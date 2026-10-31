// Standard profile semantics. The schema and ordinary v2 graph checks run first.
// These checks validate authored relationships, not the truth of requirements.
import { canonical, diagnostic, questionContexts, serviceOwners, scopeIds } from './prd-model.mjs';
import { productReviewClosureV2, reviewHashV2 } from './prd-product-v2.mjs';
import { productServiceSelection } from './prd-product-document.mjs';
import { validateStandardRefinementsV1 } from './prd-standard-refinements.mjs';
import { pageContext, activityContext, addLocalRules, standardRuleReferences } from './prd-standard-context.mjs';

const refs = (o, rel) => (o?.refs || []).filter(r => r.relation === rel).map(r => r.target);
const featureList = plan => plan.modules.flatMap((m,mi) => m.subModules.flatMap((s,si) => s.features.map((f,fi) => ({f,loc:`/profile/productDocument/modules/${mi}/subModules/${si}/features/${fi}`}))));
const questionContext = questionContexts;
const walk = (v,loc,visit) => { if (!v || typeof v!=='object') return; visit(v,loc); if(Array.isArray(v))v.forEach((x,i)=>walk(x,`${loc}/${i}`,visit)); else for(const [k,x] of Object.entries(v))walk(x,`${loc}/${k}`,visit); };
const brKey = (r, feature) => typeof r==='string'?`${feature}:${r}`:`${r.feature}:${r.id}`;
const calendarDate = text => {
  let value=text;
  const match=/^(\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})$/.exec(text);
  if(match)value=`${match[3]}-${String(['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(match[2])+1).padStart(2,'0')}-${match[1]}`;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value)))return null;
  return new Date(value).toISOString().slice(0,10)===value?value:null;
};

