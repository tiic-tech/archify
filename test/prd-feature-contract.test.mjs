import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';
import { canonical, validatePrd } from '../archify/explainer/workspace/prd-model.mjs';
import { normalizeProductDocumentV2, reviewHashV2, snapshotReviewedTextV2 } from '../archify/explainer/workspace/prd-product-v2.mjs';
import { validatePublicProduct } from '../archify/explainer/workspace/prd-product-public.mjs';
import { snapshotPublicReviewedTextV2 } from '../archify/explainer/workspace/prd-product-public-v2.mjs';
import { projectPrd } from '../archify/explainer/workspace/prd-export.mjs';
import { buildPrdReader } from '../archify/explainer/workspace/prd-reader-build.mjs';
import { composeProductDocument, renderProductMarkdown, renderProductHtml } from '../archify/explainer/workspace/prd-product-document.mjs';
import { composeFeatureDocument } from '../archify/explainer/workspace/prd-feature-composer.mjs';

const model = () => JSON.parse(fs.readFileSync(new URL('../archify/examples/prd-equipment-workspace.json', import.meta.url)));
const feature = m => m.profile.productDocument.modules[0].subModules[0].features[0];
const object = (m, id) => m.objects.find(o => o.id === id);
const errors = m => validatePrd(m).diagnostics.filter(d => d.severity === 'error');
const has = (m, message, id) => errors(m).some(d => d.message.includes(message) && (!id || d.evidence.id === id));
const make = (id,type,title,detail={},extra={}) => ({id,type,title,purpose:title,status:'proposed',detail,...extra});
const ref = (relation,target,type) => ({relation,target,type});
const sortKeys=v=>Array.isArray(v)?v.map(sortKeys):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sortKeys(v[k])])):v;
function publicFixture(m) {
  const component = m.profile.components[0];
  const manifest = {model:m,assets:[],components:[{...component,records:m.objects.map(o=>({objectId:o.id,dependencies:[]})),views:[]}]};
  const objects = Object.fromEntries(m.objects.filter(o=>o.type!=='source').map(o=>[o.id, {
    id:`public_${o.id}`,title:`Public ${o.type}`,purpose:`Public purpose for ${o.type}`,
    fields:[...Object.keys(o.detail).map(k=>`detail.${k}`),...['rule','gap','content','priority'].filter(k=>Object.hasOwn(o,k))],
    ...(o.parent?{parent:true}:{}),relations:(o.refs||[]).filter(r=>r.type!=='source').map(r=>({relation:r.relation,target:r.target}))
  }]));
  return {manifest,policy:{version:1,components:{all:'Approved equipment'},objects}};
}
function completePublicPolicy(m) {
  const {manifest,policy}=publicFixture(m);
  policy.views=Object.fromEntries(m.nativeViews.map(v=>[v.id,{
    id:`public_${v.id}`,title:'Approved workflow',caption:'Approved process',context:'Approved context',version:'1',sourceVersion:'1',service:v.service,
    lanes:Object.fromEntries(v.spec.lanes.map(x=>[x.id,{id:`p_${x.id}`,label:'Public participant'}])),
    nodes:Object.fromEntries(v.spec.nodes.map(x=>[x.id,{id:`p_${x.id}`,label:'Public step'}])),
    edges:Object.fromEntries(v.spec.edges.map(x=>[x.id,{id:`p_${x.id}`,label:'Public transition'}]))
  }]));
  const plan=structuredClone(m.profile.productDocument);policy.productDocument=plan;
  const reviewed=(s,ids)=>snapshotPublicReviewedTextV2(manifest,policy,`Approved public ${s.text}`,ids);
  for(const module of plan.modules)for(const sub of module.subModules)for(const f of sub.features){
    if(f.summary)f.summary=reviewed(f.summary,[f.service]);
    for(const a of f.actions||[]){a.summary=reviewed(a.summary,[a.activity]);for(const g of [...a.groups,...a.pages.flatMap(p=>p.groups)])g.summary=reviewed(g.summary,g.sources);}
  }
  return policy;
}
function refresh(m) {
  for (const module of m.profile.productDocument.modules) for (const sub of module.subModules) for (const f of sub.features) if (f.status === 'detailed') {
    f.summary = snapshotReviewedTextV2(m.objects, f.summary.text, [f.service]);
    for (const a of f.actions) {
      a.summary = snapshotReviewedTextV2(m.objects, a.summary.text, [a.activity]);
      for (const g of [...a.groups, ...a.pages.flatMap(p => p.groups)]) g.summary = snapshotReviewedTextV2(m.objects, g.summary.text, g.sources);
    }
  }
}

test('public binding questions use approved aliases and bounded review context',()=>{
  const m=model(),binding=object(m,'itemInput'),q=structuredClone(object(m,'operatorQuestion')),foreign=structuredClone(object(m,'loans'));
  foreign.id='unrelatedService';foreign.purpose='PRIVATE_FOREIGN_PURPOSE';q.id='bindingQuestion';q.detail.scope=[binding.id,foreign.id];q.refs=[ref('target',binding.id,'binding'),ref('target',foreign.id,'service')];binding.detail.required={question:q.id};m.objects.push(foreign,q);
  const {manifest,policy}=publicFixture(m);delete policy.objects[foreign.id];policy.omitted={[foreign.id]:'Not disclosed.'};policy.objects[q.id].relations=policy.objects[q.id].relations.filter(r=>r.target!==foreign.id);policy.objects[q.id].omissions={[foreign.id]:policy.objects[binding.id].id};
  const projection=()=>projectPrd(manifest,'client',policy),snapshot=()=>snapshotPublicReviewedTextV2(manifest,policy,'Approved binding.',[binding.id]);
  const result=projection(),b=result.objects.get(binding.id),publicQ=result.objects.get(q.id);assert.deepEqual(b.detail.required,{question:policy.objects[q.id].id});assert.deepEqual(b.detail.visibility,{constant:true});assert.deepEqual(publicQ.detail.scope,[b.id]);assert.deepEqual(result.questionScopes[publicQ.id],[b.id]);assert.ok(!JSON.stringify(publicQ).includes(foreign.id));
  const before=snapshot(),publicQuestionHash=before.reviewed.find(r=>r.object===q.id)?.sha256;assert.ok(publicQuestionHash);assert.notEqual(publicQuestionHash,snapshotReviewedTextV2(m.objects,'Source binding.',[binding.id]).reviewed.find(r=>r.object===q.id).sha256);assert.ok(!before.reviewed.some(r=>r.object===foreign.id));foreign.purpose='Another unrelated foreign purpose';assert.deepEqual(snapshot(),before);
  q.detail.consequence='An approved question detail changed';assert.notDeepEqual(snapshot(),before);q.detail.consequence=object(m,'operatorQuestion').detail.consequence;
  const publicTitle=policy.objects[q.id].title;policy.objects[q.id].title='Revised public question';assert.notDeepEqual(snapshot(),before);policy.objects[q.id].title=publicTitle;
  assert.throws(()=>snapshotPublicReviewedTextV2(manifest,policy,'Explicit question.',[q.id]),e=>e.diagnostics?.some(d=>/source path|dependency/.test(d.message)),'question-only review still requires its explicit source paths');
  const noQuestion=structuredClone(policy);delete noQuestion.objects[q.id];noQuestion.omitted[q.id]='Not disclosed.';assert.throws(()=>projectPrd(manifest,'client',noQuestion),e=>e.diagnostics?.some(d=>d.subject.locator.endsWith('/itemInput/fields/detail.required')));
  const wrong=structuredClone(m);object(wrong,'itemInput').detail.required={question:'item'};assert.throws(()=>projectPrd({...manifest,model:wrong},'client',policy),e=>e.diagnostics?.some(d=>d.subject.locator.endsWith('/itemInput/fields/detail.required')));
  const noScope=structuredClone(policy);noScope.objects[q.id].fields=noScope.objects[q.id].fields.filter(x=>x!=='detail.scope');noScope.objects[q.id].withheld={'detail.scope':'Not disclosed.'};assert.throws(()=>projectPrd(manifest,'client',noScope),e=>e.diagnostics?.some(d=>/public context/.test(d.message)));
  const noTarget=structuredClone(policy);noTarget.objects[q.id].relations=[];noTarget.objects[q.id].omissions[binding.id]=policy.objects[binding.id].id;assert.throws(()=>projectPrd(manifest,'client',noTarget),e=>e.diagnostics?.some(d=>/public context/.test(d.message)));
  const wrongContext=structuredClone(m),wrongPolicy=structuredClone(policy);object(wrongContext,q.id).detail.scope=['loans'];object(wrongContext,q.id).refs=[ref('target','loans','service')];wrongPolicy.objects[q.id].relations=[{relation:'target',target:'loans'}];assert.throws(()=>projectPrd({...manifest,model:wrongContext},'client',wrongPolicy),e=>e.diagnostics?.some(d=>/public context/.test(d.message)));
  const ancestor=structuredClone(m);object(ancestor,q.id).detail.scope=['requestPage'];object(ancestor,q.id).refs=[ref('target','requestPage','interface')];const ancestorPolicy=structuredClone(policy);ancestorPolicy.objects[q.id].relations=[{relation:'target',target:'requestPage'}];delete ancestorPolicy.objects[q.id].omissions;assert.ok(projectPrd({...manifest,model:ancestor},'client',ancestorPolicy).objects.get(binding.id));delete ancestorPolicy.objects[binding.id].parent;ancestorPolicy.objects[binding.id].omissions={requestPage:policy.objects.requestPage.id};assert.throws(()=>projectPrd({...manifest,model:ancestor},'client',ancestorPolicy),e=>e.diagnostics?.some(d=>/public context/.test(d.message)));
});

