import fs from 'node:fs';
import path from 'node:path';
import { hash, identity } from './prd-model.mjs';
import { validateServiceHistory, historyIdentity } from './prd-service.mjs';

const MAX=128*1024*1024;
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
function safeRead(root, name, limit) {
  if(typeof name!=='string'||name.length>512||name.includes('\\')||name.includes('\0')||name.split('/').some(p=>!p||p==='.'||p==='..')||path.posix.isAbsolute(name)||/^[A-Za-z]:/.test(name)) throw new Error('Unsafe base artifact path.');
  let current=root;
  for(const part of name.split('/')) {current=path.join(current,part);if(fs.lstatSync(current).isSymbolicLink())throw new Error('Symlink in base artifact path.');}
  const fd=fs.openSync(current,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  try{
    const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size>limit)throw new Error('Base artifact must be a bounded regular file.');
    if(process.platform==='linux'&&fs.realpathSync(`/proc/self/fd/${fd}`)!==current)throw new Error('Base artifact resolved outside its expected path.');
    const bytes=Buffer.alloc(stat.size);let offset=0;while(offset<bytes.length){const n=fs.readSync(fd,bytes,offset,bytes.length-offset,null);if(!n)throw new Error('Base artifact changed while reading.');offset+=n;}
    if(fs.readSync(fd,Buffer.alloc(1),0,1,null)!==0)throw new Error('Base artifact grew while reading.');return bytes;
  }finally{fs.closeSync(fd);}
}
export function loadServiceBase(directory, workspace, audience) {
  const root=path.resolve(directory), stat=fs.lstatSync(root);
  if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('Base must be a real directory, not a symlink.');
  // Reject symlinks in ancestor directories too.
  let part=path.parse(root).root;for(const name of root.slice(part.length).split(path.sep).filter(Boolean)){part=path.join(part,name);if(fs.lstatSync(part).isSymbolicLink())throw new Error('Symlink in base directory path.');}
  const manifestBytes=safeRead(root,'manifest.json',2*1024*1024), manifest=JSON.parse(manifestBytes.toString('utf8'));
  if(!manifest||manifest.kind!=='archify-prd-service-export'||manifest.version!==1||manifest.workspace!==workspace||manifest.audience!==audience||!digest(manifest.semantic)||!Array.isArray(manifest.history)||!manifest.artifacts||typeof manifest.artifacts!=='object'||Array.isArray(manifest.artifacts))throw new Error('Incompatible Service base manifest.');
  const primary=manifest.primaryMarkdown??'README.md';
  if(typeof primary!=='string'||(primary!=='README.md'&&!/^[a-z0-9]+(?:-[a-z0-9]+)*\.prd\.(client|internal)\.[a-z0-9-]+\.md$/.test(primary))||!Object.hasOwn(manifest.artifacts,primary))throw new Error('Incompatible Service base primary Markdown.');
  if(manifest.primaryMarkdown!==undefined){
    const assets=manifest.assets,features=manifest.features;
    if(!primary.includes(`.prd.${audience}.`)||!Object.hasOwn(manifest.artifacts,'README.md')||manifest.auditMarkdown!=='appendix.md'||!Object.hasOwn(manifest.artifacts,manifest.auditMarkdown)||!Array.isArray(features)||!features.length||!Array.isArray(assets)||new Set(assets).size!==assets.length||assets.some(name=>typeof name!=='string'||!/^assets\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)||!Object.hasOwn(manifest.artifacts,name))||Object.keys(manifest.artifacts).some(name=>name.startsWith('assets/')&&!assets.includes(name)))throw new Error('Incompatible Feature Service base manifest.');
    const ids=new Set();
    for(const f of features){if(!f||typeof f!=='object'||Object.keys(f).some(k=>!['id','key','anchor','service','status','artifact','workflow','workflowAsset'].includes(k))||typeof f.id!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(f.id)||ids.has(f.id)||f.anchor!==f.id||typeof f.key!=='string'||f.key.length>100||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(f.key)||f.service!==manifest.service||!['detailed','catalog-only'].includes(f.status)||f.artifact!==primary||(f.status==='detailed'&&(typeof f.workflow!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(f.workflow)||![`assets/native-${f.workflow}.svg`,`assets/native-${f.id}-${f.workflow}.svg`].includes(f.workflowAsset)||!assets.includes(f.workflowAsset)))||(f.status==='catalog-only'&&(f.workflow!==undefined||f.workflowAsset!==undefined)))throw new Error('Incompatible Feature Service base correspondence.');ids.add(f.id);}
  }
  const {digest:manifestDigest,...payload}=manifest;if(!digest(manifestDigest)||identity(payload)!==manifestDigest||!digest(manifest.recipe)||manifest.historyIdentity!==historyIdentity(manifest.history)||manifest.parentHistoryIdentity!==(manifest.history.length>1?historyIdentity(manifest.history.slice(0,-1)):null))throw new Error('Base manifest integrity check failed.');
  const entries=Object.entries(manifest.artifacts);if(entries.length>10000)throw new Error('Base artifact count exceeds limit.');
  let total=0;const files=new Map();
  for(const [name,item] of entries){if(name==='manifest.json'||!item||!digest(item.sha256)||!Number.isSafeInteger(item.bytes)||item.bytes<0||item.bytes>MAX)throw new Error('Malformed base artifact entry.');total+=item.bytes;if(total>MAX)throw new Error('Base artifact budget exceeded.');let bytes;try{bytes=safeRead(root,name,item.bytes);}catch(error){throw new Error(`Base artifact conflict: ${name} (${error.message})`);}if(bytes.length!==item.bytes||hash(bytes)!==item.sha256)throw new Error(`Base artifact conflict: ${name}`);files.set(name,bytes);}
  return {manifest,files,receipt:hash(manifestBytes),verify(){const again=loadServiceBase(root,workspace,audience);if(again.receipt!==hash(manifestBytes))throw new Error('Base manifest changed during export.');}};
}
export function serviceWorkspace(model) {if(!model.workspaceId)throw new Error('Service export requires a stable workspaceId.');return identity({workspaceId:model.workspaceId});}
function rendererIdentity(){return identity(['prd-standard-v1.mjs','prd-standard-refinements.mjs','prd-standard-context.mjs','prd-standard-composer.mjs','prd-service.mjs','prd-service-export.mjs','prd-export.mjs','prd-components.mjs','prd-product-document.mjs','prd-product-v2.mjs','prd-product-public-v2.mjs','prd-feature-composer.mjs','prd-feature-export.mjs','prd-product-export.mjs','prd-product-public.mjs','prd-model.mjs','prd-prepare.mjs','prd-cli.mjs','generated-prd-validators.mjs'].map(name=>[name,hash(fs.readFileSync(new URL(`./${name}`,import.meta.url)))]));}
function fingerprintObject(object){
  if(!object.attachments)return object;
  return {...object,attachments:object.attachments.map(({bytes,...metadata})=>({...metadata,sha256:hash(bytes)}))};
}
function inputObjects(c,map) {
  const wanted=new Set(), queue=[];
  const add=id=>{if(map.has(id)&&!wanted.has(id)){wanted.add(id);queue.push(id);}};
  const values=v=>{if(typeof v==='string')add(v);else if(Array.isArray(v))v.forEach(values);else if(v&&typeof v==='object'&&!Buffer.isBuffer(v))Object.values(v).forEach(values);};
  c.objects.forEach(o=>add(o.id));
  for(let i=0;i<queue.length;i++){const o=map.get(queue[i]);values(o);if(o.type==='variant')for(const x of map.values())if(x.type==='activity'&&(x.refs||[]).some(r=>r.relation==='variant'&&r.target===o.id))add(x.id);}
  return [...map.values()].filter(o=>wanted.has(o.id)).map(fingerprintObject);
}
export function createServiceExport({id,history,audience,workspace,base}) {
  const recipe=rendererIdentity(), counts={componentsRendered:0,componentsReused:0,resourcesRendered:0,resourcesReused:0};
  const compatible=base?.manifest.recipe===recipe;
  const cache=new Map(), api={id,history,counts};let alias,componentBytes=0;
  api.initialize=(manifest,projection,publicViews,productInput)=>{
    alias=projection.alias;
    if(base&&base.manifest.service!==alias)throw new Error('Base Service does not match selected Service.');
    const views=projection.components.flatMap(c=>c.views).map(v=>audience==='internal'?manifest.model.nativeViews.find(x=>x.id===v.id):publicViews.get(v.id)).filter(Boolean);
    const resources=audience==='internal'?manifest.assets.filter(a=>[...projection.selected].some(id=>manifest.model.objects.find(o=>o.id===id)?.assetIds?.includes(a.id))).map(({contentBase64,...metadata})=>metadata):projection.components.flatMap(c=>c.objects.flatMap(o=>(o.attachments||[]).map(a=>({name:a.name,caption:a.caption,sha256:hash(a.bytes)}))));
    const selectedObjects=manifest.model.objects.filter(o=>projection.selected.has(o.id));
    const lineage=audience==='internal'?(manifest.model.reviewHistory||[]).filter(h=>projection.selected.has(h.objectId)||selectedObjects.some(o=>[...(o.review?.causes||[]),...(o.review?.summaryCauses||[])].includes(h.proposalId))):[];
    const viewIdentity=views.map(v=>audience==='internal'?{view:v,prepared:manifest.nativeViews.find(p=>p.id===v.id)?.prepared.sha256,source:manifest.model.objects.find(o=>o.id===v.source)}:{id:v.id,type:v.type,service:v.service,caption:v.caption,context:v.context,version:v.version,specification:v.specification,bindings:v.bindings,lanes:v.lanes,svg:hash(v.prepared.svg)});
    const components=projection.components.map(c=>({...c,objects:c.objects.map(fingerprintObject)}));
    api.semantic=productInput?identity({version:2,recipe,schema:manifest.identities.schema,nativeRuntime:manifest.identities.code['native-runtime'],audience,productInput}):identity({version:1,recipe,schema:manifest.identities.schema,nativeRuntime:manifest.identities.code['native-runtime'],profile:manifest.model.profile,audience,service:{id:projection.alias,title:projection.service.title,purpose:projection.service.purpose},components,views:viewIdentity,resources,lineage});
    validateServiceHistory(history,id,audience,base?.manifest,api.semantic);
  };
  api.renderComponent=(component,map,anchors,renderer,referenced)=>{
    const objects=inputObjects(component,map), state=component.objects.map(o=>[o.id,anchors.has(`object-${o.id}`)]);
    const key=identity({version:1,recipe,referenced,type:component.type,objects,selected:component.objects.map(o=>o.id),state});
    const name=`cache/components/${key}.md`, old=compatible?base.files.get(name):undefined;let bytes;
    if(old){bytes=old;counts.componentsReused++;for(const o of component.objects)anchors.add(`object-${o.id}`);}else{bytes=Buffer.from(renderer.render(component).markdown);counts.componentsRendered++;}
    componentBytes+=bytes.length;if(componentBytes>16*1024*1024)throw new Error('Service component text exceeds the 16 MiB budget.');
    cache.set(name,bytes);return {markdown:bytes.toString('utf8'),html:''};
  };
  api.renderProductBlock=(nodes,render)=>{
    const key=identity({version:1,recipe,kind:'product-block',nodes}),name=`cache/product/${key}.md`,old=compatible?base.files.get(name):undefined;let bytes;
    if(old){bytes=old;counts.componentsReused++;}else{bytes=Buffer.from(render());counts.componentsRendered++;}
    componentBytes+=bytes.length;if(componentBytes>16*1024*1024)throw new Error('Service product text exceeds the 16 MiB budget.');cache.set(name,bytes);return bytes.toString('utf8');
  };
  api.renderResource=(prepared,render)=>{
    const key=identity({version:1,recipe,svg:prepared.svg,html:prepared.html}),name=`cache/resources/${key}.svg`,old=compatible?base.files.get(name):undefined;let bytes;
    if(old){bytes=old;counts.resourcesReused++;}else{bytes=render();counts.resourcesRendered++;}cache.set(name,bytes);return bytes;
  };
  api.finish=(files,projection,document)=>{
    for(const [name,bytes] of cache)files.set(name,bytes);
    if([...files.values()].reduce((n,b)=>n+b.length,0)>MAX)throw new Error('Service export resources exceed 128 MiB.');
    const payload={kind:'archify-prd-service-export',version:1,recipe,workspace,audience,service:alias,semantic:api.semantic,history:history.entries,historyIdentity:historyIdentity(history.entries),parentHistoryIdentity:history.entries.length>1?historyIdentity(history.entries.slice(0,-1)):null,...(document||{}),artifacts:Object.fromEntries([...files].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([name,bytes])=>[name,{sha256:hash(bytes),bytes:bytes.length}]))};
    const result={...payload,digest:identity(payload)};
    files.set('manifest.json',Buffer.from(`${JSON.stringify(result,null,2)}\n`));return {files,identity:result,projection};
  };
  return api;
}
