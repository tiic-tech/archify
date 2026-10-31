import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { windowsRepositoryEvidence } from '../scripts/windows-repository-evidence.mjs';

const repo=path.resolve('.'),cli=path.join(repo,'archify/bin/archify.mjs');
test('Windows evidence fixture derives the inspected origin and still rejects an origin mismatch',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'archify-evidence-origin-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const git=(...args)=>{const r=spawnSync('git',args,{cwd:root,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
  git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');fs.mkdirSync(path.join(root,'archify/bin'),{recursive:true});fs.writeFileSync(path.join(root,'archify/bin/archify.mjs'),'// fixture\n');git('add','.');git('commit','-qm','fixture');
  git('remote','add','origin','https://github.com/example/first.git');
  const diagram=JSON.parse(fs.readFileSync(path.join(repo,'archify/examples/web-app.architecture.json'))),input=path.join(root,'evidence.json');
  diagram.components[0].sources=[{path:'archify/bin/archify.mjs',line:1,label:'Entry'}];
  const validate=()=>spawnSync(process.execPath,[cli,'validate','architecture',input,'--repo-root',root,'--json'],{encoding:'utf8',env:{...process.env,ARCHIFY_UPDATE_CHECK_DISABLED:'1'}});
  for(const origin of ['https://github.com/example/first.git','git@github.com:example/second.git']){
    git('remote','set-url','origin',origin);diagram.meta.repository=windowsRepositoryEvidence(root);assert.equal(diagram.meta.repository.revision,git('rev-parse','HEAD'));fs.writeFileSync(input,JSON.stringify(diagram));
    const matched=validate();assert.equal(matched.status,0,matched.stdout+matched.stderr);
    git('remote','set-url','origin','https://github.com/example/unrelated.git');const mismatch=validate();assert.notEqual(mismatch.status,0);assert.ok(JSON.parse(mismatch.stdout).diagnostics.some(d=>d.code==='repository-evidence/origin-mismatch'));
  }
});