test('authored equipment example validates a hierarchy and a shared Service without role chapters', () => {
  const m = model();
  assert.deepEqual(errors(m), []);
  const subs = m.profile.productDocument.modules[0].subModules;
  assert.equal(subs.length, 2);
  assert.equal(subs[0].features.filter(f => f.status === 'detailed').length, 2);
  assert.ok(subs.flatMap(s => s.features).every(f => f.service === 'loans'));
  assert.equal(subs[1].features[0].status, 'catalog-only');
  assert.ok(!('roleChapters' in m.profile.productDocument));
  assert.deepEqual(object(m, 'dateInput').detail.required, {field:'item',op:'eq',value:'temporary'});
  assert.ok(m.nativeViews[0].spec.edges.some(e => e.role === 'return'));
  assert.ok(m.nativeViews[0].spec.edges.some(e => e.role === 'error'));
  assert.equal(normalizeProductDocumentV2(m.profile.productDocument).modules[0].subModules[0].features[0].id, 'checkoutFeature');
  assert.equal(reviewHashV2({b: 2, a: 1}), createHash('sha256').update('{"a":1,"b":2}').digest('hex'));
  assert.equal(reviewHashV2({b: 2, a: 1}), reviewHashV2({a: 1, b: 2}));
  assert.notEqual(reviewHashV2({items: [1, 2]}), reviewHashV2({items: [2, 1]}));
});

test('closed shape distinguishes detailed and catalog-only and rejects unsafe or duplicate keys', () => {
  for (const mutate of [
    m => { feature(m).extra = true; },
    m => { feature(m).status = 'catalog-only'; feature(m).question = 'operatorQuestion'; },
    m => { delete feature(m).workflow; },
    m => { delete feature(m).summary; },
    m => { delete feature(m).actions[0].performer; },
    m => { m.profile.productDocument.key = '../escape'; },
    m => { m.profile.productDocument.language = 'en/secret'; },
    m => { feature(m).actions[0].pages[0].groups[0].sources = []; },
  ]) { const m = model(); mutate(m); assert.ok(errors(m).length); }
  const m = model(); feature(m).key = 'con'; assert.ok(has(m, 'reserved portable filename'));
  feature(m).key = 'equipment-return'; assert.ok(has(m, 'business key is duplicated'));
  const mismatch = model(); feature(mismatch).actions[2].performer = 'user';
  assert.ok(has(mismatch, 'Performer classification conflicts', 'record'));
  const stale = model(); object(stale, 'loans').purpose = 'Changed Service boundary';
  assert.ok(errors(stale).some(d => d.message === 'Reviewed summary is stale.' && d.subject.locator.includes('/features/0/summary/')));
});

test('activity, page, workflow and semantic coverage are checked in the relevant Service', () => {
  const m = model(); feature(m).actions.splice(1, 1);
  assert.ok(has(m, 'activity is not represented', 'review'));
  const missingWorkflow = model(); missingWorkflow.nativeViews[0].bindings = missingWorkflow.nativeViews[0].bindings.filter(b => b.object !== 'review');
  assert.ok(has(missingWorkflow, 'does not bind a Feature activity', 'review'));
  const extraWorkflow = model(); extraWorkflow.nativeViews[0].bindings.push({node:'extra',object:'return',type:'activity'});
  assert.ok(has(extraWorkflow, 'outside this Feature', 'return'));
  const missingPage = model(); feature(missingPage).actions[0].pages = [];
  assert.ok(has(missingPage, 'interface is not covered', 'requestPage'));
  const missingRule = model(); const group = feature(missingRule).actions[0].pages[0].groups[0]; group.sources = group.sources.filter(id => id !== 'dateRule');
  assert.ok(has(missingRule, 'not covered by a semantic group', 'dateRule'));
  const foreign = model(); object(foreign, 'review').parent = 'otherService'; foreign.objects.push({id:'otherService',type:'service',title:'Other',purpose:'Other scope',status:'proposed',detail:{boundary:'Other'},parent:'project'});
  assert.ok(has(foreign, 'not owned by the Feature Service', 'review'));
  const misplaced = model(); const entry = feature(misplaced).actions[0].pages[0].groups[0]; feature(misplaced).actions[1].groups.push(entry); feature(misplaced).actions[0].pages[0].groups = [];
  assert.ok(has(misplaced, 'not connected to this action or page', 'itemInput'));
  // A rule covered in one action must not disappear from another usage of the
  // same page just because Service-wide union coverage is already satisfied.
  const shared = model(); object(shared, 'review').refs.push({relation:'uses',target:'requestPage',type:'interface'});
  feature(shared).actions[1].pages.push({id:'reviewRequestPage',interface:'requestPage',groups:[]});
  assert.ok(has(shared, 'Context rule is not covered', 'dateRule'));
  assert.ok(has(shared, 'Context requirement is not covered', 'dateInput'));
});

test('an action requirement on its own page does not require duplicate action prose', () => {
  const m = model(), activity = object(m, 'request'), a = feature(m).actions[0], group = a.pages[0].groups[0];
  m.objects.push(make('submit','action','Submit request',{contracts:{}},{refs:[ref('actor','borrower','role')]}), make('submitControl','element','Submit control',{kind:'button'},{parent:'requestPage',refs:[ref('action','submit','action')]}));
  activity.refs.push(ref('action','submit','action')); group.sources.push('submitControl','submit'); refresh(m);
  assert.deepEqual(errors(m), []);
  group.sources = group.sources.filter(id => id !== 'submit'); refresh(m);
  assert.ok(has(m, 'Context requirement is not covered', 'submit'));
});

test('shared page variants and entry placeholder retain distinct requirements and predicate-only fields', () => {
  const m = model(), activity = object(m, 'request'), action = feature(m).actions[0], original = action.pages[0];
  const yes={constant:true};
  m.objects.push(make('draft','variant','Draft',{kind:'state',predicate:yes},{parent:'requestPage'}), make('approved','variant','Approved',{kind:'state',predicate:yes},{parent:'requestPage'}), make('draftSection','section','Draft details',{}, {parent:'requestPage'}), make('approvedSection','section','Approved details',{}, {parent:'requestPage'}), make('ticket','field','Ticket',{dataType:'string'}), make('ticketInput','binding','Ticket input',{visibility:yes,editable:yes,required:yes},{parent:'approvedSection',refs:[ref('field','ticket','field'),ref('variant','approved','variant')]}));
  activity.refs.push(ref('variant','draft','variant'),ref('variant','approved','variant'));
  for(const id of ['itemInput','dateInput']) {object(m,id).parent='draftSection';object(m,id).refs.push(ref('variant','draft','variant'));}
  const rule=object(m,'dateRule'); rule.rule.scope=['draft']; rule.rule.exceptions[0].scope=['draft'];
  const second=structuredClone(rule); second.id='approvedRule'; second.title='Approved check'; second.rule.scope=['approvedSection']; second.rule.condition={field:'item',op:'eq',value:'temporary'}; second.rule.exceptions=[]; m.objects.push(second);
  m.objects.push(make('unused','variant','Unused state',{kind:'state',predicate:yes},{parent:'requestPage'}),make('unusedField','field','Unused value',{dataType:'string'}),make('unusedBinding','binding','Unused input',{visibility:yes,editable:yes,required:yes},{parent:'unused',refs:[ref('field','unusedField','field')]}),make('unusedQuestion','question','Question for unused state',{scope:['unused'],consequence:'Not in this activity',options:[],assumptions:[],confirmingFunction:'Facilities owner',blocking:true},{refs:[ref('target','unused','variant')]}));
  m.objects.push(make('approvedQuestion','question','How is approval checked?',{scope:['approvedRule'],consequence:'Review is pending',options:[],assumptions:[],confirmingFunction:'Facilities owner',blocking:true},{refs:[ref('target','approvedRule','rule')]}));
  original.variant='draft';
  action.pages=[{id:'entryAnchor',interface:'requestPage',groups:[]},original,{id:'approvedAnchor',interface:'requestPage',variant:'approved',groups:[{id:'approvedGroup',title:'Approved details',summary:{text:'Check the ticket.',reviewed:[]},sources:['ticket','ticketInput','approvedRule'],questions:['approvedQuestion']}]}];
  refresh(m); assert.deepEqual(errors(m), []);
  const composed=renderProductMarkdown(composeFeatureDocument(m,{resources:{prototypes:{requestPage:[{src:'assets/parent.png',caption:'Entry reference'}],draft:[{src:'assets/draft.png',caption:'Draft reference'}],approved:[{src:'assets/approved.png',caption:'Approved reference'}]}}}));
  const draftText=composed.slice(composed.indexOf('<a id="requestPageAnchor"></a>'),composed.indexOf('<a id="approvedAnchor"></a>'));
  const approvedText=composed.slice(composed.indexOf('<a id="approvedAnchor"></a>'),composed.indexOf('#####',composed.indexOf('<a id="approvedAnchor"></a>')));
  assert.match(draftText,/assets\/draft\.png/);assert.doesNotMatch(draftText,/assets\/(?:parent|approved)\.png/);assert.match(approvedText,/assets\/approved\.png/);assert.doesNotMatch(approvedText,/assets\/(?:parent|draft)\.png/);
  assert.ok(action.pages[2].groups[0].summary.reviewed.some(r=>r.object==='item'));
  action.pages[2].groups[0].sources = ['ticket','ticketInput']; refresh(m);
  assert.ok(has(m, 'Context rule is not covered', 'approvedRule'));
  assert.ok(has(m, 'Question is not scoped', 'approvedQuestion'));
  action.pages[2].groups[0].sources.push('dateRule'); refresh(m);
  assert.ok(has(m, 'Rule does not apply', 'dateRule'));
});

test('catalog-only Services omit detailed obligations without relaxing mixed Services', () => {
  const m=model(), features=m.profile.productDocument.modules[0].subModules[0].features;
  for(const f of features.filter(f=>f.status==='detailed')) {f.status='catalog-only';f.question='operatorQuestion';delete f.summary;delete f.workflow;delete f.actions;}
  assert.deepEqual(errors(m), []);
  features[0].summary=snapshotReviewedTextV2(m.objects,'Planned borrowing capability.',['loans']);
  assert.deepEqual(errors(m), []);object(m,'loans').purpose='Changed scope';
  assert.ok(errors(m).some(d=>d.message==='Reviewed summary is stale.'&&d.subject.locator.includes('/features/0/summary/')));
  const mixed=model(), f=mixed.profile.productDocument.modules[0].subModules[0].features[1];
  f.status='catalog-only';f.question='operatorQuestion';delete f.summary;delete f.workflow;delete f.actions;
  assert.ok(has(mixed, 'activity is not represented', 'return'));
});

