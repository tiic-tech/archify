// Product-document composition. The plan controls presentation, never ownership.
// Client callers supply an independently validated and allowlisted projection.
import { diagnostic, predicateFields, questionContexts, serviceOwners, validatePrd } from './prd-model.mjs';
import { serviceSelection } from './prd-service.mjs';
import { validateProductDocumentV2 } from './prd-product-v2.mjs';

const itemTypes=['binding','field','element','action','rule','integration','state','transition','entity'];
const refs=(o,rel)=>(o?.refs||[]).filter(r=>r.relation===rel).map(r=>r.target);
const label=s=>s.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,x=>x.toUpperCase());
const unique=xs=>[...new Set(xs)];
const activityActors=(activity,map)=>unique([...refs(activity,'actor'),...(activity?.detail.actorKind==='system'?refs(activity,'action').flatMap(id=>refs(map.get(id),'actor')):[])]);
function usageContext(map,owners,u,p,ids){
  const out=new Set([owners[u.activity],u.activity,p?.interface,p?.variant].filter(Boolean));
  for(const id of ids){let o=map.get(id);const seen=new Set();while(o&&!seen.has(o.id)){seen.add(o.id);out.add(o.id);for(const field of refs(o,'field'))out.add(field);o=map.get(o.parent);}}
  return out;
}

// Include scoped requirements and their predicate/evidence dependencies even
// when the model has no outgoing reference from a selected interface.
export function productServiceSelection(model,service){
  const {selected,owners}=serviceSelection(model,service),map=new Map(model.objects.map(o=>[o.id,o]));
  for(let changed=true;changed;){changed=false;for(const o of model.objects)if(o.type==='rule'&&(!owners[o.id]||owners[o.id]===service)&&o.rule.scope.some(id=>selected.has(id)&&(!owners[id]||owners[id]===service))){
    if(!selected.has(o.id)){selected.add(o.id);changed=true;}
    for(const p of [o.rule.condition,...(o.rule.exceptions||[]).filter(e=>e.scope.some(id=>selected.has(id)&&(!owners[id]||owners[id]===service))).map(e=>e.condition)])for(const field of predicateFields(p))if(!selected.has(field.id)&&(!owners[field.id]||owners[field.id]===service)){selected.add(field.id);changed=true;}
    const queue=(o.refs||[]).filter(r=>['source','evidence','decision'].includes(r.type)).map(r=>r.target);for(let i=0;i<queue.length;i++){const id=queue[i],x=map.get(id);if(!x||owners[id]&&owners[id]!==service)continue;if(!selected.has(id)){selected.add(id);changed=true;}for(const r of x.refs||[])if(r.type==='source'&&!queue.includes(r.target))queue.push(r.target);}
  }
  // Rules reached by inverse scope can introduce explicitly scoped questions.
  // Preserve the Service boundary and include their existing provenance only.
  for(const q of model.objects)if(q.type==='question'&&!selected.has(q.id)&&(!owners[q.id]||owners[q.id]===service)){
    const authored=[...(q.detail.scope||[]),...refs(q,'target')],contexts=questionContexts(q),local=authored.some(id=>owners[id]===service),foreign=authored.some(id=>owners[id]&&owners[id]!==service);
    if((!foreign||local)&&contexts.some(id=>selected.has(id)&&(!owners[id]||owners[id]===service)&&!['project','source'].includes(map.get(id)?.type))){selected.add(q.id);changed=true;const queue=(q.refs||[]).filter(r=>['source','evidence','decision'].includes(r.type)).map(r=>r.target);for(let i=0;i<queue.length;i++){const x=map.get(queue[i]);if(!x||owners[x.id]&&owners[x.id]!==service)continue;if(!selected.has(x.id)){selected.add(x.id);changed=true;}for(const r of x.refs||[])if(r.type==='source'&&!queue.includes(r.target))queue.push(r.target);}}
  }}
  return {selected,owners};
}

