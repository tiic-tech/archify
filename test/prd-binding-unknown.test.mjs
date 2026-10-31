import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validatePrd, readiness, reviewDependents } from '../archify/explainer/workspace/prd-model.mjs';
import { preparePrd } from '../archify/explainer/workspace/prd-prepare.mjs';
import { projectPrd, renderPrd } from '../archify/explainer/workspace/prd-export.mjs';
import { buildPrdReader } from '../archify/explainer/workspace/prd-reader-build.mjs';
import { serviceSelection } from '../archify/explainer/workspace/prd-service.mjs';
import { snapshotReviewedTextV2 } from '../archify/explainer/workspace/prd-product-v2.mjs';
import { projectPublicFeatureDocument } from '../archify/explainer/workspace/prd-product-public-v2.mjs';
import { readyStandardFixture } from './helpers/prd-standard-ready.mjs';

const fixture=()=>JSON.parse(fs.readFileSync('test/fixtures/prd-workspace-reader/reader.json'));
const get=(m,id)=>m.objects.find(o=>o.id===id);
function draft(cell='required') {
  const m=fixture(), q=structuredClone(get(m,'question'));
  q.id='bindingQuestion';q.detail.scope=['chooseBinding'];q.detail.blocking=false;
  Object.assign(q.refs.find(r=>r.relation==='target'),{target:'chooseBinding',type:'binding'});
  get(m,'chooseBinding').detail[cell]={question:q.id};m.objects.push(q);
  return m;
}
const at=(m,cell)=>`/objects/${m.objects.findIndex(o=>o.id==='chooseBinding')}/detail/${cell}`;
const has=(ds,code,loc)=>ds.some(d=>d.code===`prd/${code}`&&d.subject.locator===loc);

test('question-bound cells validate as bounded draft contracts and block only reached readiness',()=>{
  for(const cell of ['visibility','editable','required']) {
    const m=draft(cell), pos=at(m,cell), checked=validatePrd(m);
    assert.equal(checked.ok,true,JSON.stringify(checked.diagnostics));
    assert.ok(has(readiness(m,'service'),'ready-gap',pos));
    assert.ok(has(readiness(m,'choose'),'ready-gap',pos));
    const unrelated=readiness(m,'serviceTwo');
    assert.ok(!has(unrelated,'ready-gap',pos),JSON.stringify(unrelated));
    const base=fixture();assert.deepEqual(unrelated,readiness(base,'serviceTwo'));
    // A shared question cannot pull the other Service's binding into scope.
    const q=get(m,'bindingQuestion');q.detail.scope.push('serviceTwo');q.refs.push({relation:'target',target:'serviceTwo',type:'service'});
    assert.equal(validatePrd(m).ok,true);
    assert.deepEqual(readiness(m,'serviceTwo'),readiness(base,'serviceTwo'));
    get(m,'bindingQuestion').status='customer-confirmed';
    assert.ok(has(readiness(m,'service'),'ready-gap',pos),'confirmation does not fill the cell');
    get(m,'chooseBinding').detail[cell]={constant:false};
    assert.ok(!has(readiness(m,'service'),'ready-gap',pos));
  }
});

test('question references need the right type and explicitly intersecting binding context',()=>{
  for(const [change,code] of [
    [m=>get(m,'chooseBinding').detail.required.question='missing','dangling-reference'],
    [m=>get(m,'chooseBinding').detail.required.question='session','reference-type'],
    [m=>{const q=get(m,'bindingQuestion');q.detail.scope=['save'];Object.assign(q.refs.find(r=>r.relation==='target'),{target:'save',type:'action'});},'binding-question-context'],
    [m=>{Object.assign(get(m,'bindingQuestion').refs.find(r=>r.relation==='target'),{target:'save',type:'action'});},'binding-question-context']
  ]) {const m=draft();change(m);assert.ok(has(validatePrd(m).diagnostics,code,`${at(m,'required')}/question`));}
  const context=draft();get(context,'bindingQuestion').detail.scope=['choose'];Object.assign(get(context,'bindingQuestion').refs.find(r=>r.relation==='target'),{target:'choose',type:'activity'});assert.equal(validatePrd(context).ok,true);
});

