// Builds an unrelated, fully confirmed synthetic baseline for readiness tests.
// These are test facts, not a claim that hashes establish real-world approval.
import fs from 'node:fs';
import { snapshotReviewedTextV2 } from '../../archify/explainer/workspace/prd-product-v2.mjs';
import { contracts } from '../../archify/explainer/workspace/prd-model.mjs';

const read=relative=>JSON.parse(fs.readFileSync(new URL(relative,import.meta.url)));
export function readyStandardFixture(){
  const m=read('../../archify/examples/prd-equipment-standard-workspace.json');
  const get=id=>m.objects.find(o=>o.id===id),f=m.profile.productDocument.modules[0].subModules[0].features[0],proto=f.standard.sections[4],wf=f.standard.sections[3];
  get('review').refs.push({relation:'uses',target:'reviewPage',type:'interface'});
  m.objects.push({id:'reviewPage',type:'interface',title:'Review page',purpose:'Review loans',status:'proposed',detail:{kind:'page'}});
  f.actions[1].pages.push({id:'reviewPageAnchor',interface:'reviewPage',groups:[]});
  const t=(text,id)=>snapshotReviewedTextV2(m.objects,text,[id]);
  proto.screens[1]={kind:'screen',id:'S2',page:'reviewPageAnchor',interface:'reviewPage',design:t('Review page design.','reviewPage'),assets:[],elements:[],pageRules:[t('Review page rule.','reviewPage')],fields:[],buttons:[],messages:[t('Review page message.','reviewPage')]};
  proto.screens[0].elements=proto.screens[0].elements.filter(id=>id!=='inspectionUpload');proto.screens[0].fields=proto.screens[0].fields.filter(row=>!row.element);
  wf.statusModel.completeness='complete';delete wf.statusModel.question;
  get('checkoutTransition').detail.condition=structuredClone(get('dateRule').rule.condition);get('checkoutTransition').detail.effect='Equipment is checked out';
  for(const o of m.objects.filter(o=>o.type==='question'))o.status='customer-confirmed';
  const acceptance=structuredClone(read('../fixtures/prd-workspace/facility.json').objects.find(o=>o.id==='readyCase'));
  Object.assign(acceptance,{id:'checkoutCase',title:'Checkout case',purpose:'Synthetic checkout acceptance',refs:[]});
  const decision={id:'checkoutDecision',type:'decision',title:'Checkout confirmation',purpose:'Synthetic confirmation',status:'customer-confirmed',detail:{scope:['recordAction','inventoryLink','dateRule','checkoutCase'],authority:'Synthetic owner',meeting:{date:'2026-01-01',participants:['Synthetic owner'],record:'Synthetic record'}},refs:[{relation:'derivedFrom',target:'source',type:'source',locator:'note',quote:'inventory records the checkout',interpretation:'Synthetic confirmation.'}]};
  m.objects.push(acceptance,decision);
  for(const id of ['recordAction','inventoryLink','dateRule','checkoutCase']){const o=get(id);o.status='customer-confirmed';o.refs??=[];o.refs.push({relation:'decision',target:'checkoutDecision',type:'decision'});if(o.detail.contracts)for(const key of contracts)o.detail.contracts[key]??={value:`Synthetic ${key} contract.`};}
  get('recordAction').refs.push({relation:'acceptance',target:'checkoutCase',type:'acceptance'});
  get('dateRule').refs.push({relation:'derivedFrom',target:'source',type:'source',locator:'note',quote:'inventory records the checkout',interpretation:'Synthetic provenance.'});
  f.actions[2].groups.push({id:'confirmationGroup',title:'Confirmation',sources:['checkoutCase','checkoutDecision'],summary:snapshotReviewedTextV2(m.objects,'Synthetic checkout confirmation.',['checkoutCase','checkoutDecision'])});
  function resolve(v,parent,key){
    if(!v||typeof v!=='object')return;
    if(!Array.isArray(v)&&Object.keys(v).length===1&&v.question){const target=get(v.question).detail.scope[0];parent[key]=key==='priority'?'P2':key==='readiness'?'Low':key==='dataType'?'Text':key==='required'?'No':t('Synthetic confirmed detail.',target);return;}
    for(const [k,x] of Object.entries(v))resolve(x,v,k);
  }
  resolve(m.profile.productDocument.standard,null,null);for(const x of m.profile.productDocument.modules)resolve(x,null,null);
  const standard=m.profile.productDocument.standard;standard.startDate=t('2026-01-01','project');standard.documentVersion=t('1.1','project');for(const h of standard.history)h.date=t('2026-01-01','project');
  m.objects=m.objects.filter(o=>o.id!=='inspectionUpload'&&(o.type!=='question'||o.id==='operatorQuestion'));
  for(const a of f.actions)for(const p of a.pages)for(const g of p.groups){g.sources=g.sources.filter(id=>id!=='inspectionUpload');g.summary.reviewed=g.summary.reviewed.filter(r=>r.object!=='inspectionUpload');}
  function refresh(v){if(!v||typeof v!=='object')return;if(v.reviewed&&typeof v.text==='string'){Object.assign(v,snapshotReviewedTextV2(m.objects,v.text,v.reviewed.map(r=>r.object)));return;}for(const x of Object.values(v))refresh(x);}
  refresh(m.profile.productDocument);return m;
}
