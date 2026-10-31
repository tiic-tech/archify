// Service document selection and authored version metadata. The input model is
// already validated; selection never mutates it or treats shared context as ownership.
import { bindingQuestions, canonical, identity, serviceOwners } from './prd-model.mjs';

const plain = x => x && typeof x==='object' && !Array.isArray(x) && Object.getPrototypeOf(x)===Object.prototype;
function exact(x, keys) { return plain(x) && Object.keys(x).every(k=>keys.includes(k)); }
function text(x, max=1000) { return typeof x==='string' && x.trim()===x && x.length>0 && x.length<=max && !/[\r\n\0]/.test(x); }
export function validateServiceHistory(history, service, audience, previous, semantic) {
  if(!exact(history,['schemaVersion','service','audience','entries'])||history.schemaVersion!==1||history.service!==service||history.audience!==audience||!Array.isArray(history.entries)||!history.entries.length||history.entries.length>10000) throw new Error('Service history must be version 1, match the Service and audience, and contain ordered entries.');
  const versions=new Set();
  for(const entry of history.entries) {
    if(!exact(entry,['version','date','summary','references','author'])||!text(entry.version,128)||!text(entry.summary,1000)||('author' in entry&&!text(entry.author,256))||typeof entry.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)||!Number.isFinite(Date.parse(`${entry.date}T00:00:00Z`))||new Date(`${entry.date}T00:00:00Z`).toISOString().slice(0,10)!==entry.date||versions.has(entry.version)||('references' in entry && (!Array.isArray(entry.references)||entry.references.length>100||entry.references.some(x=>!text(x,1000))))) throw new Error('Service history has an invalid or duplicate entry.');
    versions.add(entry.version);
  }
  if(previous) {
    if(!Array.isArray(previous.history)||previous.history.some((entry,i)=>canonical(entry)!==canonical(history.entries[i]))) throw new Error('Service history must retain the previous entries unchanged and in order.');
    if(previous.semantic!==semantic && previous.history.length===history.entries.length) throw new Error('Service content changed without an appended authored history entry.');
  }
}

const hasForeignBindings=(view,owners,service)=>view.bindings.some(b=>owners[b.object]&&owners[b.object]!==service);

export function serviceSelection(model, service) {
  const map=new Map(model.objects.map(o=>[o.id,o])), owners=serviceOwners(model), root=map.get(service);
  if(!root||root.type!=='service') throw new Error('Service must identify a typed Service in the model.');
  const selected=new Set(), queue=[], expand=new Set();
  const add=(id,deep=false)=>{if(!map.has(id))return;const fresh=!selected.has(id),upgrade=deep&&!expand.has(id);if(fresh)selected.add(id);if(upgrade)expand.add(id);if(fresh||upgrade)queue.push(id);};
  for(const o of model.objects) if(owners[o.id]===service) add(o.id,true);
  // An explicit view association supplies reading context, not ownership.
  // Do not seed a view that the projector will reject for foreign bindings.
  for(const view of model.nativeViews) {
    if(view.service!==service||hasForeignBindings(view,owners,service))continue;
    add(view.source);
    for(const binding of view.bindings){add(binding.object);for(const target of binding.targets||[])add(target.object);}
    for(const lane of view.laneBindings||[])add(lane.role);
  }
  const children=new Map();for(const o of model.objects)if(o.parent){if(!children.has(o.parent))children.set(o.parent,[]);children.get(o.parent).push(o.id);}
  const variantServices=new Map();for(const activity of model.objects.filter(o=>o.type==='activity'&&owners[o.id]))for(const ref of activity.refs||[])if(ref.relation==='variant'){if(!variantServices.has(ref.target))variantServices.set(ref.target,new Set());variantServices.get(ref.target).add(owners[activity.id]);}
  const applicable=id=>{const o=map.get(id), variants=[...(o.type==='variant'?[o.id]:[]),...(o.refs||[]).filter(r=>r.relation==='variant').map(r=>r.target)];return variants.every(v=>!variantServices.has(v)||variantServices.get(v).has(service));};
  const fields=value=>{if(!value||typeof value!=='object')return;if(Array.isArray(value)){for(const x of value)fields(x);return;}for(const [k,v] of Object.entries(value)){if(k==='field'&&typeof v==='string')add(v);else if(k==='scope'&&Array.isArray(v)){for(const id of v)if(typeof id==='string')add(id);}else fields(v);}};
  const boundedQuestions=new Set(model.objects.flatMap(bindingQuestions));
  let cursor=0;
  for(;;){
    while(cursor<queue.length){const o=map.get(queue[cursor++]), foreign=owners[o.id]&&owners[o.id]!==service;
      if(o.parent)add(o.parent);
      if(foreign||o.type==='project') continue;
      for(const r of o.refs||[]) {if(boundedQuestions.has(o.id)&&r.relation==='target')continue;add(r.target,r.relation==='uses'&&map.get(r.target)?.type==='interface');if(o.type==='activity'&&owners[o.id]===service&&r.relation==='variant'){const variant=map.get(r.target);if(map.get(variant?.parent)?.type==='interface')add(variant.parent,true);}}
      fields(o.rule);if(!boundedQuestions.has(o.id))fields(o.detail);for(const id of bindingQuestions(o))add(id);
      if(expand.has(o.id))for(const id of children.get(o.id)||[])if((!owners[id]||owners[id]===service)&&applicable(id))add(id,true);
    }
    const before=queue.length;
    // A shared actor is reading context only when a reached, non-foreign
    // object actually names it. It does not become a containment root.
    const actors=new Set([...selected].flatMap(id=>{const o=map.get(id);return o&&(!owners[id]||owners[id]===service)?(o.refs||[]).filter(r=>r.relation==='actor').map(r=>r.target):[];}));
    const relevant=id=>{const target=map.get(id);return selected.has(id)&&target&&!['project','source'].includes(target.type)&&(target.type!=='role'||actors.has(id))&&(!owners[id]||owners[id]===service);};
    for(const o of model.objects) {
      // Only the typed endpoints establish this inverse association. Both must
      // already be in non-foreign context; a transition cannot pull in a new
      // endpoint, and remains unowned shared context rather than a root.
      if(o.type==='transition'&&!selected.has(o.id)&&!owners[o.id]) {
        const from=(o.refs||[]).filter(r=>r.relation==='from'&&r.type==='state'), to=(o.refs||[]).filter(r=>r.relation==='to'&&r.type==='state');
        if(from.length===1&&to.length===1&&[from[0],to[0]].every(r=>selected.has(r.target)&&(!owners[r.target]||owners[r.target]===service)))add(o.id);
      }
      if(!['question','evidence','decision'].includes(o.type)||selected.has(o.id)||owners[o.id])continue;
      const scope=o.detail.scope||[], targets=(o.refs||[]).filter(r=>r.relation==='target').map(r=>r.target);
      const contexts=[...scope,...targets],foreign=contexts.some(id=>owners[id]&&owners[id]!==service),local=contexts.some(id=>owners[id]===service);
      const applicable=o.type==='question'&&scope.length&&targets.length?targets.some(id=>scope.includes(id)&&relevant(id)):scope.some(relevant)||targets.some(relevant);
      if(applicable&&(!foreign||local))add(o.id);
    }
    if(before===queue.length)break;
  }
  return {selected,owners};
}

