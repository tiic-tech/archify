import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validatePrd, readiness } from '../archify/explainer/workspace/prd-model.mjs';
import { preparePrd } from '../archify/explainer/workspace/prd-prepare.mjs';
import { snapshotReviewedTextV2 } from '../archify/explainer/workspace/prd-product-v2.mjs';
import { validateStandardDocumentV1 } from '../archify/explainer/workspace/prd-standard-v1.mjs';
import { projectPublicFeatureDocument } from '../archify/explainer/workspace/prd-product-public-v2.mjs';
import { composeProjectedFeatureDocument } from '../archify/explainer/workspace/prd-feature-composer.mjs';
import { readyStandardFixture } from './helpers/prd-standard-ready.mjs';
import { crossServiceStandardFixture } from './helpers/prd-standard-cross-service.mjs';
const fixture=()=>JSON.parse(fs.readFileSync(new URL('../archify/examples/prd-equipment-standard-workspace.json',import.meta.url)));
const feature=m=>m.profile.productDocument.modules[0].subModules[0].features[0];
const section=(m,n)=>feature(m).standard.sections[n];
const errors=m=>validatePrd(m).diagnostics.filter(d=>d.severity==='error');
const contains=(m,message)=>errors(m).some(d=>d.message.includes(message));

test('production validation accepts the synthetic draft but readiness reports its actual gaps',()=>{
  const m=fixture();assert.deepEqual(errors(m),[]);
  const gaps=readiness(m,'loans');
  assert.ok(gaps.some(d=>d.message.includes('Incomplete status model')));
  assert.ok(gaps.some(d=>d.subject.locator.includes('/screens/0/fields/2/question')));
  assert.ok(gaps.some(d=>d.subject.locator.includes('/screens/1/question')));
  assert.ok(composeProjectedFeatureDocument({objects:m.objects,plan:m.profile.productDocument}).nodes.length);
  assert.throws(()=>projectPublicFeatureDocument({model:m},{},null,null),e=>e.diagnostics?.some(d=>d.subject.locator==='/disclosure/productDocument'&&d.message.includes('independently authored v2 plan')));
  assert.ok(validateStandardDocumentV1(m,{reviewFacts:new Map()}).some(d=>d.message.includes('not approved for this audience')));
});

test('new facts, questions and existing v2 review dependencies cannot go stale or escape their context',()=>{
  const cases=[
    [m=>{m.objects.find(o=>o.id==='pendingState').title='Changed';},'Reviewed standard text is stale.'],
    [m=>{section(m,4).screens[0].fields[2].question='screenQuestion';},'scoped to that upload'],
    [m=>{section(m,3).steps[0].action=snapshotReviewedTextV2(m.objects,'Unrelated review',['recordAction']);},'does not cite its local context'],
    [m=>{feature(m).actions[0].summary.reviewed[0].sha256='0'.repeat(64);},'Reviewed summary is stale.'],
    [m=>{feature(m).service='missingService';},'Reference is missing or has the wrong type.'],
    [m=>{section(m,4).screens[0].fields[0].default={question:'doesNotExist'};},'Reference is missing or has the wrong type.'],
  ];
  for(const [change,message] of cases){const m=fixture();change(m);assert.ok(contains(m,message),`${message}: ${JSON.stringify(errors(m))}`);}
});

