import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { preparePrd } from '../archify/explainer/workspace/prd-prepare.mjs';

const fixture=name=>JSON.parse(fs.readFileSync(new URL(`./fixtures/prd-workspace/${name}.json`,import.meta.url),'utf8'));
const cli=path.resolve('archify/bin/archify.mjs');
const hash=s=>createHash('sha256').update(s).digest('hex');
function run(...args){const p=spawnSync(process.execPath,[cli,'prd',...args,'--json'],{encoding:'utf8',maxBuffer:32*1024*1024}); assert.equal(p.stderr,''); return {status:p.status,...JSON.parse(p.stdout)};}
function setup(t,model=fixture('facility')){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prd-test-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'model.json'); fs.copyFileSync(new URL('./fixtures/prd-workspace/event-plan.txt',import.meta.url),path.join(dir,'event-plan.txt'));
  const save=value=>fs.writeFileSync(file,JSON.stringify(value)); save(model); return {dir,file,save};
}
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));

test('native swimlane and reusable records compile deterministically with frozen assets and gaps',t=>{
  const {dir,file}=setup(t); const a=path.join(dir,'a.json'),b=path.join(dir,'b.json');
  const one=run('compile',file,'-o',a),two=run('compile',file,'-o',b);
  assert.equal(one.status,0,JSON.stringify(one)); assert.equal(two.status,0,JSON.stringify(two));
  assert.equal(one.revision,two.revision); assert.deepEqual(fs.readFileSync(a),fs.readFileSync(b));
  const m=read(a), view=m.nativeViews[0];
  assert.deepEqual(view.prepared.spec.edges.map(e=>[e.from,e.to]),[['chooseNode','recordNode'],['recordNode','reviewNode']]);
  assert.equal(view.bindings.find(x=>x.node==='recordNode').object,'record');
  assert.deepEqual(view.laneBindings.map(x=>x.role),['patron','librarian']);
  assert.equal(m.model.objects.find(o=>o.id==='review').refs.find(r=>r.relation==='next').target,'choose');
  assert.equal(Buffer.from(m.assets[0].contentBase64,'base64').toString(),'Synthetic event plan illustration.\n');
  assert.equal(m.model.objects.find(o=>o.id==='row').source.text,fixture('facility').objects.find(o=>o.id==='row').source.text);
  for(const id of ['session','save']) assert.equal(m.model.objects.find(o=>o.id===id).refs.find(r=>r.relation==='derivedFrom').target,'row');
  assert.ok(m.diagnostics.some(d=>d.code==='prd/contract-gap'));
  assert.ok(m.diagnostics.some(d=>d.code==='prd/extension-preserved'));
  const bindings=m.model.objects.filter(o=>o.type==='binding'); assert.equal(bindings.length,2);
  assert.deepEqual(bindings.map(o=>o.refs.find(r=>r.relation==='field').target),['session','session']);
  const before=fs.readFileSync(a); assert.equal(run('compile',file,'-o',a).status,1); assert.deepEqual(fs.readFileSync(a),before);
  assert.equal(run('compile',file,'-o',file).status,1);
  assert.equal(fs.readdirSync(dir).filter(n=>n.startsWith('.archify-prd-')).length,0);
});

test('ready scope evaluates actual contracts and questions while an independent complete scope passes',t=>{
  const {dir,file}=setup(t);
  const bad=run('compile',file,'-o',path.join(dir,'bad.json'),'--ready','service');
  assert.equal(bad.status,1); assert.ok(bad.diagnostics.some(d=>d.code==='prd/ready-gap'&&d.subject.locator.includes('permission')));
  assert.ok(bad.diagnostics.some(d=>d.code==='prd/ready-gap'&&d.message.includes('question')));
  assert.equal(fs.existsSync(path.join(dir,'bad.json')),false);
  const good=run('compile',file,'-o',path.join(dir,'good.json'),'--ready','readyAction');
  assert.equal(good.status,0,JSON.stringify(good));
  const empty=fixture('garden'); fs.writeFileSync(file,JSON.stringify(empty));
  const emptyReady=run('compile',file,'-o',path.join(dir,'empty.json'),'--ready','catalog');
  assert.equal(emptyReady.status,1);assert.ok(emptyReady.diagnostics.some(d=>d.message.includes('no action')));
  assert.equal(run('compile',file,'-o',path.join(dir,'source.json'),'--ready','note').status,1);
});

