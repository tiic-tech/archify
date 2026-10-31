import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareExplainerDiagrams } from '../diagrams.mjs';
import { canonical, diagnostic, freeze, hash, identity, semanticModel, validatePrd, readiness, componentRecords, serviceOwners } from './prd-model.mjs';

function fail(code, locator, message, evidence, fix) { return diagnostic(code,locator,message,evidence,fix); }
// Native modes that expose the existing Viewer drilldown contract.
export function nativeDrilldownNodes(view) {
  const key={architecture:'components',workflow:'nodes',sequence:'participants',dataflow:'nodes',lifecycle:'states'}[view.diagramType];
  return key ? view.spec[key] || [] : [];
}
function nativeRuntimeIdentity() {
  const root=fileURLToPath(new URL('../..',import.meta.url)), files=[];
  function visit(relative) {
    const absolute=path.join(root,relative), stat=fs.lstatSync(absolute);
    if(stat.isSymbolicLink()) throw new Error(`Unexpected symlink in native runtime: ${relative}`);
    if(stat.isDirectory()) for(const name of fs.readdirSync(absolute).sort()) visit(`${relative}/${name}`);
    else if(stat.isFile()) files.push([relative,hash(fs.readFileSync(absolute))]);
  }
  for(const relative of ['renderers','schemas','assets','explainer/diagrams.mjs','explainer/check.mjs','scripts/check-render-output.mjs']) visit(relative);
  return identity(files);
}
function readAsset(root, asset) {
  // Do not follow any symlink, including an intermediate directory. Restrict to
  // portable relative paths so Windows-style traversal is rejected on POSIX too.
  const rel=asset.path;
  if(!rel || path.isAbsolute(rel) || rel.includes('\\') || rel.includes('\0') || rel.split('/').some(p=>!p||p==='.'||p==='..') || /^[A-Za-z]:/.test(rel)) throw new Error('unsafe relative path');
  let current=root;
  for(const part of rel.split('/')) { current=path.join(current,part); if(fs.lstatSync(current).isSymbolicLink()) throw new Error('symlink in asset path'); }
  const resolved=fs.realpathSync(current), relative=path.relative(root,resolved);
  if(!relative || relative.startsWith(`..${path.sep}`) || relative==='..' || path.isAbsolute(relative)) throw new Error('asset escapes project directory');
  const fd=fs.openSync(current,fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW||0));
  try { const stat=fs.fstatSync(fd); if(!stat.isFile()||stat.size>16*1024*1024) throw new Error('asset must be a regular file at most 16 MiB'); return fs.readFileSync(fd); } finally { fs.closeSync(fd); }
}
export function numberStandardWorkflow(spec,steps) {
  const numbered=structuredClone(spec);
  for(const node of numbered.nodes){const numbers=steps.filter(step=>step.node===node.id).map(step=>step.number);if(!numbers.length)continue;const label=String(node.label||'');const missing=numbers.filter(number=>!new RegExp(`(?:^|[^A-Za-z0-9])${number}(?:$|[^A-Za-z0-9])`).test(label));if(missing.length)node.label=`${missing.join(', ')} ${label}`;}
  return numbered;
}
export function isStaleReviewDiagnostic(d) {
  return d.code==='prd/product-document-v2'&&d.message==='Reviewed summary is stale.' || d.code==='prd/product-standard'&&d.message==='Reviewed standard text is stale.';
}

