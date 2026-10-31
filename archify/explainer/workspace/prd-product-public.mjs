// Validate public presentation against the source graph, then construct only
// approved aliases and facts. Omission prose is never treated as an ID.
import { validatePrd, serviceOwners, diagnostic } from './prd-model.mjs';
const fail=(loc,message,evidence={})=>{const e=new Error(message);e.diagnostics=[diagnostic('product-public',loc,message,evidence,'Approve the required public fact or correct the public plan.')];throw e;};
const relations=new Set(['actor','uses','variant','action','integration','field','rule','entity','state','from','to','api','step']);
export function validatePublicProduct(model,policy){
  if(!policy?.productDocument)fail('/disclosure/productDocument','Client product export requires a separately authored public plan.');
  const input={...model,profile:{...model.profile,productDocument:policy.productDocument}},result=validatePrd(input,{productEligible:new Set(Object.keys(policy.objects||{}))});
  if(!result.ok){const e=new Error('Public product plan is invalid.');e.diagnostics=result.diagnostics.filter(d=>d.severity==='error').map(d=>({...d,subject:{...d.subject,locator:d.subject.locator.replace(/^\/profile\/productDocument/,'/disclosure/productDocument')}}));throw e;}
}
export function remapPublicProduct(model,policy,projection,publicViews){
  const source=new Map(model.objects.map(o=>[o.id,o])), out=new Map(), owners=serviceOwners(model), seen=new Set(),children=new Map();let currentService;
  for(const o of model.objects)if(o.parent){if(!children.has(o.parent))children.set(o.parent,[]);children.get(o.parent).push(o);}
  const alias=(id,loc)=>{const o=projection.objects.get(id);if(!o)fail(loc,'Product reference is not explicitly disclosed.',{id});return o.id;};
  function include(id,loc){
    if(owners[id]&&owners[id]!==currentService)fail(loc,'Product reference belongs to another Service.',{id});if(seen.has(`${currentService}\0${id}`))return;seen.add(`${currentService}\0${id}`);const original=source.get(id),p=policy.objects[id],projected=projection.objects.get(id);if(!original||!p||!projected)fail(loc,'Required product fact is not explicitly disclosed.',{id});
    // Only facts consumed as requirements or needed for semantic context are
    // mandatory. Withheld annotations on an interface are not page content.
    const detailKeys={role:['actorKind'],activity:['actorKind'],variant:['predicate'],binding:['visibility','editable','required'],field:Object.keys(original.detail||{}),element:Object.keys(original.detail||{}),action:Object.keys(original.detail||{}),integration:Object.keys(original.detail||{}),state:Object.keys(original.detail||{}),transition:Object.keys(original.detail||{}),entity:Object.keys(original.detail||{}),acceptance:['scenario','outcome','expected']}[original.type]||[];
    const required=detailKeys.filter(k=>Object.hasOwn(original.detail,k)).map(k=>`detail.${k}`);
    if(original.type==='rule')required.push('rule');
    for(const field of required)if(!p.fields.includes(field)&&!(original.type==='field'&&field.startsWith('detail.')&&Object.hasOwn(p.withheld||{},field)))fail(`/disclosure/objects/${id}/fields`,'A product requirement is not disclosed.',{field});
    if(original.parent){
      if(p.parent!==true&&['binding','element','section','variant','state','transition','activity','journey'].includes(original.type))fail(`/disclosure/objects/${id}/parent`,'Product context requires an explicitly disclosed parent.');
      if(p.parent===true)include(original.parent,loc);
    }
    for(const r of original.refs||[])if(relations.has(r.relation)){
      const approved=p.relations?.some(x=>x.relation===r.relation&&x.target===r.target);
      const requiredField=r.relation==='field'&&['binding','element','action','integration','state','transition','entity'].includes(original.type);
      const approvedContext=['binding','element','field','variant'].includes(original.type)&&['field','rule','variant'].includes(r.relation)&&projection.objects.has(r.target);
      if((requiredField||approvedContext)&&!approved)fail(`/disclosure/objects/${id}/relations`,'Product context requires an explicitly disclosed relation.',{relation:r.relation});
      if(approved)include(r.target,loc);
    }
    function checkValues(v,key='') {if(Array.isArray(v)){for(const x of v)checkValues(x,key);return;}if(v&&typeof v==='object'){for(const [k,x] of Object.entries(v))checkValues(x,k);return;}if(typeof v==='string'&&key==='field'){include(v,loc);alias(v,loc);}}
    for(const field of p.fields)if(field.startsWith('detail.')&&field!=='detail.scope')checkValues(original.detail[field.slice(7)]);
    if(original.rule){checkValues(original.rule.condition);for(const e of original.rule.exceptions||[])if(e.scope.some(id=>projection.objects.has(id)))checkValues(e.condition);}
    const clean={...projected,detail:{...projected.detail},refs:[...projected.refs],...(p.withheld?{disclosureFields:{...p.withheld}}:{})};
    if(original.parent&&p.parent!==true)delete clean.parent;
    // Scope aliases come from explicit projection, not omission strings.
    if(clean.rule){const scopes=(ids)=>ids.filter(target=>projection.objects.has(target)).map(target=>{include(target,loc);return alias(target,loc);});clean.rule={...clean.rule,scope:scopes(original.rule.scope),exceptions:(original.rule.exceptions||[]).map((e,i)=>({...clean.rule.exceptions[i],scope:scopes(e.scope)})).filter(e=>e.scope.length)};if(!clean.rule.scope.length)fail(loc,'Product rule has no explicitly disclosed scope.');}
    out.set(clean.id,clean);
  }
  const plan=structuredClone(policy.productDocument);
  function requireRelation(id,relation,target,loc){if(!policy.objects[id]?.relations?.some(r=>r.relation===relation&&r.target===target))fail(loc,'Product context requires an explicitly disclosed relation.',{id,relation,target});}
  function requireReachable(u,page,loc){
    const reached=new Set(),fieldUses=new Set(),queue=[u.activity,...(page?[page.interface,page.variant].filter(Boolean):[])];
    for(let i=0;i<queue.length;i++){const id=queue[i],o=source.get(id),p=policy.objects[id];if(!o||!p||reached.has(id))continue;reached.add(id);
      for(const r of o.refs||[])if(['action','integration','field','entity','state','from','to'].includes(r.relation)&&p.relations?.some(x=>x.relation===r.relation&&x.target===r.target)){queue.push(r.target);if(r.relation==='field'&&['binding','element','action'].includes(o.type))fieldUses.add(r.target);}
      for(const child of children.get(id)||[])if(policy.objects[child.id]?.parent===true&&(child.type!=='variant'||child.id===page?.variant)&&(!(child.refs||[]).some(r=>r.relation==='variant')||(child.refs||[]).filter(r=>r.relation==='variant').every(r=>r.target===page?.variant)))queue.push(child.id);
    }
    for(const id of page?page.items:u.items||[]){const o=source.get(id);if(o?.type!=='rule'&&(!reached.has(id)||(o?.type==='field'&&!fieldUses.has(id))))fail(loc,'Product item lacks an explicitly disclosed path from its activity or page.',{id});}
  }
  function objectRef(obj,key,loc){if(obj[key]===undefined)return;const id=obj[key];include(id,`${loc}/${key}`);obj[key]=alias(id,`${loc}/${key}`);}
  function list(obj,key,loc){if(!obj[key])return;obj[key]=obj[key].map((id,i)=>{include(id,`${loc}/${key}/${i}`);return alias(id,`${loc}/${key}/${i}`);});}
  function workflows(list,loc){for(const [i,w] of (list||[]).entries()){const v=publicViews.get(w.view);if(!v)fail(`${loc}/${i}/view`,'Product workflow has no approved public native view.');w.view=v.id;}}
  for(const [si,s] of plan.services.entries()){
    const loc=`/disclosure/productDocument/services/${si}`;currentService=s.service;
    const cases=new Map(s.useCases.map(u=>[u.id,u]));for(const c of s.roleChapters){for(const id of c.useCases){const u=cases.get(id),activity=source.get(u.activity);if((activity.refs||[]).some(r=>r.relation==='actor'&&r.target===c.role))requireRelation(activity.id,'actor',c.role,loc);else {const action=(activity.refs||[]).filter(r=>r.relation==='action').map(r=>source.get(r.target)).find(a=>(a?.refs||[]).some(r=>r.relation==='actor'&&r.target===c.role));if(!action)fail(loc,'Role has no explicitly modeled actor path.');requireRelation(activity.id,'action',action.id,loc);requireRelation(action.id,'actor',c.role,loc);}}if(c.journey){const journey=source.get(c.journey);if((journey.refs||[]).some(r=>r.relation==='actor'&&r.target===c.role))requireRelation(c.journey,'actor',c.role,loc);for(const id of c.useCases){const activity=cases.get(id).activity;if((journey.refs||[]).some(r=>r.relation==='step'&&r.target===activity))requireRelation(c.journey,'step',activity,loc);}}}
    for(const u of s.useCases){requireReachable(u,null,loc);for(const p of u.pages){requireRelation(u.activity,'uses',p.interface,loc);if(p.variant)requireRelation(u.activity,'variant',p.variant,loc);requireReachable(u,p,loc);}}
    objectRef(s,'service',loc);for(const [i,f] of s.features.entries())objectRef(f,'object',`${loc}/features/${i}`);workflows(s.workflows,`${loc}/workflows`);
    for(const [i,c] of s.roleChapters.entries()){const at=`${loc}/roleChapters/${i}`;objectRef(c,'role',at);objectRef(c,'journey',at);list(c,'acceptance',at);workflows(c.workflows,`${at}/workflows`);}
    for(const [i,u] of s.useCases.entries()){const at=`${loc}/useCases/${i}`;objectRef(u,'activity',at);list(u,'items',at);list(u,'questions',at);workflows(u.workflows,`${at}/workflows`);for(const [j,p] of u.pages.entries()){const pos=`${at}/pages/${j}`;objectRef(p,'interface',pos);objectRef(p,'variant',pos);list(p,'items',pos);list(p,'questions',pos);}for(const [j,e] of u.edgeCases.entries()){const pos=`${at}/edgeCases/${j}`;objectRef(e,'question',pos);objectRef(e,'rule',pos);}}
  }
  const publicOwners={};for(const [id,o] of projection.objects){const owner=owners[id];if(out.has(o.id))publicOwners[o.id]=owner&&projection.objects.has(owner)?projection.objects.get(owner).id:null;}
  return {plan,objects:[...out.values()],owners:publicOwners};
}