test('CLI scope preserves role context without traversing other services through actor roles',t=>{
  const model=JSON.parse(fs.readFileSync(path.resolve('test/fixtures/prd-workspace-reader/reader.json'))),{dir,file,save}=setup(t,model);
  fs.copyFileSync(path.resolve('test/fixtures/prd-workspace-reader/prototype.png'),path.join(dir,'prototype.png'));
  const get=id=>model.objects.find(o=>o.id===id),component=model.profile.components.find(c=>c.type==='role-journey');
  get('publish').gap='Approval permissions for the second service are unresolved.';save(model);
  let result=run('compile',file,'-o',path.join(dir,'ready.json'),'--ready','readyAction');assert.equal(result.status,0,JSON.stringify(result));
  result=run('compile',file,'-o',path.join(dir,'journey-ready.json'),'--ready','staffJourney');assert.equal(result.status,1);assert.ok(result.diagnostics.some(d=>d.code==='prd/ready-gap'&&d.evidence.id==='publish'));assert.equal(fs.existsSync(path.join(dir,'journey-ready.json')),false);
  const question=structuredClone(get('question'));question.id='readyQuestion';question.detail.scope=['readyAction'];question.refs.find(r=>r.relation==='target').target='readyAction';model.objects.push(question);save(model);
  result=run('compile',file,'-o',path.join(dir,'question-blocked.json'),'--ready','readyAction');assert.equal(result.status,1);assert.ok(result.diagnostics.some(d=>d.code==='prd/ready-gap'&&d.evidence.id==='readyQuestion'));assert.ok(!result.diagnostics.some(d=>d.code==='prd/ready-gap'&&d.evidence.id==='publish'));
  question.status='customer-confirmed';save(model);result=run('compile',file,'-o',path.join(dir,'question-resolved.json'),'--ready','readyAction');assert.equal(result.status,0,JSON.stringify(result));
  const coverage=(scope,name)=>{component.selector.scope=[scope];save(model);const output=path.join(dir,name+'.json'),compiled=run('compile',file,'-o',output);assert.equal(compiled.status,0,JSON.stringify(compiled));return read(output).components.find(c=>c.id===component.id).coverage.objectIds;};
  const service=coverage('service','service');for(const id of ['patron','librarian','journeyPatron','choose'])assert.ok(service.includes(id),id);for(const id of ['staffJourney','publish'])assert.ok(!service.includes(id),id);
  const serviceTwo=coverage('serviceTwo','serviceTwo');for(const id of ['librarian','staffJourney','publish'])assert.ok(serviceTwo.includes(id),id);assert.ok(!serviceTwo.includes('journeyPatron'));
  const role=coverage('librarian','role');for(const id of ['librarian','staffJourney','publish'])assert.ok(role.includes(id),id);
  const action=coverage('readyAction','action');assert.ok(action.includes('librarian'));assert.ok(!action.includes('staffJourney'));
  get('publish').parent='staffJourney';const nested=coverage('serviceTwo','nested');assert.ok(nested.includes('staffJourney'));assert.ok(nested.includes('publish'));assert.ok(!nested.includes('journeyPatron'));
});

