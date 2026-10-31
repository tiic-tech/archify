import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ChromeVisualBrowser,findChrome } from '../archify/bin/visual-check.mjs';

const chrome=process.env.ARCHIFY_CHROME?findChrome():null;
test('all search results and evidence remain reachable beyond the old limits',{skip:chrome?false:'Set ARCHIFY_CHROME for a real browser.'},async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prd-scale-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const root=path.resolve('test/fixtures/prd-workspace-reader'),model=JSON.parse(fs.readFileSync(path.join(root,'reader.json'))),original=model.objects.find(o=>o.id==='row');
  for(let i=0;i<36;i++){const source=structuredClone(original);source.id=`extraSource${i}`;source.title=`Synthetic source ${String(i).padStart(2,'0')}`;source.source.recordKey=`extraRecord${i}`;model.objects.push(source);}
  for(const name of ['prototype.png','event-plan.txt'])fs.copyFileSync(path.join(root,name),path.join(dir,name));
  const input=path.join(dir,'model.json'),output=path.join(dir,'reader.html');fs.writeFileSync(input,JSON.stringify(model));
  const build=spawnSync(process.execPath,[path.resolve('archify/bin/archify.mjs'),'prd','build',input,'-o',output,'--json'],{encoding:'utf8',maxBuffer:32*1024*1024});assert.equal(build.status,0,build.stdout+build.stderr);
  const browser=new ChromeVisualBrowser(chrome);t.after(()=>browser.close());const session=await browser.sessionPromise;
  const send=(method,params={})=>browser.cdp.send(method,params,session);
  const val=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.equal(r.exceptionDetails,undefined,r.exceptionDetails?.exception?.description);return r.result?.value;};
  const wait=async expression=>{for(let i=0;i<200;i++){if(await val(expression))return;await new Promise(r=>setTimeout(r,50));}assert.fail(`Timed out: ${expression}`);};
  const click=async selector=>{const p=await val(`(async()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const b=e.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2;return {x,y,hit:e.contains(document.elementFromPoint(x,y))}})()`);assert.ok(p?.hit,`${selector}: ${JSON.stringify(p)}`);for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x:p.x,y:p.y,button:'left',clickCount:1});};
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:pathToFileURL(output).href});await wait('document.querySelectorAll(".catalog-item").length===2');await val('document.querySelector("#search").value="Synthetic source";document.querySelector("#search").dispatchEvent(new Event("input"))');assert.equal(await val('document.querySelectorAll("#search-results button").length'),36);await click('#search-results button:last-child');assert.equal(await val('location.hash'),'');assert.match(await val('document.querySelector("#status").textContent'),/not established/);await click('.catalog-item button');await wait('document.querySelector("#stage").dataset.nativeReady==="chooseNode"');await val('window.savedFrame=document.querySelector("#native")');
  await val('document.querySelector("#search").value="Synthetic source";document.querySelector("#search").dispatchEvent(new Event("input"))');assert.equal(await val('document.querySelectorAll("#search-results button").length'),36);await click('#search-results button:last-child');assert.match(await val('document.querySelector("#detail-content h2").textContent'),/Synthetic source 35/);assert.match(await val('document.querySelector("#detail-content").innerText'),/Project-wide source:.*viewing context only; no association/);await click('#close');
  await click('#host-evidence');await val('Promise.all(document.querySelector("#world").getAnimations().map(a=>a.finished.catch(()=>{})))');const state=await val(`(()=>{const g=document.querySelector('#evidence-group');return {count:g.querySelectorAll('button').length,text:g.innerText,first:g.querySelector('button')?.textContent}})()`);assert.ok(state.count>=36,JSON.stringify(state));assert.match(state.text,/Related to this service:/);assert.match(state.text,/Other project-wide records:/);assert.match(state.text,/Synthetic source 35/);assert.doesNotMatch(state.first,/Synthetic source/);
  await click('#evidence-group button:last-child');assert.match(await val('document.querySelector("#detail-content h2").textContent'),/Synthetic source 35/);assert.match(await val('document.querySelector("#detail-content").innerText'),/Project-wide source:.*viewing context only; no association/);assert.equal(await val('document.querySelectorAll("iframe").length'),1);assert.equal(await val('window.savedFrame===document.querySelector("#native")'),true);await click('#back');await wait('document.querySelector("#detail").hidden');assert.equal(await val('window.savedFrame===document.querySelector("#native")'),true);
});
