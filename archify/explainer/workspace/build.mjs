// Experimental, local-only P0 artifact builder. No general PRD schema is implied.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {prepareExplainer} from '../prepare.mjs';

const css=fs.readFileSync(new URL('./host.css',import.meta.url),'utf8');
const script=fs.readFileSync(new URL('./host.js',import.meta.url),'utf8');
const bridge=fs.readFileSync(new URL('./bridge.js',import.meta.url),'utf8');
const json=value=>JSON.stringify(value).replace(/[<>&\u2028\u2029]/g,c=>`\\u${c.charCodeAt(0).toString(16).padStart(4,'0')}`);
const id=value=>typeof value==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value);
const sibling=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]*\.html$/.test(value);
const text=value=>typeof value==='string'&&value.trim().length>0&&value.length<=2000;

export async function buildWorkspace(input,{inputPath}={}) {
  if(!input?.workflow || !input.workspace || !text(input.service?.meta?.title) || !text(input.service?.answer?.summary)) throw new Error('Workspace needs service and workflow input.');
  const {activities,pages}=input.workspace;
  if(!Array.isArray(activities)||!Array.isArray(pages)||!Array.isArray(input.workflow.nodes)) throw new Error('Workspace activities and pages are required.');
  const pageMap=Object.create(null), nodeMap=Object.create(null);
  const ids=new Set();
  function validateChildren(children,depth=0) {
    if(!Array.isArray(children)||depth>8) throw new Error('Invalid detail children.');
    for(const child of children) {
      if(!id(child.id)||ids.has(child.id)||!text(child.title)||!text(child.purpose)) throw new Error('Invalid or duplicate detail identity.');
      ids.add(child.id);validateChildren(child.children,depth+1);
    }
  }
  for(const page of pages) {
    if(!sibling(page.target)||Object.hasOwn(pageMap,page.target)||!text(page.title)||!text(page.purpose)) throw new Error('Invalid or duplicate page target.');
    validateChildren(page.children);pageMap[page.target]=page;
  }
  for(const node of input.workflow.nodes) {
    if(!id(node.id)||Object.hasOwn(nodeMap,node.id)) throw new Error('Invalid or duplicate native node identity.');
    const links=node.drilldowns ?? (node.href ? [{href:node.href,label:node.label}] : []);
    if(!Array.isArray(links)||links.some(link=>!sibling(link.href)||!Object.hasOwn(pageMap,link.href)||!text(link.label))) throw new Error(`Unknown or unsafe target on ${node.id}.`);
    nodeMap[node.id]={title:node.label,links};
  }
  const activityMap=Object.create(null);
  for(const activity of activities) {
    if(!id(activity.node)||!Object.hasOwn(nodeMap,activity.node)||!nodeMap[activity.node].links.length||Object.hasOwn(activityMap,activity.node)||!text(activity.purpose)||!Array.isArray(activity.relationships)||activity.relationships.some(v=>!text(v))) throw new Error('Invalid activity binding.');
    activityMap[activity.node]={...nodeMap[activity.node],purpose:activity.purpose,relationships:activity.relationships};
  }
  if(Object.entries(nodeMap).some(([node,value])=>value.links.length&&!Object.hasOwn(activityMap,node))) throw new Error('Every native target needs an activity binding.');
  const probe=activities[0]?.node;
  if(!probe) throw new Error('A native readiness probe is required.');
  // The spike displays exact prose from validated Explainer detail documents. It
  // refuses other block kinds rather than silently dropping content; P1 owns a
  // general structured content contract.
  if(!Array.isArray(input.details)||input.details.length!==pages.length) throw new Error('Every page needs one detail document.');
  const seenDetails=new Set();
  for(const detail of input.details) {
    if(!sibling(detail.file)||!Object.hasOwn(pageMap,detail.file)||seenDetails.has(detail.file)) throw new Error('Invalid detail document binding.');
    seenDetails.add(detail.file);
    const textSource=JSON.stringify(detail.document);
    const bundle=await prepareExplainer(textSource,{inputPath:path.resolve(inputPath || 'p0-input.json'),quality:'standard'});
    const document=bundle.document;
    if(document.sources.length||document.answer.reasons?.length||document.answer.scope||document.panels.some(panel=>panel.blocks.some(block=>block.type!=='prose'))) throw new Error('P0 detail documents support a summary and prose blocks only.');
    pageMap[detail.file]={...pageMap[detail.file],body:{title:document.meta.title,summary:document.answer.summary,panels:document.panels.map(panel=>({title:panel.title,paragraphs:panel.blocks.map(block=>block.text)}))}};
  }
  const source=JSON.stringify({schema_version:1,diagram_type:'explainer',meta:{id:'p0-workflow',title:input.workflow.meta.title,locale:'en'},answer:{summary:'Workflow navigation.'},panels:[{id:'workflow-panel',title:'Workflow',blocks:[{id:'workflow',type:'diagram',diagramType:'workflow',spec:input.workflow}]}],sources:[]});
  const prepared=await prepareExplainer(source,{inputPath:path.resolve(inputPath || 'p0-input.json'),quality:'standard'});
  const native=prepared.preparedDiagrams.diagrams.workflow.html;
  const config={service:{title:input.service.meta.title,purpose:input.service.answer.summary},activities:activityMap,pages:pageMap,probe,native,bridge};
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Workspace experiment</title><style>${css}</style></head><body><header class="top"><div><strong id="service-title"></strong><p id="service-purpose"></p></div><div class="tools"><button id="zoom-out" type="button" aria-label="Zoom host out">−</button><output id="zoom-label">100%</output><button id="zoom-in" type="button" aria-label="Zoom host in">+</button><button id="reset" type="button">Reset host camera</button><button id="reload-workspace" type="button" hidden>Reload workspace</button></div></header><p class="hint">Host: drag empty canvas or use its zoom buttons. Diagram: pointer, wheel and keyboard belong to the native Viewer.</p><main id="stage" tabindex="0" aria-label="Workspace canvas"><div id="world"><section class="group native-group"><h1 id="workflow-title">Native workflow</h1><iframe id="native" title="Native workflow" sandbox="allow-scripts allow-downloads allow-modals"></iframe></section><section class="group context-group"><h2>Service context</h2><p id="context-purpose"></p><p>Choose a workflow activity to inspect its related content.</p></section></div><aside id="detail" hidden aria-label="Activity details"><div class="detail-controls"><button id="back" type="button">Back</button><button id="close" type="button">Close</button></div><nav id="trail" aria-label="Ancestor trail"></nav><section id="activity"></section><section id="content"></section></aside></main><p id="status" role="status" aria-live="polite">Opening native workflow…</p><script type="application/json" id="workspace-data">${json(config)}</script><script>${script}</script></body></html>`;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  if(process.argv.length!==4) throw new Error('Usage: node build.mjs INPUT.json OUTPUT.html');
  const file=path.resolve(process.argv[2]), output=path.resolve(process.argv[3]);
  const html=await buildWorkspace(JSON.parse(fs.readFileSync(file,'utf8')),{inputPath:file});
  fs.writeFileSync(output,html,{flag:'wx'});
  console.log(JSON.stringify({output,bytes:Buffer.byteLength(html)}));
}