test('explicit integration and adjacent evidence are valid sources, but unrelated evidence is not', () => {
  const m=model(), request=object(m,'request'), a=feature(m).actions[0], record=object(m,'recordAction'), system=feature(m).actions[2];
  m.objects.push(make('handover','evidence','Handover observation',{scope:['request'],interpretation:'Observed handover',confidence:'observed'}), make('handoverQuestion','question','Who handles the handover?',{scope:['handover'],consequence:'Handover owner is unknown',options:[],assumptions:[],confirmingFunction:'Facilities owner',blocking:true},{refs:[ref('target','handover','evidence')]}),make('inventoryApi','integration','Inventory connector',{contracts:{output:{value:'Inventory response'}}}));
  request.refs.push(ref('evidence','handover','evidence'));a.questions=['handoverQuestion'];a.groups.push({id:'handoverGroup',title:'Handover',summary:{text:'The handover remains open.',reviewed:[]},sources:['handover']});
  record.refs.push(ref('integration','inventoryApi','integration'));system.groups[0].sources.push('inventoryApi');refresh(m);
  assert.deepEqual(errors(m), []);
  request.refs=request.refs.filter(r=>r.target!=='handover');refresh(m);
  assert.ok(has(m, 'Question is not scoped', 'handoverQuestion'));
  assert.ok(has(m, 'not connected to this action or page', 'handover'));
});

test('review bindings detect field, exception and linked dependency changes at the summary locator', () => {
  for (const mutate of [
    m => { object(m, 'item').detail.dataType = 'number'; },
    m => { object(m, 'dateRule').rule.exceptions[0].effect = 'Reject the request'; },
    m => { object(m, 'requestPage').purpose = 'Changed page context'; },
    m => { object(m, 'inventory').title = 'Inventory service'; },
  ]) {
    const m = model(); mutate(m); const found = errors(m).filter(d => d.message === 'Reviewed summary is stale.');
    assert.ok(found.length); assert.ok(found.every(d => /\/summary\/reviewed\/\d+\/sha256$/.test(d.subject.locator)));
  }
  const scoped = model(); object(scoped, 'requestPage').purpose = 'Changed page context';
  assert.ok(errors(scoped).some(d => d.message === 'Reviewed summary is stale.' && d.subject.locator.includes('/groups/')));
  const m = model(); const summary = feature(m).actions[0].pages[0].groups[0].summary;
  summary.reviewed = summary.reviewed.filter(r => r.object !== 'date');
  assert.ok(has(m, 'missing a source or semantic dependency review', 'date'));
  const fresh = model(); const action = feature(fresh).actions[0];
  action.summary = snapshotReviewedTextV2(fresh.objects, 'Reviewed request.', ['request']);
  assert.deepEqual(errors(fresh), []);
  assert.throws(() => snapshotReviewedTextV2(fresh.objects, 'Text', ['missing']), /unavailable/);
  const duplicated = model(); const reviewed = feature(duplicated).actions[0].summary.reviewed; reviewed.push(reviewed[0]);
  assert.ok(has(duplicated, 'Reviewed object is duplicated'));
});

