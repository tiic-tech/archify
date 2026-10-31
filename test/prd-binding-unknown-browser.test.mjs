import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';
import { preparePrd } from '../archify/explainer/workspace/prd-prepare.mjs';
import { buildPrdReader } from '../archify/explainer/workspace/prd-reader-build.mjs';

test('internal reader shows unknown cells and navigates their explicit question', {skip:process.env.ARCHIFY_CHROME?false:'Set ARCHIFY_CHROME for a real browser.'},async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prd-binding-reader-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const m=JSON.parse(fs.readFileSync('test/fixtures/prd-workspace-reader/reader.json'));
  const binding=m.objects.find(o=>o.id==='chooseBinding'),q=structuredClone(m.objects.find(o=>o.id==='question'));
  q.id='bindingQuestion';q.title='Clarify binding behavior';q.detail.scope=['choose'];q.detail.blocking=false;Object.assign(q.refs.find(r=>r.relation==='target'),{target:'choose',type:'activity'});m.objects.push(q);
  for(const k of ['visibility','editable','required'])binding.detail[k]={question:q.id};
  for(const [from,to] of [['test/fixtures/prd-workspace/event-plan.txt','event-plan.txt'],['test/fixtures/prd-workspace-reader/prototype.png','prototype.png']])fs.copyFileSync(from,path.join(dir,to));
  const input=path.join(dir,'model.json');fs.writeFileSync(input,JSON.stringify(m));const prepared=await preparePrd(m,{inputPath:input});assert.equal(prepared.ok,true,JSON.stringify(prepared.diagnostics));
  const reader=path.join(dir,'reader.html');fs.writeFileSync(reader,await buildPrdReader(prepared.manifest,{audience:'internal',inputPath:input}));
  const browser=new ChromeVisualBrowser(findChrome());t.after(()=>browser.close());const session=await browser.sessionPromise,send=(method,params={})=>browser.cdp.send(method,params,session),val=async(expression)=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.equal(r.exceptionDetails,undefined,r.exceptionDetails?.exception?.description);return r.result?.value;},wait=async(expression)=>{for(let i=0;i<160;i++){if(await val(expression))return;await new Promise(r=>setTimeout(r,50));}assert.fail(expression);};
  const url=new URL(pathToFileURL(reader));url.hash='s=service&v=workflowView&t=choose/chooseBinding';await send('Page.navigate',{url:url.href});await wait('document.querySelector("#detail")&&!document.querySelector("#detail").hidden');
  const text=await val('document.querySelector("#detail-content").innerText');assert.match(text,/visibility[\s\S]*?TBC[\s\S]*?bindingQuestion/);assert.match(text,/editable[\s\S]*?TBC/);assert.match(text,/required[\s\S]*?TBC/);
  assert.match(text,/unresolved binding question/);await val('document.querySelector("#detail-content [data-object=bindingQuestion]").click()');await wait('document.querySelector("#detail-content h2")?.textContent==="Clarify binding behavior"');
});