// Called only after the workspace schema and base graph have validated.
export function validateProductDocument(model,{eligible}={}) {
  const plan=model.profile.productDocument;if(!plan)return [];
  if(plan.version===2)return validateProductDocumentV2(model,{eligible});
  const map=new Map(model.objects.map(o=>[o.id,o])), owners=serviceOwners(model), views=new Map(model.nativeViews.map(v=>[v.id,v]));
  const errors=[], anchors=new Set(), services=new Set();
  const error=(loc,message,evidence={},fix='Correct the product-document plan or the typed model.')=>errors.push(diagnostic('product-document',loc,message,evidence,fix));
  const anchor=(id,loc)=>{if(anchors.has(id))error(loc,'Presentation anchor is duplicated.',{id});anchors.add(id);};
  const get=(id,types,loc)=>{const o=map.get(id);if(!o||!types.includes(o.type)){error(loc,'Reference is missing or has the wrong type.',{id,expected:types,actual:o?.type||null});return null;}return o;};
  const ancestors=id=>{const result=[],seen=new Set();let o=map.get(id);while(o&&!seen.has(o.id)){seen.add(o.id);result.push(o.id);o=map.get(o.parent);}return result;};
  for(const [si,s] of plan.services.entries()) {
    const loc=`/profile/productDocument/services/${si}`, service=get(s.service,['service'],`${loc}/service`);
    if(services.has(s.service))error(`${loc}/service`,'Service occurs more than once.');services.add(s.service);if(!service)continue;
    const {selected}=productServiceSelection(model,s.service), covered=new Set(), bases=new Map();
    const local=(id,at)=>{if(!selected.has(id)||(owners[id]&&owners[id]!==s.service)){error(at,'Reference is outside the selected Service context.',{id});return false;}return true;};
    const workflow=(w,at)=>{const v=views.get(w.view);if(!v){error(`${at}/view`,'Native view does not exist.',{id:w.view});return;}if(v.diagramType!=='workflow')error(`${at}/view`,'Product workflow must reference a native workflow.',{id:w.view});if((v.service&&v.service!==s.service)||v.bindings.some(b=>owners[b.object]&&owners[b.object]!==s.service)||(!v.service&&!v.bindings.some(b=>owners[b.object]===s.service)))error(`${at}/view`,'Native view is not established in this Service context.',{id:w.view});};
    const completeWorkflow=(w,at,activities)=>{const v=views.get(w.view);if(!v)return;const bound=new Set(v.bindings.filter(b=>b.type==='activity').map(b=>b.object)),missing=unique(activities).filter(id=>!bound.has(id));if(missing.length)error(`${at}/view`,'Workflow does not cover all modeled activities for this scope.',{id:w.view,missing});};
    s.workflows.forEach((w,i)=>{const at=`${loc}/workflows/${i}`;workflow(w,at);completeWorkflow(w,at,s.useCases.map(u=>u.activity));});
    s.features.forEach((f,i)=>{const at=`${loc}/features/${i}`,o=get(f.object,['service','capability','activity'],`${at}/object`);if(o)local(o.id,`${at}/object`);});
    s.useCases.forEach((u,i)=>anchor(u.id,`${loc}/useCases/${i}/id`));
    const cases=new Map(s.useCases.map((u,i)=>[u.id,{u,i}])), usedCases=new Set(), chapterRoles=new Set(), ordered=[];
    for(const [ci,c] of s.roleChapters.entries()){
      const at=`${loc}/roleChapters/${ci}`;anchor(c.id,`${at}/id`);const role=get(c.role,['role'],`${at}/role`);if(role)local(role.id,`${at}/role`);
      if(chapterRoles.has(c.role))error(`${at}/role`,'A Service may have only one chapter for a role.',{id:c.role});chapterRoles.add(c.role);
      (c.workflows||[]).forEach((w,i)=>{const pos=`${at}/workflows/${i}`;workflow(w,pos);completeWorkflow(w,pos,c.useCases.map(id=>cases.get(id)?.u.activity).filter(Boolean));const v=views.get(w.view);if(v&&!((v.laneBindings||[]).some(b=>b.role===c.role)||v.bindings.some(b=>activityActors(map.get(b.object),map).includes(c.role))))error(`${pos}/view`,'Role workflow does not establish this role in the native view.',{id:w.view,role:c.role});});
      if(c.journey){const j=get(c.journey,['journey'],`${at}/journey`);if(j&&(owners[j.id]!==s.service||!(j.parent===c.role||refs(j,'actor').includes(c.role))))error(`${at}/journey`,'Journey must belong to this Service and role.',{id:c.journey});}
      for(const [i,id] of (c.acceptance||[]).entries()){const a=get(id,['acceptance'],`${at}/acceptance/${i}`);if(a)local(id,`${at}/acceptance/${i}`);}
      for(const [i,id] of c.useCases.entries()){
        const item=cases.get(id),pos=`${at}/useCases/${i}`;if(!item){error(pos,'Use case does not exist in this Service.',{id});continue;}
        if(usedCases.has(id))error(pos,'Use case must appear in exactly one role chapter.',{id});else {usedCases.add(id);ordered.push(item);}
        const activity=map.get(item.u.activity),actors=activityActors(activity,map);
        if(role&&(!actors.includes(c.role)||activity?.detail.actorKind!==role.detail.actorKind))error(pos,'Use case actor does not match this role chapter.',{id,role:c.role});
      }
      const steps=refs(map.get(c.journey),'step'), positions=c.useCases.map(id=>steps.indexOf(cases.get(id)?.u.activity)).filter(i=>i>=0);
      if(positions.some((n,i)=>i>0&&n<positions[i-1]))error(`${at}/useCases`,'Role tasks conflict with the authored journey step order.');
    }
    const plannedActivities=new Set(s.useCases.map(u=>u.activity));
    for(const activity of model.objects)if(activity.type==='activity'&&selected.has(activity.id)&&(!eligible||eligible.has(activity.id))&&owners[activity.id]===s.service){
      if(!plannedActivities.has(activity.id))error(`${loc}/useCases`,'Selected Service activity is not represented by a use case.',{id:activity.id});
      for(const actor of activityActors(activity,map))if(map.get(actor)?.type==='role'&&!chapterRoles.has(actor))error(`${loc}/roleChapters`,'Modeled activity actor has no role chapter.',{id:actor,activity:activity.id});
    }
    for(const [i,u] of s.useCases.entries())if(!usedCases.has(u.id)){error(`${loc}/useCases/${i}`,'Use case is not assigned to a role chapter.',{id:u.id});ordered.push({u,i});}
    for(const {u,i:ui} of ordered) {
      const at=`${loc}/useCases/${ui}`;const activity=get(u.activity,['activity'],`${at}/activity`);
      if(activity&&owners[activity.id]!==s.service)error(`${at}/activity`,'Activity is not owned by this Service.',{id:activity.id});
      (u.workflows||[]).forEach((w,i)=>workflow(w,`${at}/workflows/${i}`));
      const pageIds=new Set(u.pages.map(p=>p.interface));
      const useContexts=new Set([s.service,u.activity,...pageIds,...(u.items||[]),...u.pages.flatMap(p=>[p.variant,...p.items].filter(Boolean))]);
      const questionContext=page=>{const pages=page?[page]:u.pages,ids=[...(page?[]:u.items||[]),...pages.flatMap(p=>p.items)],ctx=usageContext(map,owners,u,page,ids);for(const p of pages){ctx.add(p.interface);if(p.variant)ctx.add(p.variant);}for(const actor of activityActors(activity,map))ctx.add(actor);if(!page)for(const e of u.edgeCases)if(e.rule)ctx.add(e.rule);const roots=[...ids,...pages.map(p=>p.variant).filter(Boolean)];for(const id of [...roots,...roots.flatMap(id=>refs(map.get(id),'field'))])for(const rule of refs(map.get(id),'rule'))if(map.get(rule)?.rule?.scope.some(id=>ctx.has(id)))ctx.add(rule);const queue=[...ctx];for(let i=0;i<queue.length;i++)for(const r of map.get(queue[i])?.refs||[])if(['evidence','decision','derivedFrom'].includes(r.relation)&&(!owners[r.target]||owners[r.target]===s.service)&&!ctx.has(r.target)){ctx.add(r.target);queue.push(r.target);}return ctx;};
      const coverQuestion=(o,ctx,pos)=>{const scope=o.detail.scope||[],targets=refs(o,'target'),contexts=questionContexts(o);if(scope.length&&targets.length&&!contexts.length)error(pos,'Question scope and target have no common context.',{id:o.id},'Align the typed scope and target references.');else if(!scope.length&&!targets.length||contexts.some(id=>ctx.has(id)))covered.add(o.id);};
      const checkQuestions=(list,where,page)=>list.forEach((id,i)=>{const pos=`${where}/${i}`,o=get(id,['question'],pos);if(o&&local(id,pos))coverQuestion(o,questionContext(page),pos);});
      checkQuestions(u.questions||[],`${at}/questions`);
      function contextFor(id,page){return new Set([s.service,u.activity,...(page?[page.interface,page.variant].filter(Boolean):[]),...ancestors(id),...refs(map.get(id),'field')]);}
      function applies(rule,contexts){return (rule.rule?.scope||[]).some(id=>contexts.has(id));}
      function checkRule(rule,ctx,pos){if(!local(rule.id,pos))return false;for(const p of [rule.rule?.condition,...(rule.rule?.exceptions||[]).filter(e=>e.scope.some(id=>ctx.has(id))).map(e=>e.condition)])for(const field of predicateFields(p))local(field.id,pos);return true;}
      function linkedRules(o,page){return unique([...refs(o,'rule'),...refs(o,'field').flatMap(id=>refs(map.get(id),'rule')),...refs(map.get(page?.variant),'rule')]);}
      function items(ids,where,page) {
        // Traverse only this activity and this page, not sibling interfaces or
        // workflow next edges. Variant children are limited to the stated state.
        const reachable=new Set(), fieldUses=new Set(), queue=[u.activity,...(page?[page.interface,page.variant].filter(Boolean):[])];
        for(let n=0;n<queue.length;n++){const id=queue[n],o=map.get(id);if(!o||reachable.has(id))continue;reachable.add(id);
          for(const r of o.refs||[])if(['action','integration','field','entity','state','from','to'].includes(r.relation)){queue.push(r.target);if(r.relation==='field'&&['binding','element','action'].includes(o.type))fieldUses.add(r.target);}
          for(const child of model.objects)if(child.parent===id&&(child.type!=='variant'||child.id===page?.variant)&&(!refs(child,'variant').length||refs(child,'variant').every(v=>v===page?.variant)))queue.push(child.id);
        }
        const valid=[];
        for(const [i,id] of ids.entries()) {
          const pos=`${where}/${i}`,o=get(id,itemTypes,pos);if(!o||!local(id,pos))continue;
          const variantIds=unique([...ancestors(id).filter(x=>map.get(x)?.type==='variant'),...refs(o,'variant')]);
          if(variantIds.length&&(!page?.variant||variantIds.some(v=>v!==page.variant)))error(pos,'Item variant does not match the page variant.',{id,variants:variantIds});
          if(o.type!=='rule'&&(!reachable.has(id)||(o.type==='field'&&!fieldUses.has(id))))error(pos,'Item is not connected to this page or activity.',{id});
          valid.push(o);
        }
        const contexts=usageContext(map,owners,u,page,valid.map(o=>o.id));
        for(const o of valid) {
          const ctx=contextFor(o.id,page);
          if(o.type==='rule') {if(!applies(o,contexts))error(where,'Rule scope does not match this usage.',{id:o.id});else if(checkRule(o,contexts,where))covered.add(o.id);continue;}
          covered.add(o.id);if(o.type==='binding')for(const f of refs(o,'field'))if(local(f,where))covered.add(f);
          for(const key of ['visibility','editable','required','predicate'])for(const field of predicateFields(o.detail?.[key]))local(field.id,where);
          for(const rid of linkedRules(o,page)) {const rule=map.get(rid);if(rule&&applies(rule,ctx)&&checkRule(rule,ctx,where))covered.add(rid);}
        }
      }
      items(u.items||[],`${at}/items`,null);
      for(const [pi,p] of u.pages.entries()) {
        const pos=`${at}/pages/${pi}`;anchor(p.id,`${pos}/id`);const page=get(p.interface,['interface'],`${pos}/interface`);
        if(page){local(page.id,`${pos}/interface`);if(!refs(activity,'uses').includes(page.id))error(`${pos}/interface`,'Page is not used by this activity.',{id:page.id});}
        if(p.variant){const v=get(p.variant,['variant'],`${pos}/variant`);if(v&&(v.parent!==p.interface||!refs(activity,'variant').includes(v.id)))error(`${pos}/variant`,'Variant must belong to the page and be used by the activity.',{id:p.variant});if(v)for(const field of predicateFields(v.detail.predicate))local(field.id,`${pos}/variant`);}
        if(p.reuse){const base=bases.get(p.reuse);if(!base||base.interface!==p.interface)error(`${pos}/reuse`,'Reuse must reference an earlier page for the same interface.',{id:p.reuse});}
        bases.set(p.id,p);checkQuestions(p.questions||[],`${pos}/questions`,p);items(p.items,`${pos}/items`,p);
        const pageContext=usageContext(map,owners,u,p,p.items);for(const rid of refs(map.get(p.variant),'rule')){const r=map.get(rid);if(r&&applies(r,pageContext)&&checkRule(r,pageContext,`${pos}/variant`))covered.add(rid);}
      }
      for(const [ei,e] of u.edgeCases.entries()){
        const pos=`${at}/edgeCases/${ei}`;
        if(e.question){const q=get(e.question,['question'],`${pos}/question`);if(q&&local(q.id,`${pos}/question`))coverQuestion(q,questionContext(),`${pos}/question`);}
        if(e.rule){const r=get(e.rule,['rule'],`${pos}/rule`);if(r&&local(r.id,`${pos}/rule`)){if(!applies(r,useContexts))error(`${pos}/rule`,'Rule scope does not match this use case.',{id:r.id});else if(checkRule(r,useContexts,`${pos}/rule`))covered.add(r.id);}}
      }
    }
    // Coverage is the union of all use cases for each activity; splitting a
    // journey into tasks does not require duplicating every page in each task.
    for(const activity of model.objects)if(activity.type==='activity'&&selected.has(activity.id)&&(!eligible||eligible.has(activity.id))&&owners[activity.id]===s.service){
      const pages=s.useCases.filter(u=>u.activity===activity.id).flatMap(u=>u.pages);
      for(const id of refs(activity,'uses'))if(map.get(id)?.type==='interface'&&(!eligible||eligible.has(id))&&!pages.some(p=>p.interface===id))error(`${loc}/useCases`,'Activity interface is not covered by a product page.',{id,activity:activity.id},'Add a page for this interface to a use case of the named activity.');
      for(const id of refs(activity,'variant')){const v=map.get(id),page=v?.parent;if(v?.type==='variant'&&(!eligible||eligible.has(id)&&eligible.has(page))&&!pages.some(p=>p.interface===page&&p.variant===id))error(`${loc}/useCases`,'Activity interface variant is not covered by a product page.',{id,interface:page,activity:activity.id},'Add a page with this interface and variant to a use case of the named activity.');}
    }
    for(const o of model.objects)if(selected.has(o.id)&&(!eligible||eligible.has(o.id))&&(!owners[o.id]||owners[o.id]===s.service)&&!covered.has(o.id)){
      const authored=o.type==='question'?[...(o.detail.scope||[]),...refs(o,'target')]:[],contexts=o.type==='question'?questionContexts(o):[],foreign=authored.some(id=>owners[id]&&owners[id]!==s.service),local=authored.some(id=>owners[id]===s.service);
      const question=o.type==='question'&&(!foreign||local)&&contexts.some(id=>selected.has(id)&&(!eligible||eligible.has(id))&&(!owners[id]||owners[id]===s.service)&&!['project','source'].includes(map.get(id)?.type));
      if(['field','binding','element','action','rule'].includes(o.type)||question)error(loc,'Selected requirement is not covered in the product document.',{id:o.id,type:o.type},question?'Place this question near the relevant task, page, or edge case.':'Place this requirement in a relevant task or page.');
    }
  }
  return errors;
}

