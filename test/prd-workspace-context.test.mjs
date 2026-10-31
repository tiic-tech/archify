import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { activityContext } from '../archify/explainer/workspace/prd-context.mjs';
import { validatePrd, scopeIds, readiness, serviceOwners } from '../archify/explainer/workspace/prd-model.mjs';
import { preparePrd } from '../archify/explainer/workspace/prd-prepare.mjs';
import path from 'node:path';

const fixture = () => JSON.parse(fs.readFileSync(new URL('./fixtures/prd-workspace/facility.json', import.meta.url), 'utf8'));
const get = (model, id) => model.objects.find(object => object.id === id);

test('native targets must match authored links and directly related objects', async () => {
  const file=path.resolve('test/fixtures/prd-workspace-reader/reader.json');
  const model=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.equal((await preparePrd(model,{inputPath:file})).ok,true);
  const targets=model.nativeViews[0].bindings.find(b=>b.node==='reviewNode').targets;
  targets[0].href='forged.html';
  let result=await preparePrd(model,{inputPath:file});
  assert.ok(result.diagnostics.some(d=>d.code==='prd/native-targets'));
  targets[0].href='list.html';targets[0].object='session';targets[0].type='field';
  result=await preparePrd(model,{inputPath:file});
  assert.ok(result.diagnostics.some(d=>d.code==='prd/native-target-context'));
});

test('service ownership follows explicit journey ancestry but not shared references', () => {
  const model=JSON.parse(fs.readFileSync(path.resolve('test/fixtures/prd-workspace-reader/reader.json'),'utf8'));
  get(model,'publish').parent='staffJourney';let owners=serviceOwners(model);
  assert.equal(owners.staffJourney,'serviceTwo');assert.equal(owners.publish,'serviceTwo');
  for(const id of ['librarian','list','session','row'])assert.equal(owners[id],null,id);
  model.objects.push({id:'nestedPhase',type:'phase',parent:'staffJourney'});get(model,'publish').parent='nestedPhase';owners=serviceOwners(model);assert.equal(owners.publish,'serviceTwo');
  get(model,'staffJourney').refs.push({relation:'service',target:'service',type:'service'});owners=serviceOwners(model);assert.equal(owners.publish,null,'ambiguous mappings are not guessed');assert.ok(Object.isFrozen(owners));
});

test('typed scope keeps contextual roles separate from explicit role and service roots', () => {
  const model=JSON.parse(fs.readFileSync(path.resolve('test/fixtures/prd-workspace-reader/reader.json'),'utf8'));
  const action=scopeIds(model,['readyAction']);assert.ok(action.has('librarian'));assert.ok(!action.has('staffJourney'));assert.ok(!action.has('publish'));assert.ok(action.has('readyCase'));
  const journey=scopeIds(model,['staffJourney']);assert.ok(journey.has('publish'));assert.ok(!journey.has('serviceTwo'));assert.ok(!journey.has('choose'));
  const service=scopeIds(model,['service']);assert.ok(service.has('journeyPatron'));assert.ok(!service.has('staffJourney'));assert.ok(!service.has('publish'));
  const role=scopeIds(model,['librarian']);assert.ok(role.has('staffJourney'));assert.ok(role.has('publish'));
  const project=scopeIds(model,['project']);assert.ok(project.has('journeyPatron'));assert.ok(project.has('staffJourney'));
});

