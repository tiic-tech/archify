(function prdReaderBridge(token, revision, view, bindings, context) {
  const send = data => parent.postMessage({ ...data, token, revision, view }, '*');
  const find = id => Object.prototype.hasOwnProperty.call(bindings, id) ? bindings[id] : null;
  function sendTarget(event,id,binding,target) {
    event.preventDefault();event.stopImmediatePropagation();
    send({kind:'prd-activate',node:id,object:binding.object,type:binding.type,...(target?{target:target.object,targetType:target.type}:{})});
  }
  function activate(event) {
    if(event.target.closest?.('#btn-parent-back')) {event.preventDefault();event.stopImmediatePropagation();send({kind:'prd-parent'});return;}
    const passport=event.target.closest?.('#focus-drilldowns-list a[data-drilldown-index]');
    if(passport){const id=document.getElementById('focus-id')?.textContent.trim(),binding=find(id),index=Number(passport.dataset.drilldownIndex),target=binding?.targets?.[index];if(target)sendTarget(event,id,binding,target);else {event.preventDefault();event.stopImmediatePropagation();send({kind:'prd-failure',reason:'Unknown native target.'});}return;}
    const node=event.target.closest?.('svg [data-node-id]') || event.target.closest?.('a[data-archify-drilldown]')?.querySelector('[data-node-id]');
    if(!node)return;
    // Route Probe owns selection while it is choosing endpoints. Let its
    // native capture handler receive both pointer and keyboard events.
    const routeMode=window.Archify?.routeProbe?.active?.();
    if(routeMode==='source'||routeMode==='target')return;
    const id=node.getAttribute('data-node-id'),binding=find(id);
    if(!binding){event.preventDefault();event.stopImmediatePropagation();send({kind:'prd-failure',reason:'Native node has no model binding: '+id});return;}
    if(binding.targets?.length>1)return; // Native Passport retains its multi-target selection.
    if(binding.nativeLinks&&!binding.targets?.length){event.preventDefault();event.stopImmediatePropagation();send({kind:'prd-failure',reason:'Native targets have no model mapping: '+id});return;}
    sendTarget(event,id,binding,binding.targets?.[0]);
  }
  document.addEventListener('click',activate,true);
  document.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' ')activate(event);},true);
  addEventListener('message',event=>{
    const data=event.data;
    if(event.source!==parent||!data||Object.keys(data).sort().join(',')!=='kind,node,revision,token,view'||data.kind!=='prd-restore'||data.token!==token||data.revision!==revision||data.view!==view||!find(data.node))return;
    const node=Array.from(document.querySelectorAll('svg [data-node-id]')).find(e=>e.getAttribute('data-node-id')===data.node);
    if(node){window.focus();node.focus({preventScroll:true});}
  });
  if(['light','dark'].includes(context.theme)&&document.documentElement.dataset.theme!==context.theme){if(window.Archify?.theme?.toggle)window.Archify.theme.toggle();else document.documentElement.dataset.theme=context.theme;}
  const started=performance.now();
  async function ready(){
    await document.fonts.ready;
    if(context.probe)window.Archify?.view?.reveal([context.probe],{instant:true,includeNeighbors:true,maxScale:1});
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const inspect=()=>{
      const node=Array.from(document.querySelectorAll('svg [data-node-id]')).find(e=>e.getAttribute('data-node-id')===context.probe);
      const r=node?.getBoundingClientRect(),clip=node?.closest('.diagram-container')?.getBoundingClientRect();
      if(r&&clip&&r.width>0&&r.height>0&&r.left>=Math.max(0,clip.left)-1&&r.right<=Math.min(innerWidth,clip.right)+1&&r.top>=Math.max(0,clip.top)-1&&r.bottom<=Math.min(innerHeight,clip.bottom)+1)requestAnimationFrame(()=>requestAnimationFrame(()=>send({kind:'prd-ready',node:context.probe,elapsed:performance.now()-started})));
      else if(performance.now()-started<10000)requestAnimationFrame(inspect);
      else send({kind:'prd-failure',reason:'Native exact node is not visible.'});
    };
    if(context.probe)inspect();else send({kind:'prd-failure',reason:'This view has no bound readiness node.'});
  }
  if(document.readyState==='complete')ready();else addEventListener('load',ready,{once:true});
})