// Canonicalize record property order at the Service rendering boundary. Array
// order is authored; binary attachments and all scalar text remain unchanged.
export function orderedRecord(value) {
  if(Buffer.isBuffer(value))return value;
  if(Array.isArray(value))return value.map(orderedRecord);
  if(value && typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,orderedRecord(value[key])]));
  return value;
}

export function serviceProjection(manifest, projection, service, audience, policy) {
  const {selected,owners}=serviceSelection(manifest.model,service), all=manifest.model.objects, privateToPublic=projection.objects;
  if(audience==='client'&&!privateToPublic.has(service)) throw new Error('The selected Service must be explicitly disclosed for a client export.');
  const validView=id=>{const v=manifest.model.nativeViews.find(x=>x.id===id);return v && (!v.service||v.service===service) && (v.service===service||v.bindings.some(b=>owners[b.object]===service)) && v.bindings.some(b=>selected.has(b.object)) && !hasForeignBindings(v,owners,service);};
  for(const v of manifest.model.nativeViews)if(validView(v.id))selected.add(v.source);
  const publicIds=new Set([...selected].map(id=>audience==='client'?privateToPublic.get(id)?.id:id).filter(Boolean));
  const components=projection.components.map((c,i)=>{
    const original=manifest.components.filter(x=>(audience==='internal'||x.clientProjection==='include')&&(x.outputs.includes('document')||x.outputs.includes('appendix')))[i];
    const gaps=audience==='client'&&original?original.records.filter(r=>selected.has(r.objectId)&&!privateToPublic.has(r.objectId)&&all.find(o=>o.id===r.objectId)?.type!=='source').map(r=>policy.omitted[r.objectId]):c.gaps;
    return {...c,objects:c.objects.filter(o=>publicIds.has(o.id)),views:c.views.filter(v=>validView(v.id)),...(gaps?{gaps}: {})};
  }).filter(c=>c.objects.length||c.views.length||(c.gaps||[]).length);
  const covered=new Set(components.flatMap(c=>c.objects.map(o=>o.id)));
  const missing=all.filter(o=>selected.has(o.id)).map(o=>audience==='client'?privateToPublic.get(o.id):o).filter(o=>o&&!covered.has(o.id));
  if(missing.length)components.push({id:audience==='client'?'chapter-context':'service-context',heading:'Service context',type:'development-appendix',objects:missing,views:[]});
  const serviceObject=audience==='client'?privateToPublic.get(service):all.find(o=>o.id===service);
  return {components:components.map(c=>({...c,objects:c.objects.map(orderedRecord)})),objects:projection.objects,selected,service:orderedRecord(serviceObject),alias:audience==='client'?serviceObject.id:service};
}
export const historyIdentity = entries => identity(entries);