test('journey facts and ordered typed steps reject contradictory role and service', () => {
  const file=path.resolve('test/fixtures/prd-workspace-reader/reader.json');
  const model=JSON.parse(fs.readFileSync(file,'utf8'));
  const journey=get(model,'staffJourney');
  assert.equal(validatePrd(model).ok,true);
  assert.equal(journey.detail.dashboard,'The staff dashboard lists draft notices and tasks.');
  const scope=scopeIds(model,['staffJourney']);assert.ok(scope.has('publish'));assert.equal(scope.has('serviceTwo'),false,'service context does not pull unrelated service contents into journey readiness');
  assert.equal(readiness(model,'staffJourney').some(d=>d.evidence?.id==='serviceTwo'),false);
  journey.refs.find(ref=>ref.relation==='step').target='choose';
  let result=validatePrd(model);
  assert.ok(result.diagnostics.some(d=>d.code==='prd/journey-step-service'));
  assert.ok(result.diagnostics.some(d=>d.code==='prd/journey-step-actor'));
  journey.refs.find(ref=>ref.relation==='step').target='publish';
  journey.refs.push({relation:'step',target:'publish',type:'activity'});
  result=validatePrd(model);
  assert.ok(result.diagnostics.some(d=>d.code==='prd/journey-step'));
  journey.refs.pop();journey.refs.push({relation:'actor',target:'patron',type:'role'});
  assert.ok(validatePrd(model).diagnostics.some(d=>d.code==='prd/journey-actor'));
  journey.refs.pop();journey.refs=journey.refs.filter(ref=>ref.relation!=='service');
  assert.ok(validatePrd(model).diagnostics.some(d=>d.code==='prd/journey-service'));
  journey.parent='serviceTwo';assert.equal(validatePrd(model).ok,true,'a typed service parent supplies service context');
  journey.refs=journey.refs.filter(ref=>ref.relation!=='actor');
  assert.ok(validatePrd(model).diagnostics.some(d=>d.code==='prd/journey-actor'));
  assert.equal(validatePrd(fixture()).ok,true,'original P1 fixture remains valid');
});

test('explicit native service ownership rejects a contradictory workflow binding', async () => {
  const model = fixture();
  model.objects.push({id:'otherService',type:'service',title:'Other service',purpose:'An independent scope',status:'proposed',detail:{},parent:'project'});
  model.nativeViews[0].service='otherService';
  const result=await preparePrd(model,{inputPath:path.resolve('test/fixtures/prd-workspace/facility.json')});
  assert.equal(result.ok,false);
  assert.ok(result.diagnostics.some(d=>d.code==='prd/native-service-mismatch'&&d.evidence.activity==='choose'));
  model.nativeViews[0].service='service';
  assert.equal((await preparePrd(model,{inputPath:path.resolve('test/fixtures/prd-workspace/facility.json')})).ok,true);
});

test('workflow Rule bindings require typed local relevance without weakening lane checks', async () => {
  const file=path.resolve('test/fixtures/prd-workspace-reader/reader.json'),model=JSON.parse(fs.readFileSync(file)),view=model.nativeViews.find(v=>v.id==='workflowView');
  view.spec.nodes.push({id:'conditionNode',lane:'patronLane',col:1,type:'backend',label:'Check condition'});view.bindings.push({node:'conditionNode',object:'sessionRule',type:'rule'});get(model,'sessionRule').rule.exceptions=[];
  const check=()=>preparePrd(model,{inputPath:file});let result=await check();assert.equal(result.ok,true,JSON.stringify(result.diagnostics));
  delete view.service;result=await check();assert.equal(result.ok,true,JSON.stringify(result.diagnostics));
  get(model,'sessionRule').rule.scope=['serviceTwo'];result=await check();assert.ok(result.diagnostics.some(d=>d.code==='prd/native-rule-context'&&d.subject.locator.endsWith('/bindings/3')));
  get(model,'sessionRule').rule.scope=['service'];assert.equal((await check()).ok,true);
  view.bindings.at(-1).object='session';result=await check();assert.ok(result.diagnostics.some(d=>d.code==='prd/reference-type'||d.code==='prd/ref-type'||d.code==='prd/reference'));
  view.bindings.at(-1).object='sessionRule';get(model,'sessionRule').rule.scope=['choose'];view.bindings[0]={node:'chooseNode',object:'session',type:'field'};result=await check();assert.ok(result.diagnostics.some(d=>d.code==='prd/native-object-type'));
  view.bindings[0]={node:'chooseNode',object:'choose',type:'activity'};view.laneBindings.find(b=>b.lane==='patronLane').role='librarian';result=await check();assert.ok(result.diagnostics.some(d=>d.code==='prd/native-actor-mismatch'));
});