test('union is closed and does not expand nested or executable conditions',()=>{
  const invalid=[
    m=>{get(m,'chooseBinding').detail.required={question:'bindingQuestion',constant:true};},
    m=>{get(m,'chooseBinding').detail.required={all:[{question:'bindingQuestion'}]};},
    m=>{get(m,'sessionRule').rule.condition={question:'bindingQuestion'};},
    m=>{get(m,'open').detail.predicate={question:'bindingQuestion'};}
  ];
  for(const change of invalid){const m=draft();change(m);assert.ok(validatePrd(m).diagnostics.some(d=>d.code==='prd/schema'));}
});

function standardDraft(){
  const m=readyStandardFixture(),f=m.profile.productDocument.modules[0].subModules[0].features[0];
  const q=structuredClone(get(m,'operatorQuestion'));q.id='bindingQuestion';q.detail.scope=['itemInput'];q.detail.blocking=false;q.refs=[{relation:'target',target:'itemInput',type:'binding'}];m.objects.push(q);
  get(m,'itemInput').detail.required={question:q.id};get(m,'itemInput').detail.editable={question:q.id};get(m,'itemInput').detail.visibility={question:q.id};
  f.actions[0].pages[0].questions=[q.id];
  const row=f.standard.sections[4].screens[0].fields.find(r=>r.binding==='itemInput');row.required={question:q.id};row.editableWhen={question:q.id};
  function refresh(v){if(!v||typeof v!=='object')return;if(v.reviewed&&typeof v.text==='string'){Object.assign(v,snapshotReviewedTextV2(m.objects,v.text,v.reviewed.map(r=>r.object)));return;}for(const x of Object.values(v))refresh(x);}
  refresh(m.profile.productDocument);return {m,row};
}

test('standard draft requires the actual questions, not known values or unrelated gaps',()=>{
  const {m,row}=standardDraft(),q=get(m,'bindingQuestion');
  const checked=validatePrd(m);assert.equal(checked.ok,true,JSON.stringify(checked.diagnostics));
  assert.ok(has(readiness(m,'loans'),'ready-gap',`/objects/${m.objects.findIndex(o=>o.id==='itemInput')}/detail/required`));
  for(const value of ['Yes','No','Conditional',{question:'operatorQuestion'}]){row.required=value;assert.ok(validatePrd(m).diagnostics.some(d=>d.subject.locator.endsWith('/fields/0/required')&&d.message.includes('exact scoped question')));}
  row.required={question:q.id};for(const value of [{question:'operatorQuestion'},snapshotReviewedTextV2(m.objects,'Known prose.',['itemInput'])]){row.editableWhen=value;assert.ok(validatePrd(m).diagnostics.some(d=>d.subject.locator.endsWith('/fields/0/editableWhen')&&d.message.includes('exact scoped question')));}
});

