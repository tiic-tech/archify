import { createHash } from 'node:crypto';
import { workspace as validateSchema } from './generated-prd-validators.mjs';
import { validateProductDocument } from './prd-product-document.mjs';
import { standardReadinessV1 } from './prd-standard-v1.mjs';
export const hash = value => createHash('sha256').update(value).digest('hex');
export const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}` : JSON.stringify(value);
export const identity = value => hash(canonical(value));
const reserved = new Set(['__proto__', 'prototype', 'constructor']);
const parents = { document:['project'],service:['project'],capability:['service','capability','taxonomy'],taxonomy:['project','taxonomy'],journey:['service','role'],phase:['journey','service'],activity:['phase','journey','service'],section:['interface','section'],variant:['interface'],element:['section','interface','variant'],binding:['section','interface','variant','activity'],state:['entity'],transition:['entity'] };
const relations = {
  derivedFrom: { from:'*', to:['source'] }, evidence: { from:'*',to:['evidence'] }, decision:{from:'*',to:['decision']},
  supersedes:{from:['decision','evidence','question','revision'],to:['decision','evidence','question','revision']},
  uses:{from:['activity','journey'],to:['interface']}, next:{from:['activity'],to:['activity']},
  service:{from:['journey'],to:['service']}, step:{from:['journey'],to:['activity']},
  actor:{from:['activity','journey','action','api','transition'],to:['role']},
  action:{from:['activity','element','acceptance','api','transition'],to:['action']},
  integration:{from:['activity','action','api'],to:['integration']},
  field:{from:['binding','element','action','api','entity'],to:['field']},
  rule:{from:['binding','element','field','action','api','variant','acceptance'],to:['rule']},
  variant:{from:['activity','element','binding'],to:['variant']},
  entity:{from:['action','api','integration','field','acceptance'],to:['entity']},
  state:{from:['action','acceptance','entity'],to:['state']},
  from:{from:['transition'],to:['state']},to:{from:['transition'],to:['state']},
  api:{from:['action','integration'],to:['api']}, acceptance:{from:['action','rule','activity','integration'],to:['acceptance']},
  target:{from:['question','evidence','decision','extension'],to:'*'}
};
export const contracts = ['actor','permission','input','output','guard','stateEffects','errors','audit','idempotency','concurrency','transaction','batch','externalEffects'];
export const bindingCells = ['visibility','editable','required'];
export const bindingQuestions = o => o?.type==='binding' ? [...new Set(bindingCells.map(k=>o.detail?.[k]?.question).filter(Boolean))] : [];
// Private author-side content identity; this does not itself approve disclosure.
export function bindingPublicApprovalV1(model,binding) {
  const objects=new Map(model.objects.map(o=>[o.id,o]));
  return identity({binding,questions:bindingQuestions(binding).map(id=>objects.get(id) || null)});
}
// Scope and target agree when both are authored; neither may broaden the other.
export function questionContexts(o) {
  const scope=o?.detail?.scope||[], targets=(o?.refs||[]).filter(r=>r.relation==='target').map(r=>r.target);
  return scope.length&&targets.length?scope.filter(id=>targets.includes(id)):scope.length?scope:targets;
}
export function unsupportedBindingCells(objects, selected) {
  return objects.flatMap((o,i)=>o?.type==='binding'&&(!selected||selected.has(o.id))?bindingCells.filter(k=>typeof o.detail?.[k]?.question==='string').map(k=>diagnostic('binding-unknown-unsupported',`/objects/${i}/detail/${k}`,'Question-bound binding cells are not yet supported by this client product document.',{id:o.id,question:o.detail[k].question},'Use a supported projection or an internal draft; do not guess a predicate.')):[]);
}
export function rejectUnsupportedBindingCells(objects, selected) {
  const diagnostics=unsupportedBindingCells(objects,selected);
  if(diagnostics.length){const error=new Error('Question-bound binding cells are not yet supported by this consumer.');error.diagnostics=diagnostics;throw error;}
}
export function diagnostic(code, pointer, message, evidence, fix, severity = 'error') {
  return { code:`prd/${code}`, severity, message, subject:{locator:pointer}, evidence, supportedFixes:[fix] };
}
export function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export function semanticModel(model) { const { presentation, ...semantic } = model; return semantic; }
// Resolve only explicit service containment and a validated journey service
// reference. Other references (including shared roles and sources) are not ownership.
export function serviceOwners(model) {
  const objects=new Map(model.objects.map(o=>[o.id,o]));
  return Object.freeze(Object.fromEntries(model.objects.map(object=>{
    let current=object; const seen=new Set();
    while(current&&!seen.has(current.id)) {
      seen.add(current.id);
      if(current.type==='service') return [object.id,current.id];
      if(current.type==='journey') {
        const services=(current.refs||[]).filter(r=>r.relation==='service');
        if(services.length) return [object.id,services.length===1&&objects.get(services[0].target)?.type==='service'?services[0].target:null];
      }
      current=objects.get(current.parent);
    }
    return [object.id,null];
  })));
}
export function predicateFields(predicate, locator = '') {
  const result=[], stack=predicate?[{predicate,locator}]:[];
  while(stack.length) {
    const entry=stack.pop(), p=entry.predicate;
    if(Object.hasOwn(p,'field')) result.push({id:p.field,locator:`${entry.locator}/field`});
    for(const key of ['all','any']) for(const [i,child] of (p[key]||[]).entries()) stack.push({predicate:child,locator:`${entry.locator}/${key}/${i}`});
    if(p.not) stack.push({predicate:p.not,locator:`${entry.locator}/not`});
  }
  return result;
}
function objectPredicates(object) {
  return [object.detail.predicate,object.detail.condition,object.detail.visibility,object.detail.editable,object.detail.required,object.rule?.condition];
}
export function validatePrd(input, { productEligible } = {}) {
  const diagnostics=[];
  const add=(code,loc,msg,evidence,fix,severity)=>diagnostics.push(diagnostic(code,loc,msg,evidence,fix,severity));
  if (!validateSchema(input)) {
    for(const e of validateSchema.errors) add('schema',e.instancePath||'/',e.message,{keyword:e.keyword,params:e.params},'Correct the input to match the PRD v1 schema.');
    return {ok:false,diagnostics};
  }
  const allIds=new Set(), objects=new Map();
  const register=(id,loc)=>{
    if(reserved.has(id.toLowerCase())) add('reserved-id',loc,'Reserved ID.',{id},'Choose a non-reserved ID.');
    if(allIds.has(id)) add('duplicate-id',loc,'Duplicate global ID.',{id},'Assign a unique global ID.');
    allIds.add(id);
  };
  input.objects.forEach((obj,i)=>{register(obj.id,`/objects/${i}/id`); if(!objects.has(obj.id)) objects.set(obj.id,{obj,loc:`/objects/${i}`});});
  input.assets.forEach((a,i)=>register(a.id,`/assets/${i}/id`));
  input.nativeViews.forEach((v,i)=>register(v.id,`/nativeViews/${i}/id`));
  register(input.profile.id,'/profile/id');
  input.profile.components.forEach((c,i)=>register(c.id,`/profile/components/${i}/id`));
  const proposalIds=new Set();
  for(const [i,entry] of (input.reviewHistory||[]).entries()) {
    if(proposalIds.has(entry.proposalId) || reserved.has(entry.proposalId.toLowerCase())) add('review-history',`/reviewHistory/${i}/proposalId`,'Proposal identity is duplicated or reserved.',{id:entry.proposalId},'Use a unique proposal identity.');
    proposalIds.add(entry.proposalId);
    if(identity(entry.oldValue)!==entry.oldHash) add('review-history',`/reviewHistory/${i}/oldHash`,'Baseline hash does not match the preserved value.',{},'Restore the original review history.');
  }
  const checkRef=(id,types,loc)=>{
    const found=objects.get(id);
    if(!found) add('dangling-reference',loc,'Reference target does not exist.',{target:id},'Reference an existing object ID.');
    else if(types && !types.includes(found.obj.type)) add('reference-type',loc,'Reference target has the wrong type.',{target:id,actual:found.obj.type,expected:types},'Reference an object of the required type.');
  };
  const predicate=(p,loc)=>{for(const field of predicateFields(p,loc)) checkRef(field.id,['field'],field.locator);};
  const assetIds=new Set(input.assets.map(a=>a.id));
  const names=new Set(), sourceVersions=new Set();
  input.assets.forEach((a,i)=>{const key=a.name.toLowerCase(); if(names.has(key)) add('asset-name',`/assets/${i}/name`,'Duplicate asset output name.',{name:a.name},'Choose distinct asset output names.'); names.add(key);});
  input.objects.forEach((obj,i)=>{
    const loc=`/objects/${i}`;
    if(obj.parent) checkRef(obj.parent,parents[obj.type]||[],`${loc}/parent`);
    if(obj.review) for(const key of ['causes','summaryCauses']) for(const cause of obj.review[key]||[]) if(!proposalIds.has(cause)) add('review-cause',`${loc}/review/${key}`,'Review cause has no recorded proposal.',{id:obj.id,cause},'Retain the corresponding proposal history.');
    if(obj.type==='question') for(const key of obj.detail.gapKeys||[]) {const target=key.split(':')[0]; if(!obj.detail.scope.includes(target)) add('question-gap-key',`${loc}/detail/gapKeys`,'A question gap key must target its declared scope.',{key},'Include the target in the question scope.');}
    if(['section','variant','element','binding','state','transition'].includes(obj.type)&&!obj.parent) add('parent-required',`${loc}/parent`,'This contextual object needs a parent.',{id:obj.id,type:obj.type},'Set a parent of the documented type.');
    if(obj.type==='binding'&&(obj.refs||[]).filter(r=>r.relation==='field').length!==1) add('binding-field',`${loc}/refs`,'A binding must reference exactly one field definition.',{id:obj.id},'Link exactly one field definition.');
    (obj.assetIds||[]).forEach((id,j)=>{if(!assetIds.has(id)) add('asset-reference',`${loc}/assetIds/${j}`,'Asset reference does not exist.',{id},'Reference a declared asset ID.');});
    if(obj.source && obj.type!=='source') add('source-owner',`${loc}/source`,'Only source records own source text.',{},'Move the source to a source object.');
    if(obj.rule && obj.type!=='rule') add('rule-owner',`${loc}/rule`,'Rule data belongs to a rule object.',{},'Move it to a rule object.');
    if(obj.content && obj.type!=='extension') add('content-owner',`${loc}/content`,'Only extensions hold unmapped content.',{},'Move the content to a source-backed extension.');
    if(obj.source) {
      if(reserved.has(obj.source.recordKey.toLowerCase())) add('reserved-id',`${loc}/source/recordKey`,'Reserved source record key.',{id:obj.source.recordKey},'Choose a non-reserved source record key.');
      const key=canonical([obj.source.recordKey,obj.source.version]);
      if(sourceVersions.has(key)) add('source-version',`${loc}/source/version`,'Source record key and version must be unique.',{recordKey:obj.source.recordKey,version:obj.source.version},'Use a new version for the new source record.');
      sourceVersions.add(key);
      if(hash(Buffer.from(obj.source.text,'utf8'))!==obj.source.sha256) add('source-hash',`${loc}/source/sha256`,'Source hash does not match its UTF-8 text.',{},'Hash the exact source text.');
    }
    for(const [j,ref] of (obj.refs||[]).entries()){
      const at=`${loc}/refs/${j}`, rel=relations[ref.relation];
      checkRef(ref.target,[ref.type],`${at}/target`);
      const targetObject=objects.get(ref.target)?.obj;
      if(ref.relation==='actor' && obj.type==='activity' && targetObject?.type==='role' && targetObject.detail.actorKind!==obj.detail.actorKind) add('actor-kind',at,'Activity and role actor kinds do not match.',{activity:obj.detail.actorKind,role:targetObject.detail.actorKind},'Bind a role with the matching actor kind.');
      if(['from','to'].includes(ref.relation) && obj.type==='transition' && targetObject?.type==='state' && targetObject.parent!==obj.parent) add('transition-scope',at,'Transition endpoint belongs to a different entity.',{target:ref.target},'Bind states owned by the transition entity.');
      if(!rel || (rel.from!=='*'&&!rel.from.includes(obj.type)) || (rel.to!=='*'&&!rel.to.includes(ref.type))) add('relation-type',at,'Relation is not supported between these object types.',{relation:ref.relation,from:obj.type,to:ref.type},'Use a documented typed relationship.');
      if(ref.type==='source'){
        const src=objects.get(ref.target)?.obj.source;
        if(!ref.locator || !ref.quote || !ref.interpretation || !src || !src.text.includes(ref.quote)) add('source-anchor',at,'Source anchor needs locator, interpretation and exact quote.',{target:ref.target},'Provide an exact contiguous source quote, locator and interpretation.');
      } else if(ref.locator || ref.quote || ref.interpretation) add('anchor-type',at,'Source anchor fields require a source target.',{},'Remove anchor fields or reference a source.');
      if(ref.relation==='supersedes'){
        const target=objects.get(ref.target)?.obj;
        if(ref.type!==obj.type || ref.target===obj.id || (obj.detail.scope && target && canonical(obj.detail.scope.slice().sort())!==canonical((target.detail.scope||[]).slice().sort()))) add('supersession-scope',at,'Supersession requires another object of the same type and scope.',{target:ref.target},'Reference an earlier record of the same type and scope.');
      }
    }
    if(obj.type==='journey') {
      const serviceRefs=(obj.refs||[]).filter(r=>r.relation==='service');
      const stepRefs=(obj.refs||[]).filter(r=>r.relation==='step');
      const roleIds=[...new Set([...(objects.get(obj.parent)?.obj.type==='role'?[obj.parent]:[]),...(obj.refs||[]).filter(r=>r.relation==='actor').map(r=>r.target)])];
      const journeyService=serviceRefs[0]?.target||(objects.get(obj.parent)?.obj.type==='service'?obj.parent:null);
      if(serviceRefs.length>1 || (serviceRefs.length===1 && objects.get(obj.parent)?.obj.type==='service' && serviceRefs[0].target!==obj.parent) || (stepRefs.length&&!journeyService)) add('journey-service',`${loc}/refs`,'A journey has missing or conflicting service context.',{id:obj.id},'Use one service matching its service parent.');
      if(stepRefs.length&&!roleIds.length) add('journey-actor',`${loc}/refs`,'Journey steps need a responsible role.',{id:obj.id},'Set a role parent or actor reference.');
      if(new Set(stepRefs.map(r=>r.target)).size!==stepRefs.length) add('journey-step',`${loc}/refs`,'Journey steps must not repeat the same activity.',{id:obj.id},'Use each activity once in the ordered journey.');
      if(objects.get(obj.parent)?.obj.type==='role' && roleIds.length>1) add('journey-actor',`${loc}/refs`,'Journey actors contradict its role parent.',{id:obj.id},'Use the journey parent role.');
      for(const [j,r] of (obj.refs||[]).entries()) if(r.relation==='step') {
        const step=objects.get(r.target)?.obj; let ancestor=step; const seen=new Set();
        while(ancestor && ancestor.type!=='service' && ancestor.id!==obj.id && !seen.has(ancestor.id)){seen.add(ancestor.id);ancestor=objects.get(ancestor.parent)?.obj;}
        if(journeyService && ((ancestor?.type==='service' && ancestor.id!==journeyService)||(!ancestor || (ancestor.type!=='service' && ancestor.id!==obj.id)))) add('journey-step-service',`${loc}/refs/${j}`,'Journey step service is different or not established.',{journey:obj.id,activity:r.target,service:journeyService,owner:ancestor?.id||null},'Choose a step owned by the journey service or contained by this journey.');
        const actors=(step?.refs||[]).filter(x=>x.relation==='actor').map(x=>x.target);
        if(step?.detail.actorKind==='human' && roleIds.length && (actors.length!==1 || !roleIds.includes(actors[0]))) add('journey-step-actor',`${loc}/refs/${j}`,'Human journey step has a different responsible role.',{journey:obj.id,activity:r.target,roles:roleIds,actors},'Use a step attributed to this journey role.');
      }
    }
    if(obj.type==='extension' && !obj.refs?.some(r=>r.relation==='derivedFrom'&&r.type==='source')) add('extension-source',loc,'Extension needs a source anchor.',{},'Reference its original source.');
    if(obj.rule){
      const checks=[{v:obj.rule,p:`${loc}/rule`},...(obj.rule.exceptions||[]).map((v,j)=>({v,p:`${loc}/rule/exceptions/${j}`}))];
      for(const {v,p} of checks){if(!v.scope.length) add('rule-scope',`${p}/scope`,'Rule scope cannot be empty.',{},'List affected object IDs.'); v.scope.forEach((id,j)=>checkRef(id,null,`${p}/scope/${j}`)); predicate(v.condition,`${p}/condition`);}
      for(const [j,e] of (obj.rule.exceptions||[]).entries()) if(e.scope.some(id=>!obj.rule.scope.includes(id))) add('exception-scope',`${loc}/rule/exceptions/${j}/scope`,'Exception must be within its rule scope.',{},'Use IDs included in the rule scope.');
    }
    if(obj.detail.predicate) predicate(obj.detail.predicate,`${loc}/detail/predicate`);
    if(obj.detail.condition) predicate(obj.detail.condition,`${loc}/detail/condition`);
    for(const k of bindingCells) if(obj.detail[k]) {
      const value=obj.detail[k], at=`${loc}/detail/${k}`;
      if(obj.type==='binding'&&Object.hasOwn(value,'question')) {
        checkRef(value.question,['question'],`${at}/question`);
        const question=objects.get(value.question)?.obj;
        if(question?.type==='question') {
          const context=new Set();let current=obj;
          while(current&&!context.has(current.id)) {
            context.add(current.id);
            if(['interface','activity'].includes(current.type)) break;
            current=objects.get(current.parent)?.obj;
          }
          if(!questionContexts(question).some(id=>context.has(id))) add('binding-question-context',`${at}/question`,'Question must explicitly concern this binding or its containing interface context.',{id:obj.id,question:question.id},'Scope and target the question to the binding or its containing context.');
        }
        add('binding-gap',at,'Binding contract is unresolved.',{id:obj.id,question:value.question},'Resolve this binding cell with a source-backed predicate.','warning');
      } else predicate(value,at);
    }
    if(Array.isArray(obj.detail.scope)) { if(!obj.detail.scope.length) add('scope-empty',`${loc}/detail/scope`,'Scope cannot be empty.',{},'List the affected object IDs.'); obj.detail.scope.forEach((id,j)=>checkRef(id,null,`${loc}/detail/scope/${j}`)); }
    if(obj.gap) add('declared-gap',`${loc}/gap`,'A declared gap remains unresolved.',{id:obj.id,gap:obj.gap},'Resolve the gap with source-backed facts.','warning');
    if(obj.detail.contracts) for(const key of contracts) { const value=obj.detail.contracts[key]; if(!value || value.gap) add('contract-gap',`${loc}/detail/contracts/${key}`,'A contract fact is missing.',{id:obj.id,gap:value?.gap || null},'Provide or resolve this contract fact.','warning'); }
    const needs = obj.type==='binding' ? ['field'] : obj.type==='action' ? ['actor','acceptance'] : obj.type==='rule' ? ['derivedFrom','evidence'] : [];
    if(needs.length && (obj.type==='rule' ? !needs.some(r=>obj.refs?.some(x=>x.relation===r)) : needs.some(r=>!obj.refs?.some(x=>x.relation===r)))) add('relationship-gap',`${loc}/refs`,'Required contextual relationship is missing.',{id:obj.id,relations:needs},'Link the relevant typed objects.','warning');
    if(obj.type==='activity' && obj.detail.actorKind==='system' && !obj.refs?.some(r=>['action','integration'].includes(r.relation))) add('relationship-gap',`${loc}/refs`,'System activity lacks an action or integration.',{id:obj.id},'Link its action or integration.','warning');
    if(obj.type==='transition') for(const relation of ['from','to']) if((obj.refs||[]).filter(r=>r.relation===relation).length!==1) add('relationship-gap',`${loc}/refs`,'Transition needs exactly one endpoint of each kind.',{id:obj.id,relation},'Link one from state and one to state.','warning');
    if(obj.type==='extension') add('extension-preserved',loc,'Unsupported content is retained as an extension.',{id:obj.id},'Map this content in a later revision.','warning');
  });
  for(const [i,entry] of (input.reviewHistory||[]).entries()) {
    checkRef(entry.objectId,null,`/reviewHistory/${i}/objectId`);
    entry.sourceIds.forEach((id,j)=>checkRef(id,['source'],`/reviewHistory/${i}/sourceIds/${j}`));
    entry.decisionIds.forEach((id,j)=>checkRef(id,['decision'],`/reviewHistory/${i}/decisionIds/${j}`));
  }
  const done=new Set();
  for(const [id] of objects){const active=new Set(); let cursor=id; while(objects.has(cursor)&&!done.has(cursor)){if(active.has(cursor)){add('containment-cycle',`${objects.get(cursor).loc}/parent`,'Containment contains a cycle.',{id:cursor},'Remove the cyclic parent relationship.');break;} active.add(cursor); cursor=objects.get(cursor).obj.parent;} for(const item of active) done.add(item);}
  // Supersession is history, not a workflow loop.
  const visiting=new Set(), visited=new Set();
  for(const id of objects.keys()) {
    if(visited.has(id)) continue;
    const stack=[{id,exit:false}];
    while(stack.length) {
      const frame=stack.pop();
      if(frame.exit){visiting.delete(frame.id);visited.add(frame.id);continue;}
      if(visiting.has(frame.id)){add('supersession-cycle',`${objects.get(frame.id).loc}/refs`,'Supersession contains a cycle.',{id:frame.id},'Make supersession history acyclic.');continue;}
      if(visited.has(frame.id)) continue;
      visiting.add(frame.id);stack.push({id:frame.id,exit:true});
      for(const r of objects.get(frame.id).obj.refs||[]) if(r.relation==='supersedes'&&objects.has(r.target)) stack.push({id:r.target,exit:false});
    }
  }
  input.nativeViews.forEach((v,i)=>{if(v.service) checkRef(v.service,['service'],`/nativeViews/${i}/service`); checkRef(v.source,['source'],`/nativeViews/${i}/source`); const source=objects.get(v.source)?.obj.source; if(!source || !source.text.includes(v.anchor.quote)) add('source-anchor',`/nativeViews/${i}/anchor`,'Native view anchor quote is not in the source.',{source:v.source},'Provide an exact source quote and locator.'); v.bindings.forEach((b,j)=>{checkRef(b.object,[b.type],`/nativeViews/${i}/bindings/${j}/object`);(b.targets||[]).forEach((t,k)=>checkRef(t.object,[t.type],`/nativeViews/${i}/bindings/${j}/targets/${k}/object`));}); (v.laneBindings||[]).forEach((b,j)=>checkRef(b.role,['role'],`/nativeViews/${i}/laneBindings/${j}/role`));});
  input.profile.components.forEach((c,i)=>{for(const key of ['ids','scope']) (c.selector[key]||[]).forEach((id,j)=>checkRef(id,null,`/profile/components/${i}/selector/${key}/${j}`));});
  (input.presentation?.positions||[]).forEach((v,i)=>checkRef(v.object,null,`/presentation/positions/${i}/object`));
  if(input.profile.productDocument&&!diagnostics.some(d=>d.severity==='error')) diagnostics.push(...validateProductDocument(input,{eligible:productEligible}));
  return {ok:!diagnostics.some(d=>d.severity==='error'),diagnostics};
}

// Reverse typed semantic dependencies, not workflow reachability or runtime failure.
export function reviewDependents(model, changedId) {
  const reverse=new Map(), objects=new Map(model.objects.map(o=>[o.id,o]));
  const link=(dependency,dependent)=>{if(!objects.has(dependency)||!objects.has(dependent)||dependency===dependent) return; if(!reverse.has(dependency)) reverse.set(dependency,new Set()); reverse.get(dependency).add(dependent);};
  for(const o of model.objects) {
    if(['source','evidence','decision','question','revision'].includes(o.type)) continue;
    if(o.parent) link(o.parent,o.id);
    for(const ref of o.refs||[]) if(!['next','derivedFrom','decision','evidence','supersedes'].includes(ref.relation)) link(ref.target,o.id);
    for(const p of objectPredicates(o)) for(const field of predicateFields(p)) link(field.id,o.id);
    for(const question of bindingQuestions(o)) link(question,o.id);
    if(o.rule) {
      for(const target of o.rule.scope) link(o.id,target);
      // Exception predicates affect their explicit targets, not the shared
      // base rule or its other consumers. Base rule changes remain global.
      for(const exception of o.rule.exceptions||[]) for(const field of predicateFields(exception.condition)) for(const target of exception.scope) link(field.id,target);
    }
  }
  const seeds=Array.isArray(changedId)?changedId:[changedId];
  const seen=new Set(seeds), queue=[...seen];
  for(let i=0;i<queue.length;i++) for(const id of reverse.get(queue[i])||[]) if(!seen.has(id)){seen.add(id);queue.push(id);}
  return seen;
}

// Containing UI contexts summarize affected owned controls. These are not
// semantic dependency edges and must not fan back out to sibling controls.
export function reviewOwnerSummaries(model, changedIds) {
  const objects=new Map(model.objects.map(o=>[o.id,o])), summaries=new Set();
  for(const id of changedIds) {
    let object=objects.get(id);
    if(!object || !['element','binding','section','variant'].includes(object.type)) continue;
    while(object?.parent) {
      const parent=objects.get(object.parent);
      if(!parent || !['section','variant','interface','activity'].includes(parent.type)) break;
      if(!changedIds.has(parent.id)) summaries.add(parent.id);
      if(['interface','activity'].includes(parent.type)) break;
      object=parent;
    }
  }
  return summaries;
}

export function scopeIds(model, roots, { predicateDependencies = false, boundedQuestions } = {}) {
  const map=new Map(model.objects.map(o=>[o.id,o])), selected=new Set(roots), queue=[...roots], children=new Map(), owned=new Map(), rootIds=new Set(roots), owners=serviceOwners(model);
  boundedQuestions ||= new Set(predicateDependencies?model.objects.flatMap(bindingQuestions):[]);
  for(const o of model.objects) {
    if(o.parent) { if(!children.has(o.parent)) children.set(o.parent,[]); children.get(o.parent).push(o.id); }
    const owner=owners[o.id];if(owner&&owner!==o.id){if(!owned.has(owner))owned.set(owner,[]);owned.get(owner).push(o.id);}
  }
  const add=target=>{if(!selected.has(target)){selected.add(target);queue.push(target);}};
  let cursor=0;
  for(;;) {
    while(cursor<queue.length){
      const id=queue[cursor++], obj=map.get(id); if(!obj) continue;
      // A referenced actor role is context, not a request for every journey
      // under that role. Explicit role roots still expand their children.
      // A journey's service reference is context; service roots/containment
      // instead expand their explicitly owned journeys and activities.
      const descendants=obj.type==='role'&&!rootIds.has(id)?[]:children.get(id)||[];
      const next=[...descendants,...(obj.type==='service'?owned.get(id)||[]:[]),...(obj.refs||[]).filter(r=>!(obj.type==='journey'&&r.relation==='service')&&!(boundedQuestions.has(id)&&r.relation==='target')).map(r=>r.target)];
      if(predicateDependencies) next.push(...bindingQuestions(obj),...objectPredicates(obj).flatMap(p=>predicateFields(p).map(field=>field.id)));
      next.forEach(add);
    }
    if(!predicateDependencies) break;
    // An exception affects readiness only when its explicit scope is reached.
    // Recheck after each expansion, because another dependency may reach it.
    for(const id of queue) for(const exception of map.get(id)?.rule?.exceptions||[]) {
      if(exception.scope.some(target=>selected.has(target))) predicateFields(exception.condition).forEach(field=>add(field.id));
    }
    if(cursor===queue.length) break;
  }
  return selected;
}
export function readiness(model, scope) {
  const diagnostics=[], map=new Map(model.objects.map((o,i)=>[o.id,{o,i}]));
  const add=(loc,msg,evidence,fix)=>diagnostics.push(diagnostic('ready-gap',loc,msg,evidence,fix));
  if(!map.has(scope)){add('/','Ready scope does not exist.',{scope},'Choose an existing object ID.');return diagnostics;}
  const scopeType=map.get(scope).o.type;
  if(!['project','service','capability','journey','phase','activity','action','api','integration'].includes(scopeType)) {add(`/objects/${map.get(scope).i}`,'This object type cannot be a readiness scope.',{scope,type:scopeType},'Select a project, service, capability, journey, phase, activity or executable contract.');return diagnostics;}
  // A shared unknown question is context, not permission to traverse its
  // other target branches into an unrelated readiness scope.
  const boundedQuestions=new Set(model.objects.flatMap(bindingQuestions));
  let ids=scopeIds(model,[scope],{predicateDependencies:true,boundedQuestions});
  // Keep the original scope root distinct from contextual roles when adding
  // applicable questions; promoting all reached IDs to roots expands roles.
  const questions=new Set();
  for(;;) {
    const relevantQuestions=model.objects.filter(o=>o.type==='question'&&!ids.has(o.id)&&o.detail.scope.some(id=>ids.has(id))).map(o=>o.id);
    if(!relevantQuestions.length) break;
    relevantQuestions.forEach(id=>questions.add(id));
    ids=scopeIds(model,[scope,...questions],{predicateDependencies:true,boundedQuestions});
  }
  const scopedObjects=[...ids].map(id=>map.get(id)?.o).filter(Boolean);
  if(!scopedObjects.some(o=>['action','api','integration'].includes(o.type))) add(`/objects/${map.get(scope).i}`,'Ready scope contains no action, API or integration contract.',{scope},'Add a scoped backend contract or choose a different scope.');
  if(!scopedObjects.some(o=>o.type==='acceptance')) add(`/objects/${map.get(scope).i}`,'Ready scope contains no acceptance case.',{scope},'Link a scoped acceptance case.');
  for(const id of ids){const {o,i}=map.get(id), loc=`/objects/${i}`;
    if(o.review?.causes.length) add(`${loc}/review`,'A changed dependency requires technical review.',{id,causes:o.review.causes},'Review the affected requirement and record a separately authorized resolution.');
    if(o.gap) add(`${loc}/gap`,'Declared gap blocks readiness.',{id,gap:o.gap},'Resolve the declared gap.');
    if(o.type==='question'&&o.detail.blocking&&o.status!=='superseded'&&o.status!=='customer-confirmed') add(loc,'Open blocking question.',{id},'Obtain and record the decision or remove the blocker with evidence.');
    if(['action','api','integration','rule','acceptance'].includes(o.type)) {
      if(o.status!=='customer-confirmed') add(`${loc}/status`,'Contract is not customer-confirmed.',{id,status:o.status},'Record customer confirmation or exclude the object from the ready scope.');
      const decisions=(o.refs||[]).filter(r=>r.relation==='decision').map(r=>map.get(r.target)?.o);
      if(!decisions.some(d=>d?.type==='decision'&&d.status==='customer-confirmed'&&d.detail.scope.includes(id)&&d.refs?.some(r=>r.relation==='derivedFrom'))) add(`${loc}/refs`,'Confirmed contract needs a source-backed decision covering its scope.',{id},'Link a customer-confirmed, source-backed decision whose scope includes this object.');
    }
    if(o.detail.contracts) for(const key of contracts){const v=o.detail.contracts[key]; if(!v || v.gap) add(`${loc}/detail/contracts/${key}`,'Required backend contract is missing.',{id,field:key,gap:v?.gap||null},'Provide the fact or resolve the documented gap.');}
    if(o.type==='action'&&!o.refs?.some(r=>r.relation==='acceptance')) add(`${loc}/refs`,'Action needs an acceptance case.',{id},'Link an acceptance case.');
    if(o.type==='action'&&!o.refs?.some(r=>r.relation==='actor')) add(`${loc}/refs`,'Action needs a typed actor.',{id},'Link the responsible role.');
    if(o.type==='rule'&&!o.refs?.some(r=>r.relation==='derivedFrom'||r.relation==='evidence')) add(`${loc}/refs`,'Rule needs provenance.',{id},'Link source or evidence.');
    if(o.type==='binding') {
      if(!o.refs?.some(r=>r.relation==='field')) add(`${loc}/refs`,'Binding needs a field.',{id},'Link a field definition.');
      for(const k of bindingCells) if(o.detail[k]?.question) add(`${loc}/detail/${k}`,'Question-bound binding contract is unresolved.',{id,question:o.detail[k].question},'Resolve this binding cell with a source-backed predicate.');
    }
    if(o.type==='activity'&&o.detail.actorKind==='system'&&!o.refs?.some(r=>r.relation==='action'||r.relation==='integration')) add(`${loc}/refs`,'System activity needs an action or integration.',{id},'Link its action or integration.');
    if(o.type==='activity'&&o.detail.actorKind==='human'&&!o.refs?.some(r=>r.relation==='actor')) add(`${loc}/refs`,'Human activity needs an actor.',{id},'Link the responsible role.');
    if(o.type==='transition') {
      for(const relation of ['from','to']) if((o.refs||[]).filter(r=>r.relation===relation).length!==1) add(`${loc}/refs`,'Transition needs one from and one to state.',{id,relation},'Link the transition endpoints.');
      for(const key of ['trigger','condition','effect']) if(!o.detail[key]) add(`${loc}/detail/${key}`,'Transition contract is missing.',{id,field:key},'Supply the missing transition fact.');
    }
  }
  diagnostics.push(...standardReadinessV1(model,scope));
  return diagnostics;
}
export function componentRecords(model, diagnostics) {
  const map=new Map(model.objects.map(o=>[o.id,o])), boundedQuestions=new Set(model.objects.flatMap(bindingQuestions));
  return model.profile.components.map((c,i)=>{
    const allowed=c.selector.scope?.length?scopeIds(model,c.selector.scope):null;
    const selected=model.objects.filter(o=>c.selector.types.includes(o.type)&&(!c.selector.ids?.length||c.selector.ids.includes(o.id))&&(!allowed||allowed.has(o.id)));
    const required=c.requiredWhen==='always'||(c.requiredWhen==='selected'&&Boolean(c.selector.ids?.length||c.selector.scope?.length));
    if(required&&!selected.length) diagnostics.push(diagnostic('component-empty',`/profile/components/${i}`,'Required component selects no objects.',{id:c.id},'Select at least one object.'));
    if(c.gapPolicy==='error'&&selected.some(o=>o.gap||bindingQuestions(o).length||(o.detail.contracts&&contracts.some(k=>!o.detail.contracts[k]||o.detail.contracts[k].gap)))) diagnostics.push(diagnostic('component-gap',`/profile/components/${i}`,'Component policy rejects selected gaps.',{id:c.id},'Resolve gaps or choose include.'));
    const selectedIds=new Set(selected.map(o=>o.id));
    const views=c.type==='process-view'||c.type==='lifecycle' ? model.nativeViews.filter(v=>v.bindings.some(b=>selectedIds.has(b.object))).map(v=>({id:v.id,sha256:identity(v.spec),source:v.source,bindings:v.bindings,laneBindings:v.laneBindings||[]})) : [];
    return {contract:'archify-prd-component',version:c.version,id:c.id,type:c.type,heading:c.heading,selector:c.selector,requiredWhen:c.requiredWhen,gapPolicy:c.gapPolicy,clientProjection:c.clientProjection,outputs:c.outputs,coverage:{objectIds:selected.map(o=>o.id),count:selected.length},views,records:selected.map(o=>{
      const seen=new Set([o.id]), queue=[o.id];
      for(let j=0;j<queue.length;j++){
        const current=map.get(queue[j]);
        const predicates=[...objectPredicates(current),...(current.rule?.exceptions||[]).map(e=>e.condition)];
        const bounded=current.id!==o.id&&boundedQuestions.has(current.id);
        const targets=[...(current.refs||[]).filter(r=>!bounded||r.relation!=='target').map(r=>r.target),...(current.parent?[current.parent]:[]),...(current.rule?.scope||[]),...(current.rule?.exceptions||[]).flatMap(e=>e.scope),...(!bounded&&Array.isArray(current.detail.scope)?current.detail.scope:[]),...bindingQuestions(current),...predicates.flatMap(p=>predicateFields(p).map(field=>field.id))];
        for(const target of targets) if(!seen.has(target)&&map.has(target)){seen.add(target);queue.push(target);}
      }
      const assetMap=new Map(model.assets.map(a=>[a.id,a]));
      const assetIds=[...new Set(queue.flatMap(id=>map.get(id).assetIds||[]))];
      const reviewScope=scopeIds(model,[o.id],{predicateDependencies:true});
      let ancestor=o.parent, ancestorReview=false;
      while(ancestor){const parent=map.get(ancestor); if(!parent) break; if(parent.review?.causes.length) ancestorReview=true; ancestor=parent.parent;}
      // A rule record displays its full exceptions; a consumer record only
      // follows exception fields applicable to its own reached scope.
      const exceptionReview=o.type==='rule'&&(o.rule.exceptions||[]).some(e=>predicateFields(e.condition).some(field=>map.get(field.id)?.review?.causes.length));
      return {anchor:o.id,objectId:o.id,type:o.type,title:o.title,purpose:o.purpose,status:o.status,reviewNeeded:Boolean(o.review?.summaryCauses?.length)||ancestorReview||Boolean(exceptionReview)||[...reviewScope].some(id=>map.get(id)?.review?.causes.length>0),
        references:(o.refs||[]).map(r=>({relation:r.relation,target:r.target,type:r.type,sha256:identity(map.get(r.target))})),
        rules:queue.filter(id=>map.get(id).type==='rule').map(id=>({id,sha256:identity(map.get(id))})),
        dependencies:queue.map(id=>({id,sha256:identity(map.get(id))})),assets:assetIds.map(id=>({id,sha256:assetMap.get(id).sha256}))};
    })};
  });
}
