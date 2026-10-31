import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildWorkspace} from '../archify/explainer/workspace/build.mjs';
import {ChromeVisualBrowser,findChrome} from '../archify/bin/visual-check.mjs';
import {nativePhysicalClick} from './helpers/native-physical-click.mjs';

const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/workspace-p0/maintenance.json',import.meta.url)));
const chrome=process.env.ARCHIFY_CHROME?findChrome():null;

test('workspace build rejects unsafe and unbound targets before producing an artifact',async()=>{
  for(const target of ['../escape.html','absent.html']){const input=structuredClone(fixture);input.workflow.nodes[0].href=target;await assert.rejects(buildWorkspace(input),/target/);}
  const input=structuredClone(fixture);input.workspace.activities[0].node='missing';await assert.rejects(buildWorkspace(input),/binding/);
  const unsupported=structuredClone(fixture);unsupported.details[0].document.panels[0].blocks[0]={id:'unsupported',type:'list',items:['One']};await assert.rejects(buildWorkspace(unsupported),/prose blocks only/);
});

test('opaque native workspace supports real navigation, trust checks, cameras and export',{skip:chrome?false:'Set ARCHIFY_CHROME for a real browser.'},async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'p0-host-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'workspace.html');fs.writeFileSync(file,await buildWorkspace(fixture));
  const browser=new ChromeVisualBrowser(chrome);t.after(()=>browser.close());const session=await browser.sessionPromise;
  const send=(method,params={},s=session)=>browser.cdp.send(method,params,s);
  const value=async(expression,s=session)=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},s);assert.equal(result.exceptionDetails,undefined,result.exceptionDetails?.exception?.description);return result.result?.value;};
  const wait=async(expression,s=session)=>{let result;for(let i=0;i<120;i++){result=await value(expression,s);if(result)return result;await new Promise(resolve=>setTimeout(resolve,50));}assert.fail(`Timed out: ${expression}; last=${JSON.stringify(result)}`);};
  const navigate=async url=>{let timer;const loaded=browser.cdp.waitFor('Page.loadEventFired',session);const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('load timeout')),10000);});try{await send('Page.navigate',{url});await Promise.race([loaded,timeout]);}finally{clearTimeout(timer);}await wait('document.querySelector("#stage")?.dataset.nativeReady==="intake"');};
  const click=async(selector,s=session)=>{if(s!==session)return nativePhysicalClick({selector,child:s,send,value,wait,scroll:false});const r=await value(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);assert.ok(r,selector);for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...r,button:'left',clickCount:1});};
  const key=async(key)=>{for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key,code:key,windowsVirtualKeyCode:key==='Enter'?13:0,...(key==='Enter'&&type==='keyDown'?{text:'\r',unmodifiedText:'\r'}:{})});};
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await navigate(pathToFileURL(file).href+'?theme=dark');
  assert.equal(await value('document.querySelector("#native").getAttribute("sandbox")'),'allow-scripts allow-downloads allow-modals');
  assert.equal(await value('document.querySelectorAll("iframe").length'),1);
  const parent=await send('Page.getFrameTree');
  let target;for(let i=0;i<100;i++){target=(await send('Target.getTargets')).targetInfos.find(e=>e.type==='iframe'&&e.parentId===parent.frameTree.frame.id&&e.url.startsWith('about:srcdoc'));if(target)break;await new Promise(r=>setTimeout(r,50));}assert.ok(target,'opaque frame target');
  const attached=await send('Target.attachToTarget',{targetId:target.targetId,flatten:true});const child=attached.sessionId;t.after(()=>send('Target.detachFromTarget',{sessionId:child}).catch(()=>{}));await send('Runtime.enable',{},child);
  for(const viewport of [{width:1440,height:1000},{width:1280,height:800}]) {
    await send('Emulation.setDeviceMetricsOverride',{...viewport,deviceScaleFactor:1,mobile:false});
    await value('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',child);
    const exact=await value(`(()=>{const e=document.querySelector('svg [data-node-id="intake"]'),r=e.getBoundingClientRect(),c=e.closest('.diagram-container').getBoundingClientRect(),text=e.querySelector('text'),m=text.getScreenCTM();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,w:r.width,h:r.height,visible:r.left>=Math.max(0,c.left)-1&&r.right<=Math.min(innerWidth,c.right)+1&&r.top>=Math.max(0,c.top)-1&&r.bottom<=Math.min(innerHeight,c.bottom)+1,textPx:parseFloat(getComputedStyle(text).fontSize)*Math.hypot(m.a,m.b)}})()`,child);
    const outer=await value(`(()=>{const f=document.querySelector('#native'),r=f.getBoundingClientRect(),c=document.querySelector('#stage').getBoundingClientRect();return {left:r.left,top:r.top,scale:r.width/f.offsetWidth,clip:{left:c.left,top:c.top,right:c.right,bottom:c.bottom}}})()`);
    const labels=await value(`Array.from(document.querySelectorAll('.diagram-container > svg text')).filter(e=>e.textContent.trim()).map(e=>{const m=e.getScreenCTM();return {text:e.textContent.trim(),px:parseFloat(getComputedStyle(e).fontSize)*Math.hypot(m.a,m.b)}})`,child);
    const b={left:outer.left+exact.left*outer.scale,right:outer.left+exact.right*outer.scale,top:outer.top+exact.top*outer.scale,bottom:outer.top+exact.bottom*outer.scale};
    assert.ok(labels.length&&labels.every(label=>label.px*outer.scale>=12),JSON.stringify({viewport,labels}));
    assert.ok(exact.w>0&&exact.h>0&&exact.visible&&exact.textPx*outer.scale>=12&&b.left>=outer.clip.left-1&&b.right<=Math.min(viewport.width,outer.clip.right)+1&&b.top>=outer.clip.top-1&&b.bottom<=Math.min(viewport.height,outer.clip.bottom)+1,JSON.stringify({viewport,exact,outer,b}));
    if(viewport.width===1280) {
      // The lower native toolbar is below the stage at this height. Pan empty host canvas to expose it.
      const x=viewport.width-20,y=500;
      assert.equal(await value(`document.elementFromPoint(${x},${y}).id`),'world');
      await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
      await send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y:y-80,buttons:1});
      await send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y:y-80,button:'left',clickCount:1});
      await wait('document.querySelector("#world").style.transform.includes("-80px")');
      await value('Promise.all(document.querySelector("#world").getAnimations().map(a=>a.finished.catch(()=>{})))');
    }
    const nativeClick=selector=>nativePhysicalClick({selector,child,send,value,wait,scroll:false,viewport});
    const scale=await value('Archify.view.state().scale',child);
    await nativeClick('[data-view="in"]');await wait(`Archify.view.state().scale>${scale}`,child);
    await nativeClick('[data-view="out"]');await wait(`Archify.view.state().scale===${scale}`,child);
    await value('Promise.all(document.querySelector(".diagram-container > svg").getAnimations().filter(a=>a.transitionProperty==="transform").map(a=>a.finished.catch(()=>{})))',child);
    if(viewport.width===1280){await click('#reset');await value('Promise.all(document.querySelector("#world").getAnimations().map(a=>a.finished.catch(()=>{})))');}
  }
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await value('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',child);
  await value('document.querySelector("#stage").focus()');
  for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:'+',code:'Equal',windowsVirtualKeyCode:187});
  assert.equal(await value('document.querySelector("#zoom-label").textContent'),'110%');await click('#reset');
  await value('Promise.all(document.querySelector("#world").getAnimations().map(a=>a.finished.catch(()=>{})))');
  const framePoint=await value(`(()=>{const r=document.querySelector('#native').getBoundingClientRect();return {x:r.x+100,y:r.y+100}})()`);
  const scrollBefore=await value('scrollY',child),transformBefore=await value('document.querySelector("#world").style.transform');
  await send('Input.dispatchMouseEvent',{type:'mouseWheel',...framePoint,deltaX:0,deltaY:260});
  await wait(`scrollY>${scrollBefore}`,child);assert.equal(await value('document.querySelector("#world").style.transform'),transformBefore,'ordinary wheel remains native scrolling');
  await value('scrollTo(0,0)',child);await wait('scrollY===0',child);
  const initialCamera=await value('Archify.view.state().scale',child);
  assert.equal(await value('(()=>{const e=document.querySelector(\'svg [data-node-id="assess"]\');e.focus();return document.activeElement===e})()',child),true);
  for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:'+',code:'Equal',windowsVirtualKeyCode:187});
  await wait(`Archify.view.state().scale>${initialCamera}`,child);
  assert.equal(await value('document.querySelector("#world").style.transform'),transformBefore,'native keyboard zoom must not alter the host');
  for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:'-',code:'Minus',windowsVirtualKeyCode:189});
  await wait(`Archify.view.state().scale===${initialCamera}`,child);
  await value('Promise.all(document.querySelector(".diagram-container > svg").getAnimations().filter(a=>a.transitionProperty==="transform").map(a=>a.finished.catch(()=>{})))',child);
  await value('scrollTo(0,0)',child);await wait('scrollY===0',child);
  const savedCamera=await value('JSON.stringify(Archify.view.state())',child);
  const stageBox=await value(`(()=>{const r=document.querySelector('#stage').getBoundingClientRect();return {x:r.left+300,y:r.bottom-40}})()`);
  await send('Input.dispatchMouseEvent',{type:'mousePressed',...stageBox,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:stageBox.x+35,y:stageBox.y-20,button:'left',buttons:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:stageBox.x+35,y:stageBox.y-20,button:'left',clickCount:1});
  assert.match(await value('document.querySelector("#world").style.transform'),/translate\(35px, -20px\)/);
  await click('#zoom-in');const hostCamera=await value('document.querySelector("#world").style.transform');
  const fr=await value(`(()=>{const r=document.querySelector('#native').getBoundingClientRect();return {x:r.x+200,y:r.y+200}})()`);
  await send('Input.dispatchMouseEvent',{type:'mouseWheel',...fr,deltaX:0,deltaY:80,modifiers:2});
  assert.equal(await value('document.querySelector("#world").style.transform'),hostCamera,'wheel over native frame must not zoom host');
  await value('document.querySelector(\'svg [data-node-id="intake"]\').scrollIntoView({block:"center"})',child);
  await value('Promise.all(document.querySelector("#world").getAnimations().map(a=>a.finished.catch(()=>{})))');
  await value('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',child);const savedScroll=await value('scrollY',child);
  // Real pointer activation of the native single target enters the host instead of leaving srcdoc.
  await click('a[data-archify-drilldown]',child);await wait('!document.querySelector("#detail").hidden');
  assert.equal(await value('document.querySelector("#world").inert'),true);
  assert.match(await value('document.querySelector("#activity").innerText'),/Capture enough information/);
  assert.match(await value('document.querySelector("#content").innerText'),/Record the reported issue/);
  assert.match(await value('document.querySelector("#content").innerText'),/The dispatcher records a location and a description before assessment\./);
  assert.match(await value('document.querySelector(\'[data-child="location"]\').innerText'),/Identify the facility area/);
  await click('[data-child="location"]');
  assert.equal(await value('document.querySelector("#content .current").dataset.detailId'),'location');
  assert.match(await value('document.querySelector(\'[data-child="location-note"]\').innerText'),/Describe where the technician should look/);
  await click('[data-child="location-note"]');
  const trail=await value('document.querySelector("#detail").innerText');
  assert.match(trail,/Receive request/);assert.match(trail,/Record the reported issue/);assert.match(trail,/Identify the facility area/);assert.match(trail,/Describe where the technician/);
  const deep=await value('location.href');
  assert.equal(await value('document.querySelector("#content .current").dataset.detailId'),'location-note');
  await click('#back');await wait('document.querySelector("#content .current")?.dataset.detailId==="location"');assert.match(await value('document.querySelector("#content .current").innerText'),/Identify the facility area/);
  assert.equal(await value('document.activeElement?.dataset.child'),'location-note');
  await value('history.forward()');await wait('document.querySelector("#content .current")?.dataset.detailId==="location-note"');
  await value('history.back()');await wait('document.querySelector("#content .current")?.dataset.detailId==="location"');
  await click('#zoom-out');await click('#close');await wait('document.querySelector("#detail").hidden');
  assert.equal(await value('document.querySelector("#world").inert'),false);
  assert.equal(await value('document.querySelector("#world").style.transform'),hostCamera);
  assert.equal(await value('JSON.stringify(Archify.view.state())',child),savedCamera);assert.equal(await value('scrollY',child),savedScroll);
  await wait('document.activeElement?.getAttribute("data-node-id")==="intake"',child);
  await key('Enter');await wait('!document.querySelector("#detail").hidden');assert.match(await value('document.querySelector("#content").innerText'),/Record the reported issue/);
  await value('history.back()');await wait('document.querySelector("#detail").hidden');await wait('document.activeElement?.getAttribute("data-node-id")==="intake"',child);
  assert.equal(await value('document.querySelector("#world").style.transform'),hostCamera);
  await value('Promise.all(document.querySelector("#world").getAnimations().map(a=>a.finished.catch(()=>{})))');
  // Both pointer and keyboard use the native multi-target Passport links.
  await value('document.querySelector(\'svg [data-node-id="assess"]\').scrollIntoView({block:"center"})',child);
  await value('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',child);
  await click('svg [data-node-id="assess"]',child);await wait('document.querySelectorAll("#focus-drilldowns-list a").length===2',child);
  await click('#focus-drilldowns-list a:first-child',child);await wait('!document.querySelector("#detail").hidden');assert.match(await value('document.querySelector("#content").innerText'),/Review the reported issue/);await click('#close');
  await wait('document.querySelector("#focus-id")?.textContent.trim()==="assess" && !document.querySelector("#focus-drilldowns").hidden && document.querySelectorAll("#focus-drilldowns-list a").length===2',child);
  assert.equal(await value('(()=>{const e=document.querySelector("#focus-drilldowns-list a:nth-child(2)");e.focus();return document.activeElement===e})()',child),true);await key('Enter');
  await wait('!document.querySelector("#detail").hidden');assert.match(await value('document.querySelector("#content").innerText'),/Arrange a suitable time/);
  await click('#close');
  // Obtain the live token from the isolated frame for adversarial protocol probes.
  // This inspector access is test-only; the host never accesses child DOM.
  const token=await value(`(()=>{const s=[...document.scripts].map(e=>e.textContent).find(s=>s.includes('workspaceBridge'));return s.match(/[0-9a-f]{32}/)[0]})()`,child);assert.equal(token.length,32);
  const probe=async expression=>{await value('document.querySelector("#status").textContent="Awaiting probe"');await value(expression,child);await wait('document.querySelector("#status").textContent.startsWith("Ignored")');assert.equal(await value('document.querySelector("#detail").hidden'),true);};
  await probe(`parent.postMessage({kind:'p0-activate',token:'stale',node:'intake',target:'intake.html'},'*')`);
  await probe(`parent.postMessage({kind:'p0-activate',token:${JSON.stringify(token)},node:'assess',target:'intake.html'},'*')`);
  await probe(`parent.postMessage({kind:'p0-activate',token:${JSON.stringify(token)},node:'intake',target:'missing.html'},'*')`);
  await probe(`parent.postMessage({kind:'p0-activate',token:${JSON.stringify(token)},node:'intake',target:'../intake.html'},'*')`);
  await probe(`parent.postMessage({kind:'p0-activate',token:${JSON.stringify(token)},node:'intake',target:'intake.html',extra:true},'*')`);
  await value('document.querySelector("#status").textContent="Awaiting probe"');await value(`window.postMessage({kind:'p0-activate',token:${JSON.stringify(token)},node:'intake',target:'intake.html'},'*')`);await wait('document.querySelector("#status").textContent.includes("untrusted")');assert.equal(await value('document.querySelector("#detail").hidden'),true);
  // Native parent control is contained by the host rather than navigating srcdoc away.
  assert.equal(await value('(()=>{const e=document.querySelector("#btn-parent-back");e.focus();return document.activeElement===e})()',child),true);
  await value('document.querySelector("#status").textContent="Awaiting parent"');await key('Enter');
  await wait('document.querySelector("#status").textContent.includes("Already at")');assert.equal(await value('document.querySelectorAll("iframe").length'),1);
  // Canonical native SVG export runs inside the actual isolated Viewer.
  const exported=await value(`(async()=>{let blob;const create=URL.createObjectURL,click=HTMLAnchorElement.prototype.click;URL.createObjectURL=x=>{blob=x;return create.call(URL,x)};HTMLAnchorElement.prototype.click=function(){};try{await Archify.exportMenu.run('svg')}finally{URL.createObjectURL=create;HTMLAnchorElement.prototype.click=click}return blob&&await blob.text()})()`,child);
  assert.match(exported,/data-node-id="intake"/);assert.match(exported,/intake\.html/);assert.doesNotMatch(exported,/Activity details|workspace-bundle-navigation|p0-activate/);
  await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:dir});
  assert.equal(await value('(()=>{const e=document.querySelector("#btn-export");e.focus();return document.activeElement===e})()',child),true);await key('Enter');await wait('document.querySelector("#btn-export").getAttribute("aria-expanded")==="true"',child);
  assert.equal(await value('(()=>{const e=document.querySelector(\'[data-format="svg"]\');e.focus();return document.activeElement===e})()',child),true);await key('Enter');
  let downloaded;for(let i=0;i<100;i++){downloaded=fs.readdirSync(dir).find(name=>name.endsWith('.svg'));if(downloaded)break;await new Promise(r=>setTimeout(r,50));}
  assert.ok(downloaded,'native SVG download must complete');const svg=fs.readFileSync(path.join(dir,downloaded),'utf8');assert.match(svg,/data-node-id="intake"/);assert.doesNotMatch(svg,/Activity details|p0-activate/);
  // Deep links reconstruct the same parent/child context after a fresh page load.
  await send('Target.detachFromTarget',{sessionId:child});
  const deepUrl=new URL(deep);deepUrl.searchParams.set('reopen','1');await navigate(deepUrl.href);assert.match(await value('document.querySelector("#detail").innerText'),/Describe where the technician/);
  const reloaded=browser.cdp.waitFor('Page.loadEventFired',session);let reloadTimer;try{await send('Page.reload');await Promise.race([reloaded,new Promise((_,reject)=>{reloadTimer=setTimeout(()=>reject(new Error('reload timeout')),10000);})]);}finally{clearTimeout(reloadTimer);}await wait('document.querySelector("#stage")?.dataset.nativeReady==="intake"');assert.match(await value('document.querySelector("#detail").innerText'),/Describe where the technician/);
  assert.equal(await value('document.querySelectorAll("iframe").length'),1);
  await value('Promise.all(document.querySelector("#detail").getAnimations().map(a=>a.finished.catch(()=>{})))');
  if(process.env.P0_SCREENSHOT_DIR){const png=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(process.env.P0_SCREENSHOT_DIR,'host-detail-1440.png'),Buffer.from(png.data,'base64'));}
  // Reduced motion is an actual CSS path, not just a source assertion.
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  assert.equal(await value('getComputedStyle(document.querySelector("#detail")).animationName'),'none');
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
  await value('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const save=async name=>{if(process.env.P0_SCREENSHOT_DIR)fs.writeFileSync(path.join(process.env.P0_SCREENSHOT_DIR,name),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));};
  await save('host-detail-1280.png');
  // A fresh deep link has no host-owned parent entries: repeated Back must still climb the trail.
  await click('#back');await wait('document.querySelector("#content .current")?.dataset.detailId==="location"');
  assert.equal(await value('document.activeElement?.dataset.child'),'location-note');
  await click('#back');await wait('document.querySelector("#content .current")?.dataset.detailId==="intake.html"');
  assert.equal(await value('document.activeElement?.dataset.child'),'location');
  await save('host-related-1280.png');
  if(process.env.P0_SCREENSHOT_DIR){
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await value('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await save('host-related-1440.png');
    await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});await value('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  }
  await click('[data-child="location"]');await wait('document.querySelector("#content .current")?.dataset.detailId==="location"');
  await click('[data-child="location-note"]');await wait('document.querySelector("#content .current")?.dataset.detailId==="location-note"');
  // Revoke while a detail is open: Close, history and forged late messages must not hide the recovery instruction.
  const beforeRevocation=await send('Page.getFrameTree');let liveTarget;
  for(let i=0;i<100;i++){liveTarget=(await send('Target.getTargets')).targetInfos.find(e=>e.type==='iframe'&&e.parentId===beforeRevocation.frameTree.frame.id&&e.url.startsWith('about:srcdoc'));if(liveTarget)break;await new Promise(r=>setTimeout(r,50));}assert.ok(liveTarget);
  const liveSession=(await send('Target.attachToTarget',{targetId:liveTarget.targetId,flatten:true})).sessionId;
  const oldToken=await value(`(()=>{const s=[...document.scripts].map(e=>e.textContent).find(s=>s.includes('workspaceBridge'));return s.match(/[0-9a-f]{32}/)[0]})()`,liveSession);
  await send('Target.detachFromTarget',{sessionId:liveSession});
  await value('window.__p0OldFrame=document.querySelector("#native").contentWindow;document.querySelector("#native").srcdoc="<p>replacement</p>"');
  await wait('document.querySelectorAll("iframe").length===0');
  const unavailable=()=>value('document.querySelector("#status").textContent');
  assert.match(await unavailable(),/unavailable.*Reload workspace/);assert.equal(await value('document.querySelector("#reload-workspace").hidden'),false);
  await click('#close');assert.equal(await value('document.querySelector("#detail").hidden'),true);assert.match(await unavailable(),/unavailable.*Reload workspace/);
  await value(`window.dispatchEvent(new MessageEvent('message',{source:window.__p0OldFrame,data:{kind:'p0-activate',token:${JSON.stringify(oldToken)},node:'intake',target:'intake.html'}}))`);
  assert.equal(await value('document.querySelector("#detail").hidden'),true);assert.match(await unavailable(),/unavailable.*Reload workspace/);
  await value('history.back()');await wait('document.querySelector("#content .current")?.dataset.detailId==="location-note" && !document.querySelector("#detail").hidden');assert.match(await unavailable(),/unavailable.*Reload workspace/);
  // Back is at the top of the scrollable detail; expose it before the physical click.
  await value('document.querySelector("#detail").scrollTo({top:0,behavior:"instant"})');await wait('document.querySelector("#detail").scrollTop===0');
  const hit=await value(`(()=>{const e=document.querySelector('#back'),r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return {x,y,hit:document.elementFromPoint(x,y)?.outerHTML,scrollY,detailScroll:document.querySelector('#detail').scrollTop}})()`);assert.match(hit.hit||'',/id="back"/,JSON.stringify(hit));
  await click('#back');await wait('document.querySelector("#content .current")?.dataset.detailId==="location"');assert.match(await unavailable(),/unavailable.*Reload workspace/);
  await click('#close');assert.match(await unavailable(),/unavailable.*Reload workspace/);
  const restoredLoad=browser.cdp.waitFor('Page.loadEventFired',session);let restoreTimer;
  try{await click('#reload-workspace');await Promise.race([restoredLoad,new Promise((_,reject)=>{restoreTimer=setTimeout(()=>reject(new Error('recovery reload timeout')),10000);})]);}finally{clearTimeout(restoreTimer);}
  await wait('document.querySelector("#stage")?.dataset.nativeReady==="intake"');assert.equal(await value('document.querySelectorAll("iframe").length'),1);assert.equal(await value('document.querySelector("#reload-workspace").hidden'),true);
  const restoredTree=await send('Page.getFrameTree');let restoredTarget;
  for(let i=0;i<100;i++){restoredTarget=(await send('Target.getTargets')).targetInfos.find(e=>e.type==='iframe'&&e.parentId===restoredTree.frameTree.frame.id&&e.url.startsWith('about:srcdoc'));if(restoredTarget)break;await new Promise(r=>setTimeout(r,50));}assert.ok(restoredTarget);
  const restoredSession=(await send('Target.attachToTarget',{targetId:restoredTarget.targetId,flatten:true})).sessionId;
  try {
    const newToken=await value(`(()=>{const s=[...document.scripts].map(e=>e.textContent).find(s=>s.includes('workspaceBridge'));return s.match(/[0-9a-f]{32}/)[0]})()`,restoredSession);assert.notEqual(newToken,oldToken);
    await value(`parent.postMessage({kind:'p0-activate',token:${JSON.stringify(oldToken)},node:'intake',target:'intake.html'},'*')`,restoredSession);
    await wait('document.querySelector("#status").textContent.includes("stale")');assert.equal(await value('document.querySelector("#detail").hidden'),true);
    assert.equal(await value('(()=>{const e=document.querySelector(\'svg [data-node-id="intake"]\');e.focus();return document.activeElement===e})()',restoredSession),true);await key('Enter');
    await wait('!document.querySelector("#detail").hidden');assert.match(await value('document.querySelector("#activity").innerText'),/Capture enough information/);
  } finally {await send('Target.detachFromTarget',{sessionId:restoredSession});}
  const stale=new URL(pathToFileURL(file).href);stale.searchParams.set('case','stale');stale.hash='node=intake&target=missing.html&trail=';await send('Page.navigate',{url:stale.href});await wait('document.querySelector("#status")?.textContent.includes("stale")');
  assert.equal(await value('document.querySelector("#detail").hidden'),true);
  const contextUrl=pathToFileURL(file).href+'?theme=dark&embed=1&present=1';await navigate(contextUrl);
  const contextTree=await send('Page.getFrameTree');let contextTarget;
  for(let i=0;i<100;i++){contextTarget=(await send('Target.getTargets')).targetInfos.find(e=>e.type==='iframe'&&e.parentId===contextTree.frameTree.frame.id&&e.url.startsWith('about:srcdoc'));if(contextTarget)break;await new Promise(r=>setTimeout(r,50));}assert.ok(contextTarget);
  const contextSession=(await send('Target.attachToTarget',{targetId:contextTarget.targetId,flatten:true})).sessionId;
  try{const state=await value('({theme:document.documentElement.dataset.theme,embed:document.documentElement.dataset.embed,present:document.documentElement.dataset.present,pressed:document.querySelector("#btn-theme").getAttribute("aria-pressed")})',contextSession);assert.deepEqual(state,{theme:'dark',embed:'true',present:'true',pressed:'false'});}finally{await send('Target.detachFromTarget',{sessionId:contextSession});}
});
