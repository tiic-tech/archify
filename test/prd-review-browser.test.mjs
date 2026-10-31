import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';

const chrome=process.env.ARCHIFY_CHROME?findChrome():null,cli=path.resolve('archify/bin/archify.mjs'),fixture=path.resolve('test/fixtures/prd-workspace-reader');
const run=(...args)=>{const p=spawnSync(process.execPath,[cli,'prd',...args,'--json'],{encoding:'utf8',maxBuffer:32*1024*1024});assert.equal(p.stderr,'');assert.ok(p.stdout);return {status:p.status,...JSON.parse(p.stdout)};};
const write=(file,data)=>fs.writeFileSync(file,JSON.stringify(data));

test('reader displays real model review lineage and located gap proposals as inert data',{skip:chrome?false:'Set ARCHIFY_CHROME for a real browser.'},async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prd-review-reader-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  for(const name of ['event-plan.txt','prototype.png'])fs.copyFileSync(path.join(fixture,name),path.join(dir,name));
  const model=JSON.parse(fs.readFileSync(path.join(fixture,'reader.json')));model.workspaceId='0e86d10a-6c82-4ffc-a0b0-3ca5267f855e';
  const input=path.join(dir,'model.json'),store=path.join(dir,'store.json'),pkg=path.join(dir,'comments.json');write(input,model);
  const valid=run('validate',input);assert.equal(valid.status,0,JSON.stringify(valid));const rule=model.objects.find(o=>o.id==='sessionRule');
  write(pkg,{kind:'archify-prd-feedback',schemaVersion:1,workspaceId:model.workspaceId,comments:[{id:'commentReview',objectId:rule.id,baseRevision:valid.revision,quoteSnapshot:{path:'/rule/effect',text:rule.rule.effect},author:'Reviewer',time:'2026-10-29T01:00:00Z',body:'Literal text',state:'open'}]});
  const imported=run('feedback','import',pkg,'--model',input,'-o',store);assert.equal(imported.status,0,JSON.stringify(imported));
  const request=path.join(dir,'request.json'),proposal=path.join(dir,'proposal.json'),updated=path.join(dir,'updated.json'),output=path.join(dir,'reader.html');
  const old=rule.rule.effect,attack='Clarified value <script>window.prdInjected=1</script>';
  write(request,{kind:'archify-prd-change-request',schemaVersion:1,workspaceId:model.workspaceId,proposalId:'rulePatch',baseRevision:valid.revision,storeRevision:imported.revision,objectId:rule.id,operation:'replace',path:'/rule/effect',oldValue:old,oldHash:createHash('sha256').update(JSON.stringify(old)).digest('hex'),newValue:attack,commentIds:['commentReview']});
  assert.equal(run('feedback','propose',request,'--model',input,'--store',store,'--expect-store',imported.revision,'-o',proposal).status,0);
  assert.equal(run('feedback','apply',proposal,'--model',input,'--store',store,'--expect-store',imported.revision,'-o',updated).status,0);
  const built=run('build',updated,'-o',output);assert.equal(built.status,0,JSON.stringify(built));
  const browser=new ChromeVisualBrowser(chrome);t.after(()=>browser.close());const session=await browser.sessionPromise,send=(method,params={})=>browser.cdp.send(method,params,session);
  const val=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.equal(r.exceptionDetails,undefined,r.exceptionDetails?.exception?.description);return r.result?.value;};
  const wait=async expression=>{for(let i=0;i<200;i++){if(await val(expression))return;await new Promise(r=>setTimeout(r,50));}assert.fail(`Timed out: ${expression}`);};
  const navigate=async(trail,title)=>{const url=new URL(pathToFileURL(output));url.hash=`s=service&v=workflowView&t=${trail}`;await send('Page.navigate',{url:url.href});await wait(`document.querySelector('#detail') && !document.querySelector('#detail').hidden && document.querySelector('#detail-content h2')?.textContent===${JSON.stringify(title)}`);};
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await navigate('sessionRule','Session requirement');const history=await val('document.querySelector("[data-review-history]")?.textContent');assert.match(history,/rulePatch/);assert.ok(history.includes(old));assert.ok(history.includes(attack));assert.match(history,/commentReview/);assert.match(history,/row/);assert.equal(await val('window.prdInjected'),undefined);
  assert.match(await val('document.querySelector("[data-review-status]")?.textContent'),/Semantic causes: rulePatch/);
  await navigate('dialog','Reservation dialog');assert.match(await val('document.querySelector("[data-review-status]")?.textContent'),/Containing context summary: rulePatch/);
  await navigate('save','Save reservation');const gaps=await val('document.querySelector("[data-gap-questions]")?.textContent');assert.match(gaps,/permission/i);assert.match(gaps,/proposals, not answers/i);
});
