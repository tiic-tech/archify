import fs from 'node:fs';
import { activityContext } from './prd-context.mjs';
import { scopeIds, serviceOwners, hash, identity } from './prd-model.mjs';
import { nativeDrilldownNodes } from './prd-prepare.mjs';
import { renderPrd } from './prd-export.mjs';
import { readerZip } from './prd-reader-package.mjs';
import { proposeQuestions } from './prd-questions.mjs';
import { quotePaths, feedbackProvenanceError } from './prd-feedback.mjs';
import { productDocumentCss, productDocumentPrintCss } from './prd-product-document.mjs';

const read = name => fs.readFileSync(new URL(name, import.meta.url), 'utf8');
const json = value => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
// Generated from the same schemas as the CLI; no compiler in the installed Skill.
const feedbackValidators = read('./generated-prd-feedback-browser.js');

// Consumes only the fully prepared P1 manifest. Native HTML is frozen in the
// manifest and mounted lazily; no renderer geometry is touched here.
export async function buildPrdReader(manifest,{audience='internal',policy,inputPath,returnConfig=false}={}) {
  const featureMode=manifest.model.profile.productDocument?.version===2;
  if (manifest.kind !== 'archify-prd-manifest') throw new Error('Expected a prepared PRD manifest.');
  const rendered=await renderPrd(manifest,{audience,policy,inputPath});
  const packageFiles=new Map(rendered.files),packageIdentity={...rendered.identity,artifacts:{...rendered.identity.artifacts}};for(const name of ['index.html','appendix.html']){packageFiles.delete(name);delete packageIdentity.artifacts[name];}packageFiles.set('manifest.json',Buffer.from(`${JSON.stringify(packageIdentity,null,2)}\n`));
  const zip=readerZip(packageFiles);
  const printHtml=rendered.files.get('index.html').toString('utf8');
  const bodyStart=printHtml.indexOf('<body'),bodyContent=printHtml.indexOf('>',bodyStart),bodyEnd=printHtml.lastIndexOf('</body>');if(bodyStart<0||bodyContent<0||bodyEnd<bodyContent)throw new Error('Exported document body is missing.');
  let printBody=printHtml.slice(bodyContent+1,bodyEnd);
  const product=Boolean(manifest.model.profile.productDocument),referenced=manifest.model.profile.documentLayout==='referenced'||product;
  if(referenced) printBody=printBody.replace(/<a(?: download)? href="(?:appendix\.html(?:#[^"]*)?|assets\/[^"]+)">([^<]*)<\/a>/g,'$1 (available in the Markdown package)');
  if(featureMode)printBody=printBody.replace(`<a href="${rendered.identity.primaryMarkdown}">Primary Markdown</a>`, 'Primary Markdown (available in the Markdown package)');
  for(const [name,bytes] of rendered.files) if(name.startsWith('assets/')){
    const mime=name.endsWith('.svg')?'image/svg+xml':name.endsWith('.png')?'image/png':name.endsWith('.jpg')?'image/jpeg':name.endsWith('.webp')?'image/webp':'application/octet-stream';
    const safeName=name.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
    printBody=printBody.replaceAll(`src="${safeName}"`,`src="data:${mime};base64,${bytes.toString('base64')}"`);
  }
  let model=manifest.model,assets=manifest.assets,diagnostics=manifest.diagnostics;
  if(audience==='client'){
    assets=[];const seen=new Set();const publicObjects=[];
    const approvedFacts=featureMode?new Map(rendered.publicProduct.objects.map(o=>[o.id,o])):null;
    for(const [original,value] of rendered.projection.objects){
      const {attachments,...o}=value;const item=featureMode?{...approvedFacts.get(o.id)}:{...o};
      if(featureMode&&o.disclosureGaps?.length)item.disclosureGaps=[...o.disclosureGaps];
      if(policy.objects[original].withheld) item.disclosureFields={...policy.objects[original].withheld};
      if(item.parent&&policy.objects[original].parent!==true){(item.disclosureGaps||=[]).push(item.parent);delete item.parent;}
      item.assetIds=[];
      for(const a of attachments||[]){const id=a.name.slice('assets/'.length).replace(/\.[^.]+$/,'');item.assetIds.push(id);if(!seen.has(id)){seen.add(id);assets.push({id,name:a.caption,caption:a.caption,mediaType:a.name.endsWith('.png')?'image/png':a.name.endsWith('.jpg')?'image/jpeg':'image/webp',contentBase64:a.bytes.toString('base64'),sha256:rendered.identity.artifacts[a.name].sha256,distributable:true});}}
      publicObjects.push(item);
    }
    model={objects:publicObjects};diagnostics=[];
  }
  const objects = new Map(model.objects.map(o => [o.id, o])), owners=serviceOwners(model);
  const serviceScope=id=>scopeIds(model,[id]);
  const views = audience==='client'?[...rendered.publicViews.values()].map(view=>{const boundOwners=view.bindings.filter(b=>b.type==='activity').map(b=>owners[b.object]);const inferred=view.type==='workflow'&&boundOwners.length&&boundOwners.every(v=>v&&v===boundOwners[0])?boundOwners[0]:null;return {id:view.id,type:view.type,service:view.service||inferred,bindings:view.bindings.map(b=>({...b,nativeLinks:false})),html:view.prepared.html};}):manifest.nativeViews.map(view => {
    const authored = model.nativeViews.find(v => v.id === view.id);
    // Compatibility for original P1 workflows: a service may be established
    // only when every bound activity has the same explicit service owner.
    const boundOwners = view.bindings.filter(b=>b.type==='activity').map(b => owners[b.object]);
    const inferred = authored.diagramType === 'workflow' && boundOwners.length && boundOwners.every(v => v && v === boundOwners[0]) ? boundOwners[0] : null;
    const bindings=view.bindings.map(binding=>{const node=nativeDrilldownNodes(authored).find(n=>n.id===binding.node);return {...binding,nativeLinks:Boolean(node?.href||node?.drilldowns?.length)};});
    return { id:view.id, type:authored.diagramType, service:authored.service || inferred, bindings, html:view.prepared.html };
  });
  // A standard workflow is a Feature-specific presentation of the same
  // authored view and bindings. Preserve the native view ID for deep links.
  if(manifest.model.profile.productDocument?.standard){
    const numbered=audience==='client'?rendered.publicProduct.standardViews:manifest.standardViews;
    for(const view of views){const presentations=numbered.filter(x=>x.view===view.id).map(x=>({feature:x.feature,html:x.prepared.html}));if(presentations.length)view.presentations=presentations;}
  }
  const contexts = Object.fromEntries(model.objects.filter(o => o.type === 'activity').map(o => [o.id,activityContext(model,o.id)]));
  const serviceGaps = Object.fromEntries(model.objects.filter(o=>o.type==='service').map(service=>{
    const scope=serviceScope(service.id);
    const local=id=>scope.has(id)&&(!owners[id]||owners[id]===service.id);
    const warnings=diagnostics.filter(d=>['prd/declared-gap','prd/contract-gap','prd/binding-gap','prd/relationship-gap','prd/extension-preserved'].includes(d.code)&&local(d.evidence?.id)).length;
    const mappings=[...scope].reduce((count,id)=>count+(local(id)&&Object.hasOwn(contexts,id)?contexts[id].gaps.length:0),0);
    return [service.id,warnings+mappings];
  }));
  const serviceEvidence=Object.fromEntries(model.objects.filter(o=>o.type==='service').map(service=>{
    const scope=serviceScope(service.id);
    // Client omission prose can equal a public ID; only explicitly projected
    // aliases may establish a scope association in the public reader.
    const recordScope=o=>audience==='client'?(featureMode?(o.detail.scope||[]):(Object.hasOwn(rendered.projection.recordScopes,o.id)?rendered.projection.recordScopes[o.id]:[])):(o.detail.scope||[]);
    const relevant=new Set(model.objects.filter(o=>['source','decision','question','evidence'].includes(o.type) && (scope.has(o.id)||recordScope(o).some(id=>scope.has(id))||(o.refs||[]).some(ref=>ref.relation==='target'&&scope.has(ref.target)))).map(o=>o.id));
    for(const id of [...relevant]) for(const ref of objects.get(id)?.refs||[]) if(ref.relation==='derivedFrom'&&ref.type==='source')relevant.add(ref.target);
    return [service.id,[...relevant]];
  }));
  const disclosureGaps=audience==='client'?rendered.projection.components.flatMap(c=>[...(c.gaps||[]),...c.views.filter(v=>!rendered.publicViews.has(v.id)).map(()=> 'Native view not disclosed; an approved public representation is not available.')]):[];
  const questionScopes=audience==='client'?(featureMode?Object.fromEntries(model.objects.filter(o=>o.type==='question'&&Array.isArray(o.detail.scope)).map(o=>[o.id,o.detail.scope])):rendered.projection.questionScopes):undefined, ruleScopes=audience==='client'?(featureMode?Object.fromEntries(model.objects.filter(o=>o.type==='rule'&&o.rule).map(o=>[o.id,o.rule.scope])):rendered.projection.ruleScopes):undefined;
  const featureCorrespondence=featureMode?rendered.featureCorrespondence:undefined;
  const snapshot=audience==='client'?identity({revision:manifest.revision,disclosure:rendered.identity.disclosure,exporter:rendered.identity.exporter,validationCode:rendered.identity.preparation,objects:model.objects,questionScopes,ruleScopes,owners,assets:assets.map(({contentBase64,...asset})=>asset),views:views.map(({html,...view})=>({...view,html:hash(html)})),contexts,serviceGaps,serviceEvidence,disclosureGaps,...(featureMode?{featureCorrespondence}: {})}):null;
  const questions=audience==='internal'?proposeQuestions(model,manifest.revision):{proposals:[],covered:[]};
  const config = {revision:manifest.revision, digest:audience==='internal'?manifest.digest:undefined, workspaceId:manifest.model.workspaceId||null, quotePaths, reviewHistory:audience==='internal'?model.reviewHistory||[]:[], questionProposals:questions.proposals, coveredQuestions:questions.covered, audience, disclosure:rendered.identity.disclosure, snapshot, exporter:rendered.identity.exporter, objects:model.objects, questionScopes, ruleScopes, owners, views, assets, diagnostics, contexts, serviceGaps, serviceEvidence, disclosureGaps, ...(featureMode?{featureCorrespondence,primaryMarkdown:rendered.identity.primaryMarkdown}:{}), packageBase64:zip.toString('base64'), bridge:read('./prd-reader-bridge.js')};
  if(returnConfig)return config;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PRD workspace — ${audience==='internal'?'Authoring / Internal':'Client projection'}</title><style>${read('./prd-reader.css')}${referenced?'@media print{#print-document{overflow-wrap:anywhere}#print-document figure{break-inside:auto}#print-document img{max-height:9in;object-fit:contain}}':''}${product?`@media print{${productDocumentCss}${productDocumentPrintCss}}`:''}</style></head><body><header><button id="sidebar-toggle" aria-expanded="true" aria-controls="sidebar">☰ <span>Navigator</span></button><strong>PRD workspace</strong><span class="internal">${audience==='internal'?'Authoring / Internal':'Client projection (non-authoritative)'}</span><span id="revision"></span><button id="download-prd">Download Markdown package</button><button id="print-prd">${referenced?'Print main PRD':'Print complete PRD'}</button><button id="reload" hidden>Reload workspace</button></header><div id="layout"><aside id="sidebar"><label for="search">Search model</label><input id="search" type="search" placeholder="Title or purpose"><div id="search-results"></div><nav id="navigator" aria-label="Model navigation"></nav><section class="legend"><h2>Legend</h2><p><span class="tag scope">Scope</span> <span class="tag people">Role / activity</span> <span class="tag interface">Interface</span> <span class="tag data">Data / state</span> <span class="tag contract">Contract</span> <span class="tag evidence">Evidence / history</span></p><p><span class="priority high">Priority: High</span> <span class="priority medium">Priority: Medium</span> <span class="priority low">Priority: Low</span> <span class="priority other">Priority: Other</span></p><p><span class="authority current">Authority: current</span> <span class="authority reference">Authority: reference</span> <span class="authority inferred">Authority: inferred</span> <span class="authority proposed">Authority: proposed</span> <span class="authority customer-confirmed">Authority: customer-confirmed</span> <span class="authority superseded">Authority: superseded</span> <span class="gap-label">Gap</span></p><p>Labels are authoritative; colours do not imply approval or readiness.</p></section></aside><main id="main"><div id="catalog"></div><section id="workspace" hidden><div class="workspace-bar"><div><button id="catalog-button">← Services</button> <strong id="service-title"></strong><span id="service-status"></span></div><div><label for="view-select">Native view</label> <select id="view-select"></select> <button id="host-out" aria-label="Zoom host out">−</button> <output id="host-scale">100%</output> <button id="host-in" aria-label="Zoom host in">+</button> <button id="host-reset">Fit diagram</button> <button id="host-context">Context</button> <button id="host-evidence">Evidence</button></div></div><p class="hint">Drag empty canvas to pan. Native diagram wheel, zoom, keyboard and export stay in the Viewer. Switching views recreates the Viewer at its default camera.</p><div id="stage" tabindex="0" aria-label="Service canvas"><div id="world"><section id="native-group"><h2 id="native-title"></h2><div id="frame-slot"></div></section><section id="context-group"></section><section id="evidence-group"></section></div><section id="detail" role="dialog" aria-modal="true" aria-label="Model detail" hidden><div class="detail-controls"><button id="back">Back</button><button id="close">Close</button></div><nav id="trail" aria-label="Detail trail"></nav><div id="parent-context"></div><div id="detail-content"></div></section></div></section></main></div><div id="status" role="status" aria-live="polite">Choose a service.</div><article id="print-document"${product?' class="product-document"':''}>${printBody}</article><script type="application/json" id="reader-data">${json(config)}</script><script>${feedbackValidators}\nconst prdFeedbackProvenanceError=${feedbackProvenanceError.toString()};</script><script>${read('./prd-reader-feedback.js')}</script><script>${read('./prd-reader.js')}</script></body></html>`;
}