test('standard internal field cells and visibility note link to the authored question',async()=>{
  const {m}=standardDraft(),inputPath='archify/examples/prd-equipment-standard-workspace.json';
  const prepared=await preparePrd(m,{inputPath});assert.equal(prepared.ok,true,JSON.stringify(prepared.diagnostics));
  assert.throws(()=>projectPublicFeatureDocument(prepared.manifest,{productDocument:m.profile.productDocument,objects:{itemInput:{}}},{objects:new Map([['itemInput',{}]])},new Map()),e=>e.diagnostics?.some(d=>d.subject.locator.endsWith('/itemInput/bindingSourceSha256')));
  const output=await renderPrd(prepared.manifest,{audience:'internal',inputPath}),md=output.files.get(output.identity.primaryMarkdown).toString(),html=output.files.get('index.html').toString();
  const row=md.split('\n').find(line=>line.startsWith('| Equipment |')),cells=row.split('|');
  const questionLink=/\[TBC \(Q-[a-f0-9]+\)\]\((#standard-question-[a-f0-9]+)\)/,required=cells[3].match(questionLink),editable=cells[7].match(questionLink),visibility=md.match(/\*\*Visibility\*\*: Equipment: \[TBC \(Q-[a-f0-9]+\)\]\((#standard-question-[a-f0-9]+)\)/);
  assert.ok(required&&editable&&visibility);assert.equal(required[1],editable[1]);assert.equal(required[1],visibility[1]);assert.match(html,/<strong>Visibility<\/strong>: Equipment: <a href="#standard-question-/);assert.doesNotMatch(md,/Binding itemInput, detail\//);assert.match(output.files.get('appendix.md').toString(),/itemInput/);assert.match(md,/Who assigns the operator/);
  const stale=structuredClone(m);get(stale,'bindingQuestion').title='Changed question';assert.ok(validatePrd(stale).diagnostics.some(d=>/stale/.test(d.message)));
  const resolved=structuredClone(m);get(resolved,'itemInput').detail.required={constant:true};assert.ok(validatePrd(resolved).diagnostics.some(d=>/stale/.test(d.message)));
});

test('visibility notes group only fields with the same question',async()=>{
  const {m}=standardDraft(),q=get(m,'bindingQuestion'),inputPath='archify/examples/prd-equipment-standard-workspace.json';
  q.detail.scope.push('dateInput');q.refs.push({relation:'target',target:'dateInput',type:'binding'});get(m,'dateInput').detail.visibility={question:q.id};
  function refresh(v){if(!v||typeof v!=='object')return;if(v.reviewed&&typeof v.text==='string'){Object.assign(v,snapshotReviewedTextV2(m.objects,v.text,v.reviewed.map(r=>r.object)));return;}for(const x of Object.values(v))refresh(x);}
  const render=async()=>{refresh(m.profile.productDocument);const p=await preparePrd(m,{inputPath});assert.equal(p.ok,true,JSON.stringify(p.diagnostics));const out=await renderPrd(p.manifest,{audience:'internal',inputPath});return out.files.get(out.identity.primaryMarkdown).toString();};
  let md=await render();assert.match(md,/\*\*Visibility\*\*: Equipment; Return date: \[TBC/);assert.equal((md.match(/\*\*Visibility\*\*:/g)||[]).length,1);
  const other=structuredClone(q);other.id='otherBindingQuestion';other.detail.scope=['dateInput'];other.refs=[{relation:'target',target:'dateInput',type:'binding'}];m.objects.push(other);get(m,'dateInput').detail.visibility={question:other.id};m.profile.productDocument.modules[0].subModules[0].features[0].actions[0].pages[0].questions.push(other.id);
  md=await render();const notes=[...md.matchAll(/\*\*Visibility\*\*: ([^:]+): \[TBC \(Q-[a-f0-9]+\)\]\((#standard-question-[a-f0-9]+)\)/g)];assert.deepEqual(notes.map(n=>n[1]),['Equipment','Return date']);assert.notEqual(notes[0][2],notes[1][2]);
});

test('shared-question review closure validates without importing foreign context',()=>{
  const {m}=standardDraft(),q=get(m,'bindingQuestion'),other=structuredClone(get(m,'loans'));other.id='otherService';m.objects.push(other);q.detail.scope.push(other.id);q.refs.push({relation:'target',target:other.id,type:'service'});
  function refresh(v){if(!v||typeof v!=='object')return;if(v.reviewed&&typeof v.text==='string'){Object.assign(v,snapshotReviewedTextV2(m.objects,v.text,v.reviewed.map(r=>r.object)));return;}for(const x of Object.values(v))refresh(x);}
  refresh(m.profile.productDocument);const valid=validatePrd(m);assert.equal(valid.ok,true,JSON.stringify(valid.diagnostics));
  const summary=x=>x.profile.productDocument.modules[0].subModules[0].features[0].actions[0].pages[0].groups[0].summary;
  const missing=structuredClone(m);summary(missing).reviewed=summary(missing).reviewed.filter(r=>r.object!==q.id);assert.ok(validatePrd(missing).diagnostics.some(d=>d.message.includes('missing a source')&&d.evidence.id===q.id));
  const foreign=structuredClone(m);summary(foreign).reviewed.push(snapshotReviewedTextV2(foreign.objects,'Foreign',[other.id]).reviewed[0]);assert.ok(validatePrd(foreign).diagnostics.some(d=>d.message.includes('another Service')&&d.evidence.id===other.id));
  const snapshot=snapshotReviewedTextV2(m.objects,'Field fact',['itemInput']);assert.ok(snapshot.reviewed.some(r=>r.object===q.id));assert.ok(!snapshot.reviewed.some(r=>r.object===other.id));
  other.purpose='Foreign context revised';assert.deepEqual(snapshotReviewedTextV2(m.objects,'Field fact',['itemInput']),snapshot);assert.equal(validatePrd(m).ok,true);
  q.title='Question changed';assert.notDeepEqual(snapshotReviewedTextV2(m.objects,'Field fact',['itemInput']),snapshot);assert.ok(validatePrd(m).diagnostics.some(d=>d.message.includes('stale')));
});

test('non-standard Feature groups expose their binding TBC without inventing a predicate',async()=>{
  const {m}=standardDraft(),f=m.profile.productDocument.modules[0].subModules[0].features[0];delete m.profile.productDocument.standard;delete f.standard;
  const inputPath='archify/examples/prd-equipment-standard-workspace.json',prepared=await preparePrd(m,{inputPath});assert.equal(prepared.ok,true,JSON.stringify(prepared.diagnostics));
  const output=await renderPrd(prepared.manifest,{audience:'internal',inputPath}),md=output.files.get(output.identity.primaryMarkdown).toString();
  for(const key of ['visibility','editable','required'])assert.match(md,new RegExp(`Binding itemInput, detail/${key}.*question bindingQuestion`));
  assert.throws(()=>projectPublicFeatureDocument(prepared.manifest,{productDocument:m.profile.productDocument},{objects:new Map([['itemInput',{}]])},new Map()),e=>e.diagnostics?.some(d=>d.code==='prd/binding-unknown-unsupported'&&d.evidence.id==='itemInput'));
});

test('internal draft preparation verifies resources, ancestry and emits located TBC',async t=>{
  const m=draft(), dir=fs.mkdtempSync(path.join(os.tmpdir(),'prd-unknown-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  for(const k of ['visibility','editable'])get(m,'chooseBinding').detail[k]={question:'bindingQuestion'};
  const input=path.join(dir,'model.json');fs.writeFileSync(input,JSON.stringify(m));
  const run=(...args)=>{const p=spawnSync(process.execPath,['archify/bin/archify.mjs','prd',...args,'--json'],{encoding:'utf8'});assert.equal(p.stderr,'');return {status:p.status,...JSON.parse(p.stdout)};};
  const missing=run('validate',input);assert.equal(missing.status,1);assert.ok(missing.diagnostics.some(d=>d.code==='prd/asset-invalid'));
  fs.copyFileSync('test/fixtures/prd-workspace/event-plan.txt',path.join(dir,'event-plan.txt'));fs.copyFileSync('test/fixtures/prd-workspace-reader/prototype.png',path.join(dir,'prototype.png'));
  const validation=run('validate',input);assert.equal(validation.status,0,JSON.stringify(validation));assert.ok(!validation.diagnostics.some(d=>d.code==='prd/source-only'));
  const prepared=await preparePrd(m,{inputPath:input});assert.equal(prepared.ok,true,JSON.stringify(prepared.diagnostics));
  const record=prepared.manifest.components.flatMap(c=>c.records).find(r=>r.objectId==='chooseBinding');assert.ok(record.dependencies.some(d=>d.id==='bindingQuestion'));assert.ok(record.dependencies.some(d=>d.id==='row'));
  const ready=await preparePrd(m,{inputPath:input,ready:'service'});assert.equal(ready.ok,false);assert.ok(has(ready.diagnostics,'ready-gap',at(m,'required')));
  const strict=structuredClone(m);strict.profile.components.find(c=>c.selector.types.includes('binding')).gapPolicy='error';const strictResult=await preparePrd(strict,{inputPath:input});assert.equal(strictResult.ok,false);assert.ok(strictResult.diagnostics.some(d=>d.code==='prd/component-gap'));
  const base=path.join(dir,'base.json');assert.equal(run('compile',input,'-o',base).status,0);const mismatch=run('compile',input,'-o',path.join(dir,'bad.json'),'--base-manifest',base,'--expect-revision','0'.repeat(64));assert.equal(mismatch.status,1);assert.ok(mismatch.diagnostics.some(d=>d.code==='prd/revision-mismatch'));
  const next=run('compile',input,'-o',path.join(dir,'next.json'),'--base-manifest',base,'--expect-revision',validation.revision);assert.equal(next.status,0,JSON.stringify(next));
  const output=await renderPrd(prepared.manifest,{audience:'internal',inputPath:input}),markdown=output.files.get('README.md').toString();assert.match(markdown,/TBC.*bindingQuestion/);assert.match(markdown,/detail\/required/);assert.match(markdown,/detail\/required: TBC — question bindingQuestion: \[.*\]\(#object-bindingQuestion\)/);const bindingRow=markdown.split('\n').find(line=>line.startsWith('| Session selection (binding)'));assert.match(bindingRow,/Required: TBC/);assert.doesNotMatch(bindingRow,/Required: (Always|Never)/);
  const reader=await buildPrdReader(prepared.manifest,{audience:'internal',inputPath:input,returnConfig:true});assert.equal(reader.objects.find(o=>o.id==='chooseBinding').detail.required.question,'bindingQuestion');assert.ok(reader.serviceEvidence.service.includes('bindingQuestion'));
  assert.throws(()=>projectPrd(prepared.manifest,'client',{version:1,components:{},objects:{chooseBinding:{id:'publicBinding',title:'Binding',purpose:'Public binding',fields:['detail.visibility','detail.editable','detail.required']}}}),e=>e.diagnostics?.some(d=>d.subject.locator.endsWith('/chooseBinding/fields/detail.visibility')&&/Question/.test(d.message)));
});

test('Service incremental export isolates unrelated scope and invalidates a resolved binding',t=>{
  const m=draft(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'prd-binding-service-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));m.workspaceId='a4635e24-c43b-4f86-90c0-3e9d4c4c594a';
  for(const [from,to] of [['test/fixtures/prd-workspace/event-plan.txt','event-plan.txt'],['test/fixtures/prd-workspace-reader/prototype.png','prototype.png']])fs.copyFileSync(from,path.join(dir,to));
  const input=path.join(dir,'model.json'),historyPath=path.join(dir,'history.json'),history={schemaVersion:1,service:'service',audience:'internal',entries:[{version:'1',date:'2026-01-01',summary:'Draft baseline'}]},save=()=>{fs.writeFileSync(input,JSON.stringify(m));fs.writeFileSync(historyPath,JSON.stringify(history));};
  const run=(name,...extra)=>{const out=path.join(dir,name),p=spawnSync(process.execPath,['archify/bin/archify.mjs','prd','export',input,'-o',out,'--service','service','--service-history',historyPath,'--markdown-only',...extra,'--json'],{encoding:'utf8',maxBuffer:32*1024*1024});assert.equal(p.stderr,'');return {...JSON.parse(p.stdout),status:p.status,out};};
  save();const first=run('first');assert.equal(first.status,0,JSON.stringify(first));const warm=run('warm','--incremental-from',first.out);assert.equal(warm.status,0,JSON.stringify(warm));assert.equal(warm.cache.componentsRendered,0);
  get(m,'publish').purpose='Unrelated Service changed';save();const unrelated=run('unrelated','--incremental-from',first.out);assert.equal(unrelated.status,0,JSON.stringify(unrelated));assert.equal(unrelated.revision,first.revision);assert.equal(unrelated.cache.componentsRendered,0);
  get(m,'bindingQuestion').title='Clarify the binding';history.entries.push({version:'2',date:'2026-01-02',summary:'Clarify question'});save();const changedQuestion=run('changed-question','--incremental-from',first.out);assert.equal(changedQuestion.status,0,JSON.stringify(changedQuestion));assert.notEqual(changedQuestion.revision,first.revision);assert.ok(changedQuestion.cache.componentsRendered>0);assert.match(fs.readFileSync(path.join(changedQuestion.out,'README.md'),'utf8'),/Clarify the binding/);
  get(m,'chooseBinding').detail.required={constant:false};history.entries.push({version:'3',date:'2026-01-03',summary:'Resolve field requirement'});save();
  const updated=run('updated','--incremental-from',first.out),cold=run('cold');assert.equal(updated.status,0,JSON.stringify(updated));assert.equal(cold.status,0,JSON.stringify(cold));assert.notEqual(updated.revision,first.revision);assert.ok(updated.cache.componentsRendered>0);assert.equal(updated.revision,cold.revision);
  assert.deepEqual(fs.readFileSync(path.join(updated.out,'README.md')),fs.readFileSync(path.join(cold.out,'README.md')));assert.match(fs.readFileSync(path.join(first.out,'README.md'),'utf8'),/Required: TBC/);assert.match(fs.readFileSync(path.join(updated.out,'README.md'),'utf8'),/Required: Never/);
});

test('question dependencies stale the binding and related summaries without selecting another Service',async()=>{
  const m=draft(),q=get(m,'bindingQuestion');q.detail.scope.push('serviceTwo');q.refs.push({relation:'target',target:'serviceTwo',type:'service'});
  assert.ok(reviewDependents(m,q.id).has('chooseBinding'));assert.ok(!serviceSelection(m,'serviceTwo').selected.has('chooseBinding'));
  const snapshot=snapshotReviewedTextV2(m.objects,'Reviewed binding',['chooseBinding']);assert.ok(snapshot.reviewed.some(r=>r.object===q.id));assert.ok(!snapshot.reviewed.some(r=>r.object==='serviceTwo'));
  const explicit=snapshotReviewedTextV2(m.objects,'Reviewed question',[q.id]);assert.ok(explicit.reviewed.some(r=>r.object==='serviceTwo'),'an explicitly reviewed question retains its ordinary context closure');
  const refreshed=snapshotReviewedTextV2(m.objects,snapshot.text,snapshot.reviewed.map(r=>r.object));assert.deepEqual(refreshed,snapshot);
  get(m,'serviceTwo').purpose='Changed foreign Service';assert.deepEqual(snapshotReviewedTextV2(m.objects,'Reviewed binding',['chooseBinding']),snapshot);
  const before=await preparePrd(m,{inputPath:'test/fixtures/prd-workspace-reader/reader.json'});assert.equal(before.ok,true,JSON.stringify(before.diagnostics));
  const rec=x=>x.manifest.components.flatMap(c=>c.records).find(r=>r.objectId==='chooseBinding');
  q.title='A changed question';const after=await preparePrd(m,{inputPath:'test/fixtures/prd-workspace-reader/reader.json'});assert.equal(after.ok,true,JSON.stringify(after.diagnostics));
  assert.notEqual(rec(before).dependencies.find(d=>d.id===q.id).sha256,rec(after).dependencies.find(d=>d.id===q.id).sha256);
  assert.notDeepEqual(snapshot,snapshotReviewedTextV2(m.objects,'Reviewed binding',['chooseBinding']));
  const otherBefore=serviceSelection(m,'serviceTwo').selected;get(m,'chooseBinding').detail.required={constant:true};assert.ok(!otherBefore.has('chooseBinding'));
});
