// Standard PRD composition into the existing product-document IR. The caller
// must supply a validated internal model or an independently approved projection.
import { pageContext, standardRuleReferences } from './prd-standard-context.mjs';
import { canonical, hash } from './prd-model.mjs';

// Shared by Service identity and rendering so unrelated catalog facts are not
// hashed into, or displayed by, an independent Service extract.
export function scopeStandardCatalogV1(objects,plan,service){
  const standard=plan.standard;if(!service)return {roles:standard.roles,sharedRules:standard.sharedRules};
  const map=new Map(objects.map(o=>[o.id,o])),usedRoles=new Set(),localContext=new Set();
  const features=plan.modules.flatMap(m=>m.subModules.flatMap(s=>s.features)).filter(f=>f.service===service);
  for(const f of features){for(const step of f.standard.sections[3].steps)usedRoles.add(step.role);for(const action of f.actions||[]){const activity=map.get(action.activity),ids=action.groups.flatMap(g=>g.sources);for(const id of pageContext(map,activity,null,ids))localContext.add(id);for(const r of activity?.refs||[])if(r.relation==='actor')usedRoles.add(r.target);for(const r of activity?.refs||[])if(r.relation==='action')for(const a of map.get(r.target)?.refs||[])if(a.relation==='actor')usedRoles.add(a.target);for(const page of action.pages)for(const id of pageContext(map,activity,page,page.groups.flatMap(g=>g.sources)))localContext.add(id);}}
  return {roles:standard.roles.filter(row=>usedRoles.has(row.role)),sharedRules:standard.sharedRules.filter(row=>map.get(row.rule)?.rule?.scope.some(id=>id===service||localContext.has(id)))};
}

// Resolve only rules actually referenced by the selected Service. The returned
// facts are already validated in the master audience plan; unrelated owner
// Feature content is deliberately not carried into the extract.
export function externalStandardRulesV1(plan, service) {
  if(!service)return [];
  const all=plan.modules.flatMap(m=>m.subModules.flatMap(s=>s.features.map(feature=>({subModule:s.title,feature}))));
  const needed=new Map();
  for(const {feature:f} of all.filter(x=>x.feature.service===service)){
    for(const ref of standardRuleReferences(f)){if(typeof ref==='string')continue;const owner=all.find(x=>x.feature.id===ref.feature);if(!owner)throw new Error('Standard business rule owner is unavailable.');if(owner.feature.service===service)continue;
      const rule=owner.feature.standard.sections[4].businessRules.find(r=>r.id===ref.id);if(!rule)throw new Error('Standard business rule definition is unavailable.');
      const {id,rule:object,name,appliesTo,inputs,logic,unitsRounding,boundaries,workedExample}=rule;
      needed.set(`${owner.feature.id}:${id}`,{owner:owner.feature.id,ownerTitle:owner.feature.title,subModule:owner.subModule,rule:{id,object,name,appliesTo,inputs,logic,unitsRounding,boundaries,workedExample}});
    }
  }
  return [...needed.values()].sort((a,b)=>{const x=`${a.owner}:${a.rule.id}`,y=`${b.owner}:${b.rule.id}`;return x<y?-1:x>y?1:0;});
}

