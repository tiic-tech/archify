// Injected only into the sandboxed native copy. Native SVG/export remains authoritative.
(function workspaceBridge(token, bindings, context) {
  const send = data => parent.postMessage({...data, token}, '*');
  const targets = id => Object.prototype.hasOwnProperty.call(bindings,id) ? bindings[id] : [];
  const activate = (event,id,href) => {
    if (!id || !href) return;
    event.preventDefault(); event.stopImmediatePropagation();
    send({kind:'p0-activate',node:id,target:href});
  };
  document.addEventListener('click', event => {
    if(event.target.closest('#btn-parent-back')) {event.preventDefault();event.stopImmediatePropagation();send({kind:'p0-parent'});return;}
    const passport = event.target.closest('#focus-drilldowns-list a[data-drilldown-index]');
    if (passport) {
      const id = document.getElementById('focus-id')?.textContent.trim();
      const index = Number(passport.dataset.drilldownIndex);
      const target = targets(id)[index];
      if (target) activate(event,id,target);
      else {event.preventDefault();event.stopImmediatePropagation();send({kind:'p0-failure',reason:'Unknown native target.'});}
      return;
    }
    const anchor = event.target.closest('a[data-archify-drilldown]');
    const node = event.target.closest('svg [data-node-id]') || anchor?.querySelector('[data-node-id]');
    const id = node?.getAttribute('data-node-id');
    if (anchor && id && targets(id).length === 1) activate(event,id,targets(id)[0]);
    else if (anchor) {event.preventDefault();event.stopImmediatePropagation();send({kind:'p0-failure',reason:'Unknown native target.'});}
    else if ((event.ctrlKey || event.metaKey) && id && targets(id).length) activate(event,id,targets(id)[0]);
  },true);
  document.addEventListener('dblclick', event => {
    const node = event.target.closest('svg [data-node-id]');
    const id = node?.getAttribute('data-node-id');
    if (id && targets(id).length) activate(event,id,targets(id)[0]);
  },true);
  document.addEventListener('keydown', event => {
    const node = event.target.closest('svg [data-node-id]');
    const id = node?.getAttribute('data-node-id');
    if (id && targets(id).length === 1 && (event.key === 'Enter' || event.key === ' ')) activate(event,id,targets(id)[0]);
  },true);
  addEventListener('message', event => {
    const data=event.data;
    if(event.source!==parent || !data || data.kind!=='p0-restore' || data.token!==token || typeof data.node!=='string' || !targets(data.node).length) return;
    const node=Array.from(document.querySelectorAll('svg [data-node-id]')).find(e=>e.getAttribute('data-node-id')===data.node);
    if(node){window.focus();node.focus({preventScroll:true});}
  });
  if (['light','dark'].includes(context.theme) && document.documentElement.dataset.theme!==context.theme) {
    if (window.Archify?.theme?.toggle) window.Archify.theme.toggle();
    else document.documentElement.dataset.theme=context.theme;
  }
  // A readiness message is emitted only when the exact node has painted geometry,
  // is visible within the frame, and fonts and two rendering frames have settled.
  const started=performance.now();
  const ready=async()=>{
    await document.fonts.ready;
    // Use the native camera rather than changing SVG geometry or text styles.
    // Two native zoom steps trade some overview area for readable initial labels.
    window.Archify?.view?.zoomIn();window.Archify?.view?.zoomIn();
    window.Archify?.view?.reveal([context.probe],{instant:true,includeNeighbors:true,maxScale:1.5});
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const svg=document.querySelector('.diagram-container > svg');
    await Promise.all((svg?.getAnimations() || []).filter(animation=>animation.transitionProperty==='transform').map(animation=>animation.finished.catch(()=>{})));
    const inspect=()=>{
      const node=Array.from(document.querySelectorAll('svg [data-node-id]')).find(e=>e.getAttribute('data-node-id')===context.probe);
      const rect=node?.getBoundingClientRect(), clip=node?.closest('.diagram-container')?.getBoundingClientRect(), style=node && getComputedStyle(node);
      if(rect && clip && rect.width>0 && rect.height>0 && rect.left>=Math.max(0,clip.left)-1 && rect.right<=Math.min(innerWidth,clip.right)+1 && rect.top>=Math.max(0,clip.top)-1 && rect.bottom<=Math.min(innerHeight,clip.bottom)+1 && style.visibility!=='hidden' && style.display!=='none') {
        requestAnimationFrame(()=>requestAnimationFrame(()=>send({kind:'p0-ready',node:context.probe,elapsed:performance.now()-started,rect:{width:rect.width,height:rect.height}})));
      } else if(performance.now()-started<10000) requestAnimationFrame(inspect);
      else send({kind:'p0-failure',reason:'Native node was not visibly ready'});
    };
    inspect();
  };
  if(document.readyState==='complete') ready(); else addEventListener('load',ready,{once:true});
})
