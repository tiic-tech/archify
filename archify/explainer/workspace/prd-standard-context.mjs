// Construct local contexts from explicitly modeled action and page paths.
// Never expand an activity's sibling interfaces or use the Service as a grant.
import { productReviewDependenciesV2 } from './prd-product-v2.mjs';
const refs=(o,relation)=>(o?.refs||[]).filter(r=>r.relation===relation).map(r=>r.target);

// Enumerate the authored use sites, not arbitrary strings in facts or IDs.
export function standardRuleReferences(feature) {
  const standard=feature.standard,proto=standard.sections[4];
  return [...standard.sections[3].steps.flatMap(s=>s.businessRules),...proto.screens.flatMap(s=>s.kind==='screen'?s.fields.flatMap(row=>row.businessRules||[]):[]),...proto.processes.flatMap(p=>p.businessRules),...standard.sections[7].criteria.flatMap(c=>c.businessRules)];
}

export function addAncestors(context, objects, id, stop) {
  const seen=new Set();let o=objects.get(id);
  while(o&&!seen.has(o.id)){
    seen.add(o.id);
    if(['project','service'].includes(o.type))break;
    context.add(o.id);
    if(o.id===stop)break;
    o=objects.get(o.parent);
  }
  return context;
}

export function activityContext(objects, activity) {
  const context=new Set();if(!activity)return context;
  context.add(activity.id);
  for(const id of [...refs(activity,'actor'),...refs(activity,'action'),...refs(activity,'integration')]) {
    context.add(id);const o=objects.get(id);
    for(const r of ['actor','rule','integration'])for(const target of refs(o,r))context.add(target);
  }
  return context;
}

// Only explicitly placed rules or rules directly linked to local facts can
// introduce predicate dependencies. Merely sharing a Service never does so.
export function addLocalRules(context,objects,ids) {
  const explicit=new Set(ids.filter(id=>objects.get(id)?.type==='rule'));
  for(const id of [...context])for(const rule of refs(objects.get(id),'rule'))explicit.add(rule);
  for(const id of explicit){const rule=objects.get(id);if(!rule?.rule)continue;
    if(!rule.rule.scope.some(target=>context.has(target)))continue;
    context.add(id);for(const dep of productReviewDependenciesV2(rule))context.add(dep);
  }
  return context;
}

export function pageContext(objects,activity,page,ids=[]) {
  const context=activityContext(objects,activity);
  if(page?.interface)context.add(page.interface);if(page?.variant)context.add(page.variant);
  for(const id of ids)addAncestors(context,objects,id,page?.interface);
  return addLocalRules(context,objects,ids);
}
