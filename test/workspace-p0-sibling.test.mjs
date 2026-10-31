import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSiblingBundle } from '../archify/explainer/workspace/sibling-bundle.mjs';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';

const input = JSON.parse(fs.readFileSync(new URL('./fixtures/workspace-p0/maintenance.json',import.meta.url)));
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;

test('bundle rejects an undeclared native target without publishing files', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'p0-sibling-invalid-'));
  t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  const invalid = structuredClone(input);
  invalid.workflow.nodes[0].href = 'missing.html';
  await assert.rejects(buildSiblingBundle(invalid,dir), /Unknown detail target/);
  assert.deepEqual(fs.readdirSync(dir),[]);
});

test('service to native workflow to exact detail and back using real sibling files', {skip:chrome ? false : 'Set ARCHIFY_CHROME for a real browser.'}, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'p0-sibling-'));
  t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  await buildSiblingBundle(input,dir);
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method,params={}) => browser.cdp.send(method,params,session);
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  const run = async expression => {
    const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    assert.equal(result.exceptionDetails,undefined,result.exceptionDetails?.exception?.description);
    return result.result?.value;
  };
  const load = async action => {
    let timer;
    const timeout = new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('page load timed out')),10000);});
    const ready = browser.cdp.waitFor('Page.loadEventFired',session);
    try { await action(); await Promise.race([ready,timeout]); } finally { clearTimeout(timer); }
    await run('document.fonts.ready.then(() => true)');
  };
  const click = async selector => {
    const rect = await run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    assert.ok(rect,selector);
    await send('Input.dispatchMouseEvent',{type:'mousePressed',...rect,button:'left',clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',...rect,button:'left',clickCount:1});
  };
  await load(()=>send('Page.navigate',{url:pathToFileURL(path.join(dir,'service.html')).href+'?theme=dark'}));
  assert.match(await run('document.body.innerText'),/Coordinate requests for maintenance/);
  await load(()=>click('#workspace-bundle-navigation'));
  assert.equal(path.basename(new URL(await run('location.href')).pathname),'workflow.html');
  assert.equal(new URL(await run('location.href')).searchParams.get('theme'),'dark');
  assert.deepEqual(await run('[...new Set([...document.querySelectorAll("svg [data-node-id]")].map(e=>e.dataset.nodeId))].sort()'),['assess','complete','intake']);
  assert.deepEqual(await run('[...new Set([...document.querySelectorAll("svg [data-edge-from][data-edge-to]")].map(e=>e.dataset.edgeFrom+"→"+e.dataset.edgeTo))].sort()'),['assess→complete','intake→assess']);
  await load(()=>click('a[data-archify-drilldown]'));
  const detail = new URL(await run('location.href'));
  assert.equal(path.basename(detail.pathname),'intake.html');
  assert.equal(new URLSearchParams(detail.search).get('from'),'workflow.html?theme=dark');
  assert.match(await run('document.body.innerText'),/records a location and a description before assessment/);
  await load(()=>click('#workspace-bundle-navigation'));
  assert.equal(path.basename(new URL(await run('location.href')).pathname),'workflow.html');
  await click('[data-node-id="assess"]');
  assert.equal(await run('document.querySelectorAll("#focus-drilldowns-list a").length'),2);
  await load(()=>click('#focus-drilldowns-list a:nth-child(2)'));
  assert.match(await run('document.body.innerText'),/Coordinate a suitable time with the facility/);
  await load(()=>click('#workspace-bundle-navigation'));
  // Native keyboard activation opens the same multiple-target Passport.
  await run('document.querySelector(\'svg [data-node-id="assess"]\').focus()');
  for (const type of ['keyDown','keyUp']) await send('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  assert.equal(await run('document.querySelectorAll("#focus-drilldowns-list a").length'),2);
  await run('document.querySelector("#focus-drilldowns-list a").focus()');
  await load(async()=>{for(const type of ['keyDown','keyUp']) await send('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13,...(type==='keyDown'?{text:'\r',unmodifiedText:'\r'}:{})});});
  assert.match(await run('document.body.innerText'),/decide how it should be handled/);
  await load(()=>send('Page.reload'));
  assert.match(await run('document.body.innerText'),/decide how it should be handled/);
  await load(()=>run('history.back()'));
  assert.equal(path.basename(new URL(await run('location.href')).pathname),'workflow.html');
  await load(()=>click('#btn-parent-back'));
  assert.equal(path.basename(new URL(await run('location.href')).pathname),'service.html');
  assert.equal(new URL(await run('location.href')).searchParams.get('theme'),'dark');
  if (process.env.P0_SCREENSHOT_DIR) {
    await load(()=>click('#workspace-bundle-navigation'));
    const image=await send('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(path.join(process.env.P0_SCREENSHOT_DIR,'sibling-workflow-1440.png'),Buffer.from(image.data,'base64'));
  }
});
