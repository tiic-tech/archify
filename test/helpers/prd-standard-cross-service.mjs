// Synthetic shared page/rule, with one authoritative definition in another Service.
import fs from 'node:fs';
import { snapshotReviewedTextV2 } from '../../archify/explainer/workspace/prd-product-v2.mjs';

export function crossServiceStandardFixture() {
  const m=JSON.parse(fs.readFileSync(new URL('../../archify/examples/prd-equipment-standard-workspace.json',import.meta.url)));
  m.workspaceId='a4635e24-c43b-4f86-90c0-3e9d4c4c594a';
  const original=m.profile.productDocument.modules[0].subModules[0].features[0], replacements={loans:'otherService',request:'otherRequest',review:'otherReview',record:'otherRecord',checkoutFlow:'otherFlow',checkoutFeature:'ownerFeature',requestAction:'ownerRequestAction',reviewAction:'ownerReviewAction',inventoryAction:'ownerInventoryAction',requestPageAnchor:'ownerPageAnchor',requestGroup:'ownerRequestGroup',inventoryGroup:'ownerInventoryGroup'};
  const rewrite=v=>Array.isArray(v)?v.map(rewrite):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,rewrite(x)])):typeof v==='string'&&replacements[v]?replacements[v]:v;
  const service=structuredClone(m.objects.find(o=>o.id==='loans'));service.id='otherService';service.title='Other service';m.objects.push(service);
  for(const id of ['request','review','record']){const o=structuredClone(m.objects.find(x=>x.id===id));o.id=replacements[id];o.parent='otherService';m.objects.push(o);}
  for(const q of m.objects.filter(o=>o.type==='question'))for(const [before,after] of [['loans','otherService'],['review','otherReview'],['record','otherRecord']])if(q.detail.scope.includes(before)){q.detail.scope.push(after);q.refs.push({relation:'target',target:after,type:before==='loans'?'service':'activity'});}
  const owner=rewrite(original);owner.key='owner-feature';owner.title='Owner feature';owner.standard.changes=[];
  owner.standard.sections[0].content.text='UNRELATED_OWNER_DESCRIPTION_CANARY';
  m.objects.push({id:'ownerQuestion',type:'question',title:'Owner rule uncertainty',purpose:'Clarify the rule boundary',status:'proposed',detail:{scope:['otherRequest'],consequence:'Rule boundary is unresolved',options:[],assumptions:[],confirmingFunction:'Synthetic reviewer',blocking:true},refs:[{relation:'target',target:'otherRequest',type:'activity'}]});
  owner.standard.sections[4].businessRules[0].boundaries={question:'ownerQuestion'};
  const flow=structuredClone(m.nativeViews[0]);flow.id='otherFlow';flow.service='otherService';flow.spec.meta.title='Other flow';flow.spec.meta.output='otherFlow.html';for(const binding of flow.bindings)binding.object=replacements[binding.object];m.nativeViews.push(flow);
  m.profile.productDocument.modules[0].subModules.push({id:'ownerSub',title:'Owner area',features:[owner]});
  original.standard.sections[4].businessRules=[];original.standard.sections[4].screens[0].fields[1].typeDetails={question:'ruleQuestion'};
  const qualify=v=>Array.isArray(v)?v.map(qualify):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,qualify(x)])):v==='BR-1'?{feature:'ownerFeature',id:'BR-1'}:v;
  original.standard=qualify(original.standard);
  const refresh=v=>{if(!v||typeof v!=='object')return;if(typeof v.text==='string'&&Array.isArray(v.reviewed)){Object.assign(v,snapshotReviewedTextV2(m.objects,v.text,v.reviewed.map(r=>r.object)));return;}for(const x of Object.values(v))refresh(x);};refresh(m.profile.productDocument);
  return m;
}