test('Feature composition shares a structured document across Markdown and HTML without role chapters', () => {
  const m=model(), ir=composeFeatureDocument(m,{resources:{views:{checkoutFlow:{src:'assets/checkout.svg'}}}});
  const md=renderProductMarkdown(ir),html=renderProductHtml(ir);
  assert.match(md,/### Equipment checkout[\s\S]*Purpose \/ boundary[\s\S]*Process Workflow/);
  assert.match(md,/!\[Equipment checkout workflow\]\(assets\/checkout.svg\)/);
  assert.match(md,/External participant operation\*\*: The borrower submits/);
  assert.match(md,/System operation\*\*: The inventory system records/);
  assert.match(md,/\*\*Field:\*\*[\s\S]*Equipment[\s\S]*Return date/);
  assert.match(md,/Temporary equipment requires a return date/);
  assert.match(md,/Catalog only — detailed behavior is TBC/);
  assert.match(html,/<strong>System operation<\/strong>/);
  assert.ok(!/Role chapter|login|dashboard/i.test(md));
  assert.deepEqual(ir.groups.requestGroup,['item','date','itemInput','dateInput','dateRule']);
  assert.equal(ir.features.find(f=>f.id==='checkoutFeature').workflow,'checkoutFlow');
  assert.throws(()=>composeFeatureDocument(m,{resources:{views:{checkoutFlow:{src:'https://example.invalid/private.svg'}}}}),/portable local/);
  object(m,'dateRule').rule.effect='Change';assert.throws(()=>composeFeatureDocument(m),e=>e.diagnostics.some(d=>d.message.includes('stale')));
});

test('public review helper hashes approved facts only and rejects hidden source paths', () => {
  const m=model(), {manifest,policy}=publicFixture(m);
  object(m,'item').gap='Private owner note'; policy.objects.item.withheld={gap:'Not disclosed'}; policy.objects.item.fields=policy.objects.item.fields.filter(x=>x!=='gap');
  const snapshot=()=>snapshotPublicReviewedTextV2(manifest,policy,'Approved public description',['dateRule']);
  const first=snapshot(); assert.ok(first.reviewed.some(r=>r.object==='dateRule'));assert.ok(first.reviewed.some(r=>r.object==='item'));
  object(m,'item').gap='Different private note'; object(m,'item').title='Private renamed field';object(m,'item').status='customer-confirmed';
  assert.deepEqual(snapshot(),first);
  policy.objects.item.title='Different public equipment label';assert.notDeepEqual(snapshot(),first);
  const target=policy.objects.dateInput;target.relations=target.relations.filter(r=>r.relation!=='field');target.omissions={date:policy.objects.item.id};
  assert.throws(()=>snapshotPublicReviewedTextV2(manifest,policy,'Approved',['dateInput']),e=>e.diagnostics?.some(d=>d.message.includes('source path')));
  const missing=publicFixture(model());missing.policy.objects.item.fields=[];missing.policy.objects.item.withheld={'detail.dataType':'Not disclosed'};
  assert.throws(()=>snapshotPublicReviewedTextV2(missing.manifest,missing.policy,'Approved',['dateRule']),e=>e.diagnostics?.some(d=>d.message.includes('complete approved detail')));
  const masked=publicFixture(model()), alias=masked.policy.objects.date.id;
  delete masked.policy.objects.item; masked.policy.omitted={item:'Item is not disclosed'};
  for(const p of Object.values(masked.policy.objects)){p.relations=p.relations.filter(r=>r.target!=='item');p.omissions={item:alias};}
  assert.throws(()=>snapshotPublicReviewedTextV2(masked.manifest,masked.policy,'Approved',['dateRule']),e=>e.diagnostics?.some(d=>d.message.includes('dependency is not explicitly projected')));
});

test('questions must match context and legacy public consumers reject v2', async () => {
  const m = model(); const catalog = m.profile.productDocument.modules[0].subModules[1].features[0]; catalog.question = 'missingQuestion';
  assert.ok(has(m, 'wrong type', 'missingQuestion'));
  const bad = model(); object(bad, 'operatorQuestion').detail.scope = ['request'];
  assert.ok(has(bad, 'Question is not scoped', 'operatorQuestion'));
  const valid = model();
  assert.throws(() => validatePublicProduct(valid, {productDocument: valid.profile.productDocument, objects: Object.fromEntries(valid.objects.map(o => [o.id, {}]))}), /invalid/);
  await assert.rejects(buildPrdReader({model:valid}), /prepared PRD manifest/);
  assert.throws(() => composeProductDocument(valid), /not yet available/);
});

test('feedback proposal saves a stale reviewed draft without refreshing hashes or losing history', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'archify-feature-feedback-'));
  try {
    const m=model();m.workspaceId='bf959db5-03b7-4d2a-a29d-40c3e4779c19';
    const input=path.join(root,'model.json'),pkg=path.join(root,'comments.json'),store=path.join(root,'store.json'),request=path.join(root,'request.json'),proposal=path.join(root,'proposal.json'),output=path.join(root,'updated.json');
    const write=(p,v)=>fs.writeFileSync(p,JSON.stringify(v));write(input,m);
    const cli=new URL('../archify/bin/archify.mjs',import.meta.url).pathname;
    const run=(...args)=>{const p=spawnSync(process.execPath,[cli,'prd',...args,'--json'],{encoding:'utf8',env:{...process.env,ARCHIFY_UPDATE_CHECK_DISABLED:'1'},timeout:120000});assert.equal(p.error,undefined);return {status:p.status,...JSON.parse(p.stdout)};};
    const valid=run('validate',input);assert.equal(valid.status,0,JSON.stringify(valid));
    const rule=object(m,'dateRule');
    write(pkg,{kind:'archify-prd-feedback',schemaVersion:1,workspaceId:m.workspaceId,comments:[{id:'comment1',objectId:rule.id,baseRevision:valid.revision,quoteSnapshot:{path:'/rule/effect',text:rule.rule.effect},author:'Synthetic reviewer',time:'2026-10-29T00:00:00Z',body:'Clarify the expected result.',state:'open'}]});
    const imported=run('feedback','import',pkg,'--model',input,'-o',store);assert.equal(imported.status,0,JSON.stringify(imported));
    write(request,{kind:'archify-prd-change-request',schemaVersion:1,workspaceId:m.workspaceId,proposalId:'change1',baseRevision:valid.revision,storeRevision:imported.revision,objectId:rule.id,operation:'replace',path:'/rule/effect',oldValue:rule.rule.effect,oldHash:createHash('sha256').update(JSON.stringify(rule.rule.effect)).digest('hex'),newValue:'Return date must be supplied',commentIds:['comment1']});
    const proposed=run('feedback','propose',request,'--model',input,'--store',store,'--expect-store',imported.revision,'-o',proposal);
    assert.equal(proposed.status,0,JSON.stringify(proposed));assert.ok(proposed.diagnostics.some(d=>d.message==='Reviewed summary is stale.'&&d.severity==='warning'));
    const wrong=run('feedback','apply',proposal,'--model',input,'--store',store,'--expect-store','0'.repeat(64),'-o',output);assert.notEqual(wrong.status,0);assert.equal(fs.existsSync(output),false);
    const applied=run('feedback','apply',proposal,'--model',input,'--store',store,'--expect-store',imported.revision,'-o',output);
    assert.equal(applied.status,0,JSON.stringify(applied));assert.ok(applied.diagnostics.some(d=>d.message==='Reviewed summary is stale.'&&d.severity==='warning'));
    const changed=JSON.parse(fs.readFileSync(output));assert.equal(changed.reviewHistory[0].proposalId,'change1');assert.deepEqual(feature(changed).actions[0].pages[0].groups[0].summary,feature(m).actions[0].pages[0].groups[0].summary);
    const invalid=run('validate',output);assert.notEqual(invalid.status,0);assert.ok(invalid.diagnostics.some(d=>d.message==='Reviewed summary is stale.'&&d.severity==='error'));
    assert.ok(fs.existsSync(store));
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('standard feedback candidate retains stale reviewed text and blocks publication', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'archify-standard-feedback-'));
  try {
    const m=JSON.parse(fs.readFileSync(new URL('../archify/examples/prd-equipment-standard-workspace.json',import.meta.url)));m.workspaceId='50000000-0000-4000-8000-000000000000';
    const decision={id:'testDecision',type:'decision',title:'Synthetic decision',purpose:'Record the rule decision',status:'proposed',detail:{scope:['dateRule'],authority:'Reviewer',meeting:{date:'2026-01-01',participants:['Reviewer'],record:'Synthetic record'}},refs:[]};m.objects.push(decision);
    const input=path.join(root,'model.json'),pkg=path.join(root,'comments.json'),store=path.join(root,'store.json'),request=path.join(root,'request.json'),proposal=path.join(root,'proposal.json'),output=path.join(root,'updated.json');
    const write=(p,v)=>fs.writeFileSync(p,JSON.stringify(v)),read=p=>JSON.parse(fs.readFileSync(p));write(input,m);
    const cli=new URL('../archify/bin/archify.mjs',import.meta.url).pathname,run=(...args)=>{const p=spawnSync(process.execPath,[cli,'prd',...args,'--json'],{encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(p.error,undefined);return {status:p.status,...JSON.parse(p.stdout)};};
    const valid=run('validate',input);assert.equal(valid.status,0,JSON.stringify(valid));const rule=m.objects.find(o=>o.id==='dateRule');
    write(pkg,{kind:'archify-prd-feedback',schemaVersion:1,workspaceId:m.workspaceId,comments:[{id:'comment1',objectId:rule.id,baseRevision:valid.revision,quoteSnapshot:{path:'/rule/effect',text:rule.rule.effect},author:'Synthetic reviewer',time:'2026-10-29T00:00:00Z',body:'Review the rule.',state:'open'},{id:'decisionComment',objectId:decision.id,baseRevision:valid.revision,quoteSnapshot:{path:'/title',text:decision.title},author:'Synthetic reviewer',time:'2026-10-29T00:00:00Z',body:'Review the decision.',state:'open'}]});const imported=run('feedback','import',pkg,'--model',input,'-o',store);assert.equal(imported.status,0,JSON.stringify(imported));
    const req={kind:'archify-prd-change-request',schemaVersion:1,workspaceId:m.workspaceId,proposalId:'standardChange',baseRevision:valid.revision,storeRevision:imported.revision,objectId:rule.id,operation:'replace',path:'/rule/effect',oldValue:rule.rule.effect,oldHash:createHash('sha256').update(JSON.stringify(rule.rule.effect)).digest('hex'),newValue:'The date is checked again.',commentIds:['comment1']};write(request,req);
    const propose=()=>run('feedback','propose',request,'--model',input,'--store',store,'--expect-store',imported.revision,'-o',proposal),proposed=propose();assert.equal(proposed.status,0,JSON.stringify(proposed));for(const code of ['prd/product-document-v2','prd/product-standard'])assert.ok(proposed.diagnostics.some(d=>d.code===code&&d.severity==='warning'&&/stale/.test(d.message)),code);
    const wrong=run('feedback','apply',proposal,'--model',input,'--store',store,'--expect-store','0'.repeat(64),'-o',output);assert.notEqual(wrong.status,0);assert.equal(fs.existsSync(output),false);
    const applied=run('feedback','apply',proposal,'--model',input,'--store',store,'--expect-store',imported.revision,'-o',output);assert.equal(applied.status,0,JSON.stringify(applied));assert.deepEqual(applied.diagnostics,proposed.diagnostics);const changed=read(output);assert.deepEqual(changed.profile.productDocument,m.profile.productDocument);assert.equal(changed.reviewHistory.at(-1).proposalId,'standardChange');assert.deepEqual(changed.reviewHistory.at(-1).oldValue,rule.rule.effect);assert.ok(changed.objects.find(o=>o.id===rule.id).review.causes.includes('standardChange'));
    for(const args of [['validate',output],['compile',output,'-o',path.join(root,'blocked.json')],['export',output,'-o',path.join(root,'blocked-export'),'--audience','internal']]){const blocked=run(...args);assert.notEqual(blocked.status,0);assert.ok(blocked.diagnostics.some(d=>d.code==='prd/product-standard'&&d.severity==='error'&&/stale/.test(d.message)));}
    const reviewed=structuredClone(changed),refreshFacts=v=>{if(!v||typeof v!=='object')return;if(typeof v.text==='string'&&Array.isArray(v.reviewed)){Object.assign(v,snapshotReviewedTextV2(reviewed.objects,v.text,v.reviewed.map(r=>r.object)));return;}for(const x of Object.values(v))refreshFacts(x);};refreshFacts(reviewed.profile.productDocument);const reviewedPath=path.join(root,'reviewed.json');write(reviewedPath,reviewed);const reviewedResult=run('validate',reviewedPath);assert.equal(reviewedResult.status,0);assert.deepEqual(reviewed.reviewHistory,changed.reviewHistory);assert.deepEqual(reviewed.objects.find(o=>o.id===rule.id).review,changed.objects.find(o=>o.id===rule.id).review);
    const nextPkg=path.join(root,'next-comments.json'),nextStore=path.join(root,'next-store.json');write(nextPkg,{kind:'archify-prd-feedback',schemaVersion:1,workspaceId:m.workspaceId,comments:[{id:'comment2',objectId:rule.id,baseRevision:reviewedResult.revision,quoteSnapshot:{path:'/rule/effect',text:req.newValue},author:'Synthetic reviewer',time:'2026-10-30T00:00:00Z',body:'Review the next change.',state:'open'}]});const importedNext=run('feedback','import',nextPkg,'--model',reviewedPath,'--store',store,'--expect-store',imported.revision,'-o',nextStore);assert.equal(importedNext.status,0,JSON.stringify(importedNext));const nextReq={...req,proposalId:'standardChange2',baseRevision:reviewedResult.revision,storeRevision:importedNext.revision,oldValue:req.newValue,oldHash:createHash('sha256').update(JSON.stringify(req.newValue)).digest('hex'),newValue:'The date is checked once more.',commentIds:['comment2']},nextProposal=path.join(root,'next-proposal.json'),nextOutput=path.join(root,'next-output.json');write(request,nextReq);const nextProposed=run('feedback','propose',request,'--model',reviewedPath,'--store',nextStore,'--expect-store',importedNext.revision,'-o',nextProposal);assert.equal(nextProposed.status,0,JSON.stringify(nextProposed));const nextApplied=run('feedback','apply',nextProposal,'--model',reviewedPath,'--store',nextStore,'--expect-store',importedNext.revision,'-o',nextOutput);assert.equal(nextApplied.status,0,JSON.stringify(nextApplied));const twice=read(nextOutput);assert.deepEqual(twice.reviewHistory.slice(0,-1),changed.reviewHistory);assert.equal(twice.reviewHistory.at(-1).proposalId,'standardChange2');assert.ok(twice.objects.find(o=>o.id===rule.id).review.causes.includes('standardChange'));assert.ok(twice.objects.find(o=>o.id===rule.id).review.causes.includes('standardChange2'));
    const repeated=run('feedback','apply',proposal,'--model',input,'--store',store,'--expect-store',imported.revision,'-o',output);assert.notEqual(repeated.status,0);assert.deepEqual(read(output),changed);
    write(request,{...req,newValue:''});const malformed=run('feedback','propose',request,'--model',input,'--store',store,'--expect-store',imported.revision,'-o',path.join(root,'malformed.json'));assert.notEqual(malformed.status,0);assert.ok(malformed.diagnostics.some(d=>d.severity==='error'&&!/stale/.test(d.message)));
    const oldDecision=canonical(decision),correction={...structuredClone(decision),id:'newDecision',refs:[{relation:'supersedes',target:decision.id,type:'decision'},{relation:'derivedFrom',target:'missingSource',type:'source',locator:'note',quote:'synthetic',interpretation:'Synthetic source.'}]};write(request,{...req,proposalId:'badDecision',objectId:decision.id,operation:'decision-correction',path:'/decision/supersession',oldValue:oldDecision,oldHash:createHash('sha256').update(JSON.stringify(oldDecision)).digest('hex'),newValue:JSON.stringify(correction),commentIds:['decisionComment']});const badSemantic=run('feedback','propose',request,'--model',input,'--store',store,'--expect-store',imported.revision,'-o',path.join(root,'bad-semantic.json'));assert.notEqual(badSemantic.status,0);assert.ok(badSemantic.diagnostics.some(d=>d.code==='prd/dangling-reference'&&d.severity==='error'),JSON.stringify(badSemantic));
    write(request,{...req,baseRevision:'0'.repeat(64)});assert.notEqual(run('feedback','propose',request,'--model',input,'--store',store,'--expect-store',imported.revision,'-o',path.join(root,'stale.json')).status,0);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('v2 whole and Service Markdown packets publish safely and reuse verified bases', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'archify-feature-packets-'));
  try {
    const m=model();m.workspaceId='bf959db5-03b7-4d2a-a29d-40c3e4779c19';object(m,'item').title='PRIVATE_FIELD_CANARY';
    m.profile.components[0].selector.types.push('capability');m.objects.push(make('secretCap','capability','Private scope',{maturity:'Research'},{parent:'loans'}));
    const q=object(m,'operatorQuestion');q.detail.scope.push('secretCap');q.refs.push(ref('target','secretCap','capability'));refresh(m);
    const policy=completePublicPolicy(m);delete policy.objects.secretCap;policy.omitted={secretCap:'Additional scope withheld'};policy.objects.operatorQuestion.relations=policy.objects.operatorQuestion.relations.filter(r=>r.target!=='secretCap');policy.objects.operatorQuestion.omissions={secretCap:'public_loans'};
    const input=path.join(root,'model.json'),disclosure=path.join(root,'policy.json'),history=path.join(root,'history.json');
    const write=(p,v)=>fs.writeFileSync(p,JSON.stringify(v));write(input,m);write(disclosure,policy);
    const cli=new URL('../archify/bin/archify.mjs',import.meta.url).pathname;
    const run=(...args)=>{const p=spawnSync(process.execPath,[cli,'prd',...args,'--json'],{encoding:'utf8',env:{...process.env,ARCHIFY_UPDATE_CHECK_DISABLED:'1'},timeout:120000});assert.equal(p.error,undefined);return {status:p.status,...JSON.parse(p.stdout)};};
    const h=audience=>({schemaVersion:1,service:'loans',audience,entries:[{version:'1',date:'2026-10-29',summary:'Synthetic baseline'}]});
    for(const audience of ['internal','client']){
      const extra=audience==='client'?['--disclosure',disclosure]:[],whole=path.join(root,`${audience}-whole`),cold=path.join(root,`${audience}-cold`),warm=path.join(root,`${audience}-warm`);
      const wholeRun=run('export',input,'-o',whole,'--audience',audience,'--markdown-only',...extra);assert.equal(wholeRun.status,0,JSON.stringify(wholeRun));
      const info=JSON.parse(fs.readFileSync(path.join(whole,'manifest.json'))),name=`facilities-equipment.prd.${audience}.en.md`;
      assert.equal(info.primaryMarkdown,name);assert.equal(info.auditMarkdown,'appendix.md');assert.ok(info.features.some(f=>f.id==='checkoutFeature'&&f.artifact===name&&f.workflowAsset));
      const text=fs.readFileSync(path.join(whole,name),'utf8');assert.match(text,/Feature list/);assert.match(text,/Process Workflow/);assert.match(text,/System operation/);
      for(const f of info.features)assert.ok(text.includes(`<a id="${f.anchor}"></a>`));
      assert.match(fs.readFileSync(path.join(whole,'README.md'),'utf8'),new RegExp(name.replaceAll('.','\\.')));
      for(const f of info.features.filter(f=>f.workflowAsset))assert.ok(fs.existsSync(path.join(whole,f.workflowAsset)));
      if(audience==='client'){
        for(const entry of fs.readdirSync(whole,{recursive:true})){const file=path.join(whole,entry);if(fs.statSync(file).isFile())assert.doesNotMatch(fs.readFileSync(file,'utf8'),/PRIVATE_FIELD_CANARY|secretCap/);}
        const audit=fs.readFileSync(path.join(whole,'appendix.md'),'utf8');assert.match(audit,/Semantic group coverage/);assert.match(audit,/public\\_item/);assert.doesNotMatch(audit,/secretCap/);
        const changed=structuredClone(policy);changed.objects.item.title='Changed approved field';write(disclosure,changed);
        const stale=run('export',input,'-o',path.join(root,'public-stale'),'--audience','client','--markdown-only','--disclosure',disclosure);assert.notEqual(stale.status,0);assert.ok(stale.diagnostics.some(d=>/stale/.test(d.message)));assert.equal(fs.existsSync(path.join(root,'public-stale')),false);write(disclosure,policy);
        const hidden=structuredClone(policy);hidden.objects.item.fields=hidden.objects.item.fields.filter(f=>f!=='detail.dataType');hidden.objects.item.withheld={'detail.dataType':'Not disclosed'};write(disclosure,hidden);
        const denied=run('export',input,'-o',path.join(root,'public-hidden'),'--audience','client','--markdown-only','--disclosure',disclosure);assert.notEqual(denied.status,0);assert.equal(fs.existsSync(path.join(root,'public-hidden')),false);write(disclosure,policy);
      }
      write(history,h(audience));
      const baseArgs=['--audience',audience,'--service','loans','--service-history',history,'--markdown-only',...extra];
      const first=run('export',input,'-o',cold,...baseArgs);assert.equal(first.status,0,JSON.stringify(first));
      const second=run('export',input,'-o',warm,...baseArgs,'--incremental-from',cold);assert.equal(second.status,0,JSON.stringify(second));assert.ok(second.cache.componentsReused>0);assert.ok(second.cache.resourcesReused>0);
      assert.deepEqual(fs.readFileSync(path.join(cold,name)),fs.readFileSync(path.join(warm,name)));assert.deepEqual(fs.readFileSync(path.join(cold,'manifest.json')),fs.readFileSync(path.join(warm,'manifest.json')));
      const original=fs.readFileSync(path.join(warm,name));fs.appendFileSync(path.join(warm,name),'edited');
      const rejected=run('export',input,'-o',path.join(root,`${audience}-conflict`),...baseArgs,'--incremental-from',warm);assert.notEqual(rejected.status,0);assert.equal(fs.existsSync(path.join(root,`${audience}-conflict`)),false);fs.writeFileSync(path.join(warm,name),original);
      fs.appendFileSync(path.join(warm,'README.md'),'edited');const badIndex=run('export',input,'-o',path.join(root,`${audience}-index-conflict`),...baseArgs,'--incremental-from',warm);assert.notEqual(badIndex.status,0);
      if(audience==='internal'){
        object(m,'return').title='Return the loaned equipment';refresh(m);write(input,m);
        const missingHistory=run('export',input,'-o',path.join(root,'internal-no-history'),...baseArgs,'--incremental-from',cold);assert.notEqual(missingHistory.status,0);assert.equal(fs.existsSync(path.join(root,'internal-no-history')),false);
        const next=h(audience);next.entries.push({version:'2',date:'2026-10-30',summary:'Clarify return'});write(history,next);
        const changed=run('export',input,'-o',path.join(root,'internal-changed'),...baseArgs,'--incremental-from',cold);assert.equal(changed.status,0,JSON.stringify(changed));assert.ok(changed.cache.componentsReused>0);assert.ok(changed.cache.componentsRendered>0);assert.ok(changed.cache.resourcesReused>0);
        object(m,'return').title='Return equipment';refresh(m);write(input,m);
      }
    }
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('Feature pages preserve explicitly approved images, empty-page gaps and independent cache blocks', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'archify-feature-page-'));
  try {
    const m=model();m.workspaceId='bf959db5-03b7-4d2a-a29d-40c3e4779c19';
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA2kAAAAASUVORK5CYII=','base64');
    for(const [id,caption,distributable] of [['allowedImage','Approved historical reference',true],['withheldImage','WITHHELD_IMAGE_CANARY',false]]){
      const filename=`${id}.png`,bytes=distributable?png:Buffer.concat([png,Buffer.from('WITHHELD_IMAGE_BYTES_CANARY')]);fs.writeFileSync(path.join(root,filename),bytes);m.assets.push({id,path:filename,name:filename,mediaType:'image/png',sha256:createHash('sha256').update(bytes).digest('hex'),distributable,caption,version:'1',limitations:'Historical reference; not a target prototype'});
    }
    object(m,'requestPage').assetIds=['allowedImage','withheldImage'];
    m.objects.push(make('emptyPage','interface','Review entry',{kind:'page'},{purpose:'Enter the review task',gap:'Review controls are not yet modeled'}));
    object(m,'review').refs.push(ref('uses','emptyPage','interface'));
    feature(m).actions[1].pages.push({id:'emptyPageAnchor',interface:'emptyPage',groups:[]});refresh(m);assert.deepEqual(errors(m),[]);
    const policy=completePublicPolicy(m);policy.assets={allowedImage:{id:'publicReference',caption:'Approved historical reference, version 1'}};
    const input=path.join(root,'model.json'),disclosure=path.join(root,'policy.json'),history=path.join(root,'history.json');
    const write=(p,v)=>fs.writeFileSync(p,JSON.stringify(v));write(input,m);write(disclosure,policy);
    const cli=new URL('../archify/bin/archify.mjs',import.meta.url).pathname;
    const run=(...args)=>{const p=spawnSync(process.execPath,[cli,'prd',...args,'--json'],{encoding:'utf8',env:{...process.env,ARCHIFY_UPDATE_CHECK_DISABLED:'1'},timeout:120000});assert.equal(p.error,undefined);return {status:p.status,...JSON.parse(p.stdout)};};
    for(const audience of ['internal','client']){
      const dir=path.join(root,audience),args=['export',input,'-o',dir,'--audience',audience,'--markdown-only',...(audience==='client'?['--disclosure',disclosure]:[])];
      const result=run(...args);assert.equal(result.status,0,JSON.stringify(result));
      const meta=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))),text=fs.readFileSync(path.join(dir,meta.primaryMarkdown),'utf8');
      const page=text.slice(text.indexOf('<a id="requestPageAnchor"></a>'),text.indexOf('#####',text.indexOf('<a id="requestPageAnchor"></a>')));
      assert.match(page,/Approved historical reference/);assert.match(page,/!\[/);
      if(audience==='client'){assert.doesNotMatch(text.replaceAll('\\_','_'),/WITHHELD_IMAGE_CANARY/);assert.match(page,/assets\/publicReference\.png/);for(const entry of fs.readdirSync(dir,{recursive:true})){const file=path.join(dir,entry);if(fs.statSync(file).isFile())assert.doesNotMatch(fs.readFileSync(file).toString('utf8').replaceAll('\\_','_'),/WITHHELD_IMAGE_(?:CANARY|BYTES_CANARY)|withheldImage/);}}else assert.match(page.replaceAll('\\_','_'),/WITHHELD_IMAGE_CANARY/);
      const empty=text.slice(text.indexOf('<a id="emptyPageAnchor"></a>'),text.indexOf('#####',text.indexOf('<a id="emptyPageAnchor"></a>')));
      assert.match(empty,/\*\*Page purpose\*\*/);assert.match(empty,/\*\*TBC\*\*/);assert.match(empty,/Review controls are not yet modeled/);
      const htmlDir=path.join(root,`${audience}-html`),htmlResult=run('export',input,'-o',htmlDir,'--audience',audience,...(audience==='client'?['--disclosure',disclosure]:[]));assert.equal(htmlResult.status,0,JSON.stringify(htmlResult));
      const html=fs.readFileSync(path.join(htmlDir,'index.html'),'utf8'),appendix=fs.readFileSync(path.join(htmlDir,'appendix.html'),'utf8');assert.match(html,/Approved historical reference/);assert.match(html,/href="appendix\.html"/);assert.ok(html.includes(`href="${meta.primaryMarkdown}"`));assert.match(appendix,/Semantic group coverage/);assert.match(appendix,/Workflow provenance/);assert.ok(appendix.includes(`href="${meta.primaryMarkdown}"`));assert.deepEqual(fs.readFileSync(path.join(htmlDir,meta.primaryMarkdown)),fs.readFileSync(path.join(dir,meta.primaryMarkdown)));if(audience==='client')assert.doesNotMatch(html+appendix,/WITHHELD_IMAGE_CANARY/);
      if(process.env.ARCHIFY_CHROME){const pdfDir=path.join(root,`${audience}-pdf`),pdf=run('export',input,'-o',pdfDir,'--audience',audience,'--pdf',...(audience==='client'?['--disclosure',disclosure]:[]));assert.equal(pdf.status,0,JSON.stringify(pdf));assert.equal(fs.readFileSync(path.join(pdfDir,'document.pdf')).subarray(0,5).toString(),'%PDF-');}
    }
    const historyValue={schemaVersion:1,service:'loans',audience:'internal',entries:[{version:'1',date:'2026-10-29',summary:'First baseline'}]};write(history,historyValue);
    const base=path.join(root,'base'),next=path.join(root,'next'),serviceArgs=['--audience','internal','--service','loans','--service-history',history,'--markdown-only'];
    let result=run('export',input,'-o',base,...serviceArgs);assert.equal(result.status,0,JSON.stringify(result));const baseBlocks=result.cache.componentsRendered;
    const findBlock=dir=>fs.readdirSync(path.join(dir,'cache','product')).find(name=>fs.readFileSync(path.join(dir,'cache','product',name),'utf8').includes('<a id="emptyPageAnchor"></a>'));
    const unchanged=findBlock(base);assert.ok(unchanged);assert.doesNotMatch(fs.readFileSync(path.join(base,'cache','product',unchanged),'utf8'),/requestPageAnchor/);
    feature(m).actions[0].pages[0].groups[0].summary.text='Changed first page group description.';write(input,m);historyValue.entries.push({version:'2',date:'2026-10-30',summary:'Clarify first page'});write(history,historyValue);
    result=run('export',input,'-o',next,...serviceArgs,'--incremental-from',base);assert.equal(result.status,0,JSON.stringify(result));assert.equal(result.cache.componentsRendered,2);assert.equal(result.cache.componentsReused,baseBlocks-2);assert.ok(result.cache.resourcesReused>0);assert.equal(findBlock(next),unchanged);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('v2 whole and incremental Service audits ignore JSON object-key order without reordering authored arrays', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'archify-feature-order-'));
  try {
    const m=model();m.workspaceId='bf959db5-03b7-4d2a-a29d-40c3e4779c19';object(m,'item').title='PRIVATE_FIELD_CANARY';refresh(m);
    m.profile.components[0].selector.types.push('variant');m.objects.push(make('draftVariant','variant','Draft variant',{kind:'state',predicate:{constant:true}},{parent:'requestPage',gap:'PRIVATE_GAP_CANARY',priority:'high'}));
    const policy=completePublicPolicy(m),input=path.join(root,'model.json'),disclosure=path.join(root,'policy.json'),history=path.join(root,'history.json');
    policy.objects.draftVariant.fields=policy.objects.draftVariant.fields.filter(f=>!['gap','priority'].includes(f));policy.objects.draftVariant.withheld={priority:'Priority withheld',gap:'Gap withheld'};
    const write=(p,v)=>fs.writeFileSync(p,JSON.stringify(v));
    const sorted=sortKeys;
    const cli=new URL('../archify/bin/archify.mjs',import.meta.url).pathname;
    const run=(...args)=>{const p=spawnSync(process.execPath,[cli,'prd',...args,'--json'],{encoding:'utf8',env:{...process.env,ARCHIFY_UPDATE_CHECK_DISABLED:'1'},timeout:120000});assert.equal(p.error,undefined);const result={status:p.status,...JSON.parse(p.stdout)};assert.equal(result.status,0,JSON.stringify(result));return result;};
    const compare=(a,b,{sourceManifest=false}={})=>{const entries=fs.readdirSync(a,{recursive:true}).filter(x=>fs.statSync(path.join(a,x)).isFile()).sort();assert.deepEqual(fs.readdirSync(b,{recursive:true}).filter(x=>fs.statSync(path.join(b,x)).isFile()).sort(),entries);for(const name of entries){const first=fs.readFileSync(path.join(a,name)),second=fs.readFileSync(path.join(b,name));if(name==='manifest.json'&&sourceManifest){const x=JSON.parse(first),y=JSON.parse(second);assert.ok(x.sourceManifest&&y.sourceManifest);delete x.sourceManifest;delete y.sourceManifest;assert.deepEqual(y,x,name);}else assert.ok(first.equals(second),name);}};
    const md=s=>String(s).replaceAll('\\','\\\\').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('|','\\|').replace(/\r?\n/g,'<br>').replace(/([\[\]`*_])/g,'\\$1');
    for(const audience of ['internal','client']){
      write(input,m);write(disclosure,policy);write(history,{schemaVersion:1,service:'loans',audience,entries:[{version:'1',date:'2026-10-29',summary:'Synthetic baseline'}]});
      const extra=audience==='client'?['--disclosure',disclosure]:[],whole=path.join(root,`${audience}-whole`),wholeSorted=path.join(root,`${audience}-whole-sorted`),cold=path.join(root,`${audience}-cold`),warm=path.join(root,`${audience}-warm`);
      run('export',input,'-o',whole,'--audience',audience,...extra);
      const serviceArgs=['--audience',audience,'--service','loans','--service-history',history,'--markdown-only',...extra];run('export',input,'-o',cold,...serviceArgs);
      const reader=path.join(root,'client-reader.html'),readerSorted=path.join(root,'client-reader-sorted.html');
      if(audience==='client')run('build',input,'-o',reader,'--audience','client',...extra);
      write(input,sorted(m));write(disclosure,sorted(policy));
      run('export',input,'-o',wholeSorted,'--audience',audience,...extra);
      if(audience==='client'){
        run('build',input,'-o',readerSorted,'--audience','client',...extra);
        const data=file=>JSON.parse(fs.readFileSync(file,'utf8').match(/<script type="application\/json" id="reader-data">(.*?)<\/script>/s)[1]);
        const before=data(reader),after=data(readerSorted);assert.equal(after.snapshot,before.snapshot);assert.deepEqual(after.objects,before.objects);assert.deepEqual(after.views,before.views);assert.deepEqual(after.featureCorrespondence,before.featureCorrespondence);assert.equal(after.featureCorrespondence[0].workflow,'public_checkoutFlow');assert.deepEqual(after.objects.find(o=>o.id==='public_draftVariant').disclosureGaps,['Gap withheld','Priority withheld']);assert.doesNotMatch(JSON.stringify(after),/PRIVATE_FIELD_CANARY|PRIVATE_GAP_CANARY/);
        const original=publicFixture(m).manifest,permuted=publicFixture(sorted(m)).manifest;
        assert.deepEqual(snapshotPublicReviewedTextV2(original,policy,'Reviewed synthetic fact',['item']),snapshotPublicReviewedTextV2(permuted,sorted(policy),'Reviewed synthetic fact',['item']));
      }
      const reused=run('export',input,'-o',warm,...serviceArgs,'--incremental-from',cold);assert.ok(reused.cache.componentsReused>0);assert.ok(reused.cache.resourcesReused>0);
      // Whole internal provenance binds the prepared source manifest; Service packet bytes remain identical.
      compare(whole,wholeSorted,{sourceManifest:audience==='internal'});compare(cold,warm);
      const audit=fs.readFileSync(path.join(whole,'appendix.md'),'utf8');assert.match(audit,/Semantic group coverage/);assert.match(audit,/Workflow provenance/);assert.match(audit,audience==='internal'?/Draft variant/:/Public variant/);
      if(audience==='internal')assert.ok(audit.includes(md(JSON.stringify(sorted(m.nativeViews[0].spec.nodes)))),'authored workflow node array and nested facts are retained in order');
      const packet=JSON.parse(fs.readFileSync(path.join(whole,'manifest.json')));assert.ok(packet.preparation['prd-export.mjs']);const text=fs.readFileSync(path.join(whole,packet.primaryMarkdown),'utf8');assert.ok(text.indexOf('Equipment checkout')<text.indexOf('Equipment return'));
    }
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('v2 reader navigation, frozen download, print and public feedback work in Chromium', {skip:process.env.ARCHIFY_CHROME?false:'Set ARCHIFY_CHROME for a real browser.'}, async t => {
  const chrome=findChrome();assert.ok(chrome);const root=fs.mkdtempSync(path.join(os.tmpdir(),'archify-feature-browser-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const m=model();m.workspaceId='bf959db5-03b7-4d2a-a29d-40c3e4779c19';object(m,'item').title='PRIVATE_FIELD_CANARY';object(m,'request').refs.push({relation:'derivedFrom',target:'source',type:'source',locator:'note',quote:'A borrower requests equipment',interpretation:'Synthetic source for the request.'});refresh(m);m.nativeViews.reverse();
  const policy=completePublicPolicy(m),input=path.join(root,'model.json'),disclosure=path.join(root,'policy.json');fs.writeFileSync(input,JSON.stringify(m));fs.writeFileSync(disclosure,JSON.stringify(policy));
  const single=structuredClone(m);single.objects=single.objects.filter(o=>o.id!=='return');single.profile.productDocument.modules[0].subModules[0].features=single.profile.productDocument.modules[0].subModules[0].features.filter(f=>f.id!=='returnFeature');single.nativeViews.find(v=>v.id==='returnFlow').bindings[0].object='request';const singleInput=path.join(root,'single.json');fs.writeFileSync(singleInput,JSON.stringify(single));
  const cli=new URL('../archify/bin/archify.mjs',import.meta.url).pathname,run=(...args)=>{const p=spawnSync(process.execPath,[cli,'prd',...args,'--json'],{encoding:'utf8',env:{...process.env,ARCHIFY_UPDATE_CHECK_DISABLED:'1'},timeout:120000});assert.equal(p.error,undefined);return {status:p.status,...JSON.parse(p.stdout)};};
  const full=path.join(root,'full.html'),one=path.join(root,'one.html'),client=path.join(root,'client.html');for(const [src,out,extra] of [[input,full,[]],[singleInput,one,[]],[input,client,['--audience','client','--disclosure',disclosure]]]){const r=run('build',src,'-o',out,...extra);assert.equal(r.status,0,JSON.stringify(r));}
  const browser=new ChromeVisualBrowser(chrome);t.after(()=>browser.close());const session=await browser.sessionPromise,send=(method,params={},target=session)=>browser.cdp.send(method,params,target);
  const val=async(expression,target=session)=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},target);assert.equal(r.exceptionDetails,undefined,r.exceptionDetails?.exception?.description);return r.result?.value;};
  const wait=async(expression,target=session)=>{for(let i=0;i<200;i++){if(await val(expression,target))return;await new Promise(r=>setTimeout(r,50));}assert.fail(`Timed out: ${expression}`);};
  const navigate=async(file,hash='')=>{const url=new URL(pathToFileURL(file));url.hash=hash;await send('Page.navigate',{url:url.href});};
  const attach=async()=>{const tree=await send('Page.getFrameTree');let target;for(let i=0;i<120;i++){target=(await send('Target.getTargets')).targetInfos.find(x=>x.type==='iframe'&&x.parentId===tree.frameTree.frame.id&&x.url.startsWith('about:srcdoc'));if(target)break;await new Promise(r=>setTimeout(r,50));}assert.ok(target);const id=(await send('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;await send('Runtime.enable',{},id);return id;};
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:root});
  await navigate(one);await wait('document.querySelector(".catalog-item button")');await val('document.querySelector(".catalog-item button").click()');await wait('document.querySelector("#stage").dataset.nativeReady==="requestNode"');assert.equal(await val('document.querySelector("#view-select").value'),'checkoutFlow');assert.equal(await val('document.querySelector("#host-scale").textContent'),'100%');assert.match(await val('document.querySelector("#context-group").innerText'),/equipment-checkout\.prd\.internal\.en\.md#checkoutFeature|facilities-equipment\.prd\.internal\.en\.md#checkoutFeature/);assert.match(await val('document.querySelector("#context-group").innerText'),/Service-authored history was not supplied/);
  let child=await attach();assert.equal(await val('Archify.view.state().scale',child),1);await val('document.querySelector(\'[data-view="in"]\').click()',child);await wait('Archify.view.state().scale>1',child);await val('document.querySelector(\'[data-view="reset"]\').click()',child);await wait('Archify.view.state().scale===1',child);await val('document.querySelector("#host-in").click()');assert.equal(await val('document.querySelector("#host-scale").textContent'),'110%');await val('document.querySelector("#host-reset").click()');assert.equal(await val('document.querySelector("#host-scale").textContent'),'100%');await val('document.querySelector(\'svg [data-node-id="requestNode"]\').focus()',child);for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13,...(type==='keyDown'?{text:'\\r',unmodifiedText:'\\r'}:{})});await wait('!document.querySelector("#detail").hidden');await wait('document.querySelector("[data-object=source]")');await val('document.querySelector("[data-object=source]").click()');await wait('document.querySelector("#detail-content h2")?.textContent==="Synthetic research note"');assert.match(await val('document.querySelector("#detail-content").innerText'),/A borrower requests equipment/);await val('document.querySelector("#close").click()');await wait('document.querySelector("#detail").hidden');await wait('document.activeElement?.getAttribute("data-node-id")==="requestNode"',child);await send('Target.detachFromTarget',{sessionId:child});
  await navigate(one,'s=loans&v=returnFlow&t=');await wait('document.querySelector("#stage")?.dataset.nativeReady==="returnNode"');assert.equal(await val('document.querySelector("#view-select").value'),'returnFlow');
  await navigate(full);await wait('document.querySelector(".catalog-item button")');await val('document.querySelector(".catalog-item button").click()');await wait('document.querySelectorAll(".feature-correspondence").length===4');assert.equal(await val('document.querySelector("#view-select").value'),'');assert.equal(await val('document.querySelector("#view-select").disabled'),false);assert.equal(await val('document.querySelector("#native")'),null);assert.match(await val('document.querySelector("#native-title").textContent'),/Choose a Feature workflow/);assert.match(await val('document.querySelector("[data-feature=renewalFeature]").innerText'),/TBC/);await val('document.querySelector("[data-feature=checkoutFeature] button").click()');await wait('document.querySelector("#stage").dataset.nativeReady==="requestNode"');await val('document.querySelector("[data-feature=returnFeature] button").click()');await wait('document.querySelector("#stage").dataset.nativeReady==="returnNode"');
  await val('document.querySelector("#download-prd").click()');let download;for(let i=0;i<100;i++){download=fs.readdirSync(root).find(n=>n.startsWith('prd-internal-')&&n.endsWith('.zip'));if(download)break;await new Promise(r=>setTimeout(r,50));}assert.ok(download,'browser Markdown package download');const listed=spawnSync('unzip',['-Z1',path.join(root,download)],{encoding:'utf8'});assert.equal(listed.status,0,listed.stderr);assert.match(listed.stdout,/facilities-equipment\.prd\.internal\.en\.md/);assert.doesNotMatch(listed.stdout,/index\.html|appendix\.html/);
  assert.match(await val('document.querySelector("#print-document").innerText'),/Equipment checkout/);const pdf=await send('Page.printToPDF',{printBackground:true,preferCSSPageSize:true});assert.equal(Buffer.from(pdf.data,'base64').subarray(0,5).toString(),'%PDF-');
  await navigate(client,'s=public_loans&v=public_checkoutFlow&t=public_request');await wait('document.querySelector("[data-annotate]")');const data=await val('JSON.parse(document.querySelector("#reader-data").textContent)');assert.equal(data.audience,'client');assert.ok(data.snapshot&&data.exporter&&data.disclosure);assert.equal(data.featureCorrespondence[0].service,'public_loans');assert.doesNotMatch(JSON.stringify(data),/PRIVATE_FIELD_CANARY/);
  await val(`(()=>{document.querySelector('[data-annotate]').click();const form=document.querySelector('[data-feedback-form]');form.querySelector('[name=property]').value='/title';form.querySelector('[name=property]').dispatchEvent(new Event('change'));form.querySelector('[name=author]').value='Synthetic reviewer';form.querySelector('[name=body]').value='Clarify the public action.';form.requestSubmit();})()`);await wait('document.querySelector("[data-feedback-message]")?.textContent.includes("saved locally")');await val(`(()=>{document.querySelector('[data-feedback-view]').click();document.querySelector('[data-feedback-download]').click();})()`);
  let feedback;for(let i=0;i<100;i++){feedback=fs.readdirSync(root).find(n=>n.startsWith('archify-public-feedback-')&&n.endsWith('.json'));if(feedback)break;await new Promise(r=>setTimeout(r,50));}assert.ok(feedback);await send('DOM.enable');const dom=await send('DOM.getDocument',{depth:-1}),fileInput=await send('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'[data-feedback-file]'});assert.ok(fileInput.nodeId);await send('DOM.setFileInputFiles',{nodeId:fileInput.nodeId,files:[path.join(root,feedback)]});await wait('document.querySelector("[data-feedback-message]")?.textContent.includes("idempotent")');fs.writeFileSync(input,JSON.stringify(sortKeys(m)));fs.writeFileSync(disclosure,JSON.stringify(sortKeys(policy)));const mapped=path.join(root,'mapped.json'),mapResult=run('feedback','map-public',path.join(root,feedback),'--model',input,'--disclosure',disclosure,'--expect-revision',data.revision,'--expect-snapshot',data.snapshot,'-o',mapped);assert.equal(mapResult.status,0,JSON.stringify(mapResult));assert.equal(JSON.parse(fs.readFileSync(mapped)).comments[0].objectId,'request');const imported=run('feedback','import',mapped,'--model',input,'-o',path.join(root,'store.json'));assert.equal(imported.status,0,JSON.stringify(imported));
});

test('legacy Service bases are fully verified before named-main migration', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'archify-feature-migrate-'));
  try {
    const m=model();m.workspaceId='bf959db5-03b7-4d2a-a29d-40c3e4779c19';const legacy=structuredClone(m);delete legacy.profile.productDocument;
    const current=path.join(root,'current.json'),old=path.join(root,'legacy.json'),history=path.join(root,'history.json');
    const write=(p,v)=>fs.writeFileSync(p,JSON.stringify(v));write(current,m);write(old,legacy);
    const initial={schemaVersion:1,service:'loans',audience:'internal',entries:[{version:'1',date:'2026-10-29',summary:'Legacy baseline'}]};write(history,initial);
    const cli=new URL('../archify/bin/archify.mjs',import.meta.url).pathname;
    const run=(...args)=>{const p=spawnSync(process.execPath,[cli,'prd',...args,'--json'],{encoding:'utf8',env:{...process.env,ARCHIFY_UPDATE_CHECK_DISABLED:'1'},timeout:120000});assert.equal(p.error,undefined);return {status:p.status,...JSON.parse(p.stdout)};};
    const base=path.join(root,'base'),args=['--audience','internal','--service','loans','--service-history',history,'--markdown-only'];
    const first=run('export',old,'-o',base,...args);assert.equal(first.status,0,JSON.stringify(first));const oldManifest=JSON.parse(fs.readFileSync(path.join(base,'manifest.json')));assert.equal(oldManifest.primaryMarkdown,undefined);
    initial.entries.push({version:'2',date:'2026-10-30',summary:'Feature baseline'});write(history,initial);
    const readme=path.join(base,'README.md'),original=fs.readFileSync(readme);fs.appendFileSync(readme,'changed');
    const rejected=run('export',current,'-o',path.join(root,'blocked'),...args,'--incremental-from',base);assert.notEqual(rejected.status,0);assert.equal(fs.existsSync(path.join(root,'blocked')),false);fs.writeFileSync(readme,original);
    const migrated=path.join(root,'migrated'),result=run('export',current,'-o',migrated,...args,'--incremental-from',base);assert.equal(result.status,0,JSON.stringify(result));
    const manifest=JSON.parse(fs.readFileSync(path.join(migrated,'manifest.json')));assert.equal(manifest.primaryMarkdown,'facilities-equipment.prd.internal.en.md');assert.deepEqual(manifest.history,initial.entries);assert.deepEqual(fs.readFileSync(readme),original);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('a single Feature collection uses the authored Feature business key', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'archify-single-feature-'));
  try {
    const m=model(),module=m.profile.productDocument.modules[0];module.subModules=[module.subModules[0]];module.subModules[0].features=[module.subModules[0].features[0]];
    m.objects=m.objects.filter(o=>!['return','operatorQuestion'].includes(o.id));m.nativeViews=m.nativeViews.filter(v=>v.id!=='returnFlow');
    const input=path.join(root,'model.json'),output=path.join(root,'packet');fs.writeFileSync(input,JSON.stringify(m));
    const cli=new URL('../archify/bin/archify.mjs',import.meta.url).pathname,p=spawnSync(process.execPath,[cli,'prd','export',input,'-o',output,'--audience','internal','--markdown-only','--json'],{encoding:'utf8',env:{...process.env,ARCHIFY_UPDATE_CHECK_DISABLED:'1'},timeout:120000});
    assert.equal(p.status,0,p.stdout+p.stderr);const manifest=JSON.parse(fs.readFileSync(path.join(output,'manifest.json')));assert.equal(manifest.primaryMarkdown,'equipment-checkout.prd.internal.en.md');assert.equal(manifest.features.length,1);assert.ok(fs.existsSync(path.join(output,manifest.primaryMarkdown)));
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('case-insensitive workflow asset collisions fail before publication', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'archify-feature-collision-'));
  try {
    const m=model();m.nativeViews[1].id='CheckoutFlow';m.profile.productDocument.modules[0].subModules[0].features[1].workflow.view='CheckoutFlow';
    const input=path.join(root,'model.json'),output=path.join(root,'packet');fs.writeFileSync(input,JSON.stringify(m));
    const cli=new URL('../archify/bin/archify.mjs',import.meta.url).pathname,p=spawnSync(process.execPath,[cli,'prd','export',input,'-o',output,'--audience','internal','--markdown-only','--json'],{encoding:'utf8',env:{...process.env,ARCHIFY_UPDATE_CHECK_DISABLED:'1'},timeout:120000});
    assert.notEqual(p.status,0);assert.match(p.stdout,/collision/i);assert.equal(fs.existsSync(output),false);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('v2 reader builds a named frozen Markdown packet from the validated Feature plan', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'archify-feature-reader-'));
  try {
    const m=model();m.workspaceId='bf959db5-03b7-4d2a-a29d-40c3e4779c19';object(m,'item').title='PRIVATE_FIELD_CANARY';m.profile.components[0].selector.types.push('capability');m.objects.push(make('secretScope','capability','PRIVATE_SCOPE_CANARY',{maturity:'Research'},{parent:'loans'}));const question=object(m,'operatorQuestion');question.detail.scope.push('secretScope');question.refs.push(ref('target','secretScope','capability'));refresh(m);
    const policy=completePublicPolicy(m);delete policy.objects.secretScope;policy.omitted={secretScope:'public_loans'};policy.objects.operatorQuestion.relations=policy.objects.operatorQuestion.relations.filter(r=>r.target!=='secretScope');policy.objects.operatorQuestion.omissions={secretScope:'public_loans'};
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA2kAAAAASUVORK5CYII=','base64');
    fs.writeFileSync(path.join(root,'image.png'),png);m.assets.push({id:'pageImage',path:'image.png',name:'image.png',mediaType:'image/png',sha256:createHash('sha256').update(png).digest('hex'),distributable:true,caption:'Private caption'});object(m,'requestPage').assetIds=['pageImage'];refresh(m);policy.assets={pageImage:{id:'approvedImage',caption:'Approved image'}};
    // Public hashes omit private asset metadata; only the explicit attachment is projected.
    const input=path.join(root,'model.json'),disclosure=path.join(root,'policy.json');fs.writeFileSync(input,JSON.stringify(m));fs.writeFileSync(disclosure,JSON.stringify(policy));
    const cli=new URL('../archify/bin/archify.mjs',import.meta.url).pathname;
    const unpack=bytes=>{const files=new Map();let p=0;while(bytes.readUInt32LE(p)===0x04034b50){const size=bytes.readUInt32LE(p+18),n=bytes.readUInt16LE(p+26),extra=bytes.readUInt16LE(p+28),name=bytes.subarray(p+30,p+30+n).toString(),start=p+30+n+extra;files.set(name,bytes.subarray(start,start+size));p=start+size;}return files;};
    for(const audience of ['internal','client']){
      const output=path.join(root,`${audience}.html`),args=[cli,'prd','build',input,'-o',output,'--audience',audience,...(audience==='client'?['--disclosure',disclosure]:[]),'--json'],run=spawnSync(process.execPath,args,{encoding:'utf8',env:{...process.env,ARCHIFY_UPDATE_CHECK_DISABLED:'1'},timeout:120000});assert.equal(run.status,0,run.stdout+run.stderr);
      const html=fs.readFileSync(output,'utf8'),match=html.match(/<script type="application\/json" id="reader-data">([\s\S]*?)<\/script>/);assert.ok(match);const data=JSON.parse(match[1]),files=unpack(Buffer.from(data.packageBase64,'base64')),packet=JSON.parse(files.get('manifest.json'));
      assert.equal(packet.primaryMarkdown,`facilities-equipment.prd.${audience}.en.md`);assert.equal(data.primaryMarkdown,packet.primaryMarkdown);assert.equal(data.featureCorrespondence.length,4);assert.equal(data.featureCorrespondence.find(f=>f.id==='checkoutFeature').workflow,audience==='client'?'public_checkoutFlow':'checkoutFlow');
      assert.deepEqual([...files.keys()].filter(n=>n!=='manifest.json').sort(),Object.keys(packet.artifacts).sort());assert.equal(files.has('index.html'),false);assert.equal(files.has('appendix.html'),false);for(const [name,meta] of Object.entries(packet.artifacts)){assert.equal(createHash('sha256').update(files.get(name)).digest('hex'),meta.sha256);assert.equal(files.get(name).length,meta.bytes);}
      assert.match(files.get('README.md').toString(),new RegExp(packet.primaryMarkdown.replaceAll('.','\\.')));assert.ok(files.get(packet.primaryMarkdown).toString().includes('<a id="checkoutFeature"></a>'));assert.ok(files.has(audience==='client'?'assets/approvedImage.png':`assets/audit-${createHash('sha256').update(png).digest('hex')}.png`));
      assert.match(html,/<article id="print-document"[\s\S]*Equipment checkout/);assert.match(html,/Primary Markdown \(available in the Markdown package\)/);assert.match(html,/data:image\/png;base64,/);
      if(audience==='client'){assert.doesNotMatch(html,/PRIVATE_FIELD_CANARY|Private caption|PRIVATE_SCOPE_CANARY|secretScope/);for(const bytes of files.values())assert.doesNotMatch(bytes.toString(),/PRIVATE_FIELD_CANARY|Private caption|PRIVATE_SCOPE_CANARY|secretScope/);assert.equal(data.objects.find(o=>o.id==='public_item').status,undefined);assert.deepEqual(data.questionScopes.public_operatorQuestion,['public_loans']);assert.equal(data.featureCorrespondence[0].service,'public_loans');}
    }
    const stale=structuredClone(policy);stale.objects.item.title='Changed approved label';fs.writeFileSync(disclosure,JSON.stringify(stale));const rejected=spawnSync(process.execPath,[cli,'prd','build',input,'-o',path.join(root,'stale.html'),'--audience','client','--disclosure',disclosure,'--json'],{encoding:'utf8',env:{...process.env,ARCHIFY_UPDATE_CHECK_DISABLED:'1'},timeout:120000});assert.notEqual(rejected.status,0);assert.match(rejected.stdout,/stale/i);assert.equal(fs.existsSync(path.join(root,'stale.html')),false);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
