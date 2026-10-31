// Author-side review snapshots for explicitly approved public facts. This is
// not a public export, projection approval, or replacement for topology review.
import { projectPrd, validateStandardPolicyPresence } from './prd-export.mjs';
import { bindingCells, bindingPublicApprovalV1, bindingQuestions, diagnostic, predicateFields, rejectUnsupportedBindingCells } from './prd-model.mjs';
import { workspace as validateSchema } from './generated-prd-validators.mjs';
import { productReviewBoundedQuestionsV2, productReviewClosureV2, productReviewDependenciesV2, snapshotReviewedTextV2, validateProductDocumentV2 } from './prd-product-v2.mjs';
import { productServiceSelection } from './prd-product-document.mjs';
import { externalStandardRulesV1, scopeStandardCatalogV1 } from './prd-standard-composer.mjs';

const semanticRelations = new Set(['actor', 'uses', 'variant', 'action', 'integration', 'field', 'rule', 'entity', 'state', 'from', 'to']);
const scopedTypes = new Set(['question', 'evidence', 'decision']);
const contextualParents = new Set(['activity', 'journey', 'section', 'variant', 'element', 'binding', 'state', 'transition']);
const requiredDetails = new Set(['service', 'role', 'activity', 'variant', 'binding', 'field', 'element', 'action', 'integration', 'state', 'transition', 'entity', 'evidence', 'decision', 'question']);
const fail = (loc, message, evidence = {}) => {
  const error = new Error(message);
  error.diagnostics = [diagnostic('product-public-v2', loc, message, evidence, 'Explicitly approve the necessary public fact and association.')];
  throw error;
};

// `ids` are source IDs (as in disclosure plans). Returned review entries use
// source IDs, but each digest hashes the complete approved public fact, with
// public aliases. Private status, review lineage, omission prose and assets are
// deliberately not part of that fact. Missing dependencies never become aliases.
function cleanPublicFact(o, p) {
  const clean = { id:o.id, type:o.type, title:o.title, purpose:o.purpose, detail:o.detail, refs:o.refs };
  if (p.parent === true) clean.parent = o.parent;
  for (const key of ['rule', 'gap', 'content', 'priority']) if (p.fields.includes(key)) clean[key] = o[key];
  return clean;
}

export function snapshotPublicReviewedTextV2(manifest, policy, text, ids) {
  const source = new Map(manifest.model.objects.map(o => [o.id, o]));
  const seen=productReviewClosureV2(source,ids);
  return snapshotFromProjection(manifest,policy,text,ids,projectPrd(manifest,'client',policy,seen));
}

function snapshotFromProjection(manifest, policy, text, ids, projection) {
  const source = new Map(manifest.model.objects.map(o => [o.id, o]));
  if (!ids.length) fail('/disclosure/productDocument', 'Public review requires at least one approved source.');
  const bounded=productReviewBoundedQuestionsV2(source,ids), seen=productReviewClosureV2(source,ids);
  for (const id of seen) {
    const original = source.get(id), approval = policy.objects?.[id], fact = projection.objects.get(id), loc = `/disclosure/objects/${id}`;
    if (!original || !approval || !fact || original.type === 'source') fail(loc, 'Review source is not explicitly projected.', { id });
    if (contextualParents.has(original.type) && original.parent && approval.parent !== true) fail(`${loc}/parent`, 'Reviewed context requires an approved parent.');
    if (requiredDetails.has(original.type)) for (const key of Object.keys(original.detail || {})) if (!approval.fields.includes(`detail.${key}`)) fail(`${loc}/fields`, 'Reviewed context requires the complete approved detail fact.', { field: `detail.${key}` });
    if (original.rule && !approval.fields.includes('rule')) fail(`${loc}/fields`, 'Reviewed rule must be explicitly approved.');
    for (const r of original.refs || []) {
      if (r.type === 'source') continue;
      if (!semanticRelations.has(r.relation) && !(scopedTypes.has(original.type) && r.relation === 'target')) continue;
      if(original.type==='question'&&bounded.has(id)&&r.relation==='target')continue;
      if (!approval.relations?.some(x => x.relation === r.relation && x.target === r.target)) fail(`${loc}/relations`, 'Reviewed source path is not explicitly approved.', { relation: r.relation, target: r.target });
    }
    for(const dependency of productReviewDependenciesV2(original,{boundedQuestion:bounded.has(id)}))if(!projection.objects.has(dependency))fail(loc,'Reviewed dependency is not explicitly projected.',{id:dependency});
  }
  // Strip all private technical metadata and disclosure explanations. The
  // projection's aliases and explicitly approved values remain authoritative.
  const approved = [...seen].map(id => cleanPublicFact(projection.objects.get(id), policy.objects[id]));
  const toSource = new Map([...seen].map(id => [projection.objects.get(id).id, id]));
  const result = snapshotReviewedTextV2(approved, text, ids.map(id => projection.objects.get(id).id));
  return { text: result.text, reviewed: result.reviewed.map(r => ({ object: toSource.get(r.object), sha256: r.sha256 })) };
}