const md=s=>String(s).replaceAll('\\','\\\\').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('|','\\|').replace(/\r?\n/g,'<br>').replace(/([\[\]`*_])/g,'\\$1');
const html=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');

// Shared by standalone product HTML and the reader's print-only product view.
const productRoot=':is(body.product-document,#print-document.product-document)';
export const productDocumentCss=`${productRoot}{color:#111;background:white;font:12pt/1.45 system-ui,sans-serif;max-width:70rem;margin:2rem auto;padding:0 1rem;overflow-wrap:break-word;word-break:normal}${productRoot},${productRoot} *{box-sizing:border-box}${productRoot} table{border-collapse:collapse;width:100%;table-layout:fixed;margin:1em 0;font:inherit}${productRoot} th,${productRoot} td{border:1px solid #888;padding:.35em;text-align:left;vertical-align:top;overflow-wrap:break-word;word-break:normal}${productRoot} table:not(.product-feature-list) th:first-child:nth-last-child(2){width:25%}${productRoot} .product-feature-list col:nth-child(1){width:12%}${productRoot} .product-feature-list col:nth-child(2){width:13%}${productRoot} .product-feature-list col:nth-child(3){width:14%}${productRoot} .product-feature-list col:nth-child(4){width:10%}${productRoot} .product-feature-list col:nth-child(5){width:13%}${productRoot} .product-feature-list col:nth-child(6){width:21%}${productRoot} .product-feature-list col:nth-child(7){width:17%}${productRoot} thead{display:table-header-group}${productRoot} tr{break-inside:avoid}${productRoot} h1,${productRoot} h2,${productRoot} h3,${productRoot} h4,${productRoot} h5,${productRoot} h6{break-after:avoid;page-break-after:avoid}${productRoot} h5,${productRoot} h6{font-size:1em}${productRoot} img{max-width:100%;height:auto}${productRoot} figure{break-inside:auto}${productRoot} .product-cell p{margin:.25em 0}${productRoot} .product-cell p:first-child{margin-top:0}${productRoot} .product-cell ul{margin:.15em 0 .5em;padding-left:1.3em}${productRoot} .product-cell li{margin:.12em 0}`;
export const productDocumentPrintCss=`${productRoot}{margin:0;max-width:none;padding:0}${productRoot} table{font-size:9.5pt}${productRoot} img{max-height:9in;object-fit:contain}`;

// Resources are supplied by the integration after its own asset/view checks:
// {views: {id:{src}}, prototypes: {interfaceOrVariantId:[{src,caption}]}}.
// A variant entry takes precedence, including an explicit empty array.
export function composeProductDocument(model,options={}) {
  const checked=validatePrd(model);if(!checked.ok){const e=new Error('Invalid product-document model.');e.diagnostics=checked.diagnostics;throw e;}
  const objects=options.reviewNeeded?model.objects.map(o=>options.reviewNeeded.has(o.id)?{...o,reviewNeeded:true}:o):model.objects;
  return composeProjectedProduct({objects,plan:model.profile.productDocument,owners:serviceOwners(model)},options);
}
// The caller must validate the source and public plan, and supply only approved
// audience facts and explicitly mapped IDs. This does not validate a partial graph.
export function composeProjectedProduct({objects,plan,owners},{service,history=[],resources={}}={}) {
  if(!plan)throw new Error('No product-document plan.');
  if(plan.version===2)throw new Error('Feature product-document rendering is not yet available.');
  const plans=service?plan.services.filter(s=>s.service===service):plan.services;if(!plans.length)throw new Error('No product-document plan for Service.');
  const map=new Map(objects.map(o=>[o.id,o])), nodes=[];
  const name=id=>map.get(id)?.title||'Not modeled';
  const sentence=s=>/[.!?]$/.test(String(s).trim())?String(s):`${s}.`;
  const needsReview=o=>Boolean(o&&(o.reviewNeeded||o.review?.causes?.length||o.review?.summaryCauses?.length));
  const notice='Technical review needed';
  const qualification=o=>needsReview(o)?`Status: ${o.status}; ${notice}`:'';
  const heading=(level,text,id)=>nodes.push({type:'heading',level,text,...(id?{id}:{})});
  const paragraph=(text,strong,id)=>nodes.push({type:'paragraph',text,...(strong?{strong:strong===true?text:strong}:{}),...(id?{id}:{})});
  const table=(headers,rows,kind)=>{if(rows.length)nodes.push({type:'table',headers,rows,...(kind?{kind}:{})});};
  const image=(src,caption)=>{if(typeof src!=='string'||!/^assets\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(src)||typeof caption!=='string'||!caption.trim())throw new Error('Product image requires an approved local asset path and caption.');nodes.push({type:'image',src,caption});};
  const predicate=p=>{if(!p)return 'Not modeled';if(Object.hasOwn(p,'constant'))return p.constant?'Always':'Never';if(p.field)return `${name(p.field)} ${{eq:'equals',ne:'is not',lt:'is less than',le:'is at most',gt:'is greater than',ge:'is at least'}[p.op]} ${JSON.stringify(p.value)}`;if(p.all)return `All of (${p.all.map(predicate).join('; ')})`;if(p.any)return `Any of (${p.any.map(predicate).join('; ')})`;if(p.not)return `Not (${predicate(p.not)})`;return 'Not modeled';};
  const value=v=>v===null?'null':Array.isArray(v)?v.map(value).join(', '):typeof v==='object'?Object.entries(v).map(([k,x])=>`${label(k)}: ${value(x)}`).join('; '):String(v);
  const rule=(o,ctx,withTitle=true)=>{if(!o.rule)return `${withTitle?`${o.title}: `:''}details not modeled`;const r=o.rule,statement=r.condition?.constant===true?r.effect:`${predicate(r.condition)} → ${r.effect}`,parts=[`${withTitle?`${o.title}: `:''}${statement}`];for(const k of ['unit','precision','time'])if(r[k]&&!(['unit','precision'].includes(k)&&/^not specified$/i.test(r[k].trim())))parts.push(`${label(k)}: ${r[k]}`);for(const e of r.exceptions||[])if(e.scope.some(id=>ctx.has(id)))parts.push(`Exception (${e.scope.filter(id=>ctx.has(id)).map(name).join(', ')}): ${e.condition?.constant===true?e.effect:`${predicate(e.condition)} → ${e.effect}`}`);if(needsReview(o))parts.push(qualification(o));return parts.join('; ');};
  const context=(u,p,o)=>{const set=new Set([owners[u.activity],u.activity,p?.interface,p?.variant,o.id,...refs(o,'field')].filter(Boolean));let parent=map.get(o.parent),seen=new Set();while(parent&&!seen.has(parent.id)){seen.add(parent.id);set.add(parent.id);parent=map.get(parent.parent);}return set;};
  const cell=description=>({type:'structured',description,groups:{}});
  const add=(c,group,text,title)=>{if(text)(c.groups[group]||=[]).push({...(title?{title}:{}),text});};
  const fieldInfo=(f,omitPurpose,primary)=>{const details=omitPurpose?[]:[f.purpose];for(const [k,v] of Object.entries(f.detail||{}))if(!(['unit','precision'].includes(k)&&typeof v==='string'&&/^not specified$/i.test(v.trim())))details.push(`${k==='dataType'?'Type':label(k)}: ${value(v)}`);for(const [k,explanation] of Object.entries(f.disclosureFields||{}))if(k.startsWith('detail.')){const key=k.slice(7);details.push(`${key==='dataType'?'Type':label(key)}: Not disclosed — ${explanation}`);}if(!primary&&needsReview(f))details.push(qualification(f));if(!primary&&f.gap)details.push(`Unresolved: ${f.gap}`);return details.filter(Boolean).join(' — ');};
  const addFields=(c,ids,primaryId,localFields=new Set())=>{for(const id of unique(ids)){const f=map.get(id);if(f?.type==='field')add(c,'Field',fieldInfo(f,c.description===f.purpose,id===primaryId||localFields.has(id)),f.title);}};
  const fieldFlag=(c,text)=>{const item=c.groups.Field?.[0];if(item&&text)item.text+=`${item.text?'; ':''}${text}`;};
  const ruleFields=(r,ctx,usage,u,p)=>{const ids=[...refs(r,'field'),...predicateFields(r.rule.condition).map(x=>x.id),...(r.rule.exceptions||[]).filter(e=>e.scope.some(id=>ctx.has(id))).flatMap(e=>predicateFields(e.condition).map(x=>x.id))];for(const id of r.rule.scope)if(ctx.has(id)){const scoped=map.get(id);if(scoped?.type==='field')ids.push(id);else if(['binding','element','action'].includes(scoped?.type))ids.push(...refs(scoped,'field'));}for(const o of usage)if(['binding','element','action'].includes(o.type)&&([...refs(o,'rule'),...refs(o,'field').flatMap(id=>refs(map.get(id),'rule'))].includes(r.id))&&r.rule.scope.some(id=>context(u,p,o).has(id)))ids.push(...refs(o,'field'));return ids;};
  const ruleSections=(c,r,ctx,includeTitle)=>{const spec=r.rule;if(!spec)return;if(spec.condition?.constant!==true)add(c,'Behavior / Conditions',predicate(spec.condition),includeTitle?r.title:null);if(includeTitle&&r.purpose!==spec.effect)add(c,'Rules',r.purpose,r.title);if(includeTitle||c.description!==spec.effect)add(c,'Rules',`${spec.effect}${needsReview(r)?` — ${qualification(r)}`:''}`,includeTitle?r.title:null);else if(needsReview(r))c.description+=` — ${qualification(r)}`;if(r.gap)add(c,'Open points',r.gap,includeTitle?r.title:null);for(const k of ['unit','precision','time'])if(spec[k]&&!(['unit','precision'].includes(k)&&/^not specified$/i.test(spec[k].trim())))add(c,'Operation',`${label(k)}: ${spec[k]}`,includeTitle?r.title:null);for(const e of spec.exceptions||[])if(e.scope.some(id=>ctx.has(id)))add(c,'Exceptions',`${e.condition?.constant===true?e.effect:`${predicate(e.condition)} → ${e.effect}`}`,`Exception (${e.scope.filter(id=>ctx.has(id)).map(name).join(', ')})`);};
  const linked=(o,ctx,p,seen,explicit,c)=>{for(const id of unique([...refs(o,'rule'),...refs(o,'field').flatMap(id=>refs(map.get(id),'rule')),...refs(map.get(p?.variant),'rule')])){const r=map.get(id);if(!r?.rule?.scope.some(id=>ctx.has(id)))continue;const text=rule(r,ctx);if(explicit.has(r.id)||seen.has(text))add(c,'Rules',`See rule: ${r.title}${needsReview(r)?`; ${qualification(r)}`:''}`);else{seen.add(text);ruleSections(c,r,ctx,true);}}};
  const row=(o,u,p,all,seen,explicit,usage,localFields,shared)=>{
    const ctx=context(u,p,o),field=o.type==='binding'?map.get(refs(o,'field')[0]):null,base=field||o,c=cell(base.purpose);
    if(field||o.type==='field')addFields(c,[(field||o).id,...(field?['visibility','editable','required'].flatMap(k=>predicateFields(o.detail[k]).map(x=>x.id)):[])],(field||o).id,localFields);else if(o.type==='rule'){const scope=new Set([...ctx,...all]);seen.add(rule(o,scope));addFields(c,ruleFields(o,scope,usage,u,p),null,localFields);ruleSections(c,o,scope,false);return [o.title,c];}else addFields(c,refs(o,'field'),null,localFields);
    if(field){for(const k of ['visibility','editable','required']){const v=o.detail[k];if(!v)continue;if(v.question){const q=map.get(v.question);add(c,'Open points',`TBC — ${q?.title||v.question} (question ${v.question}; binding ${o.id}, detail/${k})`,label(k));}else if(Object.hasOwn(v,'constant')){if(k==='visibility'){if(!v.constant)fieldFlag(c,'Hidden');}else if(k==='editable')fieldFlag(c,v.constant?'Editable':'Read-only');else if(v.constant)fieldFlag(c,'Required');else if(o.detail.editable?.constant!==false)fieldFlag(c,'Optional');}else add(c,'Behavior / Conditions',`${{visibility:'Visible',editable:'Editable',required:'Required'}[k]} when ${predicate(v)}`);}if(o.purpose!==field.purpose&&!shared('binding context',o.purpose,field.id))add(c,'Behavior / Conditions',o.purpose);}
    else if(o.type==='element'){add(c,'Behavior / Conditions',label(o.detail.kind),'Control type');if(o.detail.behavior&&o.detail.behavior!==o.purpose)add(c,'Behavior / Conditions',o.detail.behavior);for(const id of refs(o,'action'))add(c,'Operation',name(id),'Action');}
    else for(const [k,v] of Object.entries(o.detail||{})){if(k==='contracts'){const gaps=new Map();for(const [key,x] of Object.entries(v))if(Object.hasOwn(x,'value'))add(c,'Operation',value(x.value),label(key));else if(Object.hasOwn(x,'gap')){if(!gaps.has(x.gap))gaps.set(x.gap,[]);gaps.get(x.gap).push(label(key));}for(const [gap,keys] of gaps)add(c,'Open points',gap,keys.join(', '));}else add(c,'Operation',value(v),label(k));}
    if(!field&&o.type!=='element')for(const r of o.refs||[])if(['actor','state','entity','api','integration','from','to'].includes(r.relation))add(c,'Operation',name(r.target),label(r.relation));
    if(needsReview(base)){if(field||o.type==='field')fieldFlag(c,qualification(base));else add(c,'Behavior / Conditions',qualification(base));}if(field&&needsReview(o))fieldFlag(c,`Binding: ${qualification(o)}`);if(base.gap)add(c,'Open points',base.gap);if(field&&o.gap&&o.gap!==base.gap&&!shared('binding/control open point',o.gap,field.id))add(c,'Open points',o.gap,'Binding');linked(o,ctx,p,seen,explicit,c);return [field?field.title:o.title,c];
  };
  const items=(ids,u,p)=>{const objects=ids.map(id=>map.get(id)), bindings=objects.filter(o=>o.type==='binding'), fields=new Set(bindings.flatMap(o=>refs(o,'field'))), explicit=new Set(objects.filter(o=>o.type==='rule').map(o=>o.id)), all=usageContext(map,owners,u,p,ids);
    // Only explicitly placed, single-field controls with one matching binding
    // may fold. An unscoped control can share the current page variant; an
    // explicitly scoped control still requires the exact binding context.
    const folded=new Map();for(const c of objects.filter(o=>o.type==='element'&&o.detail.kind!=='column'&&refs(o,'field').length===1)){
      const variants=refs(c,'variant').sort(),matches=bindings.filter(b=>{const bv=refs(b,'variant').sort(),compatible=variants.length?JSON.stringify(bv)===JSON.stringify(variants):!bv.length||!!p?.variant&&bv.every(v=>v===p.variant);return b.parent===c.parent&&refs(b,'field')[0]===refs(c,'field')[0]&&compatible;});
      if(matches.length===1)folded.set(c.id,matches[0].id);
    }
    const localFields=new Set([...fields,...objects.filter(o=>o.type==='field').map(o=>o.id)]),common=new Map(),bindingCounts=new Map();for(const b of bindings){const id=refs(b,'field')[0];bindingCounts.set(id,(bindingCounts.get(id)||0)+1);}
    const collect=(kind,text,id)=>{if(!text)return;if(!common.has(kind))common.set(kind,new Map());const messages=common.get(kind);if(!messages.has(text))messages.set(text,new Set());messages.get(text).add(id);};
    const controlPurpose=(c,f)=>![c.title,f.title,f.purpose].includes(c.purpose)?c.purpose:null;
    const controlBehavior=(c,f)=>![c.purpose,c.title,f.title,f.purpose].includes(c.detail.behavior)?c.detail.behavior:null;
    for(const b of bindings){const f=map.get(refs(b,'field')[0]);if(bindingCounts.get(f.id)!==1)continue;if(b.purpose!==f.purpose)collect('binding context',b.purpose,f.id);if(b.gap&&b.gap!==f.gap)collect('binding/control open point',b.gap,f.id);for(const control of objects.filter(c=>folded.get(c.id)===b.id)){collect('control context',controlPurpose(control,f),f.id);collect('control behavior',controlBehavior(control,f),f.id);if(control.gap&&control.gap!==f.gap)collect('binding/control open point',control.gap,f.id);}}
    const shared=(kind,text,id)=>{const ids=common.get(kind)?.get(text);return Boolean(ids&&ids.size>1&&ids.has(id));};
    for(const [kind,messages] of common)for(const [text,ids] of messages)if(ids.size>1){const all=ids.size===fields.size&&[...fields].every(id=>ids.has(id)),scope=all?`All bound fields ${p?`on ${name(p.interface)}${p.variant?` — ${name(p.variant)}`:''}`:'in this task'}`:[...ids].map(name).join(', ');paragraph(`${scope}: ${text}`,`Shared ${kind}`);}
    const seen=new Set(), rows=objects.filter(o=>!(o.type==='field'&&fields.has(o.id))&&!folded.has(o.id)).map(o=>{const r=row(o,u,p,all,seen,explicit,objects,localFields,shared);if(r&&o.type==='binding'){for(const control of objects.filter(c=>folded.get(c.id)===o.id)){const field=map.get(refs(o,'field')[0]),purpose=controlPurpose(control,field),controlTitle=![field.title,field.purpose].includes(control.title)?control.title:null,c=r[1],behavior=controlBehavior(control,field);fieldFlag(c,`Control: ${label(control.detail.kind)}${controlTitle?` — ${controlTitle}`:''}`);if(!shared('control context',purpose,field.id))add(c,'Behavior / Conditions',purpose);if(!shared('control behavior',behavior,field.id))add(c,'Behavior / Conditions',behavior);if(needsReview(control))fieldFlag(c,`Control: ${qualification(control)}`);if(control.gap&&control.gap!==field.gap&&control.gap!==o.gap&&!shared('binding/control open point',control.gap,field.id))add(c,'Open points',control.gap,'Control');for(const id of refs(control,'action'))add(c,'Operation',name(id),'Action');linked(control,context(u,p,control),p,seen,explicit,c);}}return r;}).filter(Boolean);
    for(const id of refs(map.get(p?.variant),'rule')){const r=map.get(id);if(r?.rule?.scope.some(id=>all.has(id))&&!explicit.has(id)){const text=rule(r,all);if(!seen.has(text)){seen.add(text);const c=cell(r.purpose);addFields(c,ruleFields(r,all,objects,u,p),null,localFields);ruleSections(c,r,all,false);rows.push([r.title,c]);}}}table(['Element','Rule'],rows);};
  const questionText=q=>[q.title,q.purpose!==q.title?q.purpose:null,q.detail?.consequence?`Consequence: ${q.detail.consequence}`:null,needsReview(q)?qualification(q):null].filter(Boolean).join('; ');
  const questions=(ids,shown)=>{for(const id of ids||[])if(!shown.has(id)){shown.add(id);paragraph(questionText(map.get(id)),'Open question');}};
  const workflows=list=>{for(const w of list){const resource=resources.views?.[w.view];if(resource?.src)image(resource.src,w.caption);else paragraph(`${w.caption}: workflow image not available.`);}};
  heading(1,'Document Control');table(['Date','Note','Author'],history.map(e=>[e.date,`${e.version}: ${e.summary}`,e.author||'Not recorded']));if(!history.length)paragraph('Authored revision history not provided.');paragraph('Technical review needed: this flag does not establish customer confirmation or business approval.');
  heading(1,'System overview');for(const s of plans){const o=map.get(s.service);paragraph(`${o.title}: ${s.overview} Status: ${o.status}.${needsReview(o)?` ${notice}`:''}`);}
  heading(1,'Feature List');table(['Module','Sub-Module','Feature','Priority','Readiness','Description','Note'],plans.flatMap(s=>s.features.map(f=>{const o=map.get(f.object);return [s.module,f.subModule,o.title,o.priority||'Not modeled',o.detail.maturity||'Not modeled',o.purpose,[f.note,needsReview(o)?qualification(o):null].filter(Boolean).join('; ')];})),'feature-list');
  for(const s of plans){heading(1,s.module);heading(2,name(s.service));paragraph('Process Workflow',true);workflows(s.workflows);if(!s.workflows.length)paragraph('Workflow image not modeled.');
    const cases=new Map(s.useCases.map(u=>[u.id,u])), pages=new Map(s.useCases.flatMap(u=>u.pages.map(p=>[p.id,p])));
    for(const chapter of s.roleChapters){const role=map.get(chapter.role),journey=map.get(chapter.journey), tasks=chapter.useCases.map(id=>cases.get(id)), system=role.detail.actorKind==='system';
      heading(3,role.title,chapter.id);paragraph('Role workflow',true);workflows(chapter.workflows||[]);if(!chapter.workflows?.length)paragraph('Role workflow image not modeled.');heading(4,'Responsibilities and scope');paragraph(`${role.purpose} Service scope: ${map.get(s.service).purpose}${needsReview(role)?` ${qualification(role)}`:''}`);
      heading(4,'User Journey');if(needsReview(journey))paragraph(qualification(journey));const steps=refs(journey,'step');
      if(system)paragraph(`Automated sequence: ${sentence((steps.length?steps.map(name):tasks.map(u=>u.title)).join(' → ')||'Not modeled')} Handoff: ${sentence(journey?.detail.success||'Not modeled')}`);
      else {paragraph(`Entry / login: ${sentence(journey?.detail.entry||'Not modeled')}`);paragraph(`Dashboard / assigned tasks: ${sentence(journey?.detail.dashboard||'Not modeled')}`);paragraph(`Enter Service: ${sentence(journey?.detail.serviceAccess||'Not modeled')}`);if(journey?.detail.preconditions)paragraph(`Preconditions: ${journey.detail.preconditions}`);paragraph(`Ordered tasks: ${sentence((steps.length?steps.map(name):tasks.map(u=>u.title)).join(' → ')||'Not modeled')}`);paragraph(`Handoff / outcome: ${sentence(journey?.detail.success||'Not modeled')}`);}
      heading(4,'Pages and operations');
      for(const u of tasks){const a=map.get(u.activity),shownQuestions=new Set();heading(5,u.title,u.id);paragraph(`As ${role.title}, ${u.story} Status: ${a.status}.${needsReview(a)?` ${notice}`:''}`,'User Story');if(u.workflows?.length){paragraph('Process Workflow',true);workflows(u.workflows);}if(!u.pages.length)paragraph(system?'Automated task; no human page is modeled.':'Page entry is not modeled; description-first without a prototype.','Prototype');items(u.items||[],u,null);questions(u.questions,shownQuestions);
        for(const p of u.pages){const page=map.get(p.interface);paragraph('Prototype',true);const imgs=(p.variant&&resources.prototypes?.[p.variant])??resources.prototypes?.[p.interface]??[];if(!imgs.length)paragraph('Description-first: no approved prototype is available.');else for(const img of imgs)image(img.src,img.caption);paragraph(`${page.title}${p.variant?` — ${name(p.variant)}`:''}`,true,p.id);paragraph(`${page.purpose} ${p.entry}${needsReview(page)?` ${qualification(page)}`:''}${p.variant&&needsReview(map.get(p.variant))?` ${qualification(map.get(p.variant))}`:''}`);if(p.variant&&map.get(p.variant).detail.predicate?.constant!==true)paragraph(`State condition: ${predicate(map.get(p.variant).detail.predicate)}.`);if(p.reuse){const base=pages.get(p.reuse);nodes.push({type:'reference',target:p.reuse,text:`Shared page: ${name(base.interface)}${base.variant?` — ${name(base.variant)}`:''}`,suffix:'Variant and context differences follow.'});}items(p.items,u,p);questions(p.questions,shownQuestions);}
        paragraph(u.postconditions,'Post-conditions');if(u.edgeCases.length){paragraph('Edge case handling',true);for(const e of u.edgeCases){const q=map.get(e.question),r=map.get(e.rule),ctx=usageContext(map,owners,u,null,[...(u.items||[]),...u.pages.flatMap(p=>[p.interface,p.variant,...p.items].filter(Boolean))]);const ruleText=r?rule(r,ctx):null,placed=r&&u.pages.some(p=>p.items.includes(r.id)&&rule(r,usageContext(map,owners,u,p,p.items))===ruleText);paragraph([q?(shownQuestions.has(q.id)?`See open question: ${q.title}`:questionText(q)):null,r?(placed?`See rule: ${r.title}`:ruleText):null,e.note].filter(Boolean).join('; '));if(q)shownQuestions.add(q.id);}}else paragraph('No additional edge cases authored.','Edge case handling');
      }
      heading(4,'Open questions and acceptance');const qids=unique(tasks.flatMap(u=>[...(u.questions||[]),...u.pages.flatMap(p=>p.questions||[]),...u.edgeCases.map(e=>e.question).filter(Boolean)]));paragraph(qids.length?'Open questions are shown alongside the relevant tasks.':'No open questions selected for this role.');
      if(!chapter.acceptance?.length)paragraph('Acceptance criteria not modeled.');else for(const id of chapter.acceptance){const a=map.get(id);paragraph(`${a.title}: ${a.detail.scenario} → ${a.detail.expected} (${a.detail.outcome}; ${a.status}).${needsReview(a)?` ${notice}`:''}`);}
    }
  }
  return {version:1,nodes};
}

const cellGroups=['Field','Behavior / Conditions','Rules','Exceptions','Operation','Open points'];
const inlineTarget=id=>{if(typeof id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id))throw new Error('Unsafe document anchor.');return id;};
const markdownCell=c=>c?.type==='inline'?c.parts.map(p=>{const text=p.target?`[${md(p.text)}](#${inlineTarget(p.target)})`:md(p.text);return p.strong?`**${text}**`:text;}).join(''):c?.type==='structured'?[`**Description:** ${md(c.description)}`,...cellGroups.filter(k=>c.groups[k]?.length).map(k=>`**${md(k)}:**<br>${c.groups[k].map(item=>`• ${item.title?`**${md(item.title)}:** `:''}${md(item.text)}`).join('<br>')}`)].join('<br><br>'):md(c);
const htmlCell=c=>c?.type==='inline'?c.parts.map(p=>{const text=p.target?`<a href="#${html(inlineTarget(p.target))}">${html(p.text)}</a>`:html(p.text);return p.strong?`<strong>${text}</strong>`:text;}).join(''):c?.type==='structured'?`<div class="product-cell"><p><strong>Description:</strong> ${html(c.description)}</p>${cellGroups.filter(k=>c.groups[k]?.length).map(k=>`<p><strong>${html(k)}:</strong></p><ul>${c.groups[k].map(item=>`<li>${item.title?`<strong>${html(item.title)}:</strong> `:''}${html(item.text)}</li>`).join('')}</ul>`).join('')}</div>`:html(c);
export function renderProductMarkdown(ir){return ir.nodes.map(n=>{if(n.type==='heading')return `${'#'.repeat(n.level)} ${n.literalAmpersand?md(n.text).replaceAll('&amp;','&'):md(n.text)}${n.id?`\n\n<a id="${inlineTarget(n.id)}"></a>`:''}${(n.aliases||[]).map(id=>`\n\n<a id="${inlineTarget(id)}"></a>`).join('')}\n\n`;if(n.type==='companion')return '[Technical fact appendix](appendix.md)\n\n';if(n.type==='reference')return `[${md(n.text)}](#${n.target}). ${md(n.suffix)}\n\n`;if(n.type==='paragraph')return `${n.id?`<a id="${n.id}"></a>\n\n`:''}${n.strong?`**${md(n.strong)}**${n.strong===n.text?'':': '}`:''}${n.strong===n.text?'':markdownCell(n.text)}\n\n`;if(n.type==='image')return `![${md(n.caption)}](${n.src})\n\n`;if(n.type==='list')return `${n.items.map(item=>`- ${markdownCell(item)}`).join('\n')}\n\n`;if(n.type==='table')return `| ${n.headers.map(md).join(' | ')} |\n| ${n.headers.map(()=>'---').join(' | ')} |\n${n.rows.map(r=>`| ${r.map(markdownCell).join(' | ')} |`).join('\n')}\n\n`;throw new Error('Unknown product document node.');}).join('');}
export function renderProductHtml(ir){return ir.nodes.map(n=>{if(n.type==='heading')return `${(n.aliases||[]).map(id=>`<span id="${html(inlineTarget(id))}"></span>`).join('')}<h${n.level}${n.id?` id="${html(n.id)}"`:''}>${html(n.text)}</h${n.level}>`;if(n.type==='companion')return '<p><a href="appendix.html">Technical fact appendix</a></p>';if(n.type==='reference')return `<p><a href="#${html(n.target)}">${html(n.text)}</a>. ${html(n.suffix)}</p>`;if(n.type==='paragraph')return `<p${n.id?` id="${html(n.id)}"`:''}>${n.strong?`<strong>${html(n.strong)}</strong>${n.strong===n.text?'':': '}`:''}${n.strong===n.text?'':htmlCell(n.text)}</p>`;if(n.type==='image')return `<figure><img src="${html(n.src)}" alt="${html(n.caption)}"><figcaption>${html(n.caption)}</figcaption></figure>`;if(n.type==='list')return `<ul>${n.items.map(item=>`<li>${htmlCell(item)}</li>`).join('')}</ul>`;if(n.type==='table')return `<table${n.kind==='feature-list'?' class="product-feature-list"':''}>${n.kind==='feature-list'?'<colgroup><col><col><col><col><col><col><col></colgroup>':''}<thead><tr>${n.headers.map(x=>`<th scope="col">${html(x)}</th>`).join('')}</tr></thead><tbody>${n.rows.map(r=>`<tr>${r.map(x=>`<td>${htmlCell(x)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;throw new Error('Unknown product document node.');}).join('\n');}