export function composeStandardDocumentV1({objects,plan},{service,resources={},history=[],externalRules=externalStandardRulesV1(plan,service)}={}) {
  const map=new Map(objects.map(o=>[o.id,o])),nodes=[],features=[],groups={};
  const all=plan.modules.flatMap(m=>m.subModules.flatMap(s=>s.features.map(f=>({module:m,subModule:s,feature:f}))));
  const chosen=all.filter(x=>!service||x.feature.service===service);
  if(!chosen.length)throw new Error('No Feature document for the selected Service.');
  const labels=new Map(), anchorOwners=new Map(),pending=[],shown=new Set();let queueQuestions=true;
  const question=id=>{if(!labels.has(id)){if(map.get(id)?.type!=='question')throw new Error('Standard question is unavailable.');const short=hash(id).slice(0,12),anchor=`standard-question-${short}`,owner=anchorOwners.get(anchor);if(owner&&owner!==id)throw new Error('Standard question identity collision.');anchorOwners.set(anchor,id);labels.set(id,{label:`Q-${short}`,anchor});}const item=labels.get(id);if(queueQuestions&&!shown.has(id)&&!pending.includes(id))pending.push(id);return item;};
  const name=id=>map.get(id)?.title||'Not supplied';
  const part=(text,target)=>({text:String(text),...(target?{target}:{})});
  const inline=parts=>({type:'inline',parts:parts.flat().filter(Boolean)});
  const value=v=>{if(typeof v==='string')return [part(v)];if(v?.question){const q=question(v.question);return [part(`TBC (${q.label})`,q.anchor)];}return [part(v?.text||'Not supplied')];};
  const joined=(values,separator='; ')=>values.flatMap((v,i)=>[...(i?[part(separator)]:[]),...value(v)]);
  const documentAnchors=new Set(),claim=id=>{if(!id)return;if(documentAnchors.has(id))throw new Error(`Standard document anchor is ambiguous: ${id}`);documentAnchors.add(id);};
  const heading=(level,text,id,aliases=[])=>{claim(id);aliases.forEach(claim);nodes.push({type:'heading',level,text,...(level===3&&['Prototype with UI elements & rules','Audit & Security'].includes(text)?{literalAmpersand:true}:{}),...(id?{id}:{}),...(aliases.length?{aliases}:{})});};
  const paragraph=(text,strong,id)=>{claim(id);nodes.push({type:'paragraph',text,...(strong?{strong:strong===true?text:strong}:{}),...(id?{id}:{})});};
  const fact=(v,strong)=>paragraph(inline(value(v)),strong);
  const table=(headers,rows,kind)=>{if(rows.length)nodes.push({type:'table',headers,rows,...(kind?{kind}:{})});};
  const list=items=>{if(items.length)nodes.push({type:'list',items});};
  const cell=v=>inline(value(v));
  const flush=()=>{if(!pending.length)return;paragraph('Open questions',true);while(pending.length){const id=pending.shift();if(shown.has(id))continue;shown.add(id);const q=map.get(id),item=labels.get(id);paragraph([item.label,q.title,q.purpose&&q.purpose!==q.title?q.purpose:null].filter(Boolean).join(' — '),null,item.anchor);}};
  const anchor=(feature,id)=>`${feature.id}-${id}`;
  let externalCatalogLabel='';
  const blockRef=(feature,id)=>inline([part(id,anchor(feature,id))]);
  const ruleParts=(feature,refs)=>refs.flatMap((ref,i)=>{
    const ownerId=typeof ref==='string'?feature.id:ref.feature,id=typeof ref==='string'?ref:ref.id;
    const owner=all.find(x=>x.feature.id===ownerId),external=externalRules.find(x=>x.owner===ownerId&&x.rule.id===id),rule=owner?.feature.standard.sections[4].businessRules.find(r=>r.id===id)||external?.rule;
    if(!rule||!owner&&!external)throw new Error('Standard business rule reference is unavailable.');
    const title=rule.name.text||'TBC',label=ownerId===feature.id?'':`${external?`${externalCatalogLabel} > `:''}${owner?.subModule.title||external.subModule} > ${owner?.feature.title||external.ownerTitle} > `;
    return [...(i?[part('; ')]:[]),part(`${label}${id} ${title}`,`${ownerId}-${id}`)];
  });
  const image=resource=>{if(!resource||typeof resource.src!=='string'||!/^assets\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(resource.src)||typeof resource.caption!=='string'||!resource.caption.trim())throw new Error('Standard image requires an approved local path and caption.');nodes.push({type:'image',src:resource.src,caption:resource.caption});};
  const standard=plan.standard,{roles,sharedRules}=scopeStandardCatalogV1(objects,plan,service);
  heading(1,standard.title.text||'PRD — title TBC');if(standard.title.question)fact(standard.title,'Title');
  paragraph(inline(joined(standard.authors)),'Author');paragraph(inline(joined(standard.reviewers)),'Reviewer');fact(standard.startDate,'Starting date');fact(standard.documentVersion,'Document version');
  if(service)paragraph('Service extract of the master PRD; the master remains authoritative.');
  heading(1,'Introduction');heading(2,'Background');fact(standard.background);heading(2,'Objectives');
  for(const objective of standard.objectives)paragraph(inline([...value(objective.goal).map(p=>({...p,strong:true})),part(' — '),...value(objective.meaning)]));
  if(standard.glossary?.length){heading(2,'Glossary');table(['Term','Definition'],standard.glossary.map(x=>[cell(x.term),cell(x.definition)]));}
  heading(1,'Document control');table(['Date','Version','Change','Author'],standard.history.map(h=>[cell(h.date),h.version,cell(h.change),cell(h.author)]));
  for(const h of standard.history)if(h.references.length||h.chapters.length){paragraph(`Version ${h.version}`,true);if(h.references.length)paragraph(inline(joined(h.references)),'References');for(const c of h.chapters){const f=all.find(x=>x.feature.id===c.feature)?.feature;if(f)paragraph(inline([part(`${f.title}: `),...value(c.summary)]),'Summary of changes');}}
  if(service){if(history.length)table(['Service version','Date','Change','Author'],history.map(h=>[h.version,h.date,h.summary,h.author||'Not recorded']));else paragraph('Service-specific history was not supplied.');}
  flush();
  const modules=[...new Map(chosen.map(x=>[x.module.id,x.module])).values()],commonModule=modules.find(m=>m.title==='General Module'),commonFeatures=chosen.filter(x=>x.module===commonModule).map(x=>x.feature),commonFeature=commonFeatures.find(f=>/role.*permission|permission.*role/i.test(f.title))||commonFeatures[0];
  const addCatalog=!commonModule&&(roles.length||sharedRules.length||externalRules.length),catalogId='standard-general-catalog';
  externalCatalogLabel=commonFeature?.title||'Role & Permission';
  if(addCatalog&&chosen.some(x=>x.feature.id===catalogId||x.module.id===catalogId))throw new Error('General catalog anchor conflicts with an authored chapter.');
  heading(1,'Feature list');let last='';queueQuestions=false;
  const indexRows=chosen.map(({module,feature:f})=>{const moduleName=last===module.id?'':module.title;last=module.id;return [moduleName,inline([part(f.title,f.id)]),cell(f.standard.priority),cell(f.standard.readiness),cell(f.standard.featureDescription),cell(f.standard.note)];});
  if(addCatalog)indexRows.unshift(['General Module',inline([part('Role & Permission',catalogId)]),'—','—','Shared role and rule definitions','Nontransactional catalog']);
  table(['Module','Feature','Priority','Readiness','Description','Note'],indexRows);queueQuestions=true;
  const rolePurposes=()=>table(['Role','Purpose'],roles.map(r=>[name(r.role),cell(r.purpose)]));
  const permissions=()=>table(['Role','Permissions','Restrictions'],roles.map(r=>[name(r.role),cell(r.permissions),cell(r.restrictions)]));
  const rules=()=>table(['Shared rule','Description'],sharedRules.map(r=>[name(r.rule),cell(r.description)]));
  const externalDefinitions=()=>{if(!externalRules.length)return;heading(4,'Business rules');for(const {owner,ownerTitle,subModule,rule:r} of externalRules){paragraph(inline([part(`${subModule} > ${ownerTitle}: `),...value(r.name)]),r.id,`${owner}-${r.id}`);table(['Attribute','Specification'],[['appliesTo','Applies to'],['inputs','Inputs'],['logic','Logic'],['unitsRounding','Units & rounding'],['boundaries','Boundaries & exceptions'],['workedExample','Worked example']].map(([key,label])=>[label,cell(r[key])]));}flush();};
  if(addCatalog){heading(1,'General Module');heading(2,'Role & Permission',catalogId);heading(3,'Description');paragraph('Shared role, permission and rule definitions. This catalog does not define transactions.');rolePurposes();flush();
    heading(3,'Preconditions');paragraph('Not applicable to a nontransactional definition catalog.');heading(3,'Postconditions');paragraph('Not applicable to a nontransactional definition catalog.');heading(3,'Role based workflow map');paragraph('Not applicable: the catalog does not define a workflow.');
    heading(3,'Prototype with UI elements & rules');rules();externalDefinitions();if(!sharedRules.length&&!externalRules.length)paragraph('No shared rules are included in this catalog.');flush();heading(3,'Integration points');paragraph('Not applicable: the catalog does not define an integration.');heading(3,'Audit & Security');permissions();if(!roles.length)paragraph('No roles are included in this catalog.');flush();heading(3,'Acceptance Criteria');paragraph('Not applicable: the catalog does not define transactional acceptance scenarios.');}
  for(const module of modules){
    heading(1,module.title,module.id);
    for(const {feature:f} of chosen.filter(x=>x.module.id===module.id)){
      features.push({id:f.id,key:f.key,anchor:f.id,service:f.service,status:f.status,...(f.workflow?{workflow:f.workflow.view}:{})});
      heading(2,f.title,f.id);
      for(const value of [f.standard.priority,f.standard.readiness,f.standard.featureDescription,f.standard.note])if(value?.question)question(value.question);flush();
      for(const change of f.standard.changes){paragraph(inline([part(`🔄 ${change.version} Changes (ref: `),...joined(change.references),part(')')]));for(const item of change.items)paragraph(inline(value(item)));}
      const [description,pre,post,workflow,proto,integrations,security,acceptance]=f.standard.sections,actionAliases=new Set();
      const blockAliases=block=>{const aliases=[];if(block.kind==='screen')aliases.push(block.page);for(const step of workflow.steps.filter(s=>s.block===block.id)){const action=(f.actions||[]).find(a=>a.activity===step.activity);if(action&&!actionAliases.has(action.id)){actionAliases.add(action.id);aliases.push(action.id);}}return aliases;};
      heading(3,'Description');fact(description.content);if(f===commonFeature)rolePurposes();flush();
      heading(3,'Preconditions');list(pre.conditions.map(cell));flush();
      heading(3,'Postconditions');table(['Outcome','Result'],[['success','Success'],['rejection','Rejection'],['cancellation','Cancellation'],['failure','Failure']].map(([key,title])=>[title,inline(joined(post[key]))]));flush();
      heading(3,'Role based workflow map');
      const view=resources.featureViews?.[f.id];if(view)image({...view,caption:f.workflow?.caption||view.caption});else if(f.workflow)paragraph('Numbered native workflow is not supplied.');
      if(workflow.question)fact({question:workflow.question});
      table(['Step','Role','Action','System response','Rules','Screen'],workflow.steps.map(step=>[step.number,name(step.role),cell(step.action),cell(step.response),inline([...joined(step.rules),...(step.businessRules.length?[part('; '),...ruleParts(f,step.businessRules)]:[])]),blockRef(f,step.block)]));
      const status=workflow.statusModel;paragraph(status.completeness==='complete'?'Status model':'Incomplete status model — listed states and transitions are not a whitelist.',true);if(status.question)fact({question:status.question});
      table(['Status','Meaning'],status.states.map(row=>[name(row.state),cell(row.meaning)]));table(['From','Action','By','To'],status.transitions.map(row=>[name(row.from),cell(row.action),name(row.role),name(row.to)]));flush();
      heading(3,'Prototype with UI elements & rules');if(f===commonFeature){rules();externalDefinitions();}
      if(f.status==='catalog-only')paragraph(inline([part('Prototype details are not yet modeled; '),...value({question:f.question}),part('.')]));
      for(const screen of proto.screens){
        if(screen.kind==='missing-screen'){heading(4,`${screen.id} — Missing screen`,anchor(f,screen.id),blockAliases(screen));paragraph(`Used in steps: ${workflow.steps.filter(step=>step.block===screen.id).map(step=>step.number).join(', ')}`);fact({question:screen.question});flush();continue;}
        heading(4,`${screen.id} ${name(screen.interface)}${screen.variant?` — ${name(screen.variant)}`:''}`,anchor(f,screen.id),blockAliases(screen));
        const uses=workflow.steps.filter(step=>step.block===screen.id).map(step=>step.number);paragraph(`Used in steps: ${uses.join(', ')}`);
        fact(screen.design,'Design');for(const id of screen.assets){const resource=resources.assets?.[id];if(!resource)throw new Error('Selected standard screen asset has no supplied image resource.');image(resource);}
        if(screen.elements.length)paragraph(screen.elements.map(name).join(', '),'Page elements');for(const item of screen.pageRules)fact(item,'Page rules');
        const grouped=[],labels=new Map(),qualified=new Map(),semantic=v=>typeof v==='string'?v:v?.question?{question:v.question}:{text:v?.text};
        const semanticRelations=new Set(['actor','uses','variant','action','integration','rule','entity','state','from','to']);
        const functionalRefs=o=>(o?.refs||[]).filter(r=>semanticRelations.has(r.relation)).map(({relation,target,type})=>({relation,target,type}));
        for(const row of screen.fields)if(row.field){const label=name(row.field),key=`${label}\0${name(row.binding)}`;labels.set(label,(labels.get(label)||0)+1);qualified.set(key,(qualified.get(key)||0)+1);}
        for(const row of screen.fields){if(row.element){grouped.push({rows:[row]});continue;}const binding=map.get(row.binding),field=map.get(row.field),key=canonical({dataType:semantic(row.dataType),typeDetails:semantic(row.typeDetails),required:semantic(row.required),default:semantic(row.default),rules:semantic(row.rules),source:semantic(row.source),editableWhen:semantic(row.editableWhen),businessRules:row.businessRules,bindingDetail:binding?.detail,bindingRefs:functionalRefs(binding),fieldDetail:field?.detail,fieldRefs:functionalRefs(field)});let group=grouped.at(-1);if(!group||group.key!==key){group={key,rows:[]};grouped.push(group);}group.rows.push(row);}
        const fieldLabel=row=>{const label=name(row.field),binding=name(row.binding);if(labels.get(label)===1)return label;return `${label} (${binding}${qualified.get(`${label}\0${binding}`)>1?` — ${row.binding}`:''})`;};
        table(['Field','Data type','Required','Default','Rules & validation','Source / integration','Editable when'],grouped.map(({rows})=>{const row=rows[0];if(row.element)return [name(row.element),...Array.from({length:6},()=>cell({question:row.question}))];const sameGap=row.dataType?.question&&row.dataType.question===row.typeDetails?.question;return [rows.map(fieldLabel).join('; '),inline([...value(row.dataType),...(sameGap?[]:[part(' — '),...value(row.typeDetails)])]),cell(row.required),cell(row.default),inline([...value(row.rules),...(row.businessRules.length?[part('; '),...ruleParts(f,row.businessRules)]:[])]),cell(row.source),cell(row.editableWhen)];}));
        const visibilityQuestions=new Map();
        for(const row of screen.fields)if(row.binding){const id=map.get(row.binding)?.detail.visibility?.question;if(id){if(!visibilityQuestions.has(id))visibilityQuestions.set(id,[]);visibilityQuestions.get(id).push(fieldLabel(row));}}
        for(const [id,fields] of visibilityQuestions)paragraph(inline([part(`${fields.join('; ')}: `),...value({question:id})]),'Visibility');
        if(screen.actionMatrix?.length)table(['Status','Role','Actions','Condition'],screen.actionMatrix.map(row=>[name(row.state),name(row.role),row.actions.map(name).join(', '),row.condition?cell(row.condition):'Not specified']));
        for(const b of screen.buttons)paragraph(inline([part(`${name(b.element)}: `),...value(b.visibility),part('; '),...value(b.enabled),part('; '),...value(b.behavior)]),'Button');for(const message of screen.messages)fact(message,'Message');flush();
      }
      for(const p of proto.processes){heading(4,`${p.id} ${p.title.text||'Process — TBC'}`,anchor(f,p.id),blockAliases(p));if(p.title.question)fact(p.title,'Process');paragraph(`Used in steps: ${workflow.steps.filter(step=>step.block===p.id).map(step=>step.number).join(', ')}`);
        table(['Item','Spec'],[['Trigger',cell(p.trigger)],['Input',cell(p.input)],['Processing',inline([...value(p.processing),...(p.businessRules.length?[part('; '),...ruleParts(f,p.businessRules)]:[]),...(p.integrations.length?[part(`; Integrations: ${p.integrations.map(name).join(', ')}`)]:[]),...(p.notifications.length?[part('; Notifications: '),...joined(p.notifications.map(id=>integrations.notifications.find(n=>n.id===id)?.event).filter(Boolean))]:[])])],['Output',cell(p.output)],['Exceptions',inline(joined(p.exceptions.map(x=>x.description)))],['Volume & timing',cell(p.volumeTiming)],['Human checkpoint',cell(p.humanCheckpoint)]]);
      }
      if(proto.businessRules.length){heading(4,'Business rules');for(const r of proto.businessRules){paragraph(inline(value(r.name)),r.id,anchor(f,r.id));paragraph(`Steps: ${r.steps.join(', ')}${r.bindings.length?`; fields: ${r.bindings.map(name).join(', ')}`:''}`);table(['Attribute','Specification'],[['appliesTo','Applies to'],['inputs','Inputs'],['logic','Logic'],['unitsRounding','Units & rounding'],['boundaries','Boundaries & exceptions'],['workedExample','Worked example']].map(([key,label])=>[label,cell(r[key])]));}}
      flush();heading(3,'Integration points');if(integrations.none)fact(integrations.none);table(['System','Direction','Trigger','Data exchanged','Timing','Failure handling'],integrations.integrations.map(r=>[name(r.integration),cell(r.direction),cell(r.trigger),cell(r.data),cell(r.timing),cell(r.failure)]));table(['Event','Channel','Recipient','Roles','Integration'],integrations.notifications.map(r=>[cell(r.event),cell(r.channel),cell(r.recipient),r.roles.map(name).join(', '),r.integration?name(r.integration):'Not supplied']));
      flush();heading(3,'Audit & Security');if(f===commonFeature)permissions();for(const [key,label] of [['audit','Audit log'],['access','Access control'],['integrity','Data integrity']])for(const v of security[key])fact(v,label);flush();
      heading(3,'Acceptance Criteria');const contexts=new Map();for(const c of acceptance.criteria){const key=c.blocks.length?c.blocks.join(', '):c.steps.length||c.coverage.includes('path')?'Workflow':c.coverage.some(kind=>['audit','access','integrity'].includes(kind))?'Audit & Security':'General';if(!contexts.has(key))contexts.set(key,[]);contexts.get(key).push(c);}
      for(const [context,criteria] of contexts){const contextCell=['Workflow','General','Audit & Security'].includes(context)?context:inline(context.split(', ').flatMap((id,i)=>[...(i?[part(', ')]:[]),part(id,anchor(f,id))]));table(['Context','Observation and traceability'],criteria.map((c,i)=>[i?'':contextCell,inline([part(c.observation.question?'':'✅ '),...value(c.observation),...(c.steps.length?[part(` — Steps: ${c.steps.join(', ')}`)]:[]),...(c.businessRules.length?[part('; Rules: '),...ruleParts(f,c.businessRules)]:[]),...(c.transitions.length?[part(`; Transitions: ${c.transitions.map(name).join(', ')}`)]:[]),...(c.processExceptions.length?[part('; Exceptions: '),...joined(c.processExceptions.map(id=>proto.processes.flatMap(p=>p.exceptions).find(ex=>ex.id===id)?.description).filter(Boolean))]:[])])]));}flush();
    }
  }
  return {version:2,nodes,features,groups};
}