// Compare only typed contracts whose meaning is machine-checkable. Local
// presentation IDs and independently authored reviewed prose are not identity.
function validatePublicStandardContracts(canonicalPlan, publicPlan, source) {
  const features=plan=>plan.modules.flatMap(m=>m.subModules.flatMap(s=>s.features));
  const canonicalFeatures=features(canonicalPlan);
  for(const [mi,m] of publicPlan.modules.entries())for(const [si,s] of m.subModules.entries())for(const [fi,f] of s.features.entries()){
    const base=`/disclosure/productDocument/modules/${mi}/subModules/${si}/features/${fi}/standard/sections/4/screens`;
    const screens=f.standard.sections[4].screens.flatMap((screen,i)=>{
      if(screen.kind!=='screen')return [];
      const loc=`${base}/${i}`,pages=(f.actions||[]).flatMap(a=>a.pages.filter(p=>p.id===screen.page).map(()=>a.activity));
      if(pages.length!==1)fail(`${loc}/page`,'Public screen context is missing or ambiguous.');
      return [{screen,loc,activity:pages[0]}];
    });
    if(!screens.length)continue;
    const matchingScreens=(cf,{screen,activity})=>(cf.actions||[]).filter(a=>a.activity===activity).flatMap(a=>a.pages.filter(p=>p.interface===screen.interface&&p.variant===screen.variant).flatMap(p=>cf.standard.sections[4].screens.filter(c=>c.kind==='screen'&&c.page===p.id&&c.interface===p.interface&&c.variant===p.variant)));
    const candidates=canonicalFeatures.filter(cf=>cf.service===f.service&&cf.workflow?.view===f.workflow?.view&&(f.actions||[]).every(a=>(cf.actions||[]).some(c=>c.activity===a.activity))&&screens.every(context=>matchingScreens(cf,context).length));
    if(candidates.length!==1)fail(base,'Canonical Feature context is missing or ambiguous.');
    for(const context of screens){
      const {screen,loc}=context,matches=matchingScreens(candidates[0],context);
      if(matches.length!==1)fail(`${loc}/page`,'Canonical Feature screen context is missing or ambiguous.');
      const original=matches[0];
      for(const [j,row] of screen.fields.entries()){
        if(!row.binding)continue;
        const at=`${loc}/fields/${j}`,fields=original.fields.filter(r=>r.binding===row.binding&&r.field===row.field);
        if(fields.length!==1)fail(at,'Canonical field and binding context is missing or ambiguous.');
        for(const [cell,key] of [['required','required'],['editable','editableWhen']]){const question=source.get(row.binding)?.detail?.[cell]?.question;if(question&&row[key]?.question!==question)fail(`${at}/${key}`,'Public binding cell must retain its exact canonical Question.',{question});}
        for(const key of ['dataType','required'])if(typeof row[key]==='string'&&(typeof fields[0][key]!=='string'||fields[0][key]!==row[key]))fail(`${at}/${key}`,'Public value conflicts with or promotes an unresolved canonical standard contract.');
      }
      for(const [j,row] of (screen.actionMatrix||[]).entries()){
        const grants=(original.actionMatrix||[]).filter(g=>g.state===row.state&&g.role===row.role&&row.actions.every(id=>g.actions.includes(id)));
        // One grant must cover the whole row: separate conditional grants may
        // never be combined. A question remains a gap, not an asserted grant.
        const covered=grants.some(g=>!g.condition||row.condition&&(!g.condition.question||row.condition.question));
        if(!covered)fail(`${loc}/actionMatrix/${j}`,'Public matrix row is not covered by one canonical grant with preserved conditionality.');
      }
    }
  }
}

