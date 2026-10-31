(() => {
  'use strict';
  const data=JSON.parse(document.getElementById('workspace-data').textContent);
  const byId=id=>document.getElementById(id);
  const stage=byId('stage'),world=byId('world'),frame=byId('native'),detail=byId('detail'),status=byId('status');
  let token=Array.from(crypto.getRandomValues(new Uint32Array(4)),n=>n.toString(16).padStart(8,'0')).join('');
  const bindings=Object.fromEntries(Object.entries(data.activities).map(([id,value])=>[id,value.links.map(link=>link.href)]));
  const context=new URLSearchParams(location.search);
  const requestedTheme=context.get('theme');
  const theme=['light','dark'].includes(requestedTheme)?requestedTheme:null;
  if(theme) document.documentElement.dataset.theme=theme;
  if(context.get('embed')==='1')document.documentElement.dataset.embed='true';
  if(context.get('present')==='1')document.documentElement.dataset.present='true';
  byId('service-title').textContent=data.service.title; byId('service-purpose').textContent=data.service.purpose;
  byId('context-purpose').textContent=data.service.purpose;
  const bridge=`<script>(${data.bridge.trim()})(${JSON.stringify(token)},${JSON.stringify(bindings)},${JSON.stringify({theme,probe:data.probe})});<\/script>`;
  const inherited=(context.get('embed')==='1'?' data-embed="true"':'')+(context.get('present')==='1'?' data-present="true"':'');
  const native=data.native.replace(/<html\b([^>]*)>/i,(_,attributes)=>'<html'+attributes+inherited+'>');
  const end=native.toLowerCase().lastIndexOf('</body>');
  if(end<0) {status.textContent='Native workflow is unavailable.';return;}
  let loads=0,revoked=false;
  function setStatus(message){status.textContent=revoked?'Native workflow unavailable. Reload workspace to restore it.':message;}
  byId('reload-workspace').onclick=()=>location.reload();
  frame.addEventListener('load',()=>{if(++loads>1){revoked=true;token=null;frame.remove();stage.dataset.nativeReady='';byId('reload-workspace').hidden=false;setStatus('');}});
  frame.srcdoc=native.slice(0,end)+bridge+native.slice(end);
  let camera={x:0,y:0,scale:1}, route=null, dragging=null;
  function cameraApply(){world.style.transform=`translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`;byId('zoom-label').textContent=Math.round(camera.scale*100)+'%';}
  function zoom(factor){camera.scale=Math.max(.65,Math.min(1.4,Math.round(camera.scale*factor*100)/100));cameraApply();}
  byId('zoom-in').onclick=()=>zoom(1.1);byId('zoom-out').onclick=()=>zoom(1/1.1);
  byId('reset').onclick=()=>{camera={x:0,y:0,scale:1};cameraApply();};
  stage.addEventListener('pointerdown',event=>{if(event.button!==0||!(event.target===stage||event.target===world))return;dragging={x:event.clientX,y:event.clientY,baseX:camera.x,baseY:camera.y};stage.setPointerCapture(event.pointerId);stage.classList.add('dragging');});
  stage.addEventListener('pointermove',event=>{if(!dragging)return;camera.x=dragging.baseX+event.clientX-dragging.x;camera.y=dragging.baseY+event.clientY-dragging.y;cameraApply();});
  const endDrag=()=>{dragging=null;stage.classList.remove('dragging');};stage.addEventListener('pointerup',endDrag);stage.addEventListener('pointercancel',endDrag);
  stage.addEventListener('wheel',event=>{if(event.ctrlKey&&(event.target===stage||event.target===world)){event.preventDefault();zoom(event.deltaY<0?1.1:1/1.1);}},{passive:false});
  stage.addEventListener('keydown',event=>{if(event.target!==stage)return;if(event.key==='+'||event.key==='='){event.preventDefault();zoom(1.1);}else if(event.key==='-'){event.preventDefault();zoom(1/1.1);}});
  function resolved(candidate) {
    if(!candidate||typeof candidate.node!=='string'||typeof candidate.target!=='string'||!Array.isArray(candidate.trail)||candidate.trail.some(id=>typeof id!=='string'))return null;
    if(!Object.hasOwn(data.activities,candidate.node)||!Object.hasOwn(data.pages,candidate.target))return null;
    const activity=data.activities[candidate.node],page=data.pages[candidate.target];
    if(!activity.links.some(link=>link.href===candidate.target))return null;
    let current=page;const lineage=[page];
    for(const id of candidate.trail){current=current.children.find(child=>child.id===id);if(!current)return null;lineage.push(current);}
    return {activity,lineage};
  }
  function urlFor(value){if(!value)return location.pathname+location.search;const params=new URLSearchParams({node:value.node,target:value.target,trail:value.trail.join('/')});return location.pathname+location.search+'#'+params.toString();}
  function parseRoute(){if(!location.hash)return null;const params=new URLSearchParams(location.hash.slice(1));if([...params.keys()].some(key=>!['node','target','trail'].includes(key))||params.getAll('node').length!==1||params.getAll('target').length!==1||params.getAll('trail').length!==1)return false;const trail=params.get('trail');const candidate={node:params.get('node'),target:params.get('target'),trail:trail?trail.split('/'):[]};return resolved(candidate)?candidate:false;}
  function el(tag,value){const element=document.createElement(tag);if(value!==undefined)element.textContent=value;return element;}
  function render(next,{restore=false}={}) {
    const old=route;route=next;
    detail.hidden=!route;stage.classList.toggle('detail-open',!!route);world.inert=!!route;
    if(!route){if(restore&&old&&frame.isConnected){frame.focus();frame.contentWindow.postMessage({kind:'p0-restore',token,node:old.node},'*');}return;}
    const {activity,lineage}=resolved(route);
    const trail=byId('trail');trail.replaceChildren();
    for(const label of [data.service.title,activity.title,...lineage.map(entry=>entry.title)]){const span=el('span',label);trail.append(span);}
    const activityEl=byId('activity');activityEl.replaceChildren(el('h2',activity.title),el('p',activity.purpose));
    const relations=el('ul');for(const item of activity.relationships)relations.append(el('li',item));activityEl.append(relations);
    const content=byId('content');content.replaceChildren();
    // Preserve each parent description while descending, rather than replacing the context.
    for(const [index,item] of lineage.entries()){
      const section=el('section');section.className=index===lineage.length-1?'current':'ancestor';section.dataset.detailId=index===0?route.target:item.id;section.append(el(index===lineage.length-1?'h3':'h4',item.title),el('p',item.purpose));content.append(section);
    }
    const current=lineage.at(-1);
    if(current.children.length){const heading=el('h4','Related details');content.append(heading);for(const child of current.children){const button=el('button');button.append(el('strong',child.title),el('span',child.purpose));button.type='button';button.dataset.child=child.id;button.addEventListener('click',()=>navigate({...route,trail:[...route.trail,child.id]}));content.append(button);}}
    const body=lineage[0].body,article=el('article');article.className='detail-source';article.append(el('h4',body.title),el('p',body.summary));
    for(const panel of body.panels){article.append(el('h4',panel.title));for(const paragraph of panel.paragraphs){const p=el('p',paragraph);p.style.whiteSpace='pre-wrap';article.append(p);}}
    content.append(article);
    const returning=restore && old && old.node===route.node && old.target===route.target && old.trail.length===route.trail.length+1 && route.trail.every((id,index)=>id===old.trail[index]);
    const opener=returning ? Array.from(content.querySelectorAll('[data-child]')).find(button=>button.dataset.child===old.trail.at(-1)) : null;
    (opener||byId('back')).focus({preventScroll:true});
  }
  function navigate(next,{owned=true,restore=false}={}){if(!resolved(next)){setStatus('Target is missing or stale.');return;}
    if(!route)history.replaceState({...history.state,p0Camera:{...camera}},'',location.href);
    history.pushState({p0Camera:{...camera},p0Owned:owned},'',urlFor(next));render(next,{restore});setStatus('Detail opened.');
  }
  function toRoot(){const old=route;if(old)camera={...originCamera};history.pushState({p0Camera:{...camera}},'',urlFor(null));render(null,{restore:true});cameraApply();setStatus('Returned to the workflow.');}
  let originCamera={...camera};
  // A revoked iframe navigation can add joint-history entries with the same host route.
  // Climb the logical trail instead of assuming the previous entry is the parent.
  byId('back').onclick=()=>{if(history.state?.p0Owned&&!revoked){history.back();}else if(route?.trail.length){navigate({...route,trail:route.trail.slice(0,-1)},{owned:false,restore:true});}else toRoot();};
  byId('close').onclick=toRoot;
  addEventListener('popstate',event=>{const next=parseRoute();if(next===false){setStatus('Target is missing or stale.');render(null,{restore:true});return;}if(event.state?.p0Camera){camera={...event.state.p0Camera};cameraApply();}render(next,{restore:true});if(revoked)setStatus('');});
  const exact=(object,keys)=>object&&typeof object==='object'&&!Array.isArray(object)&&Object.keys(object).sort().join(',')===keys.slice().sort().join(',');
  addEventListener('message',event=>{
    const msg=event.data;
    if(!token||!frame.isConnected||event.source!==frame.contentWindow||!msg||msg.token!==token){setStatus('Ignored an untrusted or stale frame message.');return;}
    if(msg.kind==='p0-activate'&&exact(msg,['kind','token','node','target'])&&typeof msg.node==='string'&&typeof msg.target==='string'){
      const next={node:msg.node,target:msg.target,trail:[]};if(!resolved(next)){setStatus('Ignored an unknown or unbound target.');return;}
      if(!route)originCamera={...camera};navigate(next);return;
    }
    if(msg.kind==='p0-parent'&&exact(msg,['kind','token'])){if(route)toRoot();else setStatus('Already at the service workflow.');return;}
    if(msg.kind==='p0-ready'&&exact(msg,['kind','token','node','elapsed','rect'])&&msg.node===data.probe&&Number.isFinite(msg.elapsed)&&exact(msg.rect,['width','height'])&&msg.rect.width>0&&msg.rect.height>0){
      stage.dataset.nativeReady=msg.node;stage.dataset.nativeElapsed=String(msg.elapsed);stage.dataset.readyAt=String(performance.now());if(status.textContent==='Opening native workflow…')status.textContent='Workflow ready.';return;
    }
    if(msg.kind==='p0-failure'&&exact(msg,['kind','token','reason'])&&typeof msg.reason==='string'){setStatus(msg.reason);return;}
    setStatus('Ignored an invalid frame message.');
  });
  const initial=parseRoute();if(initial===false){status.textContent='Target is missing or stale.';history.replaceState(null,'',urlFor(null));}else if(initial)render(initial);
  cameraApply();document.fonts.ready.then(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{stage.dataset.hostReady='true';stage.dataset.hostReadyAt=String(performance.now());})));
})();
