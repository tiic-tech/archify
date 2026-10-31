// Offline feedback is an external journal, never a requirements model or approval.
import { bindingQuestions, canonical, diagnostic, identity, predicateFields, reviewDependents } from './prd-model.mjs';
import { feedbackPackage as checkPackage, publicFeedbackPackage as checkPublicPackage, feedbackStore as checkStore } from './generated-prd-validators.mjs';
export { quotePaths } from './prd-feedback-schema.mjs';
const fail=(code,loc,message,evidence,fix)=>({ok:false,diagnostics:[diagnostic(`feedback-${code}`,loc,message,evidence,fix)]});
function shape(check,value){
  if(check(value)) return null;
  return {ok:false,diagnostics:check.errors.map(e=>diagnostic('feedback-schema',e.instancePath||'/',e.message,{keyword:e.keyword,params:e.params},'Correct the feedback document to the v1 contract.'))};
}
function sorted(comments){return [...comments].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);}
function duplicates(comments){const seen=new Set(); for(const c of comments){if(seen.has(c.id)) return c.id; seen.add(c.id);} return null;}
// Shared verbatim with the browser after schema validation. These fields are
// immutable comment content, so P3's existing conflict and store hash cover them.
export function feedbackProvenanceError(value){
  for(const [index,c] of value.comments.entries()){
    const p=c.publicOrigin;if(!p)continue;
    if(p.workspaceId!==value.workspaceId||p.revision!==c.baseRevision||p.sourceSnapshot.path!==c.quoteSnapshot.path||Boolean(p.assetId)!==Boolean(c.assetAnchor))return {index,reason:'Public origin does not match the comment workspace, revision, property or asset anchor.'};
    if(c.sourceAnchor)return {index,reason:'A mapped public comment cannot contain a private source anchor.'};
  }
  return null;
}
function validateProvenance(value){const bad=feedbackProvenanceError(value);return bad?fail('public-origin',`/comments/${bad.index}/publicOrigin`,bad.reason,{},'Use an intact mapped comment and its matching workspace.'):null;}
function validateTimes(comments){
  for(const [i,c] of comments.entries()){
    const milliseconds=Date.parse(c.time), normalized=c.time.replace(/(?:\.(\d{1,3}))?Z$/,(_,fraction)=>`.${(fraction||'').padEnd(3,'0')}Z`);
    if(!Number.isFinite(milliseconds)||new Date(milliseconds).toISOString()!==normalized) return fail('time',`/comments/${i}/time`,'Comment time is not a valid UTC timestamp.',{time:c.time},'Provide a real UTC time in the documented format.');
    const r=c.assetAnchor?.region; if(r&&(r.x+r.width>1||r.y+r.height>1)) return fail('asset-region',`/comments/${i}/assetAnchor/region`,'Asset region extends beyond its bounds.',{},'Use normalized coordinates within the asset.');
  }
  return null;
}
export function validatePackage(value){
  const bad=shape(checkPackage,value); if(bad) return bad;
  const dup=duplicates(value.comments); if(dup) return fail('duplicate-id','/comments','Comment IDs must be unique within a package.',{id:dup},'Remove the duplicate comment.');
  return validateProvenance(value)||validateTimes(value.comments)||{ok:true,diagnostics:[]};
}
export function validatePublicPackage(value){
  const bad=shape(checkPublicPackage,value);if(bad)return bad;
  const dup=duplicates(value.comments);if(dup)return fail('duplicate-id','/comments','Comment IDs must be unique within a package.',{id:dup},'Remove the duplicate comment.');
  const mismatch=value.comments.find(c=>c.baseRevision!==value.revision);if(mismatch)return fail('public-revision','/comments','Every public comment must match the package revision.',{id:mismatch.id},'Use an unchanged package for the same projection.');
  return validateTimes(value.comments)||{ok:true,diagnostics:[]};
}
export function validateStore(value){
  const bad=shape(checkStore,value); if(bad) return bad;
  const {revision,...payload}=value;
  if(revision!==identity(payload)) return fail('store-integrity','/revision','Store revision does not match its contents.',{revision},'Use an unchanged store version.');
  const dup=duplicates(value.comments); if(dup) return fail('duplicate-id','/comments','Store has duplicate comment IDs.',{id:dup},'Use a valid store version.');
  if(canonical(value.comments)!==canonical(sorted(value.comments))) return fail('store-order','/comments','Store comments are not in canonical ID order.',{},'Use a valid store version.');
  return validateProvenance(value)||validateTimes(value.comments)||{ok:true,diagnostics:[]};
}
export function importFeedback(model,pkg,store,expected){
  let checked=validatePackage(pkg); if(!checked.ok) return checked;
  if(!model.workspaceId || model.workspaceId!==pkg.workspaceId) return fail('workspace-mismatch','/workspaceId','Package does not belong to this explicitly identified workspace.',{model:model.workspaceId||null,package:pkg.workspaceId},'Use the matching workspace and package.');
  if(store){
    checked=validateStore(store); if(!checked.ok) return checked;
    if(store.workspaceId!==model.workspaceId) return fail('workspace-mismatch','/workspaceId','Store belongs to a different workspace.',{store:store.workspaceId,model:model.workspaceId},'Use the matching workspace and store.');
    if(!expected||expected!==store.revision) return fail('store-revision','/revision','Expected store revision does not match.',{expected:expected||null,actual:store.revision},'Reload the current store version and retry with its revision.');
  } else if(expected) return fail('store-revision','/revision','Expected revision requires a store.',{expected},'Supply the expected store version.');
  const merged=new Map((store?.comments||[]).map(c=>[c.id,c])); let added=0;
  for(const c of pkg.comments){const old=merged.get(c.id); if(old && canonical(old)!==canonical(c)) return fail('comment-conflict','/comments','A comment ID already has different content.',{id:c.id},'Resolve the conflicting identity explicitly.'); if(!old){merged.set(c.id,c);added++;}}
  const payload={kind:'archify-prd-feedback-store',schemaVersion:1,workspaceId:model.workspaceId,comments:sorted([...merged.values()])};
  return {ok:true,store:{...payload,revision:identity(payload)},added,diagnostics:[]};
}
export function exportFeedback(store){const checked=validateStore(store); if(!checked.ok) return checked; return {ok:true,package:{kind:'archify-prd-feedback',schemaVersion:1,workspaceId:store.workspaceId,comments:store.comments},diagnostics:[]};}
function getSnapshot(object,path){return path.slice(1).split('/').reduce((value,key)=>value?.[key],object);}
export function inspectFeedback(model,revision,store){
  const checked=validateStore(store); if(!checked.ok) return checked;
  if(!model.workspaceId||model.workspaceId!==store.workspaceId) return fail('workspace-mismatch','/workspaceId','Store does not belong to this workspace.',{model:model.workspaceId||null,store:store.workspaceId},'Use the matching store.');
  const objects=new Map(model.objects.map(o=>[o.id,o])), assets=new Map(model.assets.map(a=>[a.id,a]));
  const metadataTypes=new Set(['source','evidence','decision','question','revision']);
  const contexts=new Map();
  function contextFor(id){
    if(contexts.has(id)) return contexts.get(id);
    const target=objects.get(id), core=new Set();
    if(target){
      const seeds=new Set([id]);
      // A history/source target explicitly names its own scope or direct users.
      // A source merely encountered as provenance does not fan out to its users.
      if(metadataTypes.has(target.type)) {
        for(const scoped of (Array.isArray(target.detail.scope)?target.detail.scope:[])) seeds.add(scoped);
        for(const ref of target.refs||[]) if(ref.relation==='target') seeds.add(ref.target);
        for(const o of model.objects) if((o.refs||[]).some(ref=>ref.target===id)) seeds.add(o.id);
      }
      for(const dependent of reviewDependents(model,[...seeds])) core.add(dependent);
    }
    const semantic=new Set(core), queue=[...core], related=new Set(core);
    const addSemantic=id=>{if(objects.has(id)&&!semantic.has(id)){semantic.add(id);related.add(id);queue.push(id);}};
    for(let i=0;i<queue.length;i++){
      const o=objects.get(queue[i]); if(!o) continue;
      // Ancestors supply context only: do not traverse their children or refs.
      let parent=o.parent;
      while(parent&&objects.has(parent)&&!related.has(parent)){related.add(parent);parent=objects.get(parent).parent;}
      if(metadataTypes.has(o.type)) {
        for(const ref of o.refs||[]) if(['derivedFrom','supersedes'].includes(ref.relation)) addSemantic(ref.target);
        continue;
      }
      // An explicitly affected rule brings its entire scope. A shared rule
      // encountered through one consumer must not expand to other scopes.
      const exceptions=(o.rule?.exceptions||[]).filter(e=>core.has(o.id)||e.scope.some(id=>core.has(id)));
      const deps=[...(o.refs||[]).filter(ref=>ref.relation!=='next').map(ref=>ref.target),...(core.has(o.id)?o.rule?.scope||[]:[]),...bindingQuestions(o)];
      for(const p of [o.detail.predicate,o.detail.condition,o.detail.visibility,o.detail.editable,o.detail.required,o.rule?.condition,...exceptions.map(e=>e.condition)]) deps.push(...predicateFields(p).map(field=>field.id));
      for(const dep of deps) addSemantic(dep);
    }
    // A scoped exception can name a target without that target referencing
    // the rule. Retain the complete rule as context, never as a reverse edge
    // that expands its unrelated scope.
    const historyTargets=new Set(semantic);
    for(const o of model.objects) if(o.rule && !semantic.has(o.id) && (o.rule.exceptions||[]).some(e=>e.scope.some(id=>core.has(id)) && predicateFields(e.condition).some(field=>core.has(field.id)))) {
      related.add(o.id); historyTargets.add(o.id);
      for(const ref of o.refs||[]) if(['derivedFrom','decision','evidence'].includes(ref.relation)) addSemantic(ref.target);
    }
    // Relevant scoped history is included whole, but its scope and sources are
    // not reverse edges into every other object sharing those records.
    for(const o of model.objects) if(metadataTypes.has(o.type) && o.type!=='source' && ((Array.isArray(o.detail.scope)&&o.detail.scope.some(id=>historyTargets.has(id))) || (o.refs||[]).some(ref=>ref.relation==='target'&&historyTargets.has(ref.target)))) addSemantic(o.id);
    // Follow only provenance and typed supersession for added history records.
    for(let i=0;i<queue.length;i++){
      const o=objects.get(queue[i]); if(!o||!metadataTypes.has(o.type)) continue;
      for(const ref of o.refs||[]) if(['derivedFrom','supersedes'].includes(ref.relation)) addSemantic(ref.target);
    }
    const views=model.nativeViews.filter(v=>v.bindings.some(b=>semantic.has(b.object)) || target?.type==='source'&&v.source===id);
    for(const view of views) related.add(view.source);
    const relevantAssets=new Set(model.objects.filter(o=>related.has(o.id)).flatMap(o=>o.assetIds||[]));
    const result={context:model.objects.filter(o=>related.has(o.id)),assets:model.assets.filter(a=>relevantAssets.has(a.id)),nativeAnchors:views.map(v=>({id:v.id,source:v.source,anchor:v.anchor,bindings:v.bindings,laneBindings:v.laneBindings||[]}))};
    contexts.set(id,result); return result;
  }
  const comments=[];
  let outputBytes=Buffer.byteLength(JSON.stringify({ok:true,workspaceId:model.workspaceId,revision,storeRevision:store.revision,comments:[],diagnostics:[]}));
  for(const c of store.comments){
    const object=objects.get(c.objectId), reasons=[];
    if(!object) reasons.push('target-deleted-or-reassigned');
    if(c.baseRevision!==revision) reasons.push('base-revision-changed');
    if(object && getSnapshot(object,c.quoteSnapshot.path)!==c.quoteSnapshot.text) reasons.push('quote-changed');
    if(object && c.publicOrigin && getSnapshot(object,c.publicOrigin.sourceSnapshot.path)!==c.publicOrigin.sourceSnapshot.text) reasons.push('source-snapshot-changed');
    if(c.assetAnchor && (!object?.assetIds?.includes(c.assetAnchor.assetId)||assets.get(c.assetAnchor.assetId)?.sha256!==c.assetAnchor.sha256)) reasons.push('asset-changed');
    if(c.sourceAnchor){const a=c.sourceAnchor, source=objects.get(a.sourceId); if(!source?.source || source.source.sha256!==a.sourceHash || !(object?.refs||[]).some(r=>r.target===a.sourceId&&r.locator===a.locator&&r.quote===a.quote)) reasons.push('source-anchor-changed');}
    const context=contextFor(c.objectId);
    // Retain explicitly anchored source/asset metadata even for deleted or
    // split targets; those anchors do not seed reverse traversal.
    const source=c.sourceAnchor&&objects.get(c.sourceAnchor.sourceId), asset=c.assetAnchor&&assets.get(c.assetAnchor.assetId);
    const item={comment:c,review:reasons.length?'needs-review':'current',reasons,...context,
      context:source?.type==='source'&&!context.context.some(o=>o.id===source.id)?[...context.context,source]:context.context,
      assets:asset&&!context.assets.some(a=>a.id===asset.id)?[...context.assets,asset]:context.assets};
    outputBytes+=Buffer.byteLength(JSON.stringify(item))+(comments.length?1:0);
    if(outputBytes>16*1024*1024) return fail('inspect-size','/comments','Complete inspection exceeds the output budget.',{limit:16*1024*1024},'Inspect a smaller store; no text was truncated.');
    comments.push(item);
  }
  return {ok:true,workspaceId:model.workspaceId,revision,storeRevision:store.revision,comments,diagnostics:[]};
}
