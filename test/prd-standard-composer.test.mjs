import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { snapshotReviewedTextV2 } from '../archify/explainer/workspace/prd-product-v2.mjs';
import { preparePrd } from '../archify/explainer/workspace/prd-prepare.mjs';
import { projectPrd, renderPrd } from '../archify/explainer/workspace/prd-export.mjs';
import { validatePrd } from '../archify/explainer/workspace/prd-model.mjs';

const inputPath=new URL('../archify/examples/prd-equipment-standard-workspace.json',import.meta.url).pathname;
const fixture=()=>JSON.parse(fs.readFileSync(inputPath,'utf8'));

test('internal standard export shares one IR across Markdown and HTML and prepares numbered native vectors',async()=>{
  const input=fixture(),before=structuredClone(input.nativeViews[0].spec),prepared=await preparePrd(input,{inputPath});
  assert.equal(prepared.ok,true,JSON.stringify(prepared.diagnostics));
  assert.deepEqual(input.nativeViews[0].spec,before);
  for(const name of ['prd-standard-v1.mjs','prd-standard-refinements.mjs','prd-standard-context.mjs','prd-standard-composer.mjs']){const bytes=fs.readFileSync(new URL(`../archify/explainer/workspace/${name}`,import.meta.url));assert.equal(prepared.manifest.identities.code[name],createHash('sha256').update(bytes).digest('hex'));}
  const numbered=prepared.manifest.standardViews[0].prepared;
  assert.deepEqual(numbered.spec.nodes.map(n=>n.label),['1 Submit request','2 Review request','3 Record checkout']);
  assert.deepEqual(numbered.spec.edges,before.edges);assert.deepEqual(numbered.spec.nodes.map(({label,...node})=>node),before.nodes.map(({label,...node})=>node));
  const output=await renderPrd(prepared.manifest,{audience:'internal',inputPath});
  const file=output.identity.primaryMarkdown,md=output.files.get(file).toString(),html=output.files.get('index.html').toString();
  assert.equal(file,'equipment-checkout.prd.internal.en.md');
  const headings=['Description','Preconditions','Postconditions','Role based workflow map','Prototype with UI elements & rules','Integration points','Audit & Security','Acceptance Criteria'];
  let at=md.indexOf('## Equipment checkout');for(const heading of headings){const next=md.indexOf(`### ${heading}`,at);assert.ok(next>at,heading);at=next;}
  assert.match(md,/\| Module \| Feature \| Priority \| Readiness \| Description \| Note \|/);
  assert.match(md,/\[S1\]\(#checkoutFeature-S1\)/);assert.match(md,/\[P1\]\(#checkoutFeature-P1\)/);
  assert.match(md,/\[BR-1 Return date requirement\]\(#checkoutFeature-BR-1\)/);assert.match(md,/\*\*BR-1\*\*: Return date requirement/);
  assert.match(html,/<a href="#checkoutFeature-S1">S1<\/a>/);
  assert.equal((md.match(/What are the field design and defaults\?/g)||[]).length,1);
  assert.match(md,/Incomplete status model/);assert.match(md,/S2 — Missing screen[\s\S]*?Used in steps: 2/);
  const common=md.slice(md.indexOf('# General Module'),md.indexOf('# Facilities'));assert.match(common,/## Role &amp; Permission/);
  for(const heading of headings)assert.match(common,new RegExp(`### ${heading.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`));
  assert.match(md,/\| General Module \| \[Role &amp; Permission\]/);assert.doesNotMatch(md,/Assumptions:|Options:|Consequence:|Confirm with:/);
  assert.match(md,/\*\*Make loan requests visible\.\*\* — Borrowers can request equipment\./);
  assert.match(md,/\| From \| Action \| By \| To \|/);assert.doesNotMatch(md,/\| From \| Action \| By \| To \| Condition \|/);
  const svg=output.files.get('assets/native-checkoutFeature-checkoutFlow.svg').toString();assert.match(svg,/1 Submit request/);assert.match(svg,/3 Record checkout/);
  assert.ok(!md.includes('```mermaid'));assert.ok(output.identity.features[0].workflowAsset.endsWith('.svg'));
});

test('whole export distinguishes multiple catalog gaps from a detailed process-only prototype',t=>{
  const m=fixture(),sub=m.profile.productDocument.modules[0].subModules[0],original=sub.features[0];
  for(const n of [1,2]){const f=structuredClone(original);f.id=`catalog${n}`;f.key=`catalog-${n}`;f.title=`Catalog ${n}`;f.status='catalog-only';f.question='operatorQuestion';delete f.summary;delete f.workflow;delete f.actions;f.standard.changes=[];
    const wf=f.standard.sections[3],proto=f.standard.sections[4],integrations=f.standard.sections[5];wf.steps=[];wf.question='operatorQuestion';wf.statusModel.states=[];wf.statusModel.transitions=[];proto.screens=[];proto.processes=[];proto.businessRules=[];integrations.integrations=[];integrations.notifications=[];integrations.none={question:'operatorQuestion'};f.standard.sections[7].criteria=f.standard.sections[7].criteria.filter(c=>c.coverage.some(x=>['audit','access','integrity'].includes(x)));sub.features.push(f);
  }
  const f=structuredClone(original);f.id='processOnly';f.key='process-only';f.title='Process only';f.standard.changes=[];f.actions=[f.actions[2]];f.actions[0].id='processOnlyAction';f.actions[0].groups[0].id='processOnlyGroup';f.workflow.view='processOnlyFlow';const wf=f.standard.sections[3];wf.steps=[wf.steps[2]];const proto=f.standard.sections[4];proto.screens=[];proto.businessRules=[];f.standard.sections[7].criteria=f.standard.sections[7].criteria.filter(c=>['pendingOnFailure','recordPath','processTrigger','processOutput','auditCoverage','accessCoverage','integrityCoverage'].includes(c.id));sub.features.push(f);
  const view=structuredClone(m.nativeViews[0]);view.id='processOnlyFlow';view.spec.meta.title='Process only';view.spec.meta.output='processOnlyFlow.html';view.spec.lanes=view.spec.lanes.filter(l=>l.id==='systemLane');view.spec.nodes=view.spec.nodes.filter(n=>n.id==='recordNode');view.spec.nodes[0].col=0;view.spec.edges=[];view.laneBindings=view.laneBindings.filter(b=>b.lane==='systemLane');view.bindings=view.bindings.filter(b=>b.object==='record');m.nativeViews.push(view);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prd-catalog-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const input=path.join(dir,'model.json'),out=path.join(dir,'out');fs.writeFileSync(input,JSON.stringify(m));const p=spawnSync(process.execPath,['archify/bin/archify.mjs','prd','export',input,'-o',out,'--audience','internal','--json'],{encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(p.status,0,p.stdout+p.stderr);
  const receipt=JSON.parse(fs.readFileSync(path.join(out,'manifest.json'))),md=fs.readFileSync(path.join(out,receipt.primaryMarkdown),'utf8'),html=fs.readFileSync(path.join(out,'index.html'),'utf8');
  const section=(text,title)=>{const start=text.indexOf(`## ${title}\n`),end=text.indexOf('\n## ',start+1);assert.ok(start>=0,title);return text.slice(start,end<0?undefined:end);};
  for(const title of ['Catalog 1','Catalog 2']){const chapter=section(md,title),prototype=chapter.split('### Prototype with UI elements & rules\n')[1].split('\n### ')[0];assert.match(prototype,/not yet modeled/);assert.match(prototype,/\[TBC \(Q-[a-f0-9]+\)\]\(#standard-question-[a-f0-9]+\)/);const sections=[...chapter.matchAll(/^### (.+)\n([\s\S]*?)(?=^### |(?![\s\S]))/gm)];assert.deepEqual(sections.map(x=>x[1]),['Description','Preconditions','Postconditions','Role based workflow map','Prototype with UI elements & rules','Integration points','Audit & Security','Acceptance Criteria']);for(const section of sections)assert.ok(section[2].trim(),section[1]);assert.doesNotMatch(prototype,/None|No screens|No processes/);}
  const processSection=section(md,'Process only').split('### Prototype with UI elements & rules\n')[1].split('\n### ')[0];assert.match(processSection,/#### P1/);assert.doesNotMatch(processSection,/not yet modeled|No screens|No processes/);assert.match(html,/Prototype details are not yet modeled/);
});

test('Feature index questions stay with their Feature while source-only details remain in the appendix',async()=>{
  const m=fixture(),module=m.profile.productDocument.modules[0],f=module.subModules[0].features[0];module.title='Planning & Facilities';f.title='Equipment & checkout';
  m.objects.push({id:'priorityQuestion',type:'question',title:'Which priority is approved?',purpose:'Confirm priority',status:'proposed',detail:{scope:['loans'],consequence:'PRIVATE_CONSEQUENCE_DETAIL',options:['PRIVATE_OPTION_DETAIL'],assumptions:['PRIVATE_ASSUMPTION_DETAIL'],confirmingFunction:'PRIVATE_CONFIRMER_DETAIL',blocking:true},refs:[{relation:'target',target:'loans',type:'service'}]});f.standard.priority={question:'priorityQuestion'};
  const prepared=await preparePrd(m,{inputPath});assert.equal(prepared.ok,true,JSON.stringify(prepared.diagnostics));const output=await renderPrd(prepared.manifest,{audience:'internal',inputPath}),md=output.files.get(output.identity.primaryMarkdown).toString(),html=output.files.get('index.html').toString(),appendix=output.files.get('appendix.md').toString();
  assert.match(md,/Planning &amp; Facilities \| \[Equipment &amp; checkout\]/);assert.match(md,/# Planning &amp; Facilities/);assert.match(md,/## Equipment &amp; checkout/);assert.match(html,/<h2 id="checkoutFeature">Equipment &amp; checkout<\/h2>/);
  const common=md.slice(md.indexOf('# General Module'),md.indexOf('# Planning &amp; Facilities'));assert.doesNotMatch(common,/Which priority is approved/);assert.equal((md.match(/Which priority is approved\?/g)||[]).length,1);assert.ok(md.indexOf('Which priority is approved?')>md.indexOf('## Equipment &amp; checkout'));
  for(const detail of ['PRIVATE_CONSEQUENCE_DETAIL','PRIVATE_OPTION_DETAIL','PRIVATE_ASSUMPTION_DETAIL','PRIVATE_CONFIRMER_DETAIL']){assert.ok(!md.includes(detail));assert.ok(appendix.replaceAll('\\_','_').includes(detail));}
});

test('an authored General Module owns the common definitions without a second generated authority',async()=>{
  const m=fixture();m.profile.productDocument.modules[0].title='General Module';const prepared=await preparePrd(m,{inputPath});assert.equal(prepared.ok,true,JSON.stringify(prepared.diagnostics));const output=await renderPrd(prepared.manifest,{audience:'internal',inputPath}),md=output.files.get(output.identity.primaryMarkdown).toString();
  assert.equal((md.match(/^# General Module$/gm)||[]).length,1);assert.doesNotMatch(md,/## Role &amp; Permission/);assert.match(md,/## Equipment checkout[\s\S]*?### Description[\s\S]*?\| Role \| Purpose \|/);assert.match(md,/### Audit & Security[\s\S]*?\| Role \| Permissions \| Restrictions \|/);
});

test('equivalent adjacent field specifications group without merging near matches',async()=>{
  const m=fixture(),f=m.profile.productDocument.modules[0].subModules[0].features[0],screen=f.standard.sections[4].screens[0],group=f.actions[0].pages[0].groups[0],get=id=>m.objects.find(o=>o.id===id);
  const source=structuredClone(get('source'));source.id='otherSource';source.source.recordKey='otherSource';m.objects.push(source);
  const provenance=target=>({relation:'derivedFrom',target,type:'source',locator:'note',quote:'inventory records the checkout',interpretation:'Synthetic source review.'});
  get('item').refs=[provenance('source')];get('itemInput').refs.push(provenance('source'));
  const reviewed=(text,id)=>snapshotReviewedTextV2(m.objects,text,[id]);
  for(const key of ['typeDetails','default','rules','source','editableWhen'])screen.fields[0][key]=reviewed(`Shared ${key}.`,'itemInput');
  for(const [suffix,title] of [['B','Toolkit'],['C','Spare kit'],['D','Reserve kit'],['E','Safety kit']]){
    const field=structuredClone(get('item'));field.id=`item${suffix}`;field.title=title;field.refs=[provenance('otherSource')];
    const binding=structuredClone(get('itemInput'));binding.id=`itemInput${suffix}`;binding.title=`${title} selection`;binding.refs.find(r=>r.relation==='field').target=field.id;binding.refs.find(r=>r.relation==='derivedFrom').target='otherSource';if(suffix==='D')binding.detail.required={field:'item',op:'eq',value:'temporary'};m.objects.push(field,binding);group.sources.push(field.id,binding.id);
    const row=structuredClone(screen.fields[0]);row.field=field.id;row.binding=binding.id;for(const key of ['typeDetails','default','rules','source','editableWhen'])row[key]=reviewed(`Shared ${key}.`,binding.id);if(suffix==='C'){row.default={question:'fieldQuestion'};row.dataType={question:'fieldQuestion'};row.typeDetails={question:'fieldQuestion'};}if(suffix==='D')row.required='Conditional';if(suffix==='E')row.source=reviewed('A distinct source.',binding.id);screen.fields.splice(['B','C','D','E'].indexOf(suffix)+1,0,row);
    const criterion=structuredClone(f.standard.sections[7].criteria.find(c=>c.id==='equipmentRequired'));criterion.id=`equipmentRequired${suffix}`;criterion.sources=[binding.id];criterion.observation=snapshotReviewedTextV2(m.objects,`${title} is required.`,[binding.id]);f.standard.sections[7].criteria.push(criterion);
  }
  group.summary=snapshotReviewedTextV2(m.objects,group.summary.text,group.sources);
  const refresh=v=>{if(!v||typeof v!=='object')return;if(v.reviewed&&typeof v.text==='string'){Object.assign(v,snapshotReviewedTextV2(m.objects,v.text,v.reviewed.map(r=>r.object)));return;}for(const x of Object.values(v))refresh(x);};refresh(m.profile.productDocument);
  const validation=validatePrd(m);assert.equal(validation.ok,true,JSON.stringify(validation.diagnostics));
  const prepared=await preparePrd(m,{inputPath});assert.equal(prepared.ok,true,JSON.stringify(prepared.diagnostics));const output=await renderPrd(prepared.manifest,{audience:'internal',inputPath}),md=output.files.get(output.identity.primaryMarkdown).toString(),html=output.files.get('index.html').toString();
  assert.match(md,/\| Equipment; Toolkit \|/);assert.match(html,/<td>Equipment; Toolkit<\/td>/);for(const title of ['Spare kit','Reserve kit','Safety kit']){assert.ok(md.includes(`| ${title} |`));assert.ok(html.includes(`<td>${title}</td>`));}
  const spare=md.split('\n').find(line=>line.startsWith('| Spare kit |')),label=`Q-${createHash('sha256').update('fieldQuestion').digest('hex').slice(0,12)}`;assert.equal(spare.split('|')[2].split(label).length-1,1);
  const appendix=output.files.get('appendix.md').toString();for(const id of ['itemInput','itemInputB','source','otherSource'])assert.ok(appendix.includes(id));
  get('itemB').title='Equipment';refresh(m.profile.productDocument);const duplicate=await preparePrd(m,{inputPath});assert.equal(duplicate.ok,true,JSON.stringify(duplicate.diagnostics));const duplicateOutput=await renderPrd(duplicate.manifest,{audience:'internal',inputPath});assert.match(duplicateOutput.files.get(duplicateOutput.identity.primaryMarkdown).toString(),/Equipment \(Equipment selection\); Equipment \(Toolkit selection\)/);assert.match(duplicateOutput.files.get('index.html').toString(),/Equipment \(Equipment selection\); Equipment \(Toolkit selection\)/);
});

test('explicit screen images render, historical attachments stay in the appendix, and missing image resources fail closed',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prd-standard-image-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const image=fs.readFileSync(new URL('./fixtures/prd-workspace-reader/prototype.png',import.meta.url)),note=Buffer.from('Synthetic historical evidence.');fs.writeFileSync(path.join(dir,'screen.png'),image);fs.writeFileSync(path.join(dir,'historical.txt'),note);
  const m=fixture(),page=m.objects.find(o=>o.id==='requestPage'),screen=m.profile.productDocument.modules[0].subModules[0].features[0].standard.sections[4].screens[0];
  const asset=(id,file,type,bytes)=>({id,path:file,name:file,mediaType:type,sha256:createHash('sha256').update(bytes).digest('hex'),distributable:true,caption:id});
  m.assets.push(asset('screenImage','screen.png','image/png',image),asset('historicalEvidence','historical.txt','text/plain',note));page.assetIds=['screenImage','historicalEvidence'];screen.assets=['screenImage'];
  const refresh=v=>{if(!v||typeof v!=='object')return;if(v.reviewed&&typeof v.text==='string'){Object.assign(v,snapshotReviewedTextV2(m.objects,v.text,v.reviewed.map(r=>r.object)));return;}for(const x of Object.values(v))refresh(x);};refresh(m.profile.productDocument);
  const inputPath=path.join(dir,'model.json'),prepared=await preparePrd(m,{inputPath});assert.equal(prepared.ok,true,JSON.stringify(prepared.diagnostics));
  const output=await renderPrd(prepared.manifest,{audience:'internal',inputPath}),md=output.files.get(output.identity.primaryMarkdown).toString(),appendix=output.files.get('appendix.md').toString();assert.match(md,/!\[screenImage\]\(assets\/audit-/);assert.doesNotMatch(md,/!\[historicalEvidence\]/);assert.match(appendix,/historicalEvidence/);
  screen.assets=['historicalEvidence'];const bad=await preparePrd(m,{inputPath});assert.equal(bad.ok,true,JSON.stringify(bad.diagnostics));await assert.rejects(()=>renderPrd(bad.manifest,{audience:'internal',inputPath}),/Selected standard screen asset has no supplied image resource/);
});

test('selected client standard images require attachment and exact content/version approval',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prd-standard-public-image-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const first=fs.readFileSync(new URL('./fixtures/prd-workspace-reader/prototype.png',import.meta.url)),second=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA2kAAAAASUVORK5CYII=','base64'),digest=b=>createHash('sha256').update(b).digest('hex');fs.writeFileSync(path.join(dir,'screen.png'),first);
  const m=fixture(),page=m.objects.find(o=>o.id==='requestPage'),screen=m.profile.productDocument.modules[0].subModules[0].features[0].standard.sections[4].screens[0];m.assets.push({id:'screenImage',path:'screen.png',name:'screen.png',mediaType:'image/png',sha256:digest(first),version:'1',distributable:true});page.assetIds=['screenImage'];screen.assets=['screenImage'];m.profile.components[0].selector.types=[...new Set(m.objects.map(o=>o.type))];
  const refresh=v=>{if(!v||typeof v!=='object')return;if(v.reviewed&&typeof v.text==='string'){Object.assign(v,snapshotReviewedTextV2(m.objects,v.text,v.reviewed.map(r=>r.object)));return;}for(const x of Object.values(v))refresh(x);};refresh(m.profile.productDocument);
  const modelPath=path.join(dir,'model.json'),policyPath=path.join(dir,'policy.json');fs.writeFileSync(modelPath,JSON.stringify(m));const prepared=await preparePrd(m,{inputPath:modelPath});assert.equal(prepared.ok,true,JSON.stringify(prepared.diagnostics));
  const objects=Object.fromEntries(m.objects.filter(o=>o.type!=='source').map(o=>[o.id,{id:`public_${o.id}`,title:`Public ${o.type}`,purpose:`Approved ${o.type}`,fields:[...Object.keys(o.detail).map(k=>`detail.${k}`),...['rule','gap','content','priority'].filter(k=>Object.hasOwn(o,k))],...(o.parent?{parent:true}:{}),relations:(o.refs||[]).filter(r=>r.type!=='source').map(r=>({relation:r.relation,target:r.target}))}]));
  const policy={version:1,components:{all:'Approved content'},objects,productDocument:structuredClone(m.profile.productDocument),assets:{screenImage:{id:'approvedImage',caption:'Approved prototype',sha256:digest(first),version:'1'}}};
  const projected=projectPrd(prepared.manifest,'client',policy);assert.deepEqual(projected.objects.get('requestPage').attachments[0].bytes,first);
  const cli=(name)=>{fs.writeFileSync(policyPath,JSON.stringify(policy));const output=path.join(dir,name),p=spawnSync(process.execPath,['archify/bin/archify.mjs','prd','export',modelPath,'-o',output,'--audience','client','--disclosure',policyPath,'--json'],{encoding:'utf8',maxBuffer:16*1024*1024});assert.notEqual(p.status,0,p.stdout+p.stderr);assert.equal(fs.existsSync(output),false);return JSON.parse(p.stdout).diagnostics;};
  assert.ok(cli('missing-public-view').some(d=>d.message.includes('native workflow')));
  const rootStandard=policy.productDocument.standard;delete policy.productDocument.standard;assert.ok(cli('missing-standard-root').some(d=>d.subject.locator==='/disclosure/productDocument/standard'));policy.productDocument.standard=rootStandard;
  const publicFeature=policy.productDocument.modules[0].subModules[0].features[0],featureStandard=publicFeature.standard;delete publicFeature.standard;assert.ok(cli('missing-standard-feature').some(d=>d.subject.locator.endsWith('/features/0/standard')));publicFeature.standard=featureStandard;
  delete policy.assets.screenImage;assert.ok(cli('missing-approval').some(d=>d.subject.locator.endsWith('/assets/0')&&d.message.includes('explicit version-bound')));
  policy.assets.screenImage={id:'approvedImage',caption:'Approved prototype',sha256:digest(first),version:'wrong'};assert.ok(cli('stale-version').some(d=>d.subject.locator.endsWith('/version')));
  policy.assets.screenImage.version='1';delete policy.assets.screenImage.sha256;assert.ok(cli('missing-hash').some(d=>d.subject.locator.endsWith('/sha256')));policy.assets.screenImage.sha256=digest(first);
  const publicScreen=policy.productDocument.modules[0].subModules[0].features[0].standard.sections[4].screens[0];publicScreen.interface='loans';assert.ok(cli('unrelated-attachment').some(d=>d.subject.locator.endsWith('/assets/0')&&d.message.includes('attached')));publicScreen.interface='requestPage';
  m.assets[0].distributable=false;fs.writeFileSync(modelPath,JSON.stringify(m));assert.ok(cli('non-distributable').some(d=>d.message.includes('distributable')));m.assets[0].distributable=true;m.assets[0].mediaType='image/jpeg';fs.writeFileSync(modelPath,JSON.stringify(m));assert.ok(cli('wrong-format').some(d=>d.message.includes('matching signature')));m.assets[0].mediaType='image/png';
  fs.writeFileSync(path.join(dir,'screen.png'),second);m.assets[0].sha256=digest(second);fs.writeFileSync(modelPath,JSON.stringify(m));assert.ok(cli('replaced-image').some(d=>d.subject.locator.endsWith('/sha256')));
});

test('two screen contexts retain new blocks and legacy page/action anchors in export and reader',async t=>{
  const m=fixture(),f=m.profile.productDocument.modules[0].subModules[0].features[0],workflow=f.standard.sections[3],proto=f.standard.sections[4],step=structuredClone(workflow.steps[0]);
  m.objects.push({id:'confirmPage',type:'interface',title:'Confirm request',purpose:'Review the request',status:'proposed',detail:{kind:'page'}},{id:'confirmQuestion',type:'question',title:'What is shown when confirming?',purpose:'Clarify confirmation',status:'proposed',detail:{scope:['confirmPage'],consequence:'Confirmation details are open',options:[],assumptions:[],confirmingFunction:'Facilities owner',blocking:true},refs:[{relation:'target',target:'confirmPage',type:'interface'}]});
  m.objects.find(o=>o.id==='request').refs.push({relation:'uses',target:'confirmPage',type:'interface'});f.actions[0].pages.push({id:'confirmPageAnchor',interface:'confirmPage',groups:[]});
  const gap={question:'confirmQuestion'};proto.screens.push({kind:'screen',id:'S3',page:'confirmPageAnchor',interface:'confirmPage',design:gap,assets:[],elements:[],pageRules:[gap],fields:[],buttons:[],messages:[gap]});
  step.number='1a';step.block='S3';step.businessRules=[];step.rules=[gap];workflow.steps.splice(1,0,step);
  const criteria=f.standard.sections[7].criteria,item=structuredClone(criteria.find(c=>c.id==='requestPath'));item.id='requestPathVariant';item.steps=['1a'];item.blocks=['S3'];criteria.push(item);
  const refresh=v=>{if(!v||typeof v!=='object')return;if(v.reviewed&&typeof v.text==='string'){Object.assign(v,snapshotReviewedTextV2(m.objects,v.text,v.reviewed.map(r=>r.object)));return;}for(const x of Object.values(v))refresh(x);};refresh(m.profile.productDocument);
  m.nativeViews[0].spec.nodes[0].label='1 / 1a Submit request';const prepared=await preparePrd(m,{inputPath});assert.equal(prepared.ok,true,JSON.stringify(prepared.diagnostics));
  assert.equal(prepared.manifest.standardViews[0].prepared.spec.nodes[0].label,'1 / 1a Submit request');
  const output=await renderPrd(prepared.manifest,{audience:'internal',inputPath}),md=output.files.get(output.identity.primaryMarkdown).toString();
  assert.match(md,/\| 1 \| Borrower .*\[S1\]\(#checkoutFeature-S1\)/);assert.match(md,/\| 1a \| Borrower .*\[S3\]\(#checkoutFeature-S3\)/);assert.match(md,/#### S3 Confirm request/);
  const html=output.files.get('index.html').toString();for(const id of ['requestAction','requestPageAnchor','confirmPageAnchor','reviewAction','inventoryAction']){assert.equal((md.match(new RegExp(`<a id="${id}"></a>`,'g'))||[]).length,1,id);assert.equal((html.match(new RegExp(`id="${id}"`,'g'))||[]).length,1,id);}
  assert.ok(md.indexOf('<a id="confirmPageAnchor"></a>')>md.indexOf('#### S3 Confirm request'));
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prd-standard-reader-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const input=path.join(dir,'input.json'),reader=path.join(dir,'reader.html');fs.writeFileSync(input,JSON.stringify(m));
  const cli=spawnSync(process.execPath,['archify/bin/archify.mjs','prd','build',input,'-o',reader,'--audience','internal','--json'],{encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(cli.status,0,cli.stdout+cli.stderr);const readerHtml=fs.readFileSync(reader,'utf8'),data=JSON.parse(readerHtml.match(/<script type="application\/json" id="reader-data">([\s\S]*?)<\/script>/)[1]),bytes=Buffer.from(data.packageBase64,'base64');let offset=0,download='';while(bytes.readUInt32LE(offset)===0x04034b50){const size=bytes.readUInt32LE(offset+18),n=bytes.readUInt16LE(offset+26),extra=bytes.readUInt16LE(offset+28),name=bytes.subarray(offset+30,offset+30+n).toString(),start=offset+30+n+extra;if(name===data.primaryMarkdown)download=bytes.subarray(start,start+size).toString();offset=start+size;}
  for(const id of ['requestAction','requestPageAnchor','confirmPageAnchor']){assert.ok(readerHtml.includes(`id="${id}"`),id);assert.ok(download.includes(`<a id="${id}"></a>`),id);}
  f.actions[0].pages[0].id='checkoutFeature-S1';proto.screens[0].page='checkoutFeature-S1';const collision=await preparePrd(m,{inputPath});assert.equal(collision.ok,true,JSON.stringify(collision.diagnostics));await assert.rejects(()=>renderPrd(collision.manifest,{audience:'internal',inputPath}),/anchor is ambiguous/);
});

test('Service extract labels master lineage and isolates screen cache blocks',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prd-standard-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const m=fixture(),input=path.join(dir,'model.json'),historyFile=path.join(dir,'history.json'),base=path.join(dir,'base'),next=path.join(dir,'next'),cold=path.join(dir,'cold'),unrelated=path.join(dir,'unrelated');m.workspaceId='bf959db5-03b7-4d2a-a29d-40c3e4779c19';
  const otherRole=structuredClone(m.objects.find(o=>o.id==='borrower'));otherRole.id='otherRole';otherRole.title='UNRELATED_ROLE_CANARY';m.objects.push(otherRole);
  const otherService=structuredClone(m.objects.find(o=>o.id==='loans'));otherService.id='otherService';otherService.title='Other Service';m.objects.push(otherService);
  const otherRule=structuredClone(m.objects.find(o=>o.id==='dateRule'));otherRule.id='otherRule';otherRule.title='UNRELATED_RULE_CANARY';otherRule.rule.scope=['otherService'];otherRule.rule.exceptions.forEach(e=>e.scope=['otherService']);m.objects.push(otherRule);
  const shared=snapshotReviewedTextV2(m.objects,'Other Service only.',['loans']);m.profile.productDocument.standard.roles.push({role:'otherRole',purpose:shared,permissions:shared,restrictions:shared});m.profile.productDocument.standard.sharedRules.push({rule:'otherRule',description:shared});
  const history={schemaVersion:1,service:'loans',audience:'internal',entries:[{version:'1',date:'2026-10-29',summary:'First baseline'}]};
  const save=()=>{fs.writeFileSync(input,JSON.stringify(m));fs.writeFileSync(historyFile,JSON.stringify(history));};save();
  const run=(output,...extra)=>{const p=spawnSync(process.execPath,['archify/bin/archify.mjs','prd','export',input,'-o',output,'--audience','internal','--service','loans','--service-history',historyFile,'--markdown-only',...extra,'--json'],{encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(p.status,0,p.stdout+p.stderr);return JSON.parse(p.stdout);};
  run(base);const meta=JSON.parse(fs.readFileSync(path.join(base,'manifest.json'))),md=fs.readFileSync(path.join(base,meta.primaryMarkdown),'utf8');
  assert.match(md,/Service extract of the master PRD/);assert.match(md,/First baseline/);assert.doesNotMatch(md,/UNRELATED_ROLE_CANARY|UNRELATED_RULE_CANARY/);
  const findBlock=(root,id)=>fs.readdirSync(path.join(root,'cache','product')).find(name=>fs.readFileSync(path.join(root,'cache','product',name),'utf8').includes(`<a id="checkoutFeature-${id}"></a>`));
  const unchanged=findBlock(base,'S2');assert.ok(unchanged);assert.doesNotMatch(fs.readFileSync(path.join(base,'cache','product',unchanged),'utf8'),/checkoutFeature-S1/);
  otherRole.title='OTHER_ROLE_CHANGED';otherRule.title='OTHER_RULE_CHANGED';m.profile.productDocument.standard.roles.at(-1).purpose={...shared,text:'Unrelated Service changed.'};save();
  const isolated=run(unrelated,'--incremental-from',base),isolatedMeta=JSON.parse(fs.readFileSync(path.join(unrelated,'manifest.json')));assert.equal(isolatedMeta.semantic,meta.semantic);assert.equal(isolated.cache.componentsRendered,0);assert.ok(isolated.cache.componentsReused>0);
  m.objects.push({id:'newPageQuestion',type:'question',title:'Which message appears?',purpose:'Clarify request messaging',status:'proposed',detail:{scope:['requestPage'],consequence:'Message remains unresolved',options:[],assumptions:[],confirmingFunction:'Facilities owner',blocking:true},refs:[{relation:'target',target:'requestPage',type:'interface'}]});
  m.profile.productDocument.modules[0].subModules[0].features[0].standard.sections[4].screens[0].messages[0]={question:'newPageQuestion'};
  history.entries.push({version:'2',date:'2026-10-30',summary:'Clarify request page'});save();
  const result=run(next,'--incremental-from',base);run(cold);assert.ok(result.cache.componentsReused>0);assert.ok(result.cache.componentsRendered>0);assert.ok(result.cache.resourcesReused>0);assert.equal(findBlock(next,'S2'),unchanged);
  const warm=fs.readFileSync(path.join(next,meta.primaryMarkdown),'utf8'),fresh=fs.readFileSync(path.join(cold,meta.primaryMarkdown),'utf8');assert.equal(warm,fresh);assert.match(warm,/Which message appears\?/);
  for(const [,id] of warm.matchAll(/\]\(#(standard-question-[a-f0-9]+)\)/g))assert.equal((warm.match(new RegExp(`<a id="${id}"></a>`,'g'))||[]).length,1,id);
  assert.ok(warm.includes('Which document control details are confirmed?'));assert.deepEqual(fs.readFileSync(path.join(next,'assets','native-checkoutFeature-checkoutFlow.svg')),fs.readFileSync(path.join(cold,'assets','native-checkoutFeature-checkoutFlow.svg')));
});