test('schema, identity, reference, containment, anchor and predicate failures are located',t=>{
  const {file,save}=setup(t); const cases=[
    [m=>m.objects[1].id=m.objects[0].id,'prd/duplicate-id'],[m=>m.objects[1].id='constructor','prd/reserved-id'],
    [m=>m.objects[4].refs[0].target='missing','prd/dangling-reference'],[m=>m.objects[4].refs[0].target='list','prd/reference-type'],
    [m=>m.objects[4].refs[0].relation='invented','prd/relation-type'],
    [m=>m.objects.find(o=>o.id==='patron').detail.actorKind='system','prd/actor-kind'],
    [m=>m.objects.find(o=>o.id==='dialog').assetIds=['missingAsset'],'prd/asset-reference'],
    [m=>{const previous=structuredClone(m.objects.find(o=>o.id==='readyDecision'));previous.id='earlierDecision';previous.detail.scope=['readyAction'];m.objects.push(previous);m.objects.find(o=>o.id==='readyDecision').refs.push({relation:'supersedes',target:'earlierDecision',type:'decision'});},'prd/supersession-scope'],
    [m=>{m.objects[1].parent='service';},'prd/containment-cycle'],
    [m=>m.objects.find(o=>o.id==='sessionRule').rule.condition.op='eval','prd/schema'],
    [m=>m.objects.find(o=>o.id==='open').detail.predicate.all[1].field='unknown','prd/dangling-reference'],
    [m=>m.objects.find(o=>o.id==='sessionRule').rule.exceptions[0].scope=['dialog'],'prd/exception-scope'],
    [m=>m.objects.find(o=>o.id==='row').source.text='tampered','prd/source-hash'],
    [m=>m.objects.find(o=>o.id==='session').refs[0].quote='absent','prd/source-anchor'],
    [m=>m.schemaVersion=2,'prd/schema'],[m=>m.objects[0].unknown='lost','prd/schema']
  ];
  for(const [change,code] of cases){const m=fixture('facility');change(m);save(m);const result=run('validate',file);assert.equal(result.status,1,code);assert.ok(result.diagnostics.some(d=>d.code===code),`${code} ${JSON.stringify(result.diagnostics)}`);}
});

test('asset missing, tampered, traversal and symlink paths preserve output and never leave temp files',t=>{
  const model=fixture('garden'),{dir,file,save}=setup(t,model),out=path.join(dir,'result.json'); fs.writeFileSync(out,'good output');
  const bytes='Synthetic event plan illustration.\n';
  model.assets=[{id:'asset',path:'event-plan.txt',name:'asset.txt',mediaType:'text/plain',sha256:hash(bytes),distributable:true}];
  const attempts=[['missing.txt',hash(bytes)],['event-plan.txt',hash('wrong')],['../escape',hash(bytes)]];
  const outside=fs.mkdtempSync(path.join(os.tmpdir(),'prd-outside-')); t.after(()=>fs.rmSync(outside,{recursive:true,force:true}));
  fs.writeFileSync(path.join(outside,'outside.txt'),bytes);
  fs.symlinkSync(path.join(outside,'outside.txt'),path.join(dir,'alias'));
  attempts.push(['alias',hash(bytes)]);
  for(const [p,h] of attempts){model.assets[0].path=p;model.assets[0].sha256=h;save(model);const r=run('compile',file,'-o',out);assert.equal(r.status,1);assert.ok(r.diagnostics.some(d=>d.code==='prd/asset-invalid'));assert.equal(fs.readFileSync(out,'utf8'),'good output');}
  model.assets=[{id:'asset',path:'event-plan.txt',name:'same.txt',mediaType:'text/plain',sha256:hash(bytes),distributable:true},{id:'asset2',path:'event-plan.txt',name:'SAME.txt',mediaType:'text/plain',sha256:hash(bytes),distributable:false}];save(model);
  assert.ok(run('validate',file).diagnostics.some(d=>d.code==='prd/asset-name'));
  assert.equal(fs.readdirSync(dir).filter(n=>n.startsWith('.archify-prd-')).length,0);
});

