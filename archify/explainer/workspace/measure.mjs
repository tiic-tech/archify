// Reproducible local P0 observer. Child inspection is CDP test instrumentation,
// never part of the workspace host or its frame bridge.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {ChromeVisualBrowser,findChrome} from '../../bin/visual-check.mjs';

if(process.argv.length!==5) throw new Error('Usage: node measure.mjs WORKSPACE.html INPUT.json EMPTY_EVIDENCE_DIRECTORY');
const [artifact,input,dir]=process.argv.slice(2).map(p=>path.resolve(p));
if(!fs.statSync(dir).isDirectory()||fs.readdirSync(dir).length)throw new Error('Evidence directory must be empty.');
const chrome=findChrome();if(!chrome)throw new Error('Set ARCHIFY_CHROME to an executable browser.');
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const probe=JSON.parse(fs.readFileSync(input,'utf8')).workspace.activities[0].node;
const result={identity:{node:process.version,platform:process.platform,arch:process.arch,os:os.release(),chrome,chromeVersion:execFileSync(chrome,['--version'],{encoding:'utf8'}).trim(),artifactSha256:sha(artifact),artifactBytes:fs.statSync(artifact).size,inputSha256:sha(input),fontconfig:process.env.FONTCONFIG_FILE||null,libraryPath:process.env.LD_LIBRARY_PATH||null,iterations:{cold:3,warm:5},definition:'Cold creates a Chrome process; warm reuses one process and navigates from about:blank. User readiness uses navigation timing, not builder or process startup.'},samples:[]};
async function makeBrowser(){const start=performance.now(),browser=new ChromeVisualBrowser(chrome);await browser.sessionPromise;return {browser,setupMs:performance.now()-start};}
async function sample(browser,viewport,mode,index,setupMs){
  const session=await browser.sessionPromise,send=(m,p={},s=session)=>browser.cdp.send(m,p,s);
  const evaluate=async(e,s=session)=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true},s);if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;};
  await send('Emulation.setDeviceMetricsOverride',{...viewport,deviceScaleFactor:1,mobile:false});
  const loaded=browser.cdp.waitFor('Page.loadEventFired',session);let timer;
  try{await send('Page.navigate',{url:pathToFileURL(artifact).href+'?theme=light'});await Promise.race([loaded,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('navigation timeout')),10000);})]);}finally{clearTimeout(timer);}
  let host;for(let n=0;n<200;n++){host=await evaluate(`(()=>{const s=document.querySelector('#stage');if(!s||s.dataset.hostReady!=='true'||s.dataset.nativeReady!==${JSON.stringify(probe)})return null;const f=document.querySelector('#native'),r=f.getBoundingClientRect(),c=s.getBoundingClientRect();return {hostMs:Number(s.dataset.hostReadyAt),nativeMs:Number(s.dataset.readyAt),nativeBridgeMs:Number(s.dataset.nativeElapsed),frameRect:{left:r.left,top:r.top,scale:r.width/f.offsetWidth},stageRect:{left:c.left,top:c.top,right:c.right,bottom:c.bottom},dom:document.querySelectorAll('*').length,activeFrames:[...document.querySelectorAll('iframe')].filter(e=>e.getBoundingClientRect().width>0&&getComputedStyle(e).display!=='none').length,inactiveFrames:[...document.querySelectorAll('iframe')].filter(e=>!e.getBoundingClientRect().width||getComputedStyle(e).display==='none').length,resourceEntries:performance.getEntriesByType('resource').length,heapBytes:performance.memory?.usedJSHeapSize||null}})()`);if(host)break;await new Promise(r=>setTimeout(r,50));}
  if(!host)throw new Error('Host or exact native node did not become ready in 10 seconds.');
  const tree=await send('Page.getFrameTree');let target;
  for(let n=0;n<100;n++){target=(await send('Target.getTargets')).targetInfos.find(e=>e.type==='iframe'&&e.parentId===tree.frameTree.frame.id&&e.url.startsWith('about:srcdoc'));if(target)break;await new Promise(r=>setTimeout(r,50));}
  if(!target)throw new Error('Native frame target unavailable.');
  const attached=await send('Target.attachToTarget',{targetId:target.targetId,flatten:true});let child;
  try{child=await evaluate(`(()=>{const e=[...document.querySelectorAll('svg [data-node-id]')].find(node=>node.dataset.nodeId===${JSON.stringify(probe)}),r=e.getBoundingClientRect(),c=e.closest('.diagram-container').getBoundingClientRect(),text=e.querySelector('text'),m=text?.getScreenCTM();return {dom:document.querySelectorAll('*').length,resourceEntries:performance.getEntriesByType('resource').length,heapBytes:performance.memory?.usedJSHeapSize||null,node:{id:e.dataset.nodeId,left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,visible:r.width>0&&r.height>0&&r.left>=Math.max(0,c.left)-1&&r.right<=Math.min(innerWidth,c.right)+1&&r.top>=Math.max(0,c.top)-1&&r.bottom<=Math.min(innerHeight,c.bottom)+1,textPx:text&&m?parseFloat(getComputedStyle(text).fontSize)*Math.sqrt(m.a*m.a+m.b*m.b):null},viewport:{width:innerWidth,height:innerHeight},labels:[...document.querySelectorAll('.diagram-container > svg text')].filter(t=>t.textContent.trim()).map(t=>{const matrix=t.getScreenCTM();return {text:t.textContent.trim(),textPx:parseFloat(getComputedStyle(t).fontSize)*Math.hypot(matrix.a,matrix.b)}})}})()`,attached.sessionId);}finally{await send('Target.detachFromTarget',{sessionId:attached.sessionId});}
  const n=child.node,f=host.frameRect,c=host.stageRect;
  n.hostTextPx=n.textPx*f.scale;
  const bounds={left:f.left+n.left*f.scale,top:f.top+n.top*f.scale,right:f.left+n.right*f.scale,bottom:f.top+n.bottom*f.scale};
  n.hostBounds=bounds;
  if(!n.visible||bounds.left<Math.max(0,c.left)-1||bounds.right>Math.min(viewport.width,c.right)+1||bounds.top<Math.max(0,c.top)-1||bounds.bottom>Math.min(viewport.height,c.bottom)+1)throw new Error('Exact native node is clipped.');
  child.labelMinHostPx=Math.min(...child.labels.map(label=>label.textPx*f.scale));
  if(!child.labels.length||!Number.isFinite(child.labelMinHostPx)||child.labelMinHostPx<12)throw new Error(`Native SVG text below P0 local 12px gate: ${child.labelMinHostPx}`);
  const entry={viewport,mode,index,processSetupMs:setupMs,...host,child};result.samples.push(entry);
  if(mode==='cold'&&index===1){const image=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(dir,`host-root-${viewport.width}x${viewport.height}.png`),Buffer.from(image.data,'base64'),{flag:'wx'});}
}
for(const viewport of [{width:1440,height:1000},{width:1280,height:800}]){
  for(let i=0;i<3;i++){const {browser,setupMs}=await makeBrowser();try{await sample(browser,viewport,'cold',i+1,setupMs);}finally{await browser.close();}}
  const {browser,setupMs}=await makeBrowser();try{for(let i=0;i<5;i++){
    if(i){const s=await browser.sessionPromise,loaded=browser.cdp.waitFor('Page.loadEventFired',s);await browser.cdp.send('Page.navigate',{url:'about:blank'},s);await loaded;}
    await sample(browser,viewport,'warm',i+1,i===0?setupMs:null);
  }}finally{await browser.close();}
}
fs.writeFileSync(path.join(dir,'samples.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({samples:result.samples.length,artifactBytes:result.identity.artifactBytes,evidence:dir}));
