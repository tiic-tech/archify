import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { stageCleanSkill } from '../scripts/stage-clean-skill.mjs';

test('tracked clean Skill runs PRD CLI without repository dependency ancestry',t=>{
  const repo=fs.realpathSync('.'),scratch=fs.mkdtempSync(path.join(os.tmpdir(),'archify-prd-clean-package-'));t.after(()=>fs.rmSync(scratch,{recursive:true,force:true}));
  assert.ok(path.relative(repo,scratch).startsWith('..'+path.sep),'package must not be under the repository');
  for(let parent=scratch;;parent=path.dirname(parent)){assert.equal(fs.existsSync(path.join(parent,'node_modules')),false,`dependency ancestry: ${parent}`);if(path.dirname(parent)===parent)break;}
  const skill=path.join(scratch,'archify');stageCleanSkill({repoRoot:repo,destination:skill});
  const result=spawnSync(process.execPath,[path.join(repo,'scripts/package-smoke.mjs'),skill,'--prd-only'],{cwd:scratch,encoding:'utf8',env:{...process.env,NODE_PATH:''},timeout:120000});
  assert.equal(result.status,0,result.stderr+'\n'+result.stdout);assert.match(result.stdout,/packaged PRD native reader, strict validation, Markdown projections and mapped feedback\/proposal passed without dependencies/);
});