test('native bindings and native schema are validated through the public CLI',t=>{
  const m=fixture('facility'),{dir,file,save}=setup(t,m);
  m.nativeViews[0].bindings[0].node='missing';save(m);let r=run('compile',file,'-o',path.join(dir,'x.json'));assert.equal(r.status,1);assert.ok(r.diagnostics.some(d=>d.code==='prd/native-node'));
  m.nativeViews[0].bindings[0]={node:'chooseNode',object:'session',type:'field'};save(m);r=run('validate',file);assert.equal(r.status,1);assert.ok(r.diagnostics.some(d=>d.code==='prd/native-object-type'));
  m.nativeViews[0].bindings[0]={node:'chooseNode',object:'choose',type:'activity'};m.nativeViews[0].laneBindings[0].lane='unknown';save(m);r=run('validate',file);assert.equal(r.status,1);assert.ok(r.diagnostics.some(d=>d.code==='prd/native-lane'));m.nativeViews[0].laneBindings[0].lane='patronLane';
  m.nativeViews[0].bindings[0]={node:'chooseNode',object:'choose',type:'activity'};m.nativeViews[0].spec.nodes[0].type='nonsense';save(m);r=run('validate',file);assert.equal(r.status,1);assert.ok(r.diagnostics.some(d=>d.code==='prd/native-invalid'));
});

test('workflow lane bindings agree with human actors without inventing a system actor',t=>{
  const model=fixture('facility'),{dir,file,save}=setup(t,model);
  const ok=run('compile',file,'-o',path.join(dir,'aligned.json'));
  assert.equal(ok.status,0,JSON.stringify(ok));
  const record=model.objects.find(o=>o.id==='record');
  assert.equal(record.detail.actorKind,'system');
  assert.equal(record.refs.some(r=>r.relation==='actor'),false);
  const choose=model.objects.find(o=>o.id==='choose');
  choose.refs.find(r=>r.relation==='actor').target='librarian';save(model);
  const result=run('compile',file,'-o',path.join(dir,'conflict.json'));
  assert.equal(result.status,1,JSON.stringify(result));
  const diagnostic=result.diagnostics.find(d=>d.code==='prd/native-actor-mismatch');
  assert.ok(diagnostic,JSON.stringify(result.diagnostics));
  assert.equal(diagnostic.subject.locator,'/nativeViews/0/bindings/0');
  assert.deepEqual(diagnostic.evidence,{view:'workflowView',node:'chooseNode',activity:'choose',lane:'patronLane',laneRole:'patron',actors:['librarian']});
  assert.equal(fs.existsSync(path.join(dir,'conflict.json')),false);
  choose.refs.find(r=>r.relation==='actor').target='patron';
  choose.refs.push({relation:'actor',target:'librarian',type:'role'});save(model);
  assert.ok(run('compile',file,'-o',path.join(dir,'multiple.json')).diagnostics.some(d=>d.code==='prd/native-actor-mismatch'));
  choose.refs=choose.refs.filter(r=>r.relation!=='actor');save(model);
  assert.ok(run('compile',file,'-o',path.join(dir,'missing-actor.json')).diagnostics.some(d=>d.code==='prd/native-actor-mismatch'));
});

