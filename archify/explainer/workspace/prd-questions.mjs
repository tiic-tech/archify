import { contracts } from './prd-model.mjs';

// Stable keys identify structured missing facts, never text similarity.
export function proposeQuestions(model,revision){
  const existing=new Map();
  for(const q of model.objects.filter(o=>o.type==='question'&&!['superseded','customer-confirmed'].includes(o.status))) for(const key of q.detail.gapKeys||[]) {
    if(!existing.has(key)) existing.set(key,[]); existing.get(key).push(q.id);
  }
  const proposals=[],covered=[];
  function add(o,suffix,missing,decision,consequence){
    const gapKey=`${o.id}:${suffix}`, linked=(existing.get(gapKey)||[]).sort();
    const record={gapKey,objectId:o.id,objectType:o.type,title:o.title,purpose:o.purpose,missing,decision,consequence};
    if(linked.length) covered.push({...record,questionIds:linked});
    else proposals.push({...record,state:'proposed',options:[],assumptions:[]});
  }
  for(const o of model.objects){
    if(o.gap) add(o,'gap',o.gap,`Resolve the declared gap for ${o.title}.`,`The declared gap prevents readiness for ${o.title}.`);
    if(['action','api','integration'].includes(o.type)) for(const key of contracts){const fact=o.detail.contracts[key]; if(!fact||fact.gap) add(o,`detail/contracts/${key}`,fact?.gap||`No ${key} fact is recorded.`,`Determine the ${key} contract for ${o.title}.`,`The ${key} contract for ${o.title} remains unspecified and blocks readiness.`);}
    if(o.type==='rule'&&!o.refs?.some(r=>r.relation==='derivedFrom'||r.relation==='evidence')) add(o,'refs/provenance','No source or evidence is linked.',`Determine the provenance for rule ${o.title}.`,`The rule cannot satisfy readiness without provenance.`);
    if(o.type==='action') for(const rel of ['actor','acceptance']) if(!o.refs?.some(r=>r.relation===rel)) add(o,`refs/${rel}`,`No ${rel} relationship is linked.`,`Determine the ${rel} for ${o.title}.`,`The ${rel} relationship is required for readiness.`);
    if(o.type==='binding'&&!o.refs?.some(r=>r.relation==='field')) add(o,'refs/field','No field is linked.',`Determine the field for ${o.title}.`,`The binding cannot identify its field.`);
    if(o.type==='activity'&&o.detail.actorKind==='system'&&!o.refs?.some(r=>['action','integration'].includes(r.relation))) add(o,'refs/action-integration','No action or integration is linked.',`Determine the backend responsibility for ${o.title}.`,`The system activity lacks a readiness contract.`);
  }
  return {ok:true,workspaceId:model.workspaceId||null,baseRevision:revision,proposals,covered,diagnostics:[]};
}
