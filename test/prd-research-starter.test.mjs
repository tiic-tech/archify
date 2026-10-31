import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {stageCleanSkill} from '../scripts/stage-clean-skill.mjs';

// Run only the staged package from a separate project directory: no repository
// imports, local authoring scripts or pre-existing project files are used.
test('staged research starter validates, builds a reader and retains source ancestry',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'archify-research-starter-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const skill=path.join(root,'skill'),project=path.join(root,'project');stageCleanSkill({repoRoot:process.cwd(),destination:skill});fs.mkdirSync(project);const input=path.join(project,'workspace.json');fs.copyFileSync(path.join(skill,'examples/prd-research-starter.json'),input);const cli=path.join(skill,'bin/archify.mjs'),run=(...args)=>{const p=spawnSync(process.execPath,[cli,'prd',...args,'--json'],{cwd:project,encoding:'utf8',env:{...process.env,NODE_PATH:'',ARCHIFY_UPDATE_CHECK_DISABLED:'1'}});assert.equal(p.error,undefined);return {status:p.status,...JSON.parse(p.stdout)};};
 const validate=run('validate',input);assert.equal(validate.status,0,JSON.stringify(validate));assert.ok(validate.diagnostics.some(d=>d.code==='prd/extension-preserved'));const base=path.join(project,'base.json'),compiled=run('compile',input,'-o',base);assert.equal(compiled.status,0,JSON.stringify(compiled));const reader=path.join(project,'reader.html'),built=run('build',input,'-o',reader,'--audience','internal');assert.equal(built.status,0,JSON.stringify(built));assert.equal(built.revision,compiled.revision);assert.match(fs.readFileSync(reader,'utf8'),/Unclassified observation/);const ready=run('compile',input,'-o',path.join(project,'ready.json'),'--ready','project');assert.equal(ready.status,1);assert.ok(ready.diagnostics.some(d=>d.code==='prd/ready-gap'));assert.equal(fs.existsSync(path.join(project,'ready.json')),false);
 const model=JSON.parse(fs.readFileSync(input)),previous=structuredClone(model.objects.find(o=>o.id==='sourceV1')),added=structuredClone(previous);added.id='sourceV2';added.source.version='2';added.source.text+=' New evidence is retained separately.';added.source.sha256=createHash('sha256').update(added.source.text).digest('hex');model.objects.push(added);const next=path.join(project,'next.json');fs.writeFileSync(next,JSON.stringify(model));const nextManifest=path.join(project,'next-manifest.json'),continued=run('compile',next,'-o',nextManifest,'--base-manifest',base,'--expect-revision',compiled.revision);assert.equal(continued.status,0,JSON.stringify(continued));assert.deepEqual(JSON.parse(fs.readFileSync(nextManifest)).model.objects.find(o=>o.id==='sourceV1'),previous);
 model.objects.find(o=>o.id==='sourceV1').source.version='3';fs.writeFileSync(next,JSON.stringify(model));const rejected=path.join(project,'rejected.json'),conflict=run('compile',next,'-o',rejected,'--base-manifest',base,'--expect-revision',compiled.revision);assert.equal(conflict.status,1);assert.ok(conflict.diagnostics.some(d=>d.code==='prd/source-immutable'));assert.equal(fs.existsSync(rejected),false);assert.ok(fs.existsSync(base));
});