test('workflow, page, field, status, rule and criterion references are validated through the production entry',()=>{
  const cases=[
    [m=>{section(m,3).steps[1].number='1';},'Step number is duplicated.'],
    [m=>{section(m,3).steps[0].node='reviewNode';},'Step node must bind its actual activity.'],
    [m=>{section(m,3).steps[0].role='staff';},'Step role is not an actor'],
    [m=>{section(m,3).steps[2].block='S1';},'Step block type conflicts'],
    [m=>{section(m,4).screens.push(structuredClone(section(m,4).screens[0]));},'Block ID is duplicated.'],
    [m=>{section(m,3).steps[1].block='S1';},'Block is not used'],
    [m=>{section(m,4).screens[0].fields[0].field='date';},'Field row must use an actual binding'],
    [m=>{section(m,4).screens[0].buttons=[];},'Displayed button has no button specification'],
    [m=>{section(m,4).screens[0].assets=['missingAsset'];},'Screen asset must be attached'],
    [m=>{section(m,4).screens[0].page='missingPage';},'Screen must identify the exact Feature page'],
    [m=>{section(m,4).screens[1].question='fieldQuestion';},'Missing-screen question must be scoped'],
    [m=>{section(m,4).screens[0].fields[1].required='Yes';},'Required value conflicts'],
    [m=>{section(m,3).statusModel.transitions[0].to='pendingState';},'Transition endpoints do not match'],
    [m=>{section(m,3).steps[0].businessRules=['BR-99'];},'does not resolve'],
    [m=>{section(m,7).criteria[0].processExceptions=['wrongException'];},'Criterion exception is not'],
    [m=>{section(m,7).criteria=section(m,7).criteria.filter(c=>c.id!=='dateExample');},'Acceptance coverage is missing'],
    [m=>{section(m,7).criteria=section(m,7).criteria.filter(c=>c.id!=='returnToRequest');},'Acceptance coverage is missing'],
    [m=>{section(m,7).criteria.find(c=>c.id==='auditCoverage').observation={question:'accessQuestion'};},'Security coverage must identify'],
    [m=>{section(m,7).criteria.find(c=>c.id==='processOutput').sources=['record'];},'Process coverage must cite'],
    [m=>{section(m,3).steps[1].node='requestNode';section(m,3).steps[1].activity='request';section(m,3).steps[1].role='borrower';},'Multiple steps on one node'],
    [m=>{section(m,4).businessRules[0].steps=[];},'does not declare a step'],
    [m=>{section(m,3).statusModel.states.push(structuredClone(section(m,3).statusModel.states[0]));},'State is duplicated'],
    [m=>{m.profile.productDocument.standard.history[2].chapters=[];},'needs references and changed chapter summaries'],
    [m=>{m.profile.productDocument.standard.history[2].version='0.2';},'Document versions must increase'],
    [m=>{section(m,4).screens[0].fields[0].default=snapshotReviewedTextV2(m.objects,'Wrong context',['recordAction']);},'does not cite its local context'],
    [m=>{section(m,4).screens[0].fields[0].default=snapshotReviewedTextV2(m.objects,'Unsupported default',['loans']);},'does not cite its local context'],
    [m=>{feature(m).standard.changes[0].references[0].text='Different reference';},'references must match'],
  ];
  for(const [change,message] of cases){const m=fixture();change(m);assert.ok(contains(m,message),`${message}: ${JSON.stringify(errors(m))}`);}
});

test('a complete synthetic Service passes readiness until a selected role permission is unresolved',()=>{
  const m=readyStandardFixture();assert.deepEqual(errors(m),[]);assert.deepEqual(readiness(m,'loans'),[]);
  m.objects.push({id:'roleGapQuestion',type:'question',title:'Which permissions apply?',purpose:'Confirm permissions',status:'proposed',detail:{scope:['borrower'],consequence:'Permissions are unresolved',options:[],assumptions:[],confirmingFunction:'Facilities owner',blocking:false},refs:[{relation:'target',target:'borrower',type:'role'}]});
  m.profile.productDocument.standard.roles[0].permissions={question:'roleGapQuestion'};
  assert.deepEqual(errors(m),[]);
  const gaps=readiness(m,'loans');assert.ok(gaps.some(d=>d.subject.locator==='/profile/productDocument/standard/roles/0/permissions/question'));
  const applicable=readyStandardFixture();applicable.objects.push({id:'sharedRuleQuestion',type:'question',title:'Which shared rule detail applies?',purpose:'Confirm shared rule detail',status:'proposed',detail:{scope:['dateRule'],consequence:'Rule detail is unresolved',options:[],assumptions:[],confirmingFunction:'Facilities owner',blocking:false},refs:[{relation:'target',target:'dateRule',type:'rule'}]});
  applicable.profile.productDocument.standard.sharedRules.push({rule:'dateRule',description:{question:'sharedRuleQuestion'}});section(applicable,4).businessRules[0].boundaries={question:'sharedRuleQuestion'};assert.deepEqual(errors(applicable),[]);
  assert.ok(readiness(applicable,'loans').some(d=>d.subject.locator==='/profile/productDocument/standard/sharedRules/0/description/question'));
});

