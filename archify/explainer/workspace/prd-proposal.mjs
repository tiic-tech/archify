// Explicit technical proposals. Comment text is never interpreted as a patch.
import { changeRequest as check } from './generated-prd-validators.mjs';
import { canonical, contracts, diagnostic, identity, reviewDependents, reviewOwnerSummaries } from './prd-model.mjs';
import { inspectFeedback, validateStore } from './prd-feedback.mjs';

const fail=(code,subject,message,evidence,fix)=>({ok:false,diagnostics:[diagnostic(`feedback-${code}`,subject,message,evidence,fix)]});
const paths=new Set(['/title','/purpose','/gap','/rule/effect','/rule/unit','/rule/precision','/rule/time','/detail/behavior','/detail/outcome','/detail/scenario','/detail/expected','/detail/trigger','/detail/effect','/detail/boundary','/detail/identity','/detail/unit','/detail/precision',...contracts.map(k=>`/detail/contracts/${k}`)]);
const excluded=new Set(['source','evidence','decision','question','revision']);
function get(object,parts){let cursor=object; for(const part of parts){if(!cursor||typeof cursor!=='object'||!Object.hasOwn(cursor,part)) return null; cursor=cursor[part];} return cursor;}
function set(object,parts,value){let cursor=object; for(const part of parts.slice(0,-1)){if(!cursor||typeof cursor!=='object'||!Object.hasOwn(cursor,part)) return false; cursor=cursor[part];} if(!cursor||typeof cursor!=='object') return false; cursor[parts.at(-1)]=value; return true;}
function related(model,target,comments){
  const byId=new Map(model.objects.map(o=>[o.id,o]));
  const decisions=new Set(),sources=new Set();
  const candidates=[target,...model.objects.filter(o=>['decision','evidence'].includes(o.type)&&o.detail.scope?.includes(target.id))];
  for(const c of comments) if(c.sourceAnchor) sources.add(c.sourceAnchor.sourceId);
  for(let i=0;i<candidates.length;i++){
    const o=candidates[i]; if(o.type==='decision') decisions.add(o.id);
    for(const ref of o.refs||[]) { if(ref.type==='source') sources.add(ref.target); if(['decision','evidence'].includes(ref.type)){const next=byId.get(ref.target); if(next&&!candidates.includes(next)) candidates.push(next);} }
  }
  return {sourceIds:[...sources].sort(),decisionIds:[...decisions].sort()};
}
export function makeProposal(request,model,revision,store,expectedStore){
  if(!check(request)) return {ok:false,diagnostics:check.errors.map(e=>diagnostic('feedback-proposal-schema',e.instancePath||'/',e.message,{keyword:e.keyword,params:e.params},'Correct the change request.'))};
  const valid=validateStore(store); if(!valid.ok) return valid;
  if(!model.workspaceId||request.workspaceId!==model.workspaceId||store.workspaceId!==model.workspaceId) return fail('workspace-mismatch','/workspaceId','Proposal, store and model must share the workspace identity.',{},'Use matching files.');
  if(revision!==request.baseRevision) return fail('proposal-stale','/baseRevision','Proposal base revision is stale.',{expected:request.baseRevision,actual:revision},'Inspect the current model and create a new proposal.');
  if(expectedStore!==store.revision||request.storeRevision!==store.revision) return fail('store-revision','/storeRevision','Proposal must match the explicitly expected store version.',{expected:expectedStore||null,actual:store.revision,proposal:request.storeRevision},'Reload the store and use its revision.');
  if((model.reviewHistory||[]).some(h=>h.proposalId===request.proposalId)) return fail('proposal-id','/proposalId','Proposal identity already exists.',{id:request.proposalId},'Use a new unique proposal ID.');
  const object=model.objects.find(o=>o.id===request.objectId);
  const correction=request.operation==='decision-correction';
  if(!object || (correction?object.type!=='decision':excluded.has(object.type))) return fail('proposal-target','/objectId','Target is missing or cannot be changed by this operation.',{id:request.objectId,type:object?.type||null},'Choose a supported target and preserve historical records.');
  if(correction ? request.path!=='/decision/supersession' : !paths.has(request.path)) return fail('proposal-path','/path','Path is not allowed for this operation.',{path:request.path},'Use a documented property path.');
  const parts=request.path.slice(1).split('/'),old=correction?canonical(object):get(object,parts);
  const contract=request.path.startsWith('/detail/contracts/');
  if(!correction && ((contract && !['action','api','integration'].includes(object.type)) || (!contract && old===null))) return fail('proposal-path','/path','Path does not exist on this object.',{path:request.path,id:object.id},'Choose an applicable existing property.');
  if(contract ? !(request.newValue && typeof request.newValue==='object' && Object.keys(request.newValue).length===1 && typeof request.newValue.value==='string') : typeof request.newValue!=='string') return fail('proposal-value','/newValue','Replacement has the wrong type or would introduce a gap.',{path:request.path},'Supply a nonempty string or a contract value fact.');
  if(correction){
    let proposed; try{proposed=JSON.parse(request.newValue);}catch{return fail('proposal-value','/newValue','Decision correction must contain JSON for a new decision.',{},'Supply the new proposed decision as a JSON string.');}
    if(!proposed || proposed.type!=='decision' || proposed.status!=='proposed' || proposed.id===object.id || model.objects.some(o=>o.id===proposed.id) || canonical(proposed.detail?.scope)!==canonical(object.detail.scope) || (proposed.refs||[]).filter(r=>r.relation==='supersedes'&&r.type==='decision'&&r.target===object.id).length!==1 || (proposed.refs||[]).some(r=>!['supersedes','derivedFrom'].includes(r.relation))) return fail('proposal-decision','/newValue','Correction must add a new proposed decision that supersedes the original in the same scope.',{},'Create a new proposed decision with the original scope and a typed supersedes reference.');
  }
  if(canonical(old)!==canonical(request.oldValue)||identity(old)!==request.oldHash) return fail('proposal-old-value','/oldValue','Expected old value and hash must match the current property.',{id:object.id,path:request.path,actual:old},'Inspect the current value and prepare a fresh request.');
  if(canonical(old)===canonical(request.newValue)) return fail('proposal-no-change','/newValue','Replacement does not change the property.',{},'Supply a different proposed value.');
  const inspected=inspectFeedback(model,revision,store); if(!inspected.ok) return inspected;
  const byId=new Map(inspected.comments.map(c=>[c.comment.id,c]));
  const selected=request.commentIds.map(id=>byId.get(id));
  if(selected.some(c=>!c||c.comment.objectId!==object.id||c.review!=='current')) return fail('proposal-comment','/commentIds','Each comment must exist, target this object and have current anchors.',{commentIds:request.commentIds},'Review stale or mismatched comments before proposing a change.');
  const {sourceIds,decisionIds}=related(model,object,selected.map(c=>c.comment));
  if(correction) for(const ref of JSON.parse(request.newValue).refs||[]) if(ref.type==='source'&&!sourceIds.includes(ref.target)) sourceIds.push(ref.target);
  sourceIds.sort();
  const payload={...request,commentIds:[...request.commentIds].sort(),sourceIds,decisionIds,previousStatus:object.status};
  return {ok:true,proposal:{...payload,digest:identity(payload)},diagnostics:[]};
}
export function applyProposal(proposal,model,revision,store,expectedStore){
  if(!proposal||typeof proposal!=='object'||Array.isArray(proposal)) return fail('proposal-schema','/','Proposal must be an object.',{},'Provide a proposal file.');
  const {sourceIds,decisionIds,previousStatus,digest,...request}=proposal;
  const checked=makeProposal(request,model,revision,store,expectedStore); if(!checked.ok) return checked;
  if(canonical(checked.proposal)!==canonical(proposal)) return fail('proposal-integrity','/digest','Proposal or derived lineage differs from the validated proposal.',{},'Generate a fresh proposal from the current files.');
  const next=structuredClone(model),target=next.objects.find(o=>o.id===proposal.objectId);
  const correction=proposal.operation==='decision-correction';
  let changedIds;
  if(correction){
    const added=JSON.parse(proposal.newValue); next.objects.push(added);
    changedIds=new Set([added.id]);
    for(const id of target.detail.scope) for(const dependent of reviewDependents(model,id)) changedIds.add(dependent);
  } else {
    if(!set(target,proposal.path.slice(1).split('/'),structuredClone(proposal.newValue))) return fail('proposal-path','/path','Replacement parent is missing.',{},'Use an applicable path.');
    changedIds=reviewDependents(model,target.id);
  }
  const history={proposalId:proposal.proposalId,baseRevision:revision,storeRevision:store.revision,objectId:target.id,path:proposal.path,oldValue:proposal.oldValue,newValue:proposal.newValue,oldHash:proposal.oldHash,commentIds:proposal.commentIds,sourceIds:proposal.sourceIds,decisionIds:proposal.decisionIds,previousStatus:proposal.previousStatus};
  (next.reviewHistory??=[]).push(history);
  if(!correction){target.status='proposed'; if(target.refs) target.refs=target.refs.filter(r=>r.relation!=='decision');}
  const summaryIds=reviewOwnerSummaries(next,changedIds);
  for(const object of next.objects) {
    if(changedIds.has(object.id)){object.review??={causes:[]}; object.review.causes.push(proposal.proposalId); object.review.causes.sort();}
    if(summaryIds.has(object.id)){object.review??={causes:[]}; (object.review.summaryCauses??=[]).push(proposal.proposalId); object.review.summaryCauses.sort();}
  }
  return {ok:true,model:next,changedIds:[...changedIds].sort(),summaryIds:[...summaryIds].sort(),history,diagnostics:[]};
}
