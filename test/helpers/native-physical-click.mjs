import assert from 'node:assert/strict';

// Exercise the real host-to-opaque-frame input path; DOM hit tests alone can
// precede compositor routing after a host transform. No activation is faked.
export async function nativePhysicalClick({selector,child,send,value,wait,scroll=true,viewport}) {
  const settled='every(a=>a.playState==="finished"||!Number.isFinite(a.effect?.getComputedTiming().endTime))';
  await wait(`document.querySelector("#world").getAnimations().${settled}`);
  await wait(`document.querySelector(".diagram-container > svg").getAnimations().${settled}`,child);
  await value('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const park=await value(`(()=>{const f=document.querySelector('#native');for(const [x,y] of [[2,2],[innerWidth-2,2],[2,innerHeight-2],[innerWidth-2,innerHeight-2]]){const hit=document.elementFromPoint(x,y);if(hit&&hit!==f)return {x,y,hit:hit.id||hit.tagName};}return null})()`);
  assert.ok(park,'a visible host point outside the native frame is required');
  await value(`window.__hostPointer=null;document.addEventListener('pointermove',e=>window.__hostPointer={trusted:e.isTrusted,x:e.clientX,y:e.clientY},{capture:true,once:true})`);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:park.x,y:park.y});await wait('window.__hostPointer!==null');
  assert.deepEqual(await value('window.__hostPointer'),{trusted:true,x:park.x,y:park.y},'pointer must first reach the host');
  await value(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(e&&${scroll})e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})})()`,child);
  await wait(`document.fonts.status==="loaded"&&document.getAnimations().${settled}`,child);
  const node=await value(`(async()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;let previous='',stable=0;for(let i=0;i<120&&stable<3;i++){await new Promise(requestAnimationFrame);const r=e.getBoundingClientRect(),current=[r.left,r.top,r.width,r.height].join(',');stable=current===previous?stable+1:0;previous=current;}const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);return {x,y,rect:r.toJSON(),stable:stable===3,hit:e.contains(hit),hitTag:hit?.tagName,viewport:{width:innerWidth,height:innerHeight}}})()`,child);
  assert.ok(node?.stable,'native target geometry did not settle: '+JSON.stringify(node));
  assert.ok(node?.hit,selector+' '+JSON.stringify(node));
  const frame=await value(`(()=>{const e=document.querySelector('#native'),r=e.getBoundingClientRect();return {rect:r.toJSON(),scaleX:r.width/e.offsetWidth,scaleY:r.height/e.offsetHeight,viewport:{width:innerWidth,height:innerHeight},world:document.querySelector('#world').style.transform,animations:document.querySelector('#world').getAnimations().length}})()`);
  const x=frame.rect.x+node.x*frame.scaleX,y=frame.rect.y+node.y*frame.scaleY;
  const hostHit=await value(`(()=>{const e=document.elementFromPoint(${x},${y});return {id:e?.id,tag:e?.tagName}})()`);
  const diagnostics={selector,park,frame,node,point:{x,y},hostHit,camera:await value('Archify.view.state()',child),nativeAnimations:await value('document.querySelector(".diagram-container > svg").getAnimations().length',child)};
  if(viewport)assert.deepEqual(frame.viewport,viewport,'viewport must match the exercised case '+JSON.stringify(diagnostics));
  assert.ok(x>=0&&x<frame.viewport.width&&y>=0&&y<frame.viewport.height&&hostHit.id==='native','native target must be within the host viewport and frame clip '+JSON.stringify(diagnostics));
  await value(`(()=>{window.__testNativePointer=null;const target=document.querySelector(${JSON.stringify(selector)});document.addEventListener('pointermove',e=>{window.__testNativePointer={trusted:e.isTrusted,hit:target===e.target||target.contains(e.target),tag:e.target.tagName}},{capture:true,once:true});window.__testNativeClick=null;window.addEventListener('click',e=>{window.__testNativeClick={trusted:e.isTrusted,hit:target===e.target||target.contains(e.target),tag:e.target.tagName,html:e.target.outerHTML,x:e.clientX,y:e.clientY,target:target.outerHTML}},{capture:true,once:true});})()`,child);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
  try{await wait('window.__testNativePointer!==null',child);}catch{assert.fail('Native pointer move was not delivered: '+JSON.stringify({...diagnostics,hostPointer:await value('window.__hostPointer'),nativePointer:await value('window.__testNativePointer',child)}));}
  const pointer=await value('window.__testNativePointer',child);assert.ok(pointer.trusted&&pointer.hit,'native pointer must reach the target '+JSON.stringify({...diagnostics,pointer}));
  for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x,y,button:'left',clickCount:1});
  try{await wait('window.__testNativeClick!==null',child);}catch{assert.fail('Native click was not delivered: '+JSON.stringify({...diagnostics,pointer,click:await value('window.__testNativeClick',child),cameraAfter:await value('Archify.view.state()',child)}));}
  const click=await value('window.__testNativeClick',child);assert.ok(click.trusted&&click.hit,'native click must reach the target '+JSON.stringify({...diagnostics,pointer,click}));
}