export async function preparePrd(input, { inputPath, expectRevision, ready, baseManifest, feedbackCandidate = false } = {}) {
  const checked=validatePrd(input), diagnostics=checked.diagnostics.map(d => feedbackCandidate && isStaleReviewDiagnostic(d) ? {...d,severity:'warning'} : d);
  // A feedback candidate may be saved for explicit review, but it is not a
  // publishable model. No caller refreshes hashes or changes approval status.
  if(diagnostics.some(d=>d.severity==='error')) return {ok:false,diagnostics};
  const model=JSON.parse(JSON.stringify(input));
  const revision=identity(semanticModel(model));
  const root=fs.realpathSync(path.dirname(path.resolve(inputPath)));
  const assets=[]; let assetBytes=0;
  for(const [i,a] of model.assets.entries()){
    try {const bytes=readAsset(root,a); if(hash(bytes)!==a.sha256) throw new Error('content hash mismatch'); assetBytes+=bytes.length; if(assetBytes>64*1024*1024) throw new Error('aggregate asset budget exceeded'); assets.push({...a,bytes:bytes.length,contentBase64:bytes.toString('base64')});}
    catch(error){diagnostics.push(fail('asset-invalid',`/assets/${i}/path`,'Asset cannot be safely verified.',{path:a.path,reason:error.message},'Use a local project-relative regular file with the declared SHA-256.'));}
  }
  const diagrams=Object.create(null), owners=serviceOwners(model);
  for(const [i,v] of model.nativeViews.entries()) {
    try {
      const block={id:v.id,type:'diagram',diagramType:v.diagramType,spec:v.spec};
      const result=await prepareExplainerDiagrams({meta:{locale:'en'},blocks:[block]},{baseDir:root,sourcePath:path.resolve(inputPath),quality:'standard'});
      diagrams[v.id]=result.diagrams[v.id];
      const allowed={workflow:['activity','rule'],lifecycle:['state'],architecture:['service','capability','integration','action','entity'],sequence:['role','action','api','integration'],dataflow:['service','action','api','integration','entity'],erd:['entity'],tree:['taxonomy','capability','service'],class:['entity'],timeline:['activity','phase','state'],waterfall:['capability','phase','activity']};
      const nodes=new Set(diagrams[v.id].semantic.nodes.map(n=>n.id)), bound=new Set();
      const authoredNodes=new Map(nativeDrilldownNodes(v).map(node=>[node.id,node]));
      const objects=new Map(model.objects.map(object=>[object.id,object]));
      const activities=v.bindings.filter(b=>b.type==='activity').map(b=>objects.get(b.object)).filter(o=>o?.type==='activity');
      const activityOwners=activities.map(o=>owners[o.id]), inferredService=activityOwners.length&&activityOwners.every(o=>o&&o===activityOwners[0])?activityOwners[0]:null;
      const workflowService=v.service||inferredService;
      const lanes=new Set((v.spec.lanes||[]).map(l=>l.id)), boundLanes=new Set();
      for(const [j,b] of (v.laneBindings||[]).entries()) {
        if(v.diagramType!=='workflow'||!lanes.has(b.lane)||boundLanes.has(b.lane)) diagnostics.push(fail('native-lane',`/nativeViews/${i}/laneBindings/${j}`,'Lane binding is invalid or duplicated.',{lane:b.lane},'Bind each workflow lane once to a role.'));
        boundLanes.add(b.lane);
      }
      if(v.diagramType==='workflow') for(const lane of lanes) if(!boundLanes.has(lane)) diagnostics.push(fail('native-lane',`/nativeViews/${i}/laneBindings`,'Workflow lane has no role binding.',{lane},'Bind each workflow lane to a role.'));
      for(const [j,b] of v.bindings.entries()){
        const loc=`/nativeViews/${i}/bindings/${j}`;
        if(!nodes.has(b.node)) diagnostics.push(fail('native-node',`${loc}/node`,'Native node does not exist.',{node:b.node,view:v.id},'Bind a node from the validated native view.'));
        if(bound.has(b.node)) diagnostics.push(fail('native-binding',loc,'Native node has multiple object bindings.',{node:b.node},'Use one binding per native node.'));
        bound.add(b.node);
        if(allowed[v.diagramType]&&!allowed[v.diagramType].includes(b.type)) diagnostics.push(fail('native-object-type',`${loc}/type`,'Object type is incompatible with this native view.',{type:b.type,diagramType:v.diagramType},'Bind an object type supported by this native diagram mode.'));
        const activity=objects.get(b.object), lane=authoredNodes.get(b.node)?.lane;
        if(b.targets) {
          const node=authoredNodes.get(b.node), nativeTargets=node?.drilldowns?.map(d=>d.href) || (node?.href?[node.href]:[]);
          if(!node || nativeTargets.length!==b.targets.length || b.targets.some((target,k)=>target.href!==nativeTargets[k]) || new Set(nativeTargets).size!==nativeTargets.length) diagnostics.push(fail('native-targets',`${loc}/targets`,'Target bindings must match the ordered native targets.',{node:b.node},'Bind each authored native target once in its original order.'));
          for(const [k,target] of b.targets.entries()) {
            const linked=(activity?.refs||[]).some(r=>r.target===target.object)||objects.get(target.object)?.parent===activity?.id;
            if(!linked) diagnostics.push(fail('native-target-context',`${loc}/targets/${k}`,'Target is not a direct relationship of the bound object.',{node:b.node,object:b.object,target:target.object},'Bind a directly related model object.'));
          }
        }
        if(v.diagramType==='workflow' && activity?.type==='rule') {
          const scope=activity.rule?.scope||[];
          const relevant=workflowService&&scope.includes(workflowService)||activities.some(a=>scope.includes(a.id));
          if(!relevant) diagnostics.push(fail('native-rule-context',loc,'Workflow rule is not explicitly relevant to this Service or a bound activity.',{view:v.id,rule:activity.id,service:workflowService},'Scope the rule to the workflow Service or a bound activity.'));
        }
        if(v.diagramType==='workflow' && v.service && activity?.type==='activity') {
          const owner=owners[activity.id];
          if(owner && owner!==v.service) diagnostics.push(fail('native-service-mismatch',loc,'Workflow activity belongs to a different service.',{view:v.id,service:v.service,activity:activity.id,owner},'Use the owning service or bind activities from the selected service.'));
        }
        const laneMappings=(v.laneBindings||[]).filter(binding=>binding.lane===lane);
        if(v.diagramType==='workflow' && nodes.has(b.node) && activity?.type==='activity' && activity.detail.actorKind==='human' && laneMappings.length===1) {
          const laneRole=laneMappings[0].role;
          const actors=[...new Set((activity.refs||[]).filter(ref=>ref.relation==='actor').map(ref=>ref.target))].sort();
          if(actors.length!==1 || actors[0]!==laneRole) diagnostics.push(fail('native-actor-mismatch',loc,'Human activity actors do not match the mapped workflow lane role.',{view:v.id,node:b.node,activity:activity.id,lane,laneRole,actors},'Align the activity actor with the lane role or move the node to its actor’s mapped lane.'));
        }
      }
    } catch(error) {
      diagnostics.push(fail('native-invalid',`/nativeViews/${i}/spec`,'Native validation or preparation failed.',{reason:error.message,native:error.archifyDiagnostics||error.diagnostics||[]},'Correct the native specification using its native contract.'));
    }
  }
  let ancestry;
  if(baseManifest){
    const {digest,...payload}=baseManifest;
    if(baseManifest.kind!=='archify-prd-manifest'||baseManifest.schemaVersion!==1||typeof digest!=='string'||identity(payload)!==digest||!baseManifest.model||!validatePrd(baseManifest.model).ok||identity(semanticModel(baseManifest.model))!==baseManifest.revision){
      diagnostics.push(fail('base-invalid','/','Base manifest identity is invalid.',{},'Supply an unchanged compiled PRD manifest.'));
    } else {
      ancestry={revision:baseManifest.revision,manifestDigest:digest};
      if(!expectRevision || expectRevision!==baseManifest.revision) diagnostics.push(fail('revision-mismatch','/','Expected revision must match the base manifest.',{expected:expectRevision||null,actual:baseManifest.revision},'Supply --expect-revision matching the base manifest revision.'));
      if(baseManifest.model.workspaceId && model.workspaceId!==baseManifest.model.workspaceId) diagnostics.push(fail('workspace-immutable','/workspaceId','A workspace identity cannot be changed or removed in an established ancestry.',{base:baseManifest.model.workspaceId,current:model.workspaceId||null},'Retain the original workspace ID.'));
      const oldHistory=baseManifest.model.reviewHistory||[], newHistory=model.reviewHistory||[];
      if(oldHistory.some((entry,i)=>canonical(entry)!==canonical(newHistory[i]))) diagnostics.push(fail('review-history-immutable','/reviewHistory','Existing review history cannot be rewritten or removed.',{},'Retain all previous history entries in order.'));
      const currentObjects=new Map(model.objects.map(o=>[o.id,o]));
      for(const old of baseManifest.model.objects){
        const current=currentObjects.get(old.id);
        if(current && current.type!==old.type) diagnostics.push(fail('object-identity','/objects','An existing object ID cannot be reassigned to another type.',{id:old.id,baseType:old.type,currentType:current.type},'Keep the original ID and type or use a new ID.'));
        if(['causes','summaryCauses'].some(key=>(old.review?.[key]||[]).some(cause=>!current?.review?.[key]?.includes(cause)))) diagnostics.push(fail('review-flag-immutable','/objects','Existing review flags cannot be silently removed in an established ancestry.',{id:old.id},'Retain review causes; later confirmation requires a separately authorized workflow.'));
      }
      const now=new Map(model.objects.filter(o=>o.type==='source').map(o=>[o.id,o]));
      for(const old of baseManifest.model.objects.filter(o=>o.type==='source')){
        const current=now.get(old.id);
        if(!current || canonical(current.source)!==canonical(old.source)) diagnostics.push(fail('source-immutable','/objects','A base source record was changed or removed.',{id:old.id},'Keep the original source record; add a new source ID and version for changes.'));
      }
    }
  } else if(expectRevision && expectRevision!==revision) diagnostics.push(fail('revision-mismatch','/','Expected revision does not match the model.',{expected:expectRevision,actual:revision},'Use the current model revision or provide an explicit base manifest.'));
  if(ready) diagnostics.push(...readiness(model,ready));
  const components=componentRecords(model,diagnostics);
  const covered=new Set(components.flatMap(c=>c.records.map(r=>r.objectId)));
  model.objects.forEach((o,i)=>{if(!covered.has(o.id)) diagnostics.push(diagnostic('unprojected-object',`/objects/${i}`,'The profile does not select this object; it remains in the model.',{id:o.id},'Add a component selector for this object.','warning'));});
  if(diagnostics.some(d=>d.severity==='error')) return {ok:false,diagnostics};
  // Candidate preparation never issues a reusable or publishable manifest.
  if(feedbackCandidate) return {ok:true,diagnostics,candidateRevision:revision};
  const standardViews=[];
  if(model.profile.productDocument?.standard){
    const features=model.profile.productDocument.modules.flatMap(m=>m.subModules.flatMap(s=>s.features));
    for(const feature of features)if(feature.workflow){
      const view=model.nativeViews.find(v=>v.id===feature.workflow.view),spec=numberStandardWorkflow(view.spec,feature.standard.sections[3].steps);
      try {const out=await prepareExplainerDiagrams({meta:{locale:'en'},blocks:[{id:view.id,type:'diagram',diagramType:'workflow',spec}]},{baseDir:root,sourcePath:path.resolve(inputPath),quality:'standard'});const prepared=JSON.parse(JSON.stringify(out.diagrams[view.id]));if(prepared.checks?.check)delete prepared.checks.check.file;
        const pairs=x=>x.semantic.edges.map(e=>`${e.from}\0${e.to}`).sort();if(JSON.stringify(pairs(prepared))!==JSON.stringify(pairs(diagrams[view.id])))throw new Error('Numbered native workflow changed its topology.');
        standardViews.push({feature:feature.id,view:view.id,prepared});
      }catch(error){diagnostics.push(fail('standard-workflow',`/profile/productDocument`,'Numbered native workflow could not be prepared.',{feature:feature.id,reason:error.message,native:error.archifyDiagnostics||error.diagnostics||[]},'Correct the native workflow or its numbered step mapping.'));}
    }
    if(diagnostics.some(d=>d.severity==='error'))return {ok:false,diagnostics};
  }
  const codeFiles=['prd-standard-v1.mjs','prd-standard-refinements.mjs','prd-standard-context.mjs','prd-standard-composer.mjs','prd-model.mjs','prd-product-document.mjs','prd-product-v2.mjs','prd-product-public-v2.mjs','prd-feature-composer.mjs','prd-feature-export.mjs','prd-product-export.mjs','prd-product-public.mjs','prd-service.mjs','prd-prepare.mjs','prd-cli.mjs','prd-feedback-schema.mjs','prd-proposal-schema.mjs','generated-prd-validators.mjs','generated-prd-feedback-browser.js','prd-feedback.mjs','prd-feedback-cli.mjs','prd-proposal.mjs','prd-reader-build.mjs','prd-reader.js','prd-reader.css','prd-reader-bridge.js','prd-reader-package.mjs','prd-reader-feedback.js'];
  if(model.profile.productDocument?.version===2)codeFiles.push('prd-export.mjs');
  const code=Object.fromEntries(codeFiles.map(f=>[f,hash(fs.readFileSync(new URL(`./${f}`,import.meta.url)))]));
  code['native-runtime']=nativeRuntimeIdentity();
  code['native-diagrams.mjs']=hash(fs.readFileSync(new URL('../diagrams.mjs',import.meta.url)));
  for(const type of new Set(model.nativeViews.map(v=>v.diagramType))) code[`render-${type}.mjs`]=hash(fs.readFileSync(new URL(`../../renderers/${type}/render-${type}.mjs`,import.meta.url)));
  const schema=hash(fs.readFileSync(new URL('../../schemas/prd-workspace.schema.json',import.meta.url)));
  const nativeViews=model.nativeViews.map(v=>{
    // Native checks report their owned temporary output path, which is not a
    // resource identity and must not make an otherwise identical build vary.
    const prepared=JSON.parse(JSON.stringify(diagrams[v.id]));
    if(prepared.checks?.check) delete prepared.checks.check.file;
    return {id:v.id,source:v.source,anchor:v.anchor,bindings:v.bindings,laneBindings:v.laneBindings||[],prepared};
  });
  const payload={kind:'archify-prd-manifest',schemaVersion:1,revision,ancestry:ancestry||null,identities:{schema,code,profile:identity(model.profile)},model,assets,nativeViews,...(model.profile.productDocument?.standard?{standardViews}:{}),components,diagnostics};
  const manifest=freeze({...payload,digest:identity(payload)});
  return {ok:true,diagnostics,manifest};
}
