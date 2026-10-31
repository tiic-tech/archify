// Feature packets share the product document IR across Markdown and HTML.
import { hash, identity } from './prd-model.mjs';
import { composeProjectedFeatureDocument } from './prd-feature-composer.mjs';
import { externalStandardRulesV1, scopeStandardCatalogV1 } from './prd-standard-composer.mjs';
import { productServiceSelection, renderProductMarkdown, renderProductHtml } from './prd-product-document.mjs';
import { productHtmlDocument } from './prd-product-export.mjs';
import { orderedRecord } from './prd-service.mjs';

const esc = s => String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const md = s => String(s).replaceAll('\\','\\\\').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('|','\\|').replace(/\r?\n/g,'<br>').replace(/([\[\]`*_])/g,'\\$1');
const encodeFacts = objects => objects.map(({attachments,...o})=>orderedRecord(o));
function chapters(nodes){const out=[];let part=[];for(const n of nodes){if(n.type==='heading'&&(n.level<=3||(n.level>=4&&n.id))&&part.length){out.push(part);part=[];}part.push(n);}if(part.length)out.push(part);return out;}

export function renderFeatureExport(manifest,{audience,policy,projection,publicViews,publicProduct,service,markdownOnly,standaloneSvg,imageExtension}) {
  const model=manifest.model, plan=audience==='client'?publicProduct.plan:model.profile.productDocument;
  const serviceId=service?(audience==='client'?projection.alias:service.id):undefined;
  const selectedFeatures=plan.modules.flatMap(m=>m.subModules.flatMap(s=>s.features.filter(f=>!serviceId||f.service===serviceId)));
  const externalRules=serviceId&&plan.standard?externalStandardRulesV1(plan,serviceId):[];
  if(!selectedFeatures.length)throw new Error('No Feature document for selected Service.');
  const key=selectedFeatures.length===1?selectedFeatures[0].key:plan.key;
  const primaryMarkdown=`${key}.prd.${audience}.${plan.language}.md`;
  const files=new Map(),lowerNames=new Map(),resources={views:{},featureViews:{},prototypes:{},assets:{}},viewFacts=[];
  function put(name,bytes){const lower=name.toLowerCase(),previous=lowerNames.get(lower);if(previous&&previous!==name)throw new Error(`Feature artifact name collision: ${name}`);const b=Buffer.from(bytes);if(files.has(name)&&!files.get(name).equals(b))throw new Error(`Feature artifact content collision: ${name}`);lowerNames.set(lower,name);files.set(name,b);}
  for(const f of selectedFeatures)if(f.workflow&&(plan.standard||!resources.views[f.workflow.view])){
    const id=f.workflow.view, v=audience==='client'?[...publicViews.values()].find(x=>x.id===id):manifest.nativeViews.find(x=>x.id===id);
    if(!v)throw new Error('Feature workflow has no prepared approved view.');
    const numbered=plan.standard?(audience==='client'?publicProduct.standardViews:manifest.standardViews)?.find(x=>x.feature===f.id&&x.view===id):null;
    if(plan.standard&&!numbered)throw new Error('Standard Feature workflow has no prepared numbered native view.');
    const prepared=numbered?.prepared||v.prepared,name=plan.standard?`assets/native-${f.id}-${id}.svg`:`assets/native-${id}.svg`,bytes=service?service.renderResource(prepared,()=>Buffer.from(standaloneSvg(prepared))):Buffer.from(standaloneSvg(prepared));
    put(name,bytes);if(plan.standard)resources.featureViews[f.id]={src:name};else resources.views[id]={src:name};
    viewFacts.push(audience==='client'?{id:v.id,service:v.service,caption:v.caption,context:v.context,version:v.version,specification:v.specification,bindings:v.bindings,lanes:v.lanes,svg:hash(prepared.svg)}:{view:model.nativeViews.find(x=>x.id===id),...(numbered?{feature:f.id}:{}),svg:hash(prepared.svg)});
  }
  const selection=service?productServiceSelection(model,service.id):null;
  const selected=selection?.selected||new Set(model.objects.map(o=>o.id));
  const localIds=new Set([...selected].filter(id=>!service||!selection.owners[id]||selection.owners[id]===service.id));
  // A Service extract repeats master document control. Include only questions
  // actually referenced there and scoped to a master project/source; do not
  // widen the Service selection to questions from unrelated Services.
  if(service&&plan.standard){
    const {roles,sharedRules,history,...metadata}=plan.standard, ids=new Set(),visit=v=>{if(!v||typeof v!=='object')return;if(typeof v.question==='string')ids.add(v.question);for(const x of Object.values(v))visit(x);};
    visit(metadata);for(const h of history){const chapters=h.chapters.filter(c=>selectedFeatures.some(f=>f.id===c.feature));visit({...h,chapters});}
    const map=new Map((audience==='client'?publicProduct.objects:model.objects).map(o=>[o.id,o]));for(const id of ids){const q=map.get(id);if(q?.type==='question'&&q.detail.scope.some(target=>['project','source'].includes(map.get(target)?.type))){const source=audience==='client'?[...projection.objects].find(([,o])=>o.id===id)?.[0]:id;if(source)localIds.add(source);}}
  }
  const externalQuestionIds=new Set();
  if(externalRules.length){
    const available=new Map((audience==='client'?publicProduct.objects:model.objects).map(o=>[o.id,o])),aliases=audience==='client'?new Map([...projection.objects].map(([id,o])=>[o.id,id])):null;
    const visit=v=>{if(!v||typeof v!=='object')return;if(typeof v.question==='string'){const q=available.get(v.question);if(q?.type!=='question')throw new Error('External business rule question is not available to this audience.');const id=aliases?aliases.get(q.id):q.id;if(!id)throw new Error('External business rule question is not approved.');if(!localIds.has(id))externalQuestionIds.add(id);localIds.add(id);}for(const x of Object.values(v))visit(x);};visit(externalRules);
  }
  const localAliases=audience==='client'?new Set([...localIds].map(id=>projection.objects.get(id)?.id).filter(Boolean)):null;
  const externalAliases=audience==='client'?new Set([...externalQuestionIds].map(id=>projection.objects.get(id)?.id)):externalQuestionIds;
  const sourceObjects=(audience==='client'?publicProduct.objects.filter(o=>!service||localAliases.has(o.id)):model.objects.filter(o=>localIds.has(o.id))).map(o=>externalAliases.has(o.id)?{id:o.id,type:o.type,title:o.title,purpose:o.purpose}:o);
  const objects=encodeFacts(sourceObjects);
  const scopedPlan={...plan,modules:plan.modules.map(m=>({...m,subModules:m.subModules.map(s=>({...s,features:s.features.filter(f=>!serviceId||f.service===serviceId)})).filter(s=>s.features.length)})).filter(m=>m.subModules.length)};
  if(serviceId&&scopedPlan.standard){const catalog=scopeStandardCatalogV1(objects,scopedPlan,serviceId),featureIds=new Set(selectedFeatures.map(f=>f.id));scopedPlan.standard={...scopedPlan.standard,...catalog,history:scopedPlan.standard.history.map(h=>({...h,chapters:h.chapters.filter(c=>featureIds.has(c.feature))}))};}
  const assetLinks=[];
  const pageIds=new Set(selectedFeatures.flatMap(f=>(f.actions||[]).flatMap(a=>a.pages.map(p=>p.variant||p.interface))));
  const projectedByAlias=audience==='client'?new Map([...projection.objects.values()].map(o=>[o.id,o])):null;
  const authoredAssets=new Map(manifest.assets.map(a=>[a.id,a]));
  for(const id of pageIds){
    const o=audience==='client'?projectedByAlias.get(id):model.objects.find(x=>x.id===id), images=[];
    if(audience==='client')for(const a of o?.attachments||[]){put(a.name,a.bytes);const resource={src:a.name,caption:a.caption};images.push(resource);if(a.id)resources.assets[a.id]=resource;}
    else for(const aid of o?.assetIds||[]){const a=authoredAssets.get(aid);if(!a)throw new Error('Feature page asset is missing.');const bytes=Buffer.from(a.contentBase64,'base64'),ext=imageExtension(a.mediaType,bytes);if(!ext)continue;const name=`assets/audit-${a.sha256}.${ext}`;put(name,bytes);const resource={src:name,caption:[a.caption||a.name,a.version?`Version: ${a.version}`:null,a.limitations].filter(Boolean).join(' — ')};images.push(resource);resources.assets[aid]=resource;}
    if(images.length)resources.prototypes[id]=images;
  }
  if(audience==='internal'){
    const assets=new Map(manifest.assets.map(a=>[a.id,a]));
    for(const o of sourceObjects)for(const id of o.assetIds||[]){const a=assets.get(id);if(!a)throw new Error('Feature audit asset is missing.');const bytes=Buffer.from(a.contentBase64,'base64'),ext=imageExtension(a.mediaType,bytes)||'bin',name=`assets/audit-${a.sha256}.${ext}`;put(name,bytes);assetLinks.push({name,caption:a.caption||a.name});}
  } else for(const [id,o] of projection.objects)if(!service||localIds.has(id)&&!externalQuestionIds.has(id))for(const a of o.attachments||[]){put(a.name,a.bytes);assetLinks.push({name:a.name,caption:a.caption});}
  const productInput={version:2,plan:scopedPlan,objects,views:viewFacts,prototypes:resources.prototypes,assets:assetLinks.map(a=>({...a,sha256:hash(files.get(a.name))})),...(externalRules.length?{externalRules}:{})};
  if(service)service.initialize(manifest,projection,publicViews,productInput);
  const ir=composeProjectedFeatureDocument({objects,plan:scopedPlan},{service:serviceId,resources,history:service?.history.entries||[],externalRules});
  ir.nodes.push({type:'companion'});
  const markdown=service?chapters(ir.nodes).map(nodes=>service.renderProductBlock(nodes,()=>renderProductMarkdown({nodes}))).join(''):renderProductMarkdown(ir);
  const auditNodes=[{type:'heading',level:1,text:'Technical authored fact appendix'},{type:'heading',level:2,text:'Semantic group coverage'}],groupRows=[];
  let audit=`# Technical authored fact appendix\n\n[Main PRD](${primaryMarkdown})\n\n## Semantic group coverage\n\n| Feature / context | Group | Source facts |\n| --- | --- | --- |\n`;
  for(const module of scopedPlan.modules)for(const sub of module.subModules)for(const f of sub.features)for(const a of f.actions||[]){
    const context=objects.find(o=>o.id===a.activity)?.title||a.activity;
    const row=(g,where)=>{const values=[`${f.title} / ${context}${where?` / ${where}`:''}`,`${g.title} (${g.id})`,g.sources.join(', ')];groupRows.push(values);audit+=`| ${values.map(md).join(' | ')} |\n`;};
    for(const g of a.groups)row(g,'');
    for(const page of a.pages)for(const g of page.groups)row(g,objects.find(o=>o.id===page.interface)?.title||page.interface);
  }
  auditNodes.push({type:'table',headers:['Feature / context','Group','Source facts'],rows:groupRows},{type:'heading',level:2,text:'Workflow provenance'});
  audit+='\n## Workflow provenance\n\n| Workflow | Authored view facts |\n| --- | --- |\n';
  const workflowRows=viewFacts.map(v=>[v.id||v.view.id,JSON.stringify(orderedRecord(v))]);
  for(const row of workflowRows)audit+=`| ${row.map(md).join(' | ')} |\n`;
  auditNodes.push({type:'table',headers:['Workflow','Authored view facts'],rows:workflowRows});
  audit+='\n';
  for(const o of objects){audit+=`## ${md(o.title)}\n\n| Fact | Value |\n| --- | --- |\n`;const rows=Object.entries(o).map(([k,v])=>[k,typeof v==='object'?JSON.stringify(v):String(v)]);for(const row of rows)audit+=`| ${row.map(md).join(' | ')} |\n`;audit+='\n';auditNodes.push({type:'heading',level:2,text:o.title},{type:'table',headers:['Fact','Value'],rows});}
  if(assetLinks.length){audit+='## Assets\n\n';for(const a of assetLinks)audit+=`- [${md(a.caption)}](${a.name})\n`;audit+='\n';}
  put(primaryMarkdown,markdown);put('README.md',`# PRD packet\n\n[Primary Markdown](${primaryMarkdown}) · [Technical fact appendix](appendix.md)\n`);put('appendix.md',audit);
  if(!markdownOnly){
    const link=`<p><a href="${esc(primaryMarkdown)}">Primary Markdown</a></p>`;
    const assets=assetLinks.length?`<h2>Assets</h2><ul>${assetLinks.map(a=>`<li><a href="${esc(a.name)}">${esc(a.caption)}</a></li>`).join('')}</ul>`:'';
    put('index.html',productHtmlDocument('Feature requirements',link+renderProductHtml(ir)));
    put('appendix.html',productHtmlDocument('Technical authored fact appendix',link+renderProductHtml({nodes:auditNodes})+assets));
  }
  const document={primaryMarkdown,auditMarkdown:'appendix.md',features:ir.features.map(f=>({...f,artifact:primaryMarkdown,...(f.workflow?{workflowAsset:plan.standard?resources.featureViews[f.id].src:resources.views[f.workflow].src}:{})})),assets:[...files.keys()].filter(x=>x.startsWith('assets/')).sort()};
  if([...files.values()].reduce((n,b)=>n+b.length,0)>128*1024*1024)throw new Error('Feature export resources exceed 128 MiB.');
  if(service)return service.finish(files,projection,document);
  const exportIdentity={kind:'archify-prd-export',version:1,audience,revision:manifest.revision,documentLayout:'product-v2',profile:manifest.identities.profile,schema:manifest.identities.schema,preparation:manifest.identities.code,sourceManifest:audience==='internal'?manifest.digest:undefined,disclosure:audience==='client'?identity(policy):null,exporter:hash(Buffer.from('product-export-v2'+JSON.stringify(manifest.identities.code))),componentsRenderer:manifest.identities.code['prd-product-document.mjs'],nativeRuntime:manifest.identities.code['native-runtime'],...document,artifacts:Object.fromEntries([...files].map(([name,bytes])=>[name,{sha256:hash(bytes),bytes:bytes.length}]))};
  files.set('manifest.json',Buffer.from(`${JSON.stringify(exportIdentity,null,2)}\n`));
  const featureCorrespondence=selectedFeatures.map(f=>({id:f.id,title:f.title,service:f.service,status:f.status,...(f.workflow?{workflow:f.workflow.view,workflowCaption:f.workflow.caption}:{}),artifact:primaryMarkdown,anchor:f.id}));
  return {files,identity:exportIdentity,projection,publicViews,publicProduct,featureCorrespondence};
}