test('activity-owned bindings stay at known scope when the interface is not authored', () => {
  const model = fixture();
  assert.equal(validatePrd(model).ok, true);
  const choose = activityContext(model, 'choose');
  assert.deepEqual(choose.interfaces, ['list']);
  assert.deepEqual(choose.variants, ['open']);
  assert.deepEqual(choose.bindings, [{ binding: 'chooseBinding', field: 'session', scope: 'activity', activity: 'choose' }]);
  assert.deepEqual(choose.gaps, [
    { object: 'choose', target: 'open', kind: 'variant-interface-not-used' },
    { object: 'chooseBinding', kind: 'binding-interface-unmapped' }
  ]);
  const review = activityContext(model, 'review');
  assert.deepEqual(review.bindings.map(binding => binding.binding), ['reviewBinding']);
  assert.equal(review.bindings[0].field, choose.bindings[0].field);
  assert.throws(() => activityContext(model, 'session'), /activity/);
});

test('explicit activity, interface and variant edges contextualize a shared field without cloning it', () => {
  const model = fixture();
  for (const [activityId, bindingId, variant] of [['choose', 'chooseBinding', 'open'], ['review', 'reviewBinding', 'error']]) {
    get(model, activityId).refs.push({ relation: 'uses', target: 'dialog', type: 'interface' });
    get(model, bindingId).refs.push({ relation: 'variant', target: variant, type: 'variant' });
  }
  assert.equal(validatePrd(model).ok, true);
  const choose = activityContext(model, 'choose');
  const review = activityContext(model, 'review');
  assert.deepEqual(choose.bindings, [{ binding: 'chooseBinding', field: 'session', scope: 'activity-variant', activity: 'choose', interface: 'dialog', variant: 'open' }]);
  assert.deepEqual(review.bindings, [{ binding: 'reviewBinding', field: 'session', scope: 'activity-variant', activity: 'review', interface: 'dialog', variant: 'error' }]);
  assert.deepEqual(choose.gaps, []);
  assert.deepEqual(review.gaps, []);
  get(model, 'chooseBinding').refs.push({ relation: 'variant', target: 'error', type: 'variant' });
  assert.equal(validatePrd(model).ok, true);
  assert.equal(activityContext(model, 'choose').bindings[0].scope, 'activity');
  assert.equal(activityContext(model, 'choose').gaps[0].kind, 'binding-interface-unmapped');
});

test('interface and variant-owned bindings are not projected onto a different interface or variant', () => {
  const model = fixture();
  get(model, 'choose').refs.push({ relation: 'uses', target: 'dialog', type: 'interface' });
  const template = get(model, 'chooseBinding');
  const add = (id, parent) => model.objects.push({ ...structuredClone(template), id, parent });
  add('commonBinding', 'section');
  add('openBinding', 'open');
  add('errorBinding', 'error');
  assert.equal(validatePrd(model).ok, true);
  const choose = activityContext(model, 'choose');
  assert.deepEqual(choose.bindings.map(binding => binding.binding), ['chooseBinding', 'commonBinding', 'openBinding']);
  const review = activityContext(model, 'review');
  assert.deepEqual(review.bindings.map(binding => binding.binding), ['reviewBinding']);
  get(model, 'commonBinding').refs.push({ relation: 'variant', target: 'open', type: 'variant' }, { relation: 'variant', target: 'error', type: 'variant' });
  assert.equal(validatePrd(model).ok, true);
  const ambiguous = activityContext(model, 'choose');
  assert.deepEqual(ambiguous.bindings.find(binding => binding.binding === 'commonBinding'), {
    binding: 'commonBinding', field: 'session', scope: 'section', parent: 'section', interface: 'dialog', ambiguous: true
  });
  assert.ok(ambiguous.gaps.some(gap => gap.object === 'commonBinding' && gap.kind === 'binding-variant-ambiguous'));
});