test('Service readiness includes only referenced external rule gaps at the owner locator',()=>{
  const m=crossServiceStandardFixture(),owner=m.profile.productDocument.modules[0].subModules[1].features[0],q=m.objects.find(o=>o.id==='ownerQuestion');q.detail.blocking=false;
  m.objects.push({id:'unrelatedOwnerQuestion',type:'question',title:'Unrelated owner question',purpose:'Clarify other work',status:'proposed',detail:{scope:['otherService'],consequence:'Other work remains open',options:[],assumptions:[],confirmingFunction:'Reviewer',blocking:false},refs:[{relation:'target',target:'otherService',type:'service'}]});owner.standard.note={question:'unrelatedOwnerQuestion'};
  assert.deepEqual(errors(m),[]);const gaps=readiness(m,'loans').filter(d=>d.message==='Standard question-bound gap blocks readiness.');
  const ownerGaps=gaps.filter(d=>d.evidence.question==='ownerQuestion');assert.equal(ownerGaps.length,1);assert.equal(ownerGaps[0].subject.locator,'/profile/productDocument/modules/0/subModules/1/features/0/standard/sections/4/businessRules/0/boundaries/question');assert.ok(!gaps.some(d=>d.evidence.question==='unrelatedOwnerQuestion'));assert.ok(gaps.some(d=>d.evidence.question==='fieldQuestion'));
});

test('Service readiness inspects used role contracts but ignores unrelated roles',()=>{
  const m=fixture(),standard=m.profile.productDocument.standard;
  for(const row of standard.roles){row.permissions=snapshotReviewedTextV2(m.objects,'Modeled permissions.',[row.role]);row.restrictions=snapshotReviewedTextV2(m.objects,'Modeled restrictions.',[row.role]);}
  const hasRoleGap=()=>readiness(m,'loans').some(d=>d.subject.locator==='/profile/productDocument/standard/roles/0/permissions/question');
  assert.equal(hasRoleGap(),false);
  standard.roles[0].permissions={question:'scopeQuestion'};assert.equal(hasRoleGap(),true);
  standard.roles[0].permissions=snapshotReviewedTextV2(m.objects,'Modeled permissions.',['borrower']);
  m.objects.push({id:'unrelatedRole',type:'role',title:'Unrelated role',purpose:'Other Service',status:'proposed',detail:{actorKind:'human'}});
  standard.roles.push({role:'unrelatedRole',purpose:snapshotReviewedTextV2(m.objects,'Other Service role.',['unrelatedRole']),permissions:{question:'scopeQuestion'},restrictions:{question:'scopeQuestion'}});
  assert.equal(readiness(m,'loans').some(d=>d.subject.locator.includes('/standard/roles/3/')),false);
});

test('section, applied action, rule and actor questions use actual local context',()=>{
  const m=fixture(), f=feature(m), get=id=>m.objects.find(o=>o.id===id), question=(id,target,type)=>({id,type:'question',title:`Clarify ${id}`,purpose:`Clarify ${id}`,status:'proposed',detail:{scope:[target],consequence:'Detail is open',options:[],assumptions:[],confirmingFunction:'Facilities owner',blocking:true},refs:[{relation:'target',target,type}]});
  m.objects.push({id:'requestSection',type:'section',title:'Request details',purpose:'Request details',status:'proposed',detail:{},parent:'requestPage'});
  get('dateInput').parent='requestSection';get('dateRule').rule.scope=['requestSection'];get('dateRule').rule.exceptions[0].scope=['requestSection'];
  m.objects.push({id:'submitLoan',type:'action',title:'Submit loan',purpose:'Submit a loan',status:'proposed',detail:{contracts:{}},refs:[{relation:'actor',target:'borrower',type:'role'}]});
  get('request').refs.push({relation:'action',target:'submitLoan',type:'action'});
  for(const [id,target,type] of [['sectionQuestion','requestSection','section'],['submitQuestion','submitLoan','action'],['borrowerQuestion','borrower','role']])m.objects.push(question(id,target,type));
  const group={id:'submitContext',title:'Submission',sources:['submitLoan'],summary:snapshotReviewedTextV2(m.objects,'Submit a loan.',['submitLoan'])};f.actions[0].groups.push(group);
  section(m,4).screens[0].fields[1].default={question:'sectionQuestion'};
  section(m,4).screens[0].buttons[0].visibility={question:'borrowerQuestion'};
  section(m,3).steps[0].rules=[{question:'submitQuestion'}];section(m,3).steps[0].response={question:'ruleQuestion'};
  const refresh=value=>{if(!value||typeof value!=='object')return;if(value.reviewed&&typeof value.text==='string'){Object.assign(value,snapshotReviewedTextV2(m.objects,value.text,value.reviewed.map(r=>r.object)));return;}for(const child of Object.values(value))refresh(child);};refresh(m.profile.productDocument);
  assert.deepEqual(errors(m),[]);
  const inapplicable=structuredClone(m);inapplicable.objects.push({id:'otherActivity',type:'activity',title:'Other activity',purpose:'Other activity',status:'proposed',parent:'loans',detail:{actorKind:'human'}});inapplicable.objects.find(o=>o.id==='dateRule').rule.scope=['otherActivity'];inapplicable.objects.find(o=>o.id==='dateRule').rule.exceptions[0].scope=['otherActivity'];
  assert.ok(contains(inapplicable,'does not apply to it'),JSON.stringify(errors(inapplicable)));
  // A same-Service but unrelated interface is not the field's context.
  m.objects.push({id:'foreignPage',type:'interface',title:'Other page',purpose:'Other page',status:'proposed',detail:{kind:'page'}});
  m.objects.push(question('foreignQuestion','foreignPage','interface'));
  get('record').refs.push({relation:'uses',target:'foreignPage',type:'interface'});
  section(m,4).screens[0].fields[1].default={question:'foreignQuestion'};
  assert.ok(contains(m,'Question is not scoped to this local context.'));
});