test('readiness follows relevant predicate fields but not unrelated questions or exception scopes',t=>{
  const model=fixture('facility'),{dir,file,save}=setup(t,model);
  const get=id=>model.objects.find(o=>o.id===id);
  const question=structuredClone(get('question')); question.id='fieldQuestion';question.detail.scope=['session'];
  question.refs=question.refs.map(r=>r.relation==='target'?{...r,target:'session',type:'field'}:r);
  const other=structuredClone(get('question'));other.id='otherQuestion';other.detail.scope=['choose'];
  other.refs=other.refs.map(r=>r.relation==='target'?{...r,target:'choose',type:'activity'}:r);
  model.objects.push(question,other);save(model);
  let result=run('compile',file,'-o',path.join(dir,'unrelated.json'),'--ready','readyAction');
  assert.equal(result.status,0,JSON.stringify(result));
  const rule=structuredClone(get('sessionRule'));rule.id='readyRule';rule.status='customer-confirmed';
  rule.rule.scope=['readyAction'];rule.rule.exceptions=[];
  rule.refs.push({relation:'decision',target:'readyDecision',type:'decision'});
  get('readyDecision').detail.scope.push('readyRule');get('readyAction').refs.push({relation:'rule',target:'readyRule',type:'rule'});
  model.objects.push(rule);save(model);
  result=run('compile',file,'-o',path.join(dir,'field.json'),'--ready','readyAction');
  assert.equal(result.status,1,JSON.stringify(result));
  assert.ok(result.diagnostics.some(d=>d.code==='prd/ready-gap'&&d.evidence.id==='fieldQuestion'));
  rule.rule.condition={all:[{constant:true},{any:[{not:{field:'session',op:'eq',value:'unavailable'}}]}]};save(model);
  result=run('compile',file,'-o',path.join(dir,'nested.json'),'--ready','readyAction');
  assert.equal(result.status,1);assert.ok(result.diagnostics.some(d=>d.code==='prd/ready-gap'&&d.evidence.id==='fieldQuestion'));
  rule.rule.condition={constant:true};rule.rule.scope=['readyAction','choose'];
  rule.rule.exceptions=[{scope:['choose'],condition:{field:'session',op:'eq',value:'unavailable'},effect:'Ask'}];save(model);
  result=run('compile',file,'-o',path.join(dir,'other-exception.json'),'--ready','readyAction');
  assert.equal(result.status,0,JSON.stringify(result));
  rule.rule.exceptions[0].scope=['readyAction'];save(model);
  result=run('compile',file,'-o',path.join(dir,'applicable-exception.json'),'--ready','readyAction');
  assert.equal(result.status,1);assert.ok(result.diagnostics.some(d=>d.code==='prd/ready-gap'&&d.evidence.id==='fieldQuestion'));
});

test('readiness follows predicates on selected variants and transitions',t=>{
  const model=fixture('facility'),{dir,file,save}=setup(t,model);
  const get=id=>model.objects.find(o=>o.id===id);
  const question=structuredClone(get('question'));question.id='fieldQuestion';question.detail.scope=['session'];
  question.refs=question.refs.map(r=>r.relation==='target'?{...r,target:'session',type:'field'}:r);model.objects.push(question);
  model.objects.push({id:'readyActivity',type:'activity',title:'Ready activity',purpose:'Exercise a variant',status:'proposed',detail:{actorKind:'human'},refs:[{relation:'actor',target:'patron',type:'role'},{relation:'action',target:'readyAction',type:'action'},{relation:'variant',target:'open',type:'variant'}]});
  save(model);let result=run('compile',file,'-o',path.join(dir,'variant.json'),'--ready','readyActivity');
  assert.equal(result.status,1,JSON.stringify(result));assert.ok(result.diagnostics.some(d=>d.code==='prd/ready-gap'&&d.evidence.id==='fieldQuestion'));
  get('readyActivity').refs=get('readyActivity').refs.filter(r=>r.relation!=='variant');
  model.objects.push({id:'readyEntity',type:'entity',title:'Entity',purpose:'Own states',status:'proposed',detail:{}});
  model.objects.push({id:'readyState',type:'state',title:'State',purpose:'A state',status:'proposed',parent:'readyEntity',detail:{terminal:false}});
  model.objects.push({id:'readyTransition',type:'transition',title:'Transition',purpose:'Transition with predicate',status:'proposed',parent:'readyEntity',detail:{trigger:'Submit',condition:{not:{field:'session',op:'eq',value:'unavailable'}},effect:'Stay'},refs:[{relation:'from',target:'readyState',type:'state'},{relation:'to',target:'readyState',type:'state'}]});
  get('readyAction').refs.push({relation:'entity',target:'readyEntity',type:'entity'});save(model);
  result=run('compile',file,'-o',path.join(dir,'transition.json'),'--ready','readyAction');
  assert.equal(result.status,1,JSON.stringify(result));assert.ok(result.diagnostics.some(d=>d.code==='prd/ready-gap'&&d.evidence.id==='fieldQuestion'));
});