// Include the Service graph plus the actually rendered public plan facts and
// qualified external definitions. Reviewed facts bring their ordinary bounded
// semantic closure; unrelated owner Features and catalog rows do not.
export function publicServiceBindingScopeV2(model, policy, service) {
  const selected=productServiceSelection(model,service).selected, source=new Map(model.objects.map(o=>[o.id,o]));
  const plan=policy?.productDocument;
  if(!plan||!Array.isArray(plan.modules))return selected;
  const features=plan.modules.flatMap(m=>(m.subModules||[]).flatMap(s=>(s.features||[]).filter(f=>f.service===service)));
  const roots=[...features];
  if(plan.standard){
    const {roles,sharedRules,history,...metadata}=plan.standard;
    const approvedObjects=model.objects.filter(o=>policy.objects?.[o.id]).map(o=>o.rule?{...o,rule:policy.objects[o.id].fields?.includes('rule')?{...o.rule,scope:o.rule.scope.filter(id=>policy.objects?.[id])}:undefined}:o);
    const catalog=scopeStandardCatalogV1(approvedObjects,plan,service), featureIds=new Set(features.map(f=>f.id));
    roots.push(metadata,catalog,(history||[]).map(h=>({...h,chapters:h.chapters.filter(c=>featureIds.has(c.feature))})),externalStandardRulesV1(plan,service));
  }
  const referenceKeys=new Set(['service','activity','interface','variant','role','roles','state','transition','transitions','from','to','question','questions','rule','binding','bindings','field','element','elements','action','actions','integration','integrations','sources','object']);
  const rules=new Set(),visit=(value,key)=>{
    if(typeof value==='string'){if(referenceKeys.has(key)&&source.has(value)){selected.add(value);if(source.get(value).type==='rule')rules.add(value);}return;}
    if(!value||typeof value!=='object')return;
    if(Array.isArray(value)){for(const v of value)visit(v,key);return;}
    if(typeof value.text==='string'&&Array.isArray(value.reviewed)){for(const id of productReviewClosureV2(source,value.reviewed.map(r=>r.object)))selected.add(id);return;}
    for(const [k,v] of Object.entries(value))visit(v,k);
  };
  roots.forEach(visit);
  for(const id of rules)for(const dep of productReviewClosureV2(source,[id]))selected.add(dep);
  return selected;
}