test('two page-context steps may map to one native node when both numbers are shown',()=>{
  const m=fixture(), workflow=section(m,3), step=structuredClone(workflow.steps[0]), f=feature(m);
  m.objects.push({id:'confirmPage',type:'interface',title:'Confirm request',purpose:'Review the request',status:'proposed',detail:{kind:'page'}});
  m.objects.push({id:'confirmQuestion',type:'question',title:'What is shown when confirming?',purpose:'Clarify confirmation',status:'proposed',detail:{scope:['confirmPage'],consequence:'Confirmation details are open',options:[],assumptions:[],confirmingFunction:'Facilities owner',blocking:true},refs:[{relation:'target',target:'confirmPage',type:'interface'}]});
  m.objects.find(o=>o.id==='request').refs.push({relation:'uses',target:'confirmPage',type:'interface'});
  f.actions[0].pages.push({id:'confirmPageAnchor',interface:'confirmPage',groups:[]});
  const gap={question:'confirmQuestion'};
  section(m,4).screens.push({kind:'screen',id:'S3',page:'confirmPageAnchor',interface:'confirmPage',design:gap,assets:[],elements:[],pageRules:[gap],fields:[],buttons:[],messages:[gap]});
  step.number='1a';step.block='S3';step.businessRules=[];step.rules=[gap];workflow.steps.splice(1,0,step);
  const criteria=section(m,7).criteria, item=structuredClone(criteria.find(c=>c.id==='requestPath'));item.id='requestPathVariant';item.steps=['1a'];item.blocks=['S3'];criteria.push(item);
  const refresh=value=>{if(!value||typeof value!=='object')return;if(value.reviewed&&typeof value.text==='string'){Object.assign(value,snapshotReviewedTextV2(m.objects,value.text,value.reviewed.map(r=>r.object)));return;}for(const child of Object.values(value))refresh(child);};refresh(m.profile.productDocument);
  const node=m.nativeViews[0].spec.nodes.find(n=>n.id==='requestNode');node.label='1 / 1a Submit request';
  assert.deepEqual(errors(m),[]);
  node.label='Submit request';assert.ok(contains(m,'Multiple steps on one node'));
});