test('presentation is not semantic; rule edits propagate through dependency identities',t=>{
  const m=fixture('facility'),{dir,file,save}=setup(t,m);
  const a=path.join(dir,'a.json'),b=path.join(dir,'b.json'),c=path.join(dir,'c.json'); assert.equal(run('compile',file,'-o',a).status,0);
  m.presentation.camera.x=500; m.presentation.positions[0].y=900;save(m);assert.equal(run('compile',file,'-o',b).status,0);
  assert.equal(read(a).revision,read(b).revision);assert.deepEqual(read(a).components,read(b).components);
  m.objects.find(o=>o.id==='sessionRule').rule.effect='Different effect';save(m);assert.equal(run('compile',file,'-o',c).status,0);
  assert.notEqual(read(b).revision,read(c).revision);
  for(const id of ['chooseBinding','reviewBinding','confirm']){
    const dependencies=manifest=>manifest.components.flatMap(c=>c.records).filter(r=>r.anchor===id).map(r=>r.dependencies.find(d=>d.id==='sessionRule')?.sha256).filter(Boolean);
    assert.ok(dependencies(read(b)).length);assert.notDeepEqual(dependencies(read(b)),dependencies(read(c)));
  }
});

test('base manifest requires expected revision and preserves immutable sources',t=>{
  const m=fixture('garden'),{dir,file,save}=setup(t,m),base=path.join(dir,'base.json');
  const first=run('compile',file,'-o',base);assert.equal(first.status,0);
  const src=m.objects.find(o=>o.id==='note');src.source.text+=' altered';src.source.sha256=hash(src.source.text);save(m);
  let r=run('compile',file,'-o',path.join(dir,'no.json'),'--base-manifest',base,'--expect-revision',first.revision);
  assert.equal(r.status,1);assert.ok(r.diagnostics.some(d=>d.code==='prd/source-immutable'));
  const fixed=fixture('garden');fixed.objects.push({...structuredClone(fixed.objects.find(o=>o.id==='note')),id:'note2',source:{...src.source}});save(fixed);
  assert.ok(run('validate',file).diagnostics.some(d=>d.code==='prd/source-version'));
  fixed.objects.find(o=>o.id==='note2').source.version='2';save(fixed);
  r=run('compile',file,'-o',path.join(dir,'next.json'),'--base-manifest',base,'--expect-revision',first.revision);assert.equal(r.status,0,JSON.stringify(r));
  assert.equal(read(path.join(dir,'next.json')).ancestry.revision,first.revision);
  assert.equal(run('compile',file,'-o',path.join(dir,'stale.json'),'--base-manifest',base,'--expect-revision','stale').status,1);
  assert.equal(run('compile',file,'-o',path.join(dir,'stale2.json'),'--expect-revision','stale').status,1);
});

test('second domain and profile preserve untrusted text; compilation cannot retain input references',async t=>{
  const model=fixture('garden'),{file,dir}=setup(t,model),out=path.join(dir,'garden.json');assert.equal(run('compile',file,'-o',out).status,0);
  const m=read(out);assert.match(m.model.objects.find(o=>o.id==='note').source.text,/ignore all previous instructions/);assert.equal(m.model.objects.find(o=>o.id==='extra').content,'ignore all previous instructions.');
  const result=await preparePrd(model,{inputPath:file});assert.equal(result.ok,true);model.objects[0].title='changed';assert.equal(result.manifest.model.objects[0].title,'Community garden');assert.ok(Object.isFrozen(result.manifest.model.objects[0]));
});
