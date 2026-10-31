import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { bindingCells, bindingPublicApprovalV1, hash, identity, diagnostic, contracts, questionContexts, rejectUnsupportedBindingCells } from './prd-model.mjs';
import { componentRenderer } from './prd-components.mjs';

const esc = s => String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const md = s => String(s).replaceAll('\\','\\\\').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('|','\\|').replace(/\r?\n/g,'<br>').replace(/([\[\]`*_])/g,'\\$1');
const fail=(loc,message,evidence={},fix='Correct the disclosure policy or the model and retry.')=>{const e=new Error(message);e.diagnostics=[diagnostic('export-policy',loc,message,evidence,fix)];throw e;};
const plain=o=>o && typeof o==='object' && !Array.isArray(o) && Object.getPrototypeOf(o)===Object.prototype;
function keys(o, allowed, loc) { if(!plain(o)||Object.keys(o).some(k=>!allowed.includes(k))) fail(loc,'Expected an object with only documented properties.'); }
function text(s,loc){if(typeof s!=='string'||!s.trim()||s.length>10000) fail(loc,'Expected nonempty text of at most 10000 characters.'); return s;}
function imageExtension(mediaType, bytes) {
  if(mediaType==='image/png'&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if(mediaType==='image/jpeg'&&bytes.subarray(0,3).equals(Buffer.from([255,216,255]))) return 'jpg';
  if(mediaType==='image/webp'&&bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP') return 'webp';
  return null;
}
export function validateStandardPolicyPresence(model,plan) {
  if(plan?.version!==2)return;
  const sourceStandard=Boolean(model.profile.productDocument?.standard);
  if(sourceStandard&&!plan.standard)fail('/disclosure/productDocument/standard','Public structured PRD requires an independently authored standard root.');
  if(!sourceStandard&&plan.standard)fail('/disclosure/productDocument/standard','Public standard requires a source standard profile.');
  if(sourceStandard)for(const [mi,m] of (Array.isArray(plan.modules)?plan.modules:[]).entries())for(const [si,s] of (Array.isArray(m?.subModules)?m.subModules:[]).entries())for(const [fi,f] of (Array.isArray(s?.features)?s.features:[]).entries())if(!f?.standard)fail(`/disclosure/productDocument/modules/${mi}/subModules/${si}/features/${fi}/standard`,'Every selected public Feature requires an independently authored standard specification.');
}
// The optional set is computed by trusted export/review callers, never from a
// disclosure policy. All other projection validation remains workspace-wide.
export function projectPrd(manifest, audience, policy, bindingApprovalScope) {
  const model=manifest.model, byId=new Map(model.objects.map(o=>[o.id,o]));
  if(audience==='internal') {
    const selected=manifest.components.filter(c=>c.outputs.includes('document')||c.outputs.includes('appendix'));
    const components=selected.map(c=>({id:c.id,heading:c.heading,type:c.type,objects:c.records.map(r=>byId.get(r.objectId)),views:c.views}));
    const covered=new Set(components.flatMap(c=>c.objects.map(o=>o.id)));
    const dependencies=new Set(selected.flatMap(c=>[...c.records.flatMap(r=>r.dependencies.map(d=>d.id)),...c.views.map(v=>v.source)]));
    const missing=model.objects.filter(o=>dependencies.has(o.id)&&!covered.has(o.id));
    if(missing.length) components.push({id:'dependencies',heading:'Dependency appendix',type:'development-appendix',objects:missing,views:[]});
    return {components,objects:byId};
  }
  keys(policy,['version','components','objects','assets','omitted','views','productDocument'],'/disclosure');
  if(policy.productDocument&&!model.profile.productDocument)fail('/disclosure/productDocument','A public product plan requires a source product plan.');
  if(policy.version!==1 || !plain(policy.components)||!plain(policy.objects)) fail('/disclosure','Disclosure requires version 1, components and objects maps.');
  validateStandardPolicyPresence(model,policy.productDocument);
  const componentMap=new Map(manifest.components.map(c=>[c.id,c]));
  for(const id of Object.keys(policy.components)) if(!componentMap.has(id)||componentMap.get(id).clientProjection!=='include') fail(`/disclosure/components/${id}`,'Unknown or omitted component.');
  const permitted=new Set(manifest.components.filter(c=>c.clientProjection==='include'&&(c.outputs.includes('document')||c.outputs.includes('appendix'))).flatMap(c=>c.records.map(r=>r.objectId)));
  if(policy.omitted!==undefined&&!plain(policy.omitted)) fail('/disclosure/omitted','Omitted objects must be a map of IDs to public explanations.');
  for(const [id,explanation] of Object.entries(policy.omitted||{})){if(!permitted.has(id)||byId.get(id)?.type==='source'||Object.hasOwn(policy.objects,id)) fail(`/disclosure/omitted/${id}`,'Omitted object must be eligible, non-source, and not projected.');text(explanation,`/disclosure/omitted/${id}`);}
  const projected=new Map(), publicIds=new Set();
  const reviewNeeded=new Set(manifest.components.filter(c=>c.clientProjection==='include'&&(c.outputs.includes('document')||c.outputs.includes('appendix'))).flatMap(c=>c.records.filter(r=>r.reviewNeeded).map(r=>r.objectId)));
  for(const [id,p] of Object.entries(policy.objects)) {
    const at=`/disclosure/objects/${id}`, o=byId.get(id); keys(p,['id','title','purpose','fields','omissions','withheld','relations','parent','bindingSourceSha256'],at);
    if(!o||!permitted.has(id)||o.type==='source') fail(at,'Object is not eligible for client projection.');
    if(p.bindingSourceSha256!==undefined&&(o.type!=='binding'||typeof p.bindingSourceSha256!=='string'||!/^[a-f0-9]{64}$/.test(p.bindingSourceSha256)||(!bindingApprovalScope||bindingApprovalScope.has(id))&&p.bindingSourceSha256!==bindingPublicApprovalV1(model,o)))fail(`${at}/bindingSourceSha256`,'Binding source approval is stale or invalid.');
    if(typeof p.id!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(p.id)||publicIds.has(p.id)) fail(`${at}/id`,'Public ID must be unique and portable.');
    publicIds.add(p.id);text(p.title,`${at}/title`);text(p.purpose,`${at}/purpose`);
    if(!Array.isArray(p.fields)||new Set(p.fields).size!==p.fields.length||p.fields.some(x=>typeof x!=='string'||!(/^(detail\.[A-Za-z][A-Za-z0-9]*|rule|gap|content|priority)$/.test(x)))) fail(`${at}/fields`,'Fields must be a unique list of documented projections.');
    if(p.parent!==undefined && (p.parent!==true||!o.parent)) fail(`${at}/parent`,'Parent disclosure must be true for an object with a parent.');
    if(p.relations!==undefined) {if(!Array.isArray(p.relations))fail(`${at}/relations`,'Relations must be an array.');const seen=new Set();for(const [i,r] of p.relations.entries()){keys(r,['relation','target'],`${at}/relations/${i}`);const key=JSON.stringify([r.relation,r.target]);if(seen.has(key)||!(o.refs||[]).some(x=>x.type!=='source'&&x.relation===r.relation&&x.target===r.target))fail(`${at}/relations/${i}`,'Relation must be unique and authored, and cannot disclose a source.');seen.add(key);}}
    if(p.omissions!==undefined) {if(!plain(p.omissions)) fail(`${at}/omissions`,'Omissions must be a map of target IDs to explanations.'); for(const [target,value] of Object.entries(p.omissions)){if(!byId.has(target)) fail(`${at}/omissions/${target}`,'Unknown target.');text(value,`${at}/omissions/${target}`);}}
    const authored=[...Object.keys(o.detail).map(k=>`detail.${k}`),...['rule','gap','content','priority'].filter(k=>Object.hasOwn(o,k))];
    if(p.withheld!==undefined&&!plain(p.withheld)) fail(`${at}/withheld`,'Withheld facts must be a map of field names to public explanations.');
    for(const [field,value] of Object.entries(p.withheld||{})){if(!authored.includes(field)||p.fields.includes(field))fail(`${at}/withheld/${field}`,'Withheld field must be an authored, undisclosed field.');text(value,`${at}/withheld/${field}`);}
    for(const field of authored) if(!p.fields.includes(field)&&!p.withheld?.[field])fail(`${at}/withheld/${field}`,'An undisclosed fact needs a meaningful public explanation.');
    projected.set(id,{id:p.id,type:o.type,title:p.title,purpose:p.purpose,status:o.status,...(reviewNeeded.has(id)?{reviewNeeded:true}:{}),detail:{},refs:[]});
  }
  // A binding question is a typed dependency, not omission prose. Its public
  // scope is the intersection of the authored context and approved paths.
  const boundQuestions=new Set();
  const disclosedContexts=q=>{
    const p=policy.objects[q.id],targets=(q.refs||[]).filter(r=>r.relation==='target');
    if(Array.isArray(q.detail.scope)&&!p.fields.includes('detail.scope'))return [];
    return questionContexts(q).filter(id=>projected.has(id)&&(!targets.length||p.relations?.some(r=>r.relation==='target'&&r.target===id)));
  };
  for(const [id,p] of Object.entries(policy.objects)){
    const binding=byId.get(id);if(binding.type!=='binding')continue;
    for(const cell of bindingCells){const qid=binding.detail[cell]?.question;if(!qid||!p.fields.includes(`detail.${cell}`))continue;
      const at=`/disclosure/objects/${id}/fields/detail.${cell}`,q=byId.get(qid);
      if(q?.type!=='question'||!projected.has(qid))fail(at,'Binding question must be an explicitly projected Question.',{id:qid});
      const local=new Set();let current=binding;
      while(current&&projected.has(current.id)&&!local.has(current.id)){
        local.add(current.id);if(['interface','activity'].includes(current.type)||policy.objects[current.id]?.parent!==true)break;current=byId.get(current.parent);
      }
      if(!disclosedContexts(q).some(context=>local.has(context)))fail(at,'Binding question has no approved relevant public context.',{id:qid});
      boundQuestions.add(qid);
    }
  }
  const omission=(owner,id)=>Object.hasOwn(policy.objects[owner]?.omissions||{},id)?policy.objects[owner].omissions[id]:undefined;
  const target=(id,at,owner)=>{const p=projected.get(id);if(p)return p.id;const explanation=omission(owner,id);if(explanation)return explanation;fail(at,'A selected fact depends on an excluded object without an authored explanation.');};
  function safeValue(v,at,owner,key='') {
    if(Array.isArray(v)) return v.map((x,i)=>key==='scope' && typeof x==='string' ? target(x,`${at}/${i}`,owner) : safeValue(x,`${at}/${i}`,owner,''));
    if(plain(v)) {const out={};for(const [k,x] of Object.entries(v)) out[k]=safeValue(x,`${at}/${k}`,owner,k);return out;}
    if(typeof v==='string' && key==='field') return target(v,at,owner);
    return v;
  }
  for(const [id,p] of Object.entries(policy.objects)) {
    const o=byId.get(id), out=projected.get(id), at=`/disclosure/objects/${id}`;
    if(p.withheld && Object.keys(p.withheld).length) out.disclosureGaps=model.profile.productDocument?.version===2?Object.keys(p.withheld).sort().map(k=>p.withheld[k]):Object.values(p.withheld);
    for(const field of p.fields) {
      if(field.startsWith('detail.')) {const k=field.slice(7);if(!Object.hasOwn(o.detail,k))fail(`${at}/fields`,'Selected detail field does not exist.');
        if(o.type==='binding'&&bindingCells.includes(k)&&o.detail[k]?.question)out.detail[k]={question:projected.get(o.detail[k].question).id};
        else if(o.type==='question'&&k==='scope'&&boundQuestions.has(id))out.detail[k]=disclosedContexts(o).map(context=>projected.get(context).id);
        else out.detail[k]=safeValue(o.detail[k],`${at}/fields/${field}`,id,k);}
      else {if(!Object.hasOwn(o,field))fail(`${at}/fields`,'Selected field does not exist.');out[field]=safeValue(o[field],`${at}/fields/${field}`,id);}
    }
    if(o.parent) {if(p.parent===true) {if(!projected.has(o.parent))fail(`${at}/parent`,'Disclosed parent must be projected.');out.parent=projected.get(o.parent).id;} else {const explanation=omission(id,o.parent);if(!explanation)fail(`${at}/parent`,'An undisclosed parent needs an authored explanation.');out.parent=explanation;}}
    for(const r of o.refs||[]) {
      if(r.type==='source') continue;
      if(p.relations?.some(x=>x.relation===r.relation&&x.target===r.target)) {if(!projected.has(r.target))fail(`${at}/refs`,'Disclosed relation target must be projected.');out.refs.push({relation:r.relation,target:projected.get(r.target).id,type:r.type});}
      else {const explanation=omission(id,r.target);if(!explanation)fail(`${at}/refs`,'An undisclosed relationship needs an authored explanation.');(out.disclosureGaps ||= []).push(explanation);}
    }
  }
  if(policy.assets!==undefined&&!plain(policy.assets)) fail('/disclosure/assets','Assets must be a map.');
  // Only explicitly selected standard prototypes use the version-bound
  // approval. Historical attachments and legacy product documents retain
  // their existing independent approval contract.
  const selectedAssets=new Set(),list=x=>Array.isArray(x)?x:[];
  if(model.profile.productDocument?.standard&&policy.productDocument?.standard)for(const [mi,m] of list(policy.productDocument.modules).entries())for(const [si,s] of list(m?.subModules).entries())for(const [fi,f] of list(s?.features).entries())for(const [i,screen] of list(f?.standard?.sections?.[4]?.screens).entries())if(screen?.kind==='screen')for(const [j,id] of list(screen.assets).entries()){
    const at=`/disclosure/productDocument/modules/${mi}/subModules/${si}/features/${fi}/standard/sections/4/screens/${i}/assets/${j}`;
    const targets=[screen.interface,screen.variant].filter(Boolean);
    if(!targets.some(target=>projected.has(target)&&byId.get(target)?.assetIds?.includes(id)))fail(at,'Selected screen asset must be attached to its explicitly projected interface or variant.',{id});
    if(!Object.hasOwn(policy.assets||{},id))fail(at,'Selected screen asset requires explicit version-bound public approval.',{id});
    selectedAssets.add(id);
  }
  const publicAssets=new Map(), assetIds=new Set();
  for(const [id,p] of Object.entries(policy.assets||{})) {
    const at=`/disclosure/assets/${id}`, a=manifest.assets.find(x=>x.id===id),selected=selectedAssets.has(id);keys(p,selected?['id','caption','sha256','version']:['id','caption'],at);
    if(!a||!a.distributable||![...projected.keys()].some(key=>byId.get(key).assetIds?.includes(id))) fail(at,'Asset must be distributable and attached to a projected object.');
    if(selected){if(typeof p.sha256!=='string'||!/^[a-f0-9]{64}$/.test(p.sha256)||p.sha256!==a.sha256)fail(`${at}/sha256`,'Selected screen asset approval must match the exact content hash.');if(typeof a.version!=='string'||!a.version.trim()||p.version!==a.version)fail(`${at}/version`,'Selected screen asset approval must match its explicit source version.');}
    if(typeof p.id!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(p.id)||assetIds.has(p.id))fail(`${at}/id`,'Asset public ID must be unique and portable.');assetIds.add(p.id);text(p.caption,`${at}/caption`);
    const b=Buffer.from(a.contentBase64,'base64'), ext=imageExtension(a.mediaType,b);
    if(!ext) fail(at,'Client assets must be explicitly allowed PNG, JPEG or WebP with matching signature.');
    publicAssets.set(id,{name:`assets/${p.id}.${ext}`,caption:p.caption,bytes:b,...(selected?{id:p.id}:{})});
  }
  for(const [id,o] of projected) o.attachments=(byId.get(id).assetIds||[]).filter(a=>publicAssets.has(a)).map(a=>publicAssets.get(a));
  const components=[];
  for(const c of manifest.components) {
    if(c.clientProjection!=='include'||!(c.outputs.includes('document')||c.outputs.includes('appendix'))) continue;
    const heading=policy.components[c.id]; if(heading===undefined) fail(`/disclosure/components/${c.id}`,'Every included component needs a client-facing heading.');text(heading,`/disclosure/components/${c.id}`);
    const objects=c.records.map(r=>projected.get(r.objectId)).filter(Boolean), gaps=[];
    for(const r of c.records) if(!projected.has(r.objectId)&&byId.get(r.objectId).type!=='source') {const explanation=Object.hasOwn(policy.omitted||{},r.objectId)?policy.omitted[r.objectId]:null;if(!explanation)fail(`/disclosure/omitted/${r.objectId}`,'An omitted selected object needs a client-facing explanation.');gaps.push(explanation);}
    const required=c.requiredWhen==='always'||(c.requiredWhen==='selected'&&Boolean(c.selector.ids?.length||c.selector.scope?.length));
    if(required&&!objects.length) fail(`/disclosure/components/${c.id}`,'A required component has no client-disclosed objects.');
    components.push({id:`chapter-${components.length+1}`,heading,type:c.type,objects,gaps,views:c.views});
  }
  // The reader must distinguish approved scope aliases from omission prose,
  // which is allowed to equal another public ID. Emit aliases only for an
  // explicitly disclosed scope aliases, never private keys or hidden targets.
  const recordScopes=Object.fromEntries([...projected].filter(([id,o])=>['question','evidence','decision'].includes(o.type)&&policy.objects[id].fields.includes('detail.scope')).map(([id,o])=>[o.id,boundQuestions.has(id)?disclosedContexts(byId.get(id)).map(target=>projected.get(target).id):(byId.get(id).detail.scope||[]).filter(target=>projected.has(target)).map(target=>projected.get(target).id)]));
  const questionScopes=Object.fromEntries([...projected.values()].filter(o=>o.type==='question'&&Object.hasOwn(recordScopes,o.id)).map(o=>[o.id,recordScopes[o.id]]));
  const ruleScopes=Object.fromEntries([...projected].filter(([id,o])=>o.type==='rule'&&policy.objects[id].fields.includes('rule')).map(([id,o])=>[o.id,(byId.get(id).rule?.scope||[]).filter(target=>projected.has(target)).map(target=>projected.get(target).id)]));
  // Disclosure maps are not authored sequences. V2 consumers use the model's
  // explicit object order, while legacy projections retain their existing order.
  const objects=model.profile.productDocument?.version===2?new Map(model.objects.filter(o=>projected.has(o.id)).map(o=>[o.id,projected.get(o.id)])):projected;
  return {components,objects,questionScopes,ruleScopes,recordScopes};
}
function rows(obj) {
  const r=[];function visit(key,value){if(value===null){r.push([key,'null']);return;}if(Array.isArray(value)){if(!value.length)r.push([key,'(empty)']);else value.forEach((v,i)=>visit(`${key} [${i+1}]`,v));return;}if(plain(value)){if(!Object.keys(value).length)r.push([key,'(empty)']);else for(const [k,v] of Object.entries(value))visit(key?`${key} / ${k}`:k,v);return;}r.push([key,String(value)]);}
  for(const [k,v] of Object.entries(obj)) if(!['id','type','title','purpose','assetIds','attachments'].includes(k)) visit(k,v);
  if(['action','api','integration'].includes(obj.type) && obj.detail?.contracts) for(const k of contracts) if(!Object.hasOwn(obj.detail.contracts,k)) r.push([`detail / contracts / ${k}`,'Not modeled']);
  return r;
}
async function preparePublicViews(manifest,policy,projection,inputPath) {
  if(policy.views!==undefined&&!plain(policy.views)) fail('/disclosure/views','Views must be a map.');
  const {prepareExplainerDiagrams}=await import('../diagrams.mjs');
  // These schemas are also bound into the native-runtime identity by preparation.
  const nativeSchemas=Object.fromEntries(['workflow','lifecycle','common'].map(name=>[name,JSON.parse(fs.readFileSync(new URL(`../../schemas/${name}.schema.json`,import.meta.url)))]));
  const eligible=new Set(projection.components.flatMap(c=>c.views.map(v=>v.id))), result=new Map(), publicIds=new Set();
  for(const s of policy.productDocument?.services||[])for(const w of [...s.workflows,...s.roleChapters.flatMap(c=>c.workflows||[]),...s.useCases.flatMap(u=>u.workflows||[])])eligible.add(w.view);
  for(const m of policy.productDocument?.modules||[])for(const s of m.subModules)for(const f of s.features)if(f.workflow)eligible.add(f.workflow.view);
  const idCheck=(value,at)=>{if(typeof value!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)||['constructor','prototype','__proto__'].includes(value.toLowerCase()))fail(at,'Expected a portable public ID.');};
  for(const [id,p] of Object.entries(policy.views||{})) {
    const at=`/disclosure/views/${id}`;keys(p,['id','title','caption','context','version','sourceVersion','service','lanes','nodes','edges','states','transitions','legend'],at);
    const v=manifest.model.nativeViews.find(x=>x.id===id), original=manifest.nativeViews.find(x=>x.id===id);
    if(!v||!eligible.has(id)||!['workflow','lifecycle'].includes(v.diagramType))fail(at,'Only selected workflow and lifecycle views support explicit public preparation.');
    idCheck(p.id,`${at}/id`);if(publicIds.has(p.id))fail(`${at}/id`,'Public view ID is duplicated.');publicIds.add(p.id);
    text(p.title,`${at}/title`);text(p.caption,`${at}/caption`);text(p.context,`${at}/context`);text(p.version,`${at}/version`);text(p.sourceVersion,`${at}/sourceVersion`);
    const source=manifest.model.objects.find(o=>o.id===v.source);if(p.sourceVersion!==source.source.version)fail(`${at}/sourceVersion`,'Source version does not match this view.');
    if(p.service!==undefined&&(p.service!==v.service||projection.objects.get(p.service)?.type!=='service'))fail(`${at}/service`,'The explicit source service must be client-projected and match the authored view service.');
    const service=p.service?projection.objects.get(p.service).id:null;
    const spec=v.spec,sourcePath=`/nativeViews/${manifest.model.nativeViews.indexOf(v)}/spec`;
    // The policy locator remains stable; evidence points to the actual native
    // source, not to a nonexistent disclosure-policy "source" property.
    const sourceKeys=(value,allowed,suffix='')=>{
      const loc=`${at}/source${suffix}`,nativeSpecLocator=sourcePath+suffix;
      const fix='Review the authored native spec at the indicated model path or author a separate compatible view; independently approve its public mapping.';
      if(!plain(value))fail(loc,'The authored native source must be an object for public preparation.',{nativeSpecLocator,allowedKeys:allowed},fix);
      const unsupportedKeys=Object.keys(value).filter(key=>!allowed.includes(key));
      if(unsupportedKeys.length)fail(loc,`The authored native source has unsupported public-preparation properties: ${unsupportedKeys.join(', ')}.`,{nativeSpecLocator,unsupportedKeys,allowedKeys:allowed},fix);
    };
    let legend;
    if(p.legend!==undefined){
      const loc=`${at}/legend`, schema=nativeSchemas[v.diagramType].properties.meta.properties.legend, common=nativeSchemas.common.$defs;
      keys(p.legend,['mode','entries'],loc);
      if(p.legend.mode!==undefined&&!common.legendMode.enum.includes(p.legend.mode))fail(`${loc}/mode`,'Unknown native legend mode.');
      if(p.legend.entries!==undefined){
        if(!plain(p.legend.entries))fail(`${loc}/entries`,'Legend entries must be a map of supported native kinds.');
        for(const [kind,entry] of Object.entries(p.legend.entries)){
          const where=`${loc}/entries/${kind}`;if(!Object.hasOwn(schema.properties.entries.properties,kind))fail(where,'Unknown native legend kind.');
          keys(entry,['label','visible'],where);if(!Object.keys(entry).length)fail(where,'Legend entry must include a label or visibility.');
          if(entry.label!==undefined&&(typeof entry.label!=='string'||!entry.label.trim()||entry.label.length>common.legendEntry.properties.label.maxLength))fail(`${where}/label`,'Legend label must be nonempty and within the native limit.');
          if(entry.visible!==undefined&&typeof entry.visible!=='boolean')fail(`${where}/visible`,'Legend visibility must be boolean.');
        }
      }
      legend=structuredClone(p.legend);
    }
    if(v.diagramType==='lifecycle'){
      if(!service)fail(`${at}/service`,'A public lifecycle requires an explicitly disclosed view service.');
      if(p.lanes!==undefined||p.nodes!==undefined||p.edges!==undefined)fail(at,'Lifecycle mappings use states and transitions, not workflow mappings.');
      sourceKeys(spec,['schema_version','diagram_type','meta','mainPath','states','transitions']);
      if(!Array.isArray(spec.states)||!Array.isArray(spec.transitions)||!Array.isArray(spec.mainPath)||!plain(p.states)||!plain(p.transitions)||Object.keys(p.states).length!==spec.states.length||Object.keys(p.transitions).length!==spec.transitions.length)fail(at,'Every lifecycle state and transition requires one explicit public mapping.');
      const stateMap=new Map(),transitionMap=new Map(),aliases=new Set(),bindings=[];
      for(const [i,state] of spec.states.entries()){
        sourceKeys(state,['id','type','label','sublabel','tag','step'],`/states/${i}`);const x=p.states[state.id];keys(x,['id','label'],`${at}/states/${state.id}`);idCheck(x.id,`${at}/states/${state.id}/id`);text(x.label,`${at}/states/${state.id}/label`);if(aliases.has(x.id))fail(`${at}/states/${state.id}/id`,'Public lifecycle aliases must be unique.');aliases.add(x.id);stateMap.set(state.id,x);
        const matches=v.bindings.filter(b=>b.node===state.id),binding=matches[0];if(matches.length!==1||!projection.objects.has(binding.object))fail(`${at}/states/${state.id}`,'Every state must bind exactly one client-projected object.');bindings.push({node:x.id,object:projection.objects.get(binding.object).id,type:binding.type});
      }
      for(const [i,edge] of spec.transitions.entries()){
        sourceKeys(edge,['id','from','to','label'],`/transitions/${i}`);const x=p.transitions[edge.id];keys(x,['id','label'],`${at}/transitions/${edge.id}`);idCheck(x.id,`${at}/transitions/${edge.id}/id`);text(x.label,`${at}/transitions/${edge.id}/label`);if(aliases.has(x.id)||!stateMap.has(edge.from)||!stateMap.has(edge.to))fail(`${at}/transitions/${edge.id}`,'Transition alias must be unique and endpoints mapped.');aliases.add(x.id);transitionMap.set(edge.id,x);
      }
      if(spec.mainPath.some(id=>!stateMap.has(id)))fail(`${at}/source/mainPath`,'Every main-path state must be publicly mapped.');
      const publicSpec={schema_version:spec.schema_version,diagram_type:'lifecycle',meta:{title:p.title,output:'public-lifecycle.html',...(legend===undefined?{}:{legend})},mainPath:spec.mainPath.map(id=>stateMap.get(id).id),states:spec.states.map(s=>({id:stateMap.get(s.id).id,type:s.type,label:stateMap.get(s.id).label})),transitions:spec.transitions.map(e=>({id:transitionMap.get(e.id).id,from:stateMap.get(e.from).id,to:stateMap.get(e.to).id,label:transitionMap.get(e.id).label}))};
      let prepared;try{const out=await prepareExplainerDiagrams({meta:{locale:'en'},blocks:[{id:p.id,type:'diagram',diagramType:'lifecycle',spec:publicSpec}]},{baseDir:path.dirname(path.resolve(inputPath)),sourcePath:path.resolve(inputPath),quality:'standard'});prepared=out.diagrams[p.id];}catch(error){fail(at,'Public native preparation failed.',{reason:error.message});}
      const pair=(a,b)=>`${a}\0${b}`,expected=original.prepared.semantic.edges.map(e=>pair(stateMap.get(e.from)?.id,stateMap.get(e.to)?.id)).sort(),actual=prepared.semantic.edges.map(e=>pair(e.from,e.to)).sort();
      if(JSON.stringify(expected)!==JSON.stringify(actual)||JSON.stringify(prepared.semantic.nodes.map(n=>n.id).sort())!==JSON.stringify([...stateMap.values()].map(n=>n.id).sort()))fail(at,'Public renderer topology does not match the prepared source view.');
      result.set(id,{id:p.id,type:'lifecycle',service,caption:p.caption,context:p.context,version:p.version,prepared,specification:identity(publicSpec),bindings,lanes:[]});continue;
    }
    if(p.states!==undefined||p.transitions!==undefined)fail(at,'Workflow mappings use lanes and nodes, not lifecycle mappings.');
    sourceKeys(spec,['schema_version','diagram_type','meta','lanes','nodes','edges']);
    if(!Array.isArray(spec.lanes)||!Array.isArray(spec.nodes)||!Array.isArray(spec.edges)||!plain(p.lanes)||!plain(p.nodes))fail(at,'Workflow lanes, nodes and edges require explicit complete mappings.');
    const laneMap=new Map(),nodeMap=new Map(),aliases=new Set();
    function mapping(items, authored, target, kind, allowed) {
      if(Object.keys(authored).length!==items.length)fail(`${at}/${kind}`,'Every source item must have exactly one public mapping.');
      for(const [i,item] of items.entries()) {
        sourceKeys(item,allowed,`/${kind}/${i}`);const x=authored[item.id];keys(x,['id','label'],`${at}/${kind}/${item.id}`);idCheck(x.id,`${at}/${kind}/${item.id}/id`);text(x.label,`${at}/${kind}/${item.id}/label`);
        if(aliases.has(x.id))fail(`${at}/${kind}/${item.id}/id`,'Public lane and node IDs must be unique.');aliases.add(x.id);target.set(item.id,x);
      }
    }
    mapping(spec.lanes,p.lanes,laneMap,'lanes',['id','label']);mapping(spec.nodes,p.nodes,nodeMap,'nodes',['id','lane','col','type','label','width']);
    const bindings=[],lanes=[];
    for(const node of spec.nodes) {
      const matches=v.bindings.filter(b=>b.node===node.id), binding=matches[0];
      if(matches.length!==1||!projection.objects.has(binding.object)||!laneMap.has(node.lane))fail(`${at}/nodes/${node.id}`,'Every node must bind exactly one client-projected object and mapped lane.');
      bindings.push({node:nodeMap.get(node.id).id,object:projection.objects.get(binding.object).id,type:binding.type});
    }
    for(const lane of spec.lanes){const matches=(v.laneBindings||[]).filter(b=>b.lane===lane.id), binding=matches[0];if(matches.length!==1||!projection.objects.has(binding.role))fail(`${at}/lanes/${lane.id}`,'Every lane must bind exactly one client-projected role.');lanes.push({lane:laneMap.get(lane.id).id,role:projection.objects.get(binding.role).id});}
    const explicit=p.edges!==undefined, edgeSchema=nativeSchemas.workflow.properties.edges.items.properties;
    if(explicit&&!plain(p.edges))fail(`${at}/edges`,'Workflow edges must be a map of source IDs to public mappings.');
    if(explicit&&Object.keys(p.edges).length!==spec.edges.length)fail(`${at}/edges`,'Every source edge must have exactly one public mapping.');
    const sourceEdgeIds=new Set();
    const edges=spec.edges.map((edge,i)=>{
      const loc=`${at}/source/edges/${i}`;sourceKeys(edge,['id','from','to','label','role','route'],`/edges/${i}`);
      if(!nodeMap.has(edge.from)||!nodeMap.has(edge.to))fail(loc,'Edge endpoints must be publicly mapped.');
      if(!explicit&&['label','role','route'].some(k=>Object.hasOwn(edge,k)))fail(loc,'Labeled or role/routing edges require explicit public mappings for every edge.');
      if(edge.role!==undefined&&!edgeSchema.role.enum.includes(edge.role))fail(`${loc}/role`,'Unknown native edge role.');
      if(edge.route!==undefined&&!edgeSchema.route.enum.includes(edge.route))fail(`${loc}/route`,'Unknown native edge route.');
      let id=`edge${i+1}`,label;
      if(explicit){
        if(typeof edge.id!=='string'||!edge.id||sourceEdgeIds.has(edge.id))fail(`${loc}/id`,'Explicit edge mappings require unique stable source edge IDs.');sourceEdgeIds.add(edge.id);
        const where=`${at}/edges/${edge.id}`, x=Object.hasOwn(p.edges,edge.id)?p.edges[edge.id]:undefined;keys(x,['id','label'],where);idCheck(x.id,`${where}/id`);text(x.label,`${where}/label`);
        if(aliases.has(x.id))fail(`${where}/id`,'Public lane, node and edge IDs must be unique within the view.');aliases.add(x.id);id=x.id;label=x.label;
      }
      return {id,from:nodeMap.get(edge.from).id,to:nodeMap.get(edge.to).id,...(explicit?{label}:{}),...(edge.role===undefined?{}:{role:edge.role}),...(edge.route===undefined?{}:{route:edge.route})};
    });
    const publicSpec={schema_version:spec.schema_version,diagram_type:'workflow',meta:{title:p.title,locale:'en',output:'public-workflow.html',...(legend===undefined?{}:{legend})},lanes:spec.lanes.map(x=>({id:laneMap.get(x.id).id,label:laneMap.get(x.id).label})),nodes:spec.nodes.map(x=>({id:nodeMap.get(x.id).id,lane:laneMap.get(x.lane).id,col:x.col,type:x.type,label:nodeMap.get(x.id).label,...(x.width===undefined?{}:{width:x.width})})),edges};
    let prepared;try {const out=await prepareExplainerDiagrams({meta:{locale:'en'},blocks:[{id:p.id,type:'diagram',diagramType:'workflow',spec:publicSpec}]},{baseDir:path.dirname(path.resolve(inputPath)),sourcePath:path.resolve(inputPath),quality:'standard'});prepared=out.diagrams[p.id];}catch(error){fail(at,'Public native preparation failed.',{reason:error.message});}
    const pair=(a,b)=>`${a}\0${b}`;const expectedEdges=original.prepared.semantic.edges.map(e=>pair(nodeMap.get(e.from)?.id,nodeMap.get(e.to)?.id)).sort();const actualEdges=prepared.semantic.edges.map(e=>pair(e.from,e.to)).sort();
    if(JSON.stringify(expectedEdges)!==JSON.stringify(actualEdges)||JSON.stringify(prepared.semantic.nodes.map(n=>n.id).sort())!==JSON.stringify([...nodeMap.values()].map(n=>n.id).sort()))fail(at,'Public renderer topology does not match the prepared source view.');
    result.set(id,{id:p.id,type:'workflow',service,caption:p.caption,context:p.context,version:p.version,prepared,specification:identity(publicSpec),bindings,lanes});
  }
  return result;
}
function standaloneSvg(prepared) {
  // The native SVG relies on the Viewer stylesheet for its semantic colours.
  // Copy the frozen native head styles and fix the export to light theme; keep
  // the prepared geometry and contents intact. XML-escape CSS text.
  const head=prepared.html.slice(0,prepared.html.indexOf('<body'));
  const styles=[...head.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
  if(!styles) throw new Error('Prepared native stylesheet is missing.');
  const xml=styles.replaceAll('&','&amp;').replaceAll('<','&lt;');
  if(!/^<svg\b/.test(prepared.svg)) throw new Error('Prepared native SVG is missing.');
  return prepared.svg.replace(/^<svg\b([^>]*)>/,(_match,attrs)=>`<svg xmlns="http://www.w3.org/2000/svg" data-theme="light"${attrs.replace(/\s+(?:xmlns|data-theme)="[^"]*"/g,'')}><style>${xml}</style>`);
}
export async function renderPrd(manifest,{audience,policy,inputPath,markdownOnly=false,service} = {}) {
  if(manifest.model.profile.productDocument?.version===2){
    const publicModule=audience==='client'?await import('./prd-product-public-v2.mjs'):null;
    const bindingScope=service&&publicModule?publicModule.publicServiceBindingScopeV2(manifest.model,policy,service.id):undefined;
    let projection=projectPrd(manifest,audience,policy,bindingScope), publicViews=new Map(), publicProduct;
    if(audience==='client'){
      if(!policy?.productDocument||policy.productDocument.version!==2)fail('/disclosure/productDocument','Client Feature export requires a separately authored v2 plan.');
      publicViews=await preparePublicViews(manifest,policy,projection,inputPath);
      // Match the authored native-view sequence, not disclosure map order.
      publicViews=new Map(manifest.model.nativeViews.filter(v=>publicViews.has(v.id)).map(v=>[v.id,publicViews.get(v.id)]));
      publicProduct=publicModule.projectPublicFeatureDocument(manifest,policy,projection,publicViews,bindingScope);
      if(publicProduct.plan.standard){
        const {numberStandardWorkflow}=await import('./prd-prepare.mjs'),{prepareExplainerDiagrams}=await import('../diagrams.mjs');
        publicProduct.standardViews=[];
        for(const f of publicProduct.plan.modules.flatMap(m=>m.subModules.flatMap(s=>s.features)))if(f.workflow){
          const view=[...publicViews.values()].find(v=>v.id===f.workflow.view);if(!view)fail('/disclosure/productDocument','Approved standard workflow is unavailable.');
          const spec=numberStandardWorkflow(view.prepared.spec,f.standard.sections[3].steps);
          let prepared;try{const out=await prepareExplainerDiagrams({meta:{locale:'en'},blocks:[{id:view.id,type:'diagram',diagramType:'workflow',spec}]},{baseDir:path.dirname(path.resolve(inputPath)),sourcePath:path.resolve(inputPath),quality:'standard'});prepared=out.diagrams[view.id];}catch(error){fail('/disclosure/productDocument','Numbered public workflow preparation failed.',{reason:error.message});}
          const pairs=x=>x.semantic.edges.map(e=>`${e.from}\0${e.to}`).sort();if(JSON.stringify(pairs(prepared))!==JSON.stringify(pairs(view.prepared)))fail('/disclosure/productDocument','Numbered public workflow changed its topology.');
          publicProduct.standardViews.push({feature:f.id,view:view.id,prepared});
        }
      }
    }
    if(service){const {serviceProjection}=await import('./prd-service.mjs');projection=serviceProjection(manifest,projection,service.id,audience,policy);}
    const {renderFeatureExport}=await import('./prd-feature-export.mjs');
    return renderFeatureExport(manifest,{audience,policy,projection,publicViews,publicProduct,service,markdownOnly,standaloneSvg,imageExtension});
  }
  if(manifest.model.profile.productDocument){
    const bindingScope=service&&audience==='client'?(await import('./prd-service.mjs')).serviceSelection(manifest.model,service.id).selected:undefined;
    let projection=projectPrd(manifest,audience,policy,bindingScope), publicViews=new Map(), publicProduct;
    if(audience==='client')rejectUnsupportedBindingCells(manifest.model.objects,new Set(projection.objects.keys()));
    if(audience==='client'){
      const {validatePublicProduct,remapPublicProduct}=await import('./prd-product-public.mjs');
      validatePublicProduct(manifest.model,policy);publicViews=await preparePublicViews(manifest,policy,projection,inputPath);
      publicProduct=remapPublicProduct(manifest.model,policy,projection,publicViews);
    }
    if(service){const {serviceProjection}=await import('./prd-service.mjs');projection=serviceProjection(manifest,projection,service.id,audience,policy);}
    const {renderProductExport}=await import('./prd-product-export.mjs');
    return renderProductExport(manifest,{audience,policy,projection,publicViews,publicProduct,service,markdownOnly,standaloneSvg,imageExtension,rows});
  }
  const bindingScope=service&&audience==='client'?(await import('./prd-service.mjs')).serviceSelection(manifest.model,service.id).selected:undefined;
  let projection=projectPrd(manifest,audience,policy,bindingScope), orderServiceRecord;
  const files=new Map(), usedAnchors=new Set(), viewFacts=new Map();
  const referenced=manifest.model.profile.documentLayout==='referenced';
  const publicViews=audience==='client'?await preparePublicViews(manifest,policy,projection,inputPath):new Map();
  if(service) {
    const {serviceProjection,orderedRecord}=await import('./prd-service.mjs');
    orderServiceRecord=orderedRecord;
    projection=serviceProjection(manifest,projection,service.id,audience,policy);
    service.initialize(manifest,projection,publicViews);
    manifest={...manifest,revision:service.semantic,components:manifest.components.map(c=>({...c,records:c.records.filter(r=>projection.selected.has(r.objectId))}))};
  }
  let budget=0;for(const c of projection.components) for(const o of c.objects){const {attachments,...facts}=o;budget+=Buffer.byteLength(JSON.stringify(facts));if(budget>16*1024*1024) fail('/profile/components','Selected repeated object data exceeds the 16 MiB export budget.');}
  const heading=service?`PRD — ${projection.service.title}`:`PRD — ${audience==='internal'?'Internal authoring (private)':'Client reading projection'}`;
  const intro=`Revision: ${manifest.revision}. Technical export only; it does not imply customer confirmation.`;
  let markdown=`# ${md(heading)}\n\n${md(intro)}\n\n`, body=markdownOnly?'':`<h1>${esc(heading)}</h1><p>${esc(intro)}</p>`;
  if(service){const entries=service.history.entries, current=entries.at(-1), authors=entries.some(e=>e.author!==undefined);markdown+=`${md(projection.service.purpose)}\n\nAudience: ${audience==='internal'?'Internal authoring (private)':'Client reading projection'}  \nService: ${md(projection.alias)}  \nVersion: ${md(current.version)}  \nParent: ${md(entries.at(-2)?.version||'none')}  \nDate: ${md(current.date)}  \nSummary: ${md(current.summary)}\n\n## Authored revision history\n\n| Version | Date | Summary |${authors?' Author |':''} References |\n| --- | --- | --- |${authors?' --- |':''} --- |\n${entries.map(e=>`| ${md(e.version)} | ${md(e.date)} | ${md(e.summary)} |${authors?` ${md(e.author??'Not recorded')} |`:''} ${(e.references||[]).map(md).join('; ')} |`).join('\n')}\n\n`;}
  if(audience==='client') {const note='Only explicitly approved public native views and distributable image assets are included; source originals and locators remain private.';markdown+=`${md(note)}\n\n`;if(!markdownOnly)body+=`<p>${esc(note)}</p>`;}
  if(referenced){markdown+='Main PRD. [Full authored fact appendix](appendix.md) accompanies this document.\n\n';if(!markdownOnly)body+='<p>Main PRD. <a href="appendix.html">Full authored fact appendix</a> accompanies this document.</p>';}
  const assetMap=new Map(manifest.assets.map(a=>[a.id,a]));
  const displayMap=new Map(projection.components.flatMap(c=>c.objects.map(o=>[o.id,o])));
  const renderer=componentRenderer([...displayMap.values()],id=>{const a=`object-${id}`;if(usedAnchors.has(a))return null;usedAnchors.add(a);return a;},()=>fail('/profile/components','Projected component text exceeds the 16 MiB budget.'),{html:!markdownOnly,referenced});
  for(const c of projection.components) {
    markdown+=`## ${md(c.heading)}\n\n`;if(!markdownOnly)body+=`<section><h2>${esc(c.heading)}</h2>`;
    if(!c.objects.length){const empty=audience==='client'?'No client-disclosed items in this section.':'No modeled items in this section.';markdown+=`${empty}\n\n`;if(!markdownOnly)body+=`<p>${empty}</p>`;}
    for(const gap of c.gaps||[]){markdown+=`Disclosure gap: ${md(gap)}\n\n`;if(!markdownOnly)body+=`<p>Disclosure gap: ${esc(gap)}</p>`;}
    const rendered=service?service.renderComponent(c,displayMap,usedAnchors,renderer,referenced):renderer.render(c);markdown+=rendered.markdown;if(!markdownOnly)body+=rendered.html;
    for(const o of c.objects){
      if(o.type==='binding')for(const k of bindingCells){const id=o.detail[k]?.question,q=displayMap.get(id);if(q){const label=`${o.title} (${o.id}) — detail/${k}: TBC — question ${id}`;markdown+=`${md(label)}: [${md(q.title)}](#object-${id})\n\n`;if(!markdownOnly)body+=`<p>${esc(label)}: <a href="#object-${esc(id)}">${esc(q.title)}</a></p>`;}}
      for(const ref of o.refs||[]) if(ref.target && displayMap.has(ref.target)) {const title=displayMap.get(ref.target).title,source=referenced&&ref.relation==='derivedFrom', mdTarget=source?`appendix.md#fact-${ref.target}`:`#object-${ref.target}`, htmlTarget=source?`appendix.html#fact-${ref.target}`:`#object-${ref.target}`;markdown+=`${md(o.title)} — ${md(ref.relation)}: [${md(title)}](${mdTarget})\n\n`;if(!markdownOnly)body+=`<p>${esc(o.title)} — ${esc(ref.relation)}: <a href="${esc(htmlTarget)}">${esc(title)}</a></p>`;}
      if(audience==='internal' && o.type==='interface' && !o.assetIds?.length){markdown+=`${md(o.title)} prototype: not modeled.\n\n`;if(!markdownOnly)body+=`<p>${esc(o.title)} prototype: not modeled.</p>`;}
      if(audience==='client') for(const a of o.attachments||[]){files.set(a.name,a.bytes);markdown+=`![${md(a.caption)}](${a.name})\n\n`;if(!markdownOnly)body+=`<figure><img src="${esc(a.name)}" alt="${esc(a.caption)}"><figcaption>${esc(o.title)}: ${esc(a.caption)}</figcaption></figure>`;}
      if(audience==='internal') for(const id of o.assetIds||[]){const a=assetMap.get(id),name=`assets/${a.sha256}-${a.name}`;const bytes=Buffer.from(a.contentBase64,'base64');files.set(name,bytes);const image=imageExtension(a.mediaType,bytes),caption=a.caption||a.name,provenance=(o.refs||[]).filter(r=>r.relation==='derivedFrom').map(r=>`${displayMap.get(r.target)?.title||r.target} (${r.locator})`).join(', ')||'not specified',metadata=`Version: ${a.version||'not specified'}; provenance: ${provenance}; limitations: ${a.limitations||'not specified'}; SHA-256 ${a.sha256}; distributable: ${a.distributable}`;markdown+=`${md(o.title)} asset: [${md(caption)}](${name}) (${md(metadata)})\n\n`;if(!markdownOnly)body+=`<p>${esc(o.title)} asset: <a download href="${esc(name)}">${esc(caption)}</a> (${esc(metadata)})</p>`;if(image){markdown+=`![${md(caption)}](${name})\n\n`;if(!markdownOnly)body+=`<figure><img src="${esc(name)}" alt="${esc(caption)}"><figcaption>${esc(o.title)}: ${esc(caption)} — ${esc(metadata)}</figcaption></figure>`;}}
    }
    if(audience==='client') for(const view of c.views){const v=publicViews.get(view.id);if(!v){const gap='Native view not disclosed; an approved public representation is not available.';markdown+=`${gap}\n\n`;if(!markdownOnly)body+=`<p>${gap}</p>`;continue;}const name=`assets/native-${v.id}.svg`;files.set(name,service?service.renderResource(v.prepared,()=>Buffer.from(standaloneSvg(v.prepared))):Buffer.from(standaloneSvg(v.prepared)));markdown+=`![${md(v.caption)}](${name})\n\n${md(v.context)} — version ${md(v.version)}${referenced?` — overview; [full vector](${name})`:''}\n\n`;if(!markdownOnly)body+=`<figure><img src="${esc(name)}" alt="${esc(v.caption)}"><figcaption>${esc(v.caption)} — ${esc(v.context)} — version ${esc(v.version)}${referenced?` — overview; <a href="${esc(name)}">full vector</a>`:''}</figcaption></figure>`;}
    if(audience==='internal') for(const view of c.views){const v=manifest.nativeViews.find(x=>x.id===view.id);const name=`assets/native-${v.id}.svg`;files.set(name,service?service.renderResource(v.prepared,()=>Buffer.from(standaloneSvg(v.prepared))):Buffer.from(standaloneSvg(v.prepared)));const source=manifest.model.objects.find(o=>o.id===v.source);const full=`Native diagram ${v.id}; model revision ${manifest.revision}; source ${v.source}, version ${source.source.version}, source hash ${source.source.sha256}, locator ${v.anchor.locator}, quote “${v.anchor.quote}”; specification ${view.sha256}; native HTML ${v.prepared.sha256}`;const label=referenced?`Native diagram ${v.id} (overview; use the full vector for detail)`:full;if(referenced)viewFacts.set(v.id,full);markdown+=`![${md(label)}](${name})\n\n${referenced?`[Full vector](${name}) · [Diagram source record](appendix.md#view-${v.id})\n\n`:''}`;if(!markdownOnly)body+=`<figure><img src="${esc(name)}" alt="${esc(label)}"><figcaption>${esc(label)}${referenced?` — <a href="${esc(name)}">Full vector</a> — <a href="appendix.html#view-${esc(v.id)}">Diagram source record</a>`:''}</figcaption></figure>`;}
    if(!markdownOnly)body+='</section>';
  }
  if(audience==='internal'){
    const selected=service?projection.selected:new Set(manifest.components.filter(c=>c.outputs.includes('document')||c.outputs.includes('appendix')).flatMap(c=>c.records.map(r=>r.objectId))),selectedObjects=manifest.model.objects.filter(o=>selected.has(o.id));
    const history=(manifest.model.reviewHistory||[]).filter(h=>selected.has(h.objectId)||selectedObjects.some(o=>[...(o.review?.causes||[]),...(o.review?.summaryCauses||[])].includes(h.proposalId)));
    if(history.length){markdown+='## Technical review lineage\n\n';if(!markdownOnly)body+='<section><h2>Technical review lineage</h2>';for(const h of history){const affected=selectedObjects.filter(o=>o.review?.causes?.includes(h.proposalId)).map(o=>o.id),summaries=selectedObjects.filter(o=>o.review?.summaryCauses?.includes(h.proposalId)).map(o=>o.id),facts={...h,affected,ownerSummaries:summaries};markdown+=`### ${md(h.proposalId)}\n\n| Fact | Value |\n| --- | --- |\n`;if(!markdownOnly)body+=`<h3>${esc(h.proposalId)}</h3><table><thead><tr><th>Fact</th><th>Value</th></tr></thead><tbody>`;for(const [k,v] of rows(service?orderServiceRecord(facts):facts)){markdown+=`| ${md(k)} | ${md(v)} |\n`;if(!markdownOnly)body+=`<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`;}markdown+='\n';if(!markdownOnly)body+='</tbody></table>';}if(!markdownOnly)body+='</section>';}
  }
  let appendixMd='## Complete authored fact appendix\n\n', appendixBody=markdownOnly?'':'<section><h2>Complete authored fact appendix</h2>';
  for(const o of displayMap.values()){appendixMd+=`${referenced?`<a id="fact-${o.id}"></a>\n\n`:''}### ${md(o.title)}\n\n| Fact | Value |\n| --- | --- |\n`;if(!markdownOnly)appendixBody+=`<h3${referenced?` id="fact-${esc(o.id)}"`:''}>${esc(o.title)}</h3><table><thead><tr><th>Fact</th><th>Value</th></tr></thead><tbody>`;for(const [k,v] of [...(referenced?[['id',o.id],['type',o.type],['title',o.title],['purpose',o.purpose],...(o.assetIds||[]).map(id=>['asset',id]),...(o.attachments||[]).map(a=>['attachment',`${a.name} — ${a.caption}`])]:[]),...rows(o)]){appendixMd+=`| ${md(k)} | ${md(v)} |\n`;if(!markdownOnly)appendixBody+=`<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`;}appendixMd+='\n';if(!markdownOnly)appendixBody+='</tbody></table>';}
  if(referenced)for(const [id,fact] of viewFacts){appendixMd+=`<a id="view-${id}"></a>\n\n### ${md(id)} — diagram source\n\n${md(fact)}\n\n`;if(!markdownOnly)appendixBody+=`<h3 id="view-${esc(id)}">${esc(id)} — diagram source</h3><p>${esc(fact)}</p>`;}
  if(!markdownOnly)appendixBody+='</section>';
  if(referenced){const context=`Full authored fact appendix — ${audience==='internal'?'Internal authoring (private)':'Client reading projection'}`;files.set('appendix.md',Buffer.from(`# ${md(context)}\n\n${md(intro)}\n\n[Main PRD](README.md)\n\n${appendixMd}`));if(!markdownOnly)appendixBody=`<h1>${esc(context)}</h1><p>${esc(intro)}</p><p><a href="index.html">Main PRD</a></p>${appendixBody}`;}else {markdown+=appendixMd;if(!markdownOnly)body+=appendixBody;}
  const html=markdownOnly?null:`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' file: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${esc(heading)}</title><style>html{color-scheme:light}body{color:#111;background:#fff;font:12pt/1.45 system-ui,sans-serif;max-width:70rem;margin:2rem auto;padding:0 1rem${referenced?';overflow-wrap:anywhere':''}}table{border-collapse:collapse;width:100%;table-layout:fixed;margin:1em 0}th,td{border:1px solid #888;padding:.35em;text-align:left;vertical-align:top;overflow-wrap:anywhere}table.wide{font-size:9pt}table.wide th,table.wide td{padding:.25em}thead{display:table-header-group}h2{border-bottom:1px solid #666}article,figure,tr{break-inside:avoid}img{max-width:100%;height:auto}small{font-weight:normal}@media print{body{margin:0;max-width:none}a{color:#111}section{break-before:auto}${referenced?'figure{break-inside:auto}img{max-height:9in;object-fit:contain}':''}}</style></head><body>${body}</body></html>\n`;
  if(Buffer.byteLength(markdown)>128*1024*1024||(!markdownOnly&&Buffer.byteLength(html)>128*1024*1024)) throw new Error('Export text exceeds 128 MiB.');
  files.set('README.md',Buffer.from(markdown));if(!markdownOnly){files.set('index.html',Buffer.from(html));if(referenced)files.set('appendix.html',Buffer.from(html.replace(`<body>${body}</body>`,()=>`<body>${appendixBody}</body>`)));}
  if([...files.values()].reduce((total,bytes)=>total+bytes.length,0)>128*1024*1024) fail('/profile/components','Export resources exceed the 128 MiB aggregate budget.');
  if(service) return service.finish(files,projection);
  const exportIdentity={kind:'archify-prd-export',version:1,audience,revision:manifest.revision,...(referenced?{documentLayout:'referenced'}:{}),profile:manifest.identities.profile,schema:manifest.identities.schema,preparation:audience==='internal'?manifest.identities.code:Object.fromEntries(['prd-model.mjs','prd-prepare.mjs','prd-cli.mjs','prd-feedback-schema.mjs','prd-proposal-schema.mjs','generated-prd-validators.mjs','generated-prd-feedback-browser.js','prd-feedback.mjs','prd-proposal.mjs','prd-reader-build.mjs','prd-reader-feedback.js'].map(k=>[k,manifest.identities.code[k]])),sourceManifest:audience==='internal'?manifest.digest:undefined,disclosure:audience==='client'?identity(policy):null,exporter:hash(fs.readFileSync(new URL('./prd-export.mjs',import.meta.url))),componentsRenderer:hash(fs.readFileSync(new URL('./prd-components.mjs',import.meta.url))),nativeRuntime:manifest.identities.code['native-runtime'],publicViews:audience==='client'?[...publicViews.values()].map(v=>({id:v.id,type:v.type,service:v.service,version:v.version,specification:v.specification,bindings:v.bindings,lanes:v.lanes})):undefined,artifacts:Object.fromEntries([...files].map(([name,bytes])=>[name,{sha256:hash(bytes),bytes:bytes.length}]))};
  files.set('manifest.json',Buffer.from(`${JSON.stringify(exportIdentity,null,2)}\n`));
  return {files,identity:exportIdentity,projection,publicViews};
}
async function printPdf(stage) {
  const {ChromeVisualBrowser,findChrome}=await import('../../bin/visual-check.mjs');
  if((typeof process.getuid==='function'&&process.getuid()===0)||process.env.ARCHIFY_CHROME_NO_SANDBOX==='1') throw new Error('PDF export requires a sandboxed non-root Chromium.');
  const chrome=findChrome();if(!chrome)throw new Error('Chromium is unavailable; set ARCHIFY_CHROME.');
  const browser=new ChromeVisualBrowser(chrome);
  try {
    const session=await browser.sessionPromise;
    const loaded=browser.cdp.waitFor('Page.loadEventFired',session);loaded.catch(()=>{});
    const navigation=await browser.cdp.send('Page.navigate',{url:pathToFileURL(path.join(stage,'index.html')).href},session);
    if(navigation.errorText)throw new Error(`Print navigation failed: ${navigation.errorText}`);await loaded;
    const ready=await browser.cdp.send('Runtime.evaluate',{expression:`Promise.all([document.fonts.ready,...Array.from(document.images, i=>i.decode().catch(()=>{}))]).then(()=>Array.from(document.images,i=>i.naturalWidth>0 && i.naturalHeight>0).every(Boolean))`,awaitPromise:true,returnByValue:true},session);
    if(ready.result?.value!==true) throw new Error('A print image could not be decoded.');
    // Chromium otherwise turns relative companion links into file actions that
    // name the private, soon-to-be-removed staging directory. Keep fragment
    // navigation and substantive anchor text; this mutation is print-only.
    const projection=await browser.cdp.send('Runtime.evaluate',{expression:`(() => { const referenced=Boolean(document.querySelector('a[href="appendix.html"]')); let companions=false; for (const a of document.querySelectorAll('a[href]')) { if (a.getAttribute('href').startsWith('#')) continue; companions=true; const span=document.createElement('span'); span.replaceChildren(...a.childNodes); a.replaceWith(span); } if (companions) { const note=document.createElement('p'); note.textContent=(referenced?'PDF contains the main PRD only. ':'')+'Companion appendix, source records, assets and full vectors, where included, are available in the accompanying Markdown/HTML package.'; document.querySelector('h1').after(note); } return true; })()`,returnByValue:true},session);
    if(projection.exceptionDetails || projection.result?.value!==true) throw new Error('Could not prepare the PDF print projection.');
    const result=await browser.cdp.send('Page.printToPDF',{printBackground:true,preferCSSPageSize:true},session,120000);
    const bytes=Buffer.from(result.data,'base64');if(!bytes.length||bytes.length>128*1024*1024)throw new Error('PDF is empty or exceeds 128 MiB.');return bytes;
  } finally {await browser.close();}
}
// GNU mv uses an exclusive rename for --no-clobber. Refuse unsupported platforms.
export async function publishDirectory(output,files,{pdf=false,beforePublish}={}) {
  if(process.platform!=='linux') throw new Error('Create-only directory publication currently requires Linux GNU mv.');
  const target=path.resolve(output), parent=fs.realpathSync(path.dirname(target)), name=path.basename(target);
  if(!name||name==='.'||name==='..') throw new Error('Invalid output directory.');
  const final=path.join(parent,name);
  try {fs.lstatSync(final);throw new Error('Output already exists.');} catch(error) {if(error.code!=='ENOENT')throw error;}
  const version=spawnSync('mv',['--version'],{encoding:'utf8'});
  if(version.status!==0||!version.stdout.startsWith('mv (GNU coreutils)')) throw new Error('GNU mv is required for create-only directory publication.');
  const stage=fs.mkdtempSync(path.join(parent,'.archify-prd-export-'));
  try {for(const [name,bytes] of files){const p=path.join(stage,name);fs.mkdirSync(path.dirname(p),{recursive:true,mode:0o700});fs.writeFileSync(p,bytes,{flag:'wx',mode:0o600});}
    if(pdf){const bytes=await printPdf(stage);fs.writeFileSync(path.join(stage,'document.pdf'),bytes,{flag:'wx',mode:0o600});const m=JSON.parse(files.get('manifest.json').toString('utf8'));m.optionalPdf={sha256:hash(bytes),bytes:bytes.length,nondeterministicMetadata:true};fs.writeFileSync(path.join(stage,'manifest.json'),`${JSON.stringify(m,null,2)}\n`,{mode:0o600});}
    if(beforePublish) await beforePublish();
    const move=spawnSync('mv',['--no-clobber','--no-target-directory','--',stage,final],{encoding:'utf8'});
    if(move.status!==0||fs.existsSync(stage)) throw new Error(`Output already exists or publication failed: ${move.stderr.trim()}`);
    return final;
  } finally {fs.rmSync(stage,{recursive:true,force:true});}
}