test('standard workflow paths through a rule preserve declared activity reachability and remain non-step constraints',async()=>{
  const m=readyStandardFixture(),view=m.nativeViews[0],rule=structuredClone(m.objects.find(o=>o.id==='dateRule'));rule.id='workflowCondition';rule.rule.scope=['request'];rule.rule.exceptions=[];m.objects.push(rule);
  const request=m.objects.find(o=>o.id==='request');request.refs.push({relation:'next',target:'review',type:'activity'});
  const action=feature(m).actions[0];action.groups.push({id:'conditionGroup',title:'Condition',sources:[rule.id],summary:snapshotReviewedTextV2(m.objects,'Evaluate the condition.',[rule.id])});action.pages[0].groups[0].sources.push(rule.id);action.pages[0].groups[0].summary=snapshotReviewedTextV2(m.objects,'Collect equipment and evaluate the condition.',action.pages[0].groups[0].sources);
  view.spec.nodes.find(n=>n.id==='reviewNode').col=2;view.spec.nodes.find(n=>n.id==='recordNode').col=3;view.spec.nodes.push({id:'conditionNode',lane:'borrowerLane',col:1,type:'backend',label:'Evaluate condition'});view.bindings.push({node:'conditionNode',object:rule.id,type:'rule'});
  const edge=view.spec.edges.find(e=>e.from==='requestNode'&&e.to==='reviewNode');edge.to='conditionNode';view.spec.edges.push({id:'conditionPass',from:'conditionNode',to:'reviewNode'});
  const refresh=(v,model=m)=>{if(!v||typeof v!=='object')return;if(v.reviewed&&typeof v.text==='string'){Object.assign(v,snapshotReviewedTextV2(model.objects,v.text,v.reviewed.map(r=>r.object)));return;}for(const x of Object.values(v))refresh(x,model);};refresh(m.profile.productDocument);
  assert.deepEqual(errors(m),[]);const prepared=await preparePrd(m,{inputPath:'archify/examples/prd-equipment-standard-workspace.json'});assert.equal(prepared.ok,true,JSON.stringify(prepared.diagnostics));
  const incomplete=structuredClone(m);incomplete.objects.find(o=>o.id==='request').refs=incomplete.objects.find(o=>o.id==='request').refs.filter(r=>r.relation!=='next');refresh(incomplete.profile.productDocument,incomplete);assert.deepEqual(errors(incomplete),[],'an absent next contract is not invented');
  const wrong=structuredClone(m);wrong.nativeViews[0].spec.edges.find(e=>e.id==='conditionPass').to='recordNode';assert.ok(contains(wrong,'conflict with declared activity.next'));
  const broken=structuredClone(m);broken.nativeViews[0].spec.edges=broken.nativeViews[0].spec.edges.filter(e=>e.id!=='conditionPass');assert.ok(contains(broken,'conflict with declared activity.next'));
  const masquerade=structuredClone(m);section(masquerade,3).steps[0].node='conditionNode';assert.ok(contains(masquerade,'Step node must bind its actual activity.'));
  const coverage=structuredClone(m);section(coverage,7).criteria=section(coverage,7).criteria.filter(c=>!(c.coverage.includes('path')&&c.steps.indexOf('1')>=0&&c.steps.indexOf('2')>c.steps.indexOf('1')));assert.ok(contains(coverage,'Acceptance coverage is missing'));
});

test('release references ignore record key order but retain content and array order',()=>{
  const m=fixture(),entry=m.profile.productDocument.standard.history.find(h=>h.version==='1.1');
  entry.references=entry.references.map(r=>Object.fromEntries(Object.entries(r).reverse()));assert.deepEqual(errors(m),[]);
  entry.references[0].text='A genuinely different reference';assert.ok(contains(m,'Chapter callout references must match'));
  const ordered=fixture(),history=ordered.profile.productDocument.standard.history.find(h=>h.version==='1.1'),change=feature(ordered).standard.changes[0];const second=snapshotReviewedTextV2(ordered.objects,'Another source reference.',['source']);history.references.push(second);change.references.push(structuredClone(second));assert.deepEqual(errors(ordered),[]);history.references.reverse();assert.ok(contains(ordered,'Chapter callout references must match'));
});

test('authored dates accept the requested display format and preserve chronology',()=>{
  const m=fixture(), doc=m.profile.productDocument.standard, fact=text=>snapshotReviewedTextV2(m.objects,text,['source']);
  doc.startDate=fact('12 Oct 2026');
  for(const [entry,date] of doc.history.map((entry,i)=>[entry,['12 Oct 2026','2026-10-13','14 Oct 2026'][i]]))entry.date=fact(date);
  assert.deepEqual(errors(m),[]);
  doc.history[2].date=fact('11 Oct 2026');assert.ok(contains(m,'Document history dates must be chronological'));
  doc.startDate=fact('31 Feb 2026');assert.ok(contains(m,'Starting date must be a real'));
});

test('complete state models require reachable actual states',()=>{
  const m=fixture(),status=section(m,3).statusModel;status.completeness='complete';delete status.question;
  m.objects=m.objects.filter(o=>o.id!=='statusQuestion');
  assert.deepEqual(errors(m),[]);
  const orphan={id:'unreachableState',type:'state',title:'Unreachable',purpose:'Unreachable',status:'proposed',detail:{},parent:'loanEntity'};
  m.objects.push(orphan);status.states.push({state:orphan.id,meaning:snapshotReviewedTextV2(m.objects,'Not reached',[orphan.id]),initial:false});
  assert.ok(contains(m,'State is unreachable'));
});