// Internal input uses source objects. A projected caller must provide its own
// audience facts; absent facts never fall back to the private model.
export function validateStandardDocumentV1(model, {reviewFacts} = {}) {
  const plan=model.profile.productDocument;if(plan?.version!==2||!plan.standard)return [];
  const objects=new Map(model.objects.map(o=>[o.id,o])), owners=serviceOwners(model), views=new Map(model.nativeViews.map(v=>[v.id,v]));
  const features=featureList(plan), errors=validateStandardRefinementsV1(model);
  const error=(loc,message,evidence={})=>errors.push(diagnostic('product-standard',loc,message,evidence,'Correct the referenced modeled facts or record a scoped question.'));
  const get=(id,types,loc)=>{const o=objects.get(id);if(!o||!types.includes(o.type)){error(loc,'Reference is missing or has the wrong type.',{id,expected:types,actual:o?.type||null});return null;}return o;};
  const selections=new Map(features.map(({f})=>[f.service,productServiceSelection(model,f.service).selected]));
  const global=new Set([...selections.values()].flatMap(s=>[...s]));
  for(const o of model.objects)if(['project','source'].includes(o.type))global.add(o.id);
  for(const o of model.objects)if(o.type==='question'&&questionContext(o).some(id=>objects.get(id)?.type==='project'))global.add(o.id);
  function facts(root,loc,allowed,service) {
    walk(root,loc,(value,at)=>{
      if(!Array.isArray(value)&&Object.hasOwn(value,'question')){
        const q=get(value.question,['question'],`${at}/question`);if(q&&(!allowed.has(q.id)||!questionContext(q).some(id=>allowed.has(id))))error(`${at}/question`,'Question is outside the authored context.',{id:q.id});
      }
      if(!Array.isArray(value)&&Array.isArray(value.reviewed)&&typeof value.text==='string'){
        const entries=new Map();
        for(const [i,r] of value.reviewed.entries()){
          const pos=`${at}/reviewed/${i}`,o=objects.get(r.object);
          if(entries.has(r.object))error(`${pos}/object`,'Reviewed fact is duplicated.',{id:r.object});entries.set(r.object,r.sha256);
          if(!o){error(`${pos}/object`,'Reviewed fact is missing.',{id:r.object});continue;}
          if(!allowed.has(o.id)||service&&owners[o.id]&&owners[o.id]!==service)error(`${pos}/object`,'Reviewed fact is outside the authored context.',{id:o.id});
          const fact=reviewFacts?reviewFacts.get(o.id):o;
          if(!fact)error(`${pos}/object`,'Reviewed fact is not approved for this audience.',{id:o.id});
          else if(reviewHashV2(fact)!==r.sha256)error(`${pos}/sha256`,'Reviewed standard text is stale.',{id:o.id});
        }
        for(const dep of productReviewClosureV2(objects,[...entries.keys()]))if(!entries.has(dep))error(`${at}/reviewed`,'Reviewed text is missing a semantic dependency.',{id:dep});
      }
    });
  }
  // Each compact cell must actually cite its placement context, not merely an
  // unrelated object elsewhere in the same Service.
  function contextFacts(root,loc,context) {
    walk(root,loc,(value,at)=>{
      if(Array.isArray(value))return;
      if(value?.reviewed&&!value.reviewed.some(r=>context.has(r.object)))error(`${at}/reviewed`,'Reviewed text does not cite its local context.');
      if(typeof value?.question==='string'&&!questionContext(objects.get(value.question)).some(id=>context.has(id)))error(`${at}/question`,'Question is not scoped to this local context.',{id:value.question});
    });
  }
  facts(plan.standard,'/profile/productDocument/standard',global,null);
  const roles=new Set();
  for(const [i,row] of plan.standard.roles.entries()){
    const at=`/profile/productDocument/standard/roles/${i}`;get(row.role,['role'],`${at}/role`);
    if(roles.has(row.role))error(`${at}/role`,'Role is duplicated.',{id:row.role});roles.add(row.role);
  }
  const shared=new Set();for(const [i,row] of plan.standard.sharedRules.entries()){const at=`/profile/productDocument/standard/sharedRules/${i}`;get(row.rule,['rule'],`${at}/rule`);if(shared.has(row.rule))error(`${at}/rule`,'Shared rule is duplicated.',{id:row.rule});shared.add(row.rule);}
  const release=new Map();let lastVersion=null,lastDate=null;
  for(const [i,h] of plan.standard.history.entries()){
    const at=`/profile/productDocument/standard/history/${i}`, match=/^(?:v)?(\d+)\.(\d+)$/.exec(h.version), version=match&&[Number(match[1]),Number(match[2])];
    if(!version)error(`${at}/version`,'Version must be an authored major.minor version.',{version:h.version});
    else {if(lastVersion&&(version[0]<lastVersion[0]||version[0]===lastVersion[0]&&version[1]<=lastVersion[1]))error(`${at}/version`,'Document versions must increase.',{version:h.version});lastVersion=version;}
    if(h.date.text){const d=calendarDate(h.date.text);if(!d)error(`${at}/date`,'Authored date must be a real ISO or DD Mon YYYY calendar date.');else {if(lastDate&&d<lastDate)error(`${at}/date`,'Document history dates must be chronological.');lastDate=d;}}
    if(release.has(h.version))error(`${at}/version`,'Document version is duplicated.');release.set(h.version,h);
    if(version&&h.released&&(version[0]>1||version[0]===1&&version[1]>0)&&(!h.references.length||!h.chapters.length))error(at,'A released post-v1.0 version needs references and changed chapter summaries.');
    const seen=new Set();for(const [j,c] of h.chapters.entries()){if(seen.has(c.feature))error(`${at}/chapters/${j}`,'Changed chapter is duplicated.',{id:c.feature});seen.add(c.feature);if(!features.some(x=>x.f.id===c.feature))error(`${at}/chapters/${j}/feature`,'Changed chapter does not exist.',{id:c.feature});}
  }
  if(plan.standard.documentVersion.text&&plan.standard.history.length&&plan.standard.documentVersion.text.replace(/^v/,'')!==plan.standard.history.at(-1).version.replace(/^v/,''))error('/profile/productDocument/standard/documentVersion','Document version must match the latest history entry.');
  if(plan.standard.startDate.text&&!calendarDate(plan.standard.startDate.text))error('/profile/productDocument/standard/startDate','Starting date must be a real ISO or DD Mon YYYY calendar date.');
  for(const {f,loc} of features){
    const base=`${loc}/standard`, s=f.standard, wf=s.sections[3], proto=s.sections[4], integration=s.sections[5], accept=s.sections[7], selected=selections.get(f.service)||new Set(), allowed=new Set(selected);
    facts(s,base,allowed,f.service);
    for(const change of s.changes){const h=release.get(change.version),chapter=h?.chapters.find(c=>c.feature===f.id);if(!h?.released||!chapter)error(`${base}/changes`,'Chapter callout must match a released document chapter summary.',{version:change.version});else {if(canonical(h.references)!==canonical(change.references))error(`${base}/changes`,'Chapter callout references must match the release references.',{version:change.version});const summary=chapter.summary,related=change.items.some(item=>summary.question?item.question===summary.question:summary.reviewed?.some(a=>item.reviewed?.some(b=>a.object===b.object)));if(!related)error(`${base}/changes`,'Chapter callout and release summary must cite a common modeled source.',{version:change.version});}}
    for(const h of plan.standard.history)if(h.chapters.some(c=>c.feature===f.id)&&!s.changes.some(c=>c.version===h.version))error(`${base}/changes`,'Changed chapter is missing its release callout.',{version:h.version});
    const view=views.get(f.workflow?.view),nodes=new Map((view?.spec?.nodes||[]).map(n=>[n.id,n])), bindings=new Map((view?.bindings||[]).map(b=>[b.node,b.object]));
    const actions=new Map((f.actions||[]).map(a=>[a.activity,a])), blocks=new Map(), numbers=new Set(),used=new Set();
    const ruleIds=list=>(list||[]).map(ref=>{const owner=typeof ref==='string'?f.id:ref.feature,id=typeof ref==='string'?ref:ref.id;return features.find(x=>x.f.id===owner)?.f.standard.sections[4].businessRules.find(r=>r.id===id)?.rule;}).filter(Boolean);
    for(const [i,b] of [...proto.screens,...proto.processes].entries()){if(blocks.has(b.id))error(`${base}/sections/4`,'Block ID is duplicated.',{id:b.id});else blocks.set(b.id,b);}
    for(const [i,step] of wf.steps.entries()){
      const at=`${base}/sections/3/steps/${i}`,a=actions.get(step.activity),activity=get(step.activity,['activity'],`${at}/activity`),role=get(step.role,['role'],`${at}/role`),block=blocks.get(step.block);
      const stepPage=block?.kind==='screen'?a?.pages.find(p=>p.id===block.page):null;
      const sourceIds=[...(a?.groups||[]).flatMap(g=>g.sources),...(stepPage?.groups||[]).flatMap(g=>g.sources),...ruleIds(step.businessRules)];
      const context=pageContext(objects,activity,stepPage,sourceIds);if(role)context.add(role.id);
      contextFacts({action:step.action,response:step.response,rules:step.rules},at,context);
      if(numbers.has(step.number))error(`${at}/number`,'Step number is duplicated.',{number:step.number});numbers.add(step.number);
      if(!a)error(`${at}/activity`,'Step activity is not a Feature action.',{id:step.activity});
      if(!nodes.has(step.node)||bindings.get(step.node)!==step.activity)error(`${at}/node`,'Step node must bind its actual activity.',{node:step.node,activity:step.activity});
      const node=nodes.get(step.node),laneRole=(view?.laneBindings||[]).find(b=>b.lane===node?.lane)?.role;
      if(laneRole&&laneRole!==step.role)error(`${at}/role`,'Step role does not match the native workflow lane.',{id:step.role,laneRole});
      const actors=[...refs(activity,'actor'),...refs(activity,'action').flatMap(id=>refs(objects.get(id),'actor'))];
      if(role&&!actors.includes(step.role))error(`${at}/role`,'Step role is not an actor of the modeled activity.',{id:step.role});
      if(role&&!roles.has(step.role))error(`${at}/role`,'Step role is absent from the document role catalog.',{id:step.role});
      if(!block)error(`${at}/block`,'Step block is missing.',{id:step.block});else {used.add(step.block);const screen=step.block.startsWith('S');if(screen&&a?.performer==='system'||!screen&&a?.performer==='user')error(`${at}/block`,'Step block type conflicts with its performer.',{id:step.block});if(screen&&block.kind==='screen'&&!a?.pages.some(p=>p.id===block.page&&p.interface===block.interface&&p.variant===block.variant))error(`${at}/block`,'Screen is not a page of this activity.',{id:step.block});}
    }
    for(const [nodeId,node] of nodes){const mapped=wf.steps.filter(step=>step.node===nodeId);if(mapped.length>1){const label=String(node.label||'');for(const step of mapped)if(!new RegExp(`(?:^|[^A-Za-z0-9])${step.number}(?:$|[^A-Za-z0-9])`).test(label))error(`${base}/sections/3/steps`,'Multiple steps on one node must all be numbered in its label.',{node:nodeId,number:step.number});}}
    for(const b of blocks.keys())if(!used.has(b))error(`${base}/sections/4`,'Block is not used by any workflow step.',{id:b});
    for(const [i,screen] of proto.screens.entries())if(screen.kind==='missing-screen'){
      const activities=new Set(wf.steps.filter(step=>step.block===screen.id).map(step=>step.activity));
      if(!questionContext(objects.get(screen.question)).some(id=>activities.has(id)))error(`${base}/sections/4/screens/${i}/question`,'Missing-screen question must be scoped to an activity using the placeholder.',{id:screen.question});
    }
    for(const a of f.actions||[]){
      if(!wf.steps.some(st=>st.activity===a.activity))error(`${base}/sections/3/steps`,'Feature activity has no numbered step.',{id:a.activity});
      for(const page of a.pages)if(!proto.screens.some(screen=>screen.kind==='screen'&&screen.page===page.id))error(`${base}/sections/4/screens`,'Feature page has no screen block.',{id:page.id});
    }
    for(const [i,screen] of proto.screens.entries())if(screen.kind==='screen'){
      const at=`${base}/sections/4/screens/${i}`,entry=(f.actions||[]).flatMap(action=>action.pages.map(page=>({action,page}))).find(x=>x.page.id===screen.page),page=entry?.page,sources=new Set((page?.groups||[]).flatMap(g=>g.sources));
      const activity=objects.get(entry?.action.activity),context=pageContext(objects,activity,page,[...sources]);
      contextFacts({design:screen.design,pageRules:screen.pageRules,messages:screen.messages},at,context);
      for(const [j,button] of screen.buttons.entries())contextFacts(button,`${at}/buttons/${j}`,pageContext(objects,activity,page,[button.element,button.action].filter(Boolean)));
      for(const [j,row] of (screen.actionMatrix||[]).entries()){const ctx=pageContext(objects,activity,page,row.actions);ctx.add(row.role);ctx.add(row.state);contextFacts(row,`${at}/actionMatrix/${j}`,ctx);}
      const rows=new Set();
      for(const [j,row] of screen.fields.entries())if(row.binding){const pos=`${at}/fields/${j}`,binding=get(row.binding,['binding'],`${pos}/binding`),field=get(row.field,['field'],`${pos}/field`);
        const fieldContext=pageContext(objects,activity,page,[row.binding,row.field,...refs(binding,'rule'),...refs(field,'rule'),...ruleIds(row.businessRules)]);
        addLocalRules(fieldContext,objects,ruleIds(row.businessRules));contextFacts(row,pos,fieldContext);
        if(binding&&(!sources.has(row.binding)||refs(binding,'field').length!==1||refs(binding,'field')[0]!==row.field))error(pos,'Field row must use an actual binding and field in this page.',{binding:row.binding,field:row.field});if(rows.has(row.binding))error(pos,'Binding appears more than once on a screen.',{id:row.binding});rows.add(row.binding);
        if(binding){
          for(const [cell,key] of [['required','required'],['editable','editableWhen']]){const question=binding.detail[cell]?.question;if(question&&row[key]?.question!==question)error(`${pos}/${key}`,'An unresolved binding cell requires its exact scoped question.',{binding:binding.id,cell,question});}
          if(typeof row.required==='string'&&!binding.detail.required?.question){const predicate=binding.detail.required, expected=Object.hasOwn(predicate,'constant')?(predicate.constant?'Yes':'No'):'Conditional';if(row.required!==expected)error(`${pos}/required`,'Required value conflicts with the modeled binding predicate.',{expected});}
        }
      }
      for(const id of sources)if(objects.get(id)?.type==='binding'&&!rows.has(id))error(`${at}/fields`,'Page binding has no field specification.',{id});
      for(const [j,id] of screen.elements.entries())if(!sources.has(id)||objects.get(id)?.type!=='element')error(`${at}/elements/${j}`,'Screen element is not an actual page element.',{id});
      for(const id of sources)if(objects.get(id)?.type==='element'&&!screen.elements.includes(id))error(`${at}/elements`,'Page element is not represented on the screen.',{id});
      const buttonIds=new Set();for(const [j,button] of screen.buttons.entries()){const pos=`${at}/buttons/${j}`,element=objects.get(button.element);if(buttonIds.has(button.element))error(pos,'Button is duplicated.',{id:button.element});buttonIds.add(button.element);if(element?.type!=='element'||element.detail.kind!=='button'||!screen.elements.includes(button.element))error(`${pos}/element`,'Button must be an actual displayed button element.',{id:button.element});if(button.action&&!refs(element,'action').includes(button.action))error(`${pos}/action`,'Button action must be linked to its modeled element.',{id:button.action});}
      for(const id of screen.elements)if(objects.get(id)?.detail?.kind==='button'&&!buttonIds.has(id))error(`${at}/buttons`,'Displayed button has no button specification.',{id});
      for(const [j,id] of screen.assets.entries()){const attached=[...(objects.get(screen.interface)?.assetIds||[]),...(objects.get(screen.variant)?.assetIds||[])];if(!model.assets.some(a=>a.id===id)||!attached.includes(id))error(`${at}/assets/${j}`,'Screen asset must be attached to its actual interface or variant.',{id});}
    }
    const status=wf.statusModel, states=new Map();
    const entities=new Set();
    for(const [i,row] of status.states.entries()){const at=`${base}/sections/3/statusModel/states/${i}`,state=get(row.state,['state'],`${at}/state`);if(state&&!selected.has(row.state))error(`${at}/state`,'State is outside the Feature Service context.',{id:row.state});if(state?.parent)entities.add(state.parent);if(states.has(row.state))error(at,'State is duplicated.',{id:row.state});states.set(row.state,row);}
    if(entities.size>1)error(`${base}/sections/3/statusModel/states`,'Status model states must belong to one modeled entity.');
    const graph=new Map([...states.keys()].map(id=>[id,[]]));
    const transitionIds=new Set();
    for(const [i,tr] of status.transitions.entries()){
      const at=`${base}/sections/3/statusModel/transitions/${i}`,o=get(tr.transition,['transition'],`${at}/transition`),step=wf.steps.find(s=>s.number===tr.step);
      if(transitionIds.has(tr.transition))error(`${at}/transition`,'Transition is duplicated.',{id:tr.transition});transitionIds.add(tr.transition);
      if(!states.has(tr.from)||!states.has(tr.to))error(at,'Transition endpoints must be listed states.');
      if(o&&(refs(o,'from').length!==1||refs(o,'from')[0]!==tr.from||refs(o,'to').length!==1||refs(o,'to')[0]!==tr.to))error(at,'Transition endpoints do not match the modeled transition.',{id:tr.transition});
      if(o&&entities.size===1&&!entities.has(o.parent))error(`${at}/transition`,'Transition must belong to the same entity as its states.',{id:tr.transition});
      if(!step||step.role!==tr.role||o&&!refs(o,'actor').includes(tr.role))error(at,'Transition role and step must match the modeled actor.',{id:tr.transition});
      if(o&&step){const activity=objects.get(step.activity),activityActions=refs(activity,'action'),transitionActions=refs(o,'action');if(transitionActions.length&&!transitionActions.some(id=>activityActions.includes(id)))error(at,'Transition action is not linked to the step activity.',{id:tr.transition});}
      graph.get(tr.from)?.push(tr.to);
    }
    if(status.completeness==='complete'){
      const initial=[...states.values()].filter(x=>x.initial);if(initial.length!==1)error(`${base}/sections/3/statusModel/states`,'A complete status model requires exactly one initial state.');
      const seen=new Set(initial.map(x=>x.state)),queue=[...seen];for(let i=0;i<queue.length;i++)for(const id of graph.get(queue[i])||[])if(!seen.has(id)){seen.add(id);queue.push(id);}for(const id of states.keys())if(!seen.has(id))error(`${base}/sections/3/statusModel/states`,'State is unreachable from the initial state.',{id});
    }
    const integrationIds=new Set(integration.integrations.map(x=>x.integration)), notifications=new Set(integration.notifications.map(x=>x.id));
    if(integrationIds.size!==integration.integrations.length)error(`${base}/sections/5/integrations`,'Integration is duplicated.');
    if(notifications.size!==integration.notifications.length)error(`${base}/sections/5/notifications`,'Notification is duplicated.');
    for(const [i,row] of integration.integrations.entries()){get(row.integration,['integration'],`${base}/sections/5/integrations/${i}/integration`);if(!selected.has(row.integration))error(`${base}/sections/5/integrations/${i}/integration`,'Integration is outside the Feature Service context.',{id:row.integration});}
    for(const [i,row] of integration.notifications.entries()){for(const id of row.roles)get(id,['role'],`${base}/sections/5/notifications/${i}/roles`);if(row.integration&&!integrationIds.has(row.integration))error(`${base}/sections/5/notifications/${i}/integration`,'Notification references an unlisted integration.',{id:row.integration});}
    if(!integration.integrations.length&&!integration.notifications.length&&!integration.none)error(`${base}/sections/5`,'Integration section needs an explicit none fact or question.');
    const exceptionIds=new Set();
    for(const [i,p] of proto.processes.entries()){
      const at=`${base}/sections/4/processes/${i}`, activities=wf.steps.filter(step=>step.block===p.id).map(step=>objects.get(step.activity));
      const context=new Set([f.service,...activities.flatMap(a=>[a?.id,...refs(a,'action'),...refs(a,'integration')].filter(Boolean))]);
      contextFacts(p,at,context);
      for(const [key,allowedIds] of [['integrations',integrationIds],['notifications',notifications]])for(const id of p[key])if(!allowedIds.has(id))error(`${at}/${key}`,'Process references an unlisted integration or notification.',{id});
      for(const id of p.integrations)if(!activities.some(a=>refs(a,'integration').includes(id)||refs(a,'action').some(action=>refs(objects.get(action),'integration').includes(id))))error(`${at}/integrations`,'Process integration is not linked to its activity.',{id});
      for(const ex of p.exceptions){if(exceptionIds.has(ex.id))error(`${at}/exceptions`,'Process exception ID is duplicated.',{id:ex.id});exceptionIds.add(ex.id);}
    }
    for(const [i,r] of proto.businessRules.entries()){
      const at=`${base}/sections/4/businessRules/${i}`;
      contextFacts(r,at,new Set([f.service,r.rule,...r.bindings,...r.steps.map(number=>wf.steps.find(step=>step.number===number)?.activity).filter(Boolean)]));
      for(const number of r.steps)if(!numbers.has(number))error(`${at}/steps`,'Business rule step does not exist.',{number});
      for(const step of wf.steps)if(step.businessRules.some(ref=>brKey(ref,f.id)===`${f.id}:${r.id}`)&&!r.steps.includes(step.number))error(`${at}/steps`,'Business rule does not declare a step that uses it.',{number:step.number});
      for(const screen of proto.screens)if(screen.kind==='screen')for(const row of screen.fields)if(row.binding&&row.businessRules.some(ref=>brKey(ref,f.id)===`${f.id}:${r.id}`)&&!r.bindings.includes(row.binding))error(`${at}/bindings`,'Business rule does not declare a binding that uses it.',{id:row.binding});
      for(const id of r.bindings)if(!proto.screens.some(screen=>screen.kind==='screen'&&screen.fields.some(row=>row.binding===id)))error(`${at}/bindings`,'Business rule binding does not occur on a Feature screen.',{id});
      if(!wf.steps.some(step=>step.businessRules.some(ref=>brKey(ref,f.id)===`${f.id}:${r.id}`))&&!proto.screens.some(screen=>screen.kind==='screen'&&screen.fields.some(row=>row.businessRules?.some(ref=>brKey(ref,f.id)===`${f.id}:${r.id}`)))&&!proto.processes.some(p=>p.businessRules.some(ref=>brKey(ref,f.id)===`${f.id}:${r.id}`)))error(at,'Business rule is not used by a step, field or process.',{id:r.id});
    }
    const featureContext=new Set([f.service,...(f.actions||[]).flatMap(a=>[a.activity,...a.groups.flatMap(g=>g.sources),...a.pages.flatMap(p=>[p.interface,p.variant,...p.groups.flatMap(g=>g.sources)].filter(Boolean))]),...status.states.map(x=>x.state),...status.transitions.map(x=>x.transition),...integration.integrations.map(x=>x.integration),...proto.businessRules.map(x=>x.rule)]);
    for(const id of productReviewClosureV2(objects,[...featureContext]))featureContext.add(id);
    const criteria=accept.criteria;
    const need=(at,kind,predicate,id)=>{if(!criteria.some(predicate))error(at,'Acceptance coverage is missing or needs an explicit scoped question.',{kind,id});};
    for(const step of wf.steps)need(`${base}/sections/7/criteria`,'path',c=>c.coverage.includes('path')&&c.steps.includes(step.number)&&c.sources.includes(step.activity),step.number);
    // Collapse only explicitly rule-bound nodes, never activities or unbound
    // nodes, when checking paths and declared activity.next correspondence.
    const edges=view?.spec?.edges||[], types=new Map((view?.bindings||[]).map(b=>[b.node,b.type])), paths=[], throughRule=new Set();
    for(const start of nodes.keys())if(types.get(start)==='activity'){
      const queue=edges.filter(e=>e.from===start).map(e=>({node:e.to,rule:false})),seen=new Set();
      for(let i=0;i<queue.length;i++){const {node,rule}=queue[i],key=`${node}\0${rule}`;if(seen.has(key))continue;seen.add(key);
        if(types.get(node)==='activity'){paths.push({from:start,to:node,rule});if(rule)throughRule.add(bindings.get(start));continue;}
        if(types.get(node)==='rule'){throughRule.add(bindings.get(start));for(const edge of edges)if(edge.from===node)queue.push({node:edge.to,rule:true});}
      }
    }
    for(const activity of throughRule){const declared=refs(objects.get(activity),'next');if(!declared.length)continue;
      const actual=new Set(paths.filter(p=>bindings.get(p.from)===activity).map(p=>bindings.get(p.to))),boundActivities=new Set([...bindings].filter(([node])=>types.get(node)==='activity').map(([,id])=>id)),expected=new Set(declared.filter(id=>boundActivities.has(id)));
      if([...actual].some(id=>!expected.has(id))||[...expected].some(id=>!actual.has(id)))error(`${base}/sections/3/steps`,'Workflow paths through a rule conflict with declared activity.next.',{activity,expected:[...expected],actual:[...actual]});
    }
    for(const edge of [...edges,...paths.filter(p=>p.rule)]){const from=wf.steps.filter(step=>step.node===edge.from),to=wf.steps.filter(step=>step.node===edge.to);if(from.length&&to.length)need(`${base}/sections/7/criteria`,'branch',c=>c.coverage.includes('path')&&from.some(a=>to.some(b=>c.steps.indexOf(a.number)>=0&&c.steps.indexOf(b.number)>c.steps.indexOf(a.number))),edge.id||`${edge.from}->${edge.to}`);}
    for(const screen of proto.screens)if(screen.kind==='screen')for(const row of screen.fields)if(row.binding)need(`${base}/sections/7/criteria`,'field',c=>c.coverage.includes('field')&&c.sources.includes(row.binding)&&c.blocks.includes(screen.id),row.binding);
    for(const p of proto.processes){
      for(const kind of ['process-trigger','process-output'])need(`${base}/sections/7/criteria`,kind,c=>c.coverage.includes(kind)&&c.blocks.includes(p.id),p.id);
      for(const ex of p.exceptions)need(`${base}/sections/7/criteria`,'process-exception',c=>c.coverage.includes('process-exception')&&c.blocks.includes(p.id)&&c.processExceptions.includes(ex.id),ex.id);
    }
    for(const r of proto.businessRules)need(`${base}/sections/7/criteria`,'rule-example',c=>c.coverage.includes('rule-example')&&c.businessRules.some(ref=>brKey(ref,f.id)===`${f.id}:${r.id}`)&&c.sources.includes(r.rule),r.id);
    for(const row of integration.integrations)need(`${base}/sections/7/criteria`,'integration',c=>c.coverage.includes('integration')&&c.sources.includes(row.integration),row.integration);
    for(const kind of ['audit','access','integrity'])need(`${base}/sections/7/criteria`,kind,c=>c.coverage.includes(kind),kind);
    for(const [i,c] of criteria.entries()){
      const at=`${base}/sections/7/criteria/${i}`;
      for(const id of c.sources)if(!objects.has(id)||!allowed.has(id)||!featureContext.has(id))error(`${at}/sources`,'Criterion source is missing or outside the Feature context.',{id});
      for(const number of c.steps)if(!numbers.has(number))error(`${at}/steps`,'Criterion step is missing.',{number});
      for(const id of c.blocks)if(!blocks.has(id))error(`${at}/blocks`,'Criterion block is missing.',{id});
      for(const id of c.transitions)if(!status.transitions.some(t=>t.transition===id))error(`${at}/transitions`,'Criterion transition is missing.',{id});
      for(const id of c.processExceptions)if(!proto.processes.some(p=>p.exceptions.some(e=>e.id===id)&&c.blocks.includes(p.id)))error(`${at}/processExceptions`,'Criterion exception is not in a referenced process.',{id});
      if(!c.observation.question&&!c.sources.length)error(`${at}/sources`,'Concrete criterion needs an actual source.');
      if(c.observation.reviewed&&!c.observation.reviewed.some(r=>c.sources.includes(r.object)))error(`${at}/sources`,'Criterion observation must cite a referenced source.');
      if(c.observation.question){const q=objects.get(c.observation.question),targets=new Set([...c.sources,...wf.steps.filter(step=>c.steps.includes(step.number)||c.blocks.includes(step.block)).map(step=>step.activity)]);if(!questionContext(q).some(id=>targets.has(id)))error(`${at}/observation/question`,'Criterion gap must be scoped to its referenced source or activity.',{id:c.observation.question});}
      const processBlocks=c.blocks.map(id=>blocks.get(id)).filter(b=>b&&b.id.startsWith('P'));
      if(c.coverage.includes('path')&&!c.steps.length||c.coverage.includes('field')&&!c.sources.some(id=>['binding','field'].includes(objects.get(id)?.type))||c.coverage.some(x=>['process-trigger','process-output'].includes(x))&&!processBlocks.length||c.coverage.includes('process-exception')&&!c.processExceptions.length||c.coverage.includes('rule-example')&&!c.businessRules.length||c.coverage.includes('integration')&&!c.sources.some(id=>integrationIds.has(id)))error(`${at}/coverage`,'Coverage label lacks its required concrete reference.');
      if(c.coverage.includes('path')&&c.steps.some(number=>!c.sources.includes(wf.steps.find(step=>step.number===number)?.activity)))error(`${at}/coverage`,'Path coverage must cite the activity for every referenced step.');
      const matches=(fact)=>fact&&(c.observation.question?fact.question===c.observation.question:fact.reviewed?.some(r=>c.sources.includes(r.object)));
      for(const kind of ['audit','access','integrity'])if(c.coverage.includes(kind)&&!s.sections[6][kind].some(matches))error(`${at}/coverage`,'Security coverage must identify a source or scoped question of the applicable security fact.',{kind});
      for(const [kind,key] of [['process-trigger','trigger'],['process-output','output']])if(c.coverage.includes(kind)&&!processBlocks.some(p=>matches(p[key])))error(`${at}/coverage`,'Process coverage must cite its actual spec or question.',{kind});
      if(c.coverage.includes('process-exception')&&!processBlocks.some(p=>p.exceptions.some(ex=>c.processExceptions.includes(ex.id)&&matches(ex.description))))error(`${at}/coverage`,'Process exception coverage must cite its actual exception or question.');
    }
  }
  return errors;
}