// Validate against an explicitly projected graph, not the private graph. The
// plan is authored with private source IDs and is remapped only after checks.
export function projectPublicFeatureDocument(manifest, policy, projection, publicViews, bindingApprovalScope) {
  const plan = policy?.productDocument;
  if (!plan || plan.version !== 2) fail('/disclosure/productDocument', 'Client Feature export requires an independently authored v2 plan.');
  if(!plan.standard)rejectUnsupportedBindingCells(manifest.model.objects,new Set(projection.objects.keys()));
  for(const o of manifest.model.objects)if(projection.objects.has(o.id)&&(!bindingApprovalScope||bindingApprovalScope.has(o.id))&&bindingQuestions(o).length){
    const approval=policy.objects[o.id],loc=`/disclosure/objects/${o.id}`;
    if(approval.bindingSourceSha256!==bindingPublicApprovalV1(manifest.model,o))fail(`${loc}/bindingSourceSha256`,'Question-bound binding requires a current content-bound source approval.');
    for(const cell of bindingCells)if(o.detail[cell]?.question&&!approval.fields.includes(`detail.${cell}`))fail(`${loc}/fields`,'Question-bound binding cell must be explicitly approved.',{cell});
  }
  validateStandardPolicyPresence(manifest.model,plan);
  const shaped = {...manifest.model, profile:{...manifest.model.profile, productDocument:plan}};
  if (!validateSchema(shaped)) {
    const e = new Error('Public Feature plan does not match the closed schema.');
    e.diagnostics = validateSchema.errors.map(x => diagnostic('product-public-v2', x.instancePath.replace(/^\/profile\/productDocument/, '/disclosure/productDocument'), x.message, {keyword:x.keyword,params:x.params}, 'Correct the public Feature plan.'));
    throw e;
  }
  const source = new Map(manifest.model.objects.map(o => [o.id,o]));
  const aliases = new Map([...projection.objects].map(([id,o]) => [o.id,id]));
  const approved = new Set(projection.objects.keys());
  const toAlias = id => {const o=projection.objects.get(id);if(!o)fail('/disclosure/productDocument','Feature reference is not explicitly projected.',{id});return o.id;};
  const mappedScope = (o, p) => {
    const scope=o.detail.scope||[], targets=(o.refs||[]).filter(r=>r.relation==='target').map(r=>r.target);
    const common=scope.length&&targets.length?scope.filter(id=>targets.includes(id)):scope.length?scope:targets;
    const disclosedTargets=new Set((p.relations||[]).filter(r=>r.relation==='target').map(r=>r.target));
    return common.filter(id=>approved.has(id)&&(!targets.length||disclosedTargets.has(id)));
  };
  const reviewFacts=new Map(), privateShape=[], publicObjects=[];
  for (const [id, projected] of projection.objects) {
    const o=source.get(id), p=policy.objects[id], clean=cleanPublicFact(projected,p);
    reviewFacts.set(id,clean);
    const detail={};for(const field of p.fields)if(field.startsWith('detail.')){const key=field.slice(7);detail[key]=structuredClone(o.detail[key]);}
    const scoped=scopedTypes.has(o.type), contexts=scoped?mappedScope(o,p):null;
    if(scoped&&Object.hasOwn(detail,'scope'))detail.scope=contexts;
    const refs=(o.refs||[]).filter(r=>r.type!=='source'&&p.relations?.some(x=>x.relation===r.relation&&x.target===r.target)&&approved.has(r.target)&&(!scoped||r.relation!=='target'||contexts.includes(r.target))).map(({relation,target,type})=>({relation,target,type}));
    const item={id,type:o.type,title:p.title,purpose:p.purpose,status:'proposed',detail,refs};
    if(o.parent&&p.parent===true)item.parent=o.parent;
    if(plan.standard&&o.assetIds)item.assetIds=o.assetIds.filter(asset=>policy.assets?.[asset]&&projected.attachments?.some(a=>a.name.startsWith(`assets/${policy.assets[asset].id}.`)));
    if(o.rule&&p.fields.includes('rule')) item.rule={...structuredClone(o.rule),scope:o.rule.scope.filter(x=>approved.has(x)),exceptions:(o.rule.exceptions||[]).map(e=>({...structuredClone(e),scope:e.scope.filter(x=>approved.has(x))})).filter(e=>e.scope.length)};
    const predicates=[...['predicate','condition','visibility','editable','required'].filter(k=>Object.hasOwn(detail,k)).map(k=>detail[k]),item.rule?.condition,...(item.rule?.exceptions||[]).map(e=>e.condition)];
    for(const field of predicates.flatMap(p=>predicateFields(p)))if(!approved.has(field.id))fail(`/disclosure/objects/${id}`, 'An approved predicate depends on an unprojected field.', {id:field.id});
    privateShape.push(item);
    const visible=structuredClone(clean);
    if(scoped&&Object.hasOwn(visible.detail,'scope'))visible.detail.scope=contexts.map(toAlias);
    if(scoped)visible.refs=visible.refs.filter(r=>r.relation!=='target'||contexts.some(id=>toAlias(id)===r.target));
    if(visible.rule){visible.rule.scope=item.rule.scope.map(toAlias);visible.rule.exceptions=(o.rule.exceptions||[]).map((e,i)=>({publicException:clean.rule.exceptions[i],scope:e.scope.filter(x=>approved.has(x))})).filter(x=>x.scope.length).map(x=>({...x.publicException,scope:x.scope.map(toAlias)}));}
    publicObjects.push(visible);
  }
  const views=[...publicViews].map(([id,v])=>{
    const mappings=policy.views[id], reverse=map=>new Map(Object.entries(map||{}).map(([source,p])=>[p.id,source]));
    const node=reverse(mappings.nodes),lane=reverse(mappings.lanes),spec=structuredClone(v.prepared.spec);
    if(v.type==='workflow'){
      spec.lanes=spec.lanes.map(x=>({...x,id:lane.get(x.id)}));
      spec.nodes=spec.nodes.map(x=>({...x,id:node.get(x.id),lane:lane.get(x.lane)}));
      spec.edges=spec.edges.map(x=>({...x,from:node.get(x.from),to:node.get(x.to)}));
    }
    return {id,diagramType:v.type,spec,service:v.service?aliases.get(v.service):undefined,bindings:v.bindings.map(b=>({...b,node:v.type==='workflow'?node.get(b.node):b.node,object:aliases.get(b.object)})),laneBindings:(v.lanes||[]).map(b=>({...b,lane:lane.get(b.lane),role:aliases.get(b.role)}))};
  });
  const publicModel={...manifest.model,objects:privateShape,nativeViews:views,profile:{...manifest.model.profile,productDocument:plan}};
  const errors=validateProductDocumentV2(publicModel,{reviewFacts});
  if(errors.length){const e=new Error('Public Feature plan is invalid.');e.diagnostics=errors.map(d=>({...d,subject:{...d.subject,locator:d.subject.locator.replace(/^\/profile\/productDocument/,'/disclosure/productDocument')}}));throw e;}
  if(plan.standard)validatePublicStandardContracts(manifest.model.profile.productDocument,plan,source);
  const mapped=structuredClone(plan);
  function summary(s, required, loc){
    if(!s)return;
    const expected=snapshotFromProjection(manifest,policy,s.text,[...required,...s.reviewed.map(r=>r.object)],projection);
    const actual=new Map(s.reviewed.map(r=>[r.object,r.sha256]));
    for(const r of expected.reviewed)if(actual.get(r.object)!==r.sha256)fail(`${loc}/reviewed`,'Public reviewed summary is stale or missing an approved dependency.',{id:r.object});
    s.reviewed=s.reviewed.map(r=>({...r,object:toAlias(r.object)}));
  }
  const remapList=ids=>(ids||[]).map(toAlias);
  // The closed standard schema uses these exact shapes for facts and gaps.
  // Do not interpret arbitrary prose or local presentation identifiers as IDs.
  function standardFacts(value,loc){
    if(!value||typeof value!=='object')return;
    if(Array.isArray(value)){value.forEach((v,i)=>standardFacts(v,`${loc}/${i}`));return;}
    if(typeof value.text==='string'&&Array.isArray(value.reviewed)){summary(value,[],loc);return;}
    if(typeof value.question==='string')value.question=toAlias(value.question);
    for(const [key,v] of Object.entries(value))if(key!=='question')standardFacts(v,`${loc}/${key}`);
  }
  if(mapped.standard){standardFacts(mapped.standard,'/disclosure/productDocument/standard');for(const r of mapped.standard.roles)r.role=toAlias(r.role);for(const r of mapped.standard.sharedRules)r.rule=toAlias(r.rule);}
  for(const [mi,m] of mapped.modules.entries())for(const [si,s] of m.subModules.entries())for(const [fi,f] of s.features.entries()){
    const loc=`/disclosure/productDocument/modules/${mi}/subModules/${si}/features/${fi}`,service=f.service;
    summary(f.summary,[service],`${loc}/summary`);f.service=toAlias(service);
    if(f.question)f.question=toAlias(f.question);
    if(f.standard){
      standardFacts(f.standard,`${loc}/standard`);
      const [,,,wf,proto,integrations,,acceptance]=f.standard.sections,viewPolicy=policy.views?.[f.workflow?.view];
      for(const step of wf.steps){const n=viewPolicy?.nodes?.[step.node];if(!n)fail(`${loc}/standard/sections/3/steps`,'Step node has no approved public mapping.',{id:step.node});step.node=n.id;step.activity=toAlias(step.activity);step.role=toAlias(step.role);}
      for(const state of wf.statusModel.states)state.state=toAlias(state.state);
      for(const tr of wf.statusModel.transitions)for(const k of ['transition','from','to','role'])tr[k]=toAlias(tr[k]);
      for(const screen of proto.screens)if(screen.kind==='screen'){
        screen.interface=toAlias(screen.interface);if(screen.variant)screen.variant=toAlias(screen.variant);
        screen.assets=screen.assets.map(id=>{const a=policy.assets?.[id];if(!a)fail(`${loc}/standard/sections/4/screens`,'Screen asset lacks approval.',{id});return a.id;});screen.elements=remapList(screen.elements);
        for(const row of screen.fields){if(row.element)row.element=toAlias(row.element);else{row.field=toAlias(row.field);row.binding=toAlias(row.binding);}}
        for(const row of screen.actionMatrix||[]){row.state=toAlias(row.state);row.role=toAlias(row.role);row.actions=remapList(row.actions);}
        for(const button of screen.buttons){button.element=toAlias(button.element);if(button.action)button.action=toAlias(button.action);}
      }
      for(const process of proto.processes)process.integrations=remapList(process.integrations);
      for(const rule of proto.businessRules){rule.rule=toAlias(rule.rule);rule.bindings=remapList(rule.bindings);}
      for(const row of integrations.integrations)row.integration=toAlias(row.integration);
      for(const row of integrations.notifications){row.roles=remapList(row.roles);if(row.integration)row.integration=toAlias(row.integration);}
      for(const criterion of acceptance.criteria){criterion.sources=remapList(criterion.sources);criterion.transitions=remapList(criterion.transitions);}
    }
    if(f.workflow){const v=publicViews.get(f.workflow.view);if(!v)fail(`${loc}/workflow/view`,'Feature workflow has no approved public view.');f.workflow.view=v.id;}
    for(const [ai,a] of (f.actions||[]).entries()){
      const al=`${loc}/actions/${ai}`,activity=a.activity;summary(a.summary,[activity],`${al}/summary`);a.activity=toAlias(activity);a.questions=remapList(a.questions);
      const groups=(list,gl)=>list.forEach((g,i)=>{summary(g.summary,g.sources,`${gl}/${i}/summary`);g.sources=remapList(g.sources);g.questions=remapList(g.questions);});
      groups(a.groups,`${al}/groups`);
      for(const [pi,p] of a.pages.entries()){const pl=`${al}/pages/${pi}`;p.interface=toAlias(p.interface);if(p.variant)p.variant=toAlias(p.variant);p.questions=remapList(p.questions);groups(p.groups,`${pl}/groups`);}
    }
  }
  return {plan:mapped,objects:publicObjects};
}
