import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { preparePrd } from '../archify/explainer/workspace/prd-prepare.mjs';
import { buildPrdReader } from '../archify/explainer/workspace/prd-reader-build.mjs';
import Ajv from 'ajv';
import * as generated from '../archify/explainer/workspace/generated-prd-validators.mjs';
import { packageSchema, publicPackageSchema, storeSchema } from '../archify/explainer/workspace/prd-feedback-schema.mjs';
import { requestSchema } from '../archify/explainer/workspace/prd-proposal-schema.mjs';

const root=path.resolve('archify'),workspace=JSON.parse(fs.readFileSync(path.join(root,'schemas/prd-workspace.schema.json')));
const clone=v=>structuredClone(v);
test('generated draft-07 validators preserve AJV acceptance and diagnostics',()=>{
  const id='1fd09445-b9d9-4884-ac67-cc8e607708d9',sha='a'.repeat(64),comment={id:'comment',objectId:'field',baseRevision:sha,quoteSnapshot:{path:'/title',text:'Title'},author:'Reviewer',time:'2026-01-01T00:00:00Z',body:'Literal',state:'open'};
  const pkg={kind:'archify-prd-feedback',schemaVersion:1,workspaceId:id,comments:[comment]},pub={kind:'archify-prd-public-feedback',schemaVersion:1,workspaceId:id,revision:sha,disclosure:sha,snapshot:sha,exporter:sha,comments:[comment]},store={kind:'archify-prd-feedback-store',schemaVersion:1,workspaceId:id,comments:[comment],revision:sha};
  const req={kind:'archify-prd-change-request',schemaVersion:1,workspaceId:id,proposalId:'proposal',baseRevision:sha,storeRevision:sha,objectId:'field',operation:'replace',path:'/title',oldValue:'Title',oldHash:sha,newValue:'Revised',commentIds:['comment']};
  const model=JSON.parse(fs.readFileSync('test/fixtures/prd-workspace/garden.json'));
  for(const [name,schema,valid,bad] of [
    ['workspace',workspace,model,v=>{v.objects[0].unexpected=true;v.schemaVersion=3;}],
    ['feedbackPackage',packageSchema,pkg,v=>{v.comments[0].id='bad id';v.extra=true;}],
    ['publicFeedbackPackage',publicPackageSchema,pub,v=>{v.comments[0].sourceAnchor={};v.exporter='bad';}],
    ['feedbackStore',storeSchema,store,v=>{v.comments[0].publicOrigin={};v.revision='bad';}],
    ['changeRequest',requestSchema,req,v=>{v.commentIds=['comment','comment'];v.path='x'.repeat(129);}]
  ]){
    const original=new Ajv({allErrors:true,strict:false}).compile(schema),invalid=clone(valid);bad(invalid);
    for(const input of [valid,invalid]){assert.equal(generated[name](input),original(input),name);assert.deepEqual(generated[name].errors,original.errors,name);}
  }
});

test('generated workspace validator matches the binding-only question union',()=>{
  const model=JSON.parse(fs.readFileSync('test/fixtures/prd-workspace/facility.json'));
  const binding=model.objects.find(o=>o.type==='binding'), rule=model.objects.find(o=>o.type==='rule');
  const original=new Ajv({allErrors:true,strict:false}).compile(workspace);
  for(const cell of ['visibility','editable','required']){
    const valid=clone(model);valid.objects.find(o=>o.id===binding.id).detail[cell]={question:'question'};
    const extra=clone(valid);extra.objects.find(o=>o.id===binding.id).detail[cell].extra=true;
    const nested=clone(valid);nested.objects.find(o=>o.id===binding.id).detail[cell]={not:{question:'question'}};
    const condition=clone(valid);condition.objects.find(o=>o.id===rule.id).rule.condition={question:'question'};
    for(const [input,expected] of [[valid,true],[extra,false],[nested,false],[condition,false]]){
      assert.equal(original(input),expected);assert.equal(generated.workspace(input),expected);assert.deepEqual(generated.workspace.errors,original.errors);
    }
  }
});

test('prepared and public snapshot identities bind validator and schema bytes',async()=>{
  const input=path.resolve('test/fixtures/prd-workspace/garden.json'),model=JSON.parse(fs.readFileSync(input)),prepared=await preparePrd(model,{inputPath:input});assert.equal(prepared.ok,true);
  for(const name of ['prd-feedback-schema.mjs','prd-proposal-schema.mjs','generated-prd-validators.mjs','generated-prd-feedback-browser.js'])assert.equal(prepared.manifest.identities.code[name],createHash('sha256').update(fs.readFileSync(path.join(root,'explainer/workspace',name))).digest('hex'));
  const policy={version:1,components:{catalogSection:'Seed catalog',notes:'Notes'},objects:{name:{id:'packetName',title:'Packet name',purpose:'Identify a packet',fields:['detail.dataType']}},omitted:{garden:'Broader scope under review.',catalog:'Boundary under review.',extra:'Note under review.'}};
  const before=await buildPrdReader(prepared.manifest,{audience:'client',policy,inputPath:input,returnConfig:true}),changed=structuredClone(prepared.manifest);changed.identities.code['generated-prd-validators.mjs']='0'.repeat(64);const after=await buildPrdReader(changed,{audience:'client',policy,inputPath:input,returnConfig:true});assert.notEqual(before.snapshot,after.snapshot);
});

test('validator freshness detects changes to both PRD schema inputs',t=>{
  // This development-only copy inherits the repository's AJV tooling; it is
  // not a staged Skill and is excluded from clean-package inputs.
  const dir=fs.mkdtempSync(path.join(root,'.validator-check-prd-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  for(const name of ['scripts','schemas','renderers/shared','explainer/workspace'])fs.mkdirSync(path.join(dir,name),{recursive:true});
  fs.cpSync(path.join(root,'schemas'),path.join(dir,'schemas'),{recursive:true});
  for(const name of ['scripts/generate-validators.mjs','renderers/shared/generated-validators.mjs','explainer/workspace/prd-feedback-schema.mjs','explainer/workspace/prd-proposal-schema.mjs','explainer/workspace/generated-prd-validators.mjs','explainer/workspace/generated-prd-feedback-browser.js'])fs.copyFileSync(path.join(root,name),path.join(dir,name));
  const check=()=>spawnSync(process.execPath,[path.join(dir,'scripts/generate-validators.mjs'),'--check'],{encoding:'utf8'});
  let result=check();assert.equal(result.status,0,result.stderr);
  const feedback=path.join(dir,'explainer/workspace/prd-feedback-schema.mjs'),original=fs.readFileSync(feedback,'utf8');fs.writeFileSync(feedback,original.replace('maxItems:10000,items:comment','maxItems:9999,items:comment'));result=check();assert.notEqual(result.status,0);assert.match(result.stderr,/generated-prd-validators.mjs is stale/);fs.writeFileSync(feedback,original);
  const schemaPath=path.join(dir,'schemas/prd-workspace.schema.json'),schema=JSON.parse(fs.readFileSync(schemaPath));schema.properties.workspaceId.pattern='^different$';fs.writeFileSync(schemaPath,JSON.stringify(schema));result=check();assert.notEqual(result.status,0);assert.match(result.stderr,/generated-prd-validators.mjs is stale/);
});