export function standardReadinessV1(model,scope) {
  const plan=model.profile.productDocument;if(plan?.version!==2||!plan.standard)return [];
  const roots=scopeIds(model,[scope],{predicateDependencies:true}), object=model.objects.find(o=>o.id===scope), errors=[];
  const add=(loc,message,evidence={})=>errors.push(diagnostic('ready-gap',loc,message,evidence,'Resolve the authored standard gap with reviewed facts.'));
  const inspect=(v,loc)=>walk(v,loc,(x,at)=>{if(!Array.isArray(x)&&Object.hasOwn(x,'question'))add(`${at}/question`,'Standard question-bound gap blocks readiness.',{question:x.question});});
  const selected=featureList(plan).filter(({f})=>roots.has(f.service)||(f.actions||[]).some(a=>roots.has(a.activity)||a.groups.some(g=>g.sources.includes(scope))||a.pages.some(p=>p.interface===scope||p.variant===scope||p.groups.some(g=>g.sources.includes(scope)))||refs(model.objects.find(o=>o.id===a.activity),'action').includes(scope)||refs(model.objects.find(o=>o.id===a.activity),'integration').includes(scope)));
  if(object?.type==='project')inspect(plan.standard,'/profile/productDocument/standard');
  else if(selected.length){
    for(const key of ['title','authors','reviewers','startDate','documentVersion','background','objectives'])inspect(plan.standard[key],`/profile/productDocument/standard/${key}`);
    const objects=new Map(model.objects.map(o=>[o.id,o])),roles=new Set(),contexts=new Set(),services=new Set();
    for(const {f} of selected){services.add(f.service);for(const step of f.standard.sections[3].steps)roles.add(step.role);
      for(const action of f.actions||[]){const activity=objects.get(action.activity),ids=action.groups.flatMap(g=>g.sources);for(const id of pageContext(objects,activity,null,ids))contexts.add(id);for(const id of refs(activity,'actor'))roles.add(id);for(const id of refs(activity,'action'))for(const role of refs(objects.get(id),'actor'))roles.add(role);
        for(const page of action.pages)for(const id of pageContext(objects,activity,page,page.groups.flatMap(g=>g.sources)))contexts.add(id);
      }
    }
    plan.standard.roles.forEach((row,i)=>{if(roles.has(row.role))inspect(row,`/profile/productDocument/standard/roles/${i}`);});
    plan.standard.sharedRules.forEach((row,i)=>{const rule=objects.get(row.rule);if(rule?.rule?.scope.some(id=>contexts.has(id)||services.has(id)))inspect(row,`/profile/productDocument/standard/sharedRules/${i}`);});
  }
  const all=featureList(plan), selectedIds=new Set(selected.map(({f})=>f.id)), inspectedRules=new Set();
  for(const {f,loc} of selected){
    inspect(f.standard,`${loc}/standard`);
    if(f.standard.sections[3].statusModel.completeness!=='complete')add(`${loc}/standard/sections/3/statusModel`,'Incomplete status model blocks readiness.');
    for(const ref of standardRuleReferences(f)){
      if(typeof ref==='string'||selectedIds.has(ref.feature))continue;
      const key=`${ref.feature}:${ref.id}`;if(inspectedRules.has(key))continue;inspectedRules.add(key);
      const owner=all.find(({f})=>f.id===ref.feature),index=owner?.f.standard.sections[4].businessRules.findIndex(r=>r.id===ref.id);
      if(index===undefined||index<0)continue;
      const rule=owner.f.standard.sections[4].businessRules[index],base=`${owner.loc}/standard/sections/4/businessRules/${index}`;
      for(const field of ['name','appliesTo','inputs','logic','unitsRounding','boundaries','workedExample'])inspect(rule[field],`${base}/${field}`);
    }
  }
  return errors;
}
