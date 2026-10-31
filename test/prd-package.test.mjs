import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { stageCleanSkill } from '../scripts/stage-clean-skill.mjs';
import { verifyPrdDirectoryExports } from '../scripts/prd-package-smoke.mjs';

test('tracked clean Skill runs PRD CLI without repository dependency ancestry',t=>{
  const repo=fs.realpathSync('.'),scratch=fs.mkdtempSync(path.join(os.tmpdir(),'archify-prd-clean-package-'));t.after(()=>fs.rmSync(scratch,{recursive:true,force:true}));
  assert.ok(path.relative(repo,scratch).startsWith('..'+path.sep),'package must not be under the repository');
  for(let parent=scratch;;parent=path.dirname(parent)){assert.equal(fs.existsSync(path.join(parent,'node_modules')),false,`dependency ancestry: ${parent}`);if(path.dirname(parent)===parent)break;}
  const skill=path.join(scratch,'archify');stageCleanSkill({repoRoot:repo,destination:skill});
  const result=spawnSync(process.execPath,[path.join(repo,'scripts/package-smoke.mjs'),skill,'--prd-only'],{cwd:scratch,encoding:'utf8',env:{...process.env,NODE_PATH:''},timeout:120000});
  assert.equal(result.status,0,result.stderr+'\n'+result.stdout);assert.match(result.stdout,/packaged PRD native reader, strict validation, frozen Markdown projections, (directory exports|fail-closed directory export) and mapped feedback\/proposal passed without dependencies/);
});

test('non-Linux package harness requires the platform diagnostic and preserves destinations',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prd-package-platform-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const results=[],failure={ok:false,diagnostics:[{code:'prd/operation-failed',evidence:{reason:'Create-only directory publication currently requires Linux GNU mv.'}}]};
  const options={platform:'darwin',dir,model:'model.json',policy:'policy.json',internalMd:'internal',publicMd:'public',call:()=>assert.fail('non-Linux must not expect success'),reject:(...args)=>{results.push(args);return failure;}};
  verifyPrdDirectoryExports(options);assert.equal(results.length,4);for(const audience of ['internal','client'])assert.equal(fs.readFileSync(path.join(dir,audience,'sentinel.txt'),'utf8'),'unchanged');
  const other=fs.mkdtempSync(path.join(os.tmpdir(),'prd-package-platform-invalid-'));t.after(()=>fs.rmSync(other,{recursive:true,force:true}));
  assert.throws(()=>verifyPrdDirectoryExports({...options,dir:other,reject:()=>({ok:false,diagnostics:[]})}),/platform diagnostic/);
  assert.throws(()=>verifyPrdDirectoryExports({...options,dir:other,reject:(...args)=>{const target=args[args.indexOf('-o')+1];if(fs.existsSync(target))fs.writeFileSync(path.join(target,'sentinel.txt'),'overwritten');return failure;}}),/changed an existing destination/);
});
