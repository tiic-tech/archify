// Internal Feature composition into the existing Markdown/HTML document IR.
// Public projection and packet publication must validate their own boundaries.
import { bindingCells, validatePrd } from './prd-model.mjs';
import { hasStandardProfileV1 } from './prd-product-v2.mjs';
import { composeStandardDocumentV1 } from './prd-standard-composer.mjs';

export function composeFeatureDocument(model, { service, resources = {}, history = [] } = {}) {
  const result = validatePrd(model);
  if (!result.ok) { const error = new Error('Invalid Feature product document.'); error.diagnostics = result.diagnostics; throw error; }
  return composeProjectedFeatureDocument({objects:model.objects,plan:model.profile.productDocument}, {service,resources,history});
}

// The caller must validate its source or independently approved projection.
export function composeProjectedFeatureDocument({objects,plan}, {service,resources = {},history = [],externalRules} = {}) {
  if (plan?.version !== 2) throw new Error('Feature composition requires a version 2 product document.');
  if (hasStandardProfileV1(plan)) return composeStandardDocumentV1({objects,plan},{service,resources,history,externalRules});
  const map = new Map(objects.map(o => [o.id, o]));
  const nodes = [], features = [], groups = {};
  const heading = (level, text, id) => nodes.push({type:'heading',level,text,...(id ? {id} : {})});
  const paragraph = (text, strong) => nodes.push({type:'paragraph',text,...(strong ? {strong} : {})});
  const question = id => { const q = map.get(id); paragraph([q.title, q.purpose !== q.title ? q.purpose : null, q.detail.consequence ? `Consequence: ${q.detail.consequence}` : null].filter(Boolean).join('; '), 'TBC'); };
  const questions = ids => (ids || []).forEach(question);
  const table = list => {
    if (!list.length) return;
    const rows = list.map(g => {
      groups[g.id] = [...g.sources];
      const cell = {type:'structured',description:g.summary.text,groups:{}};
      if (g.fields?.length) cell.groups.Field = g.fields.map(text => ({text}));
      if (g.rules?.length) cell.groups.Rules = g.rules.map(text => ({text}));
      return [g.title, cell];
    });
    nodes.push({type:'table',headers:['Element / group','Rule'],rows});
    for (const g of list) {
      for(const id of g.sources){const binding=map.get(id);for(const k of bindingCells){const q=binding?.type==='binding'&&binding.detail[k]?.question;if(q)paragraph(`Binding ${id}, detail/${k}: ${map.get(q)?.title||q} (question ${q})`,'TBC');}}
      questions(g.questions);
    }
  };
  const selected = plan.modules.map(m => ({...m,subModules:m.subModules.map(s => ({...s,features:s.features.filter(f => !service || f.service === service)})).filter(s => s.features.length)})).filter(m => m.subModules.length);
  if (!selected.length) throw new Error('No Feature document for the selected Service.');
  heading(1, 'Document control');
  if (history.length) nodes.push({type:'table',headers:['Version','Date','Summary'],rows:history.map(e => [e.version,e.date,e.summary])});
  else paragraph('Authored revision history not provided.');
  paragraph('Functional baseline for a full-function user; this does not grant production permissions or confirm business approval.');
  heading(1, 'Feature list');
  nodes.push({type:'table',headers:['Module','Sub-Module','Feature','Status'],rows:selected.flatMap(m=>m.subModules.flatMap(s=>s.features.map(f=>[m.title,s.title,f.title,f.status==='detailed'?'Detailed':'Catalog only — TBC'])))});
  for (const module of selected) {
    heading(1, module.title, module.id);
    for (const sub of module.subModules) {
      heading(2, sub.title, sub.id);
      for (const feature of sub.features) {
        heading(3, feature.title, feature.id);
        features.push({id:feature.id,key:feature.key,anchor:feature.id,service:feature.service,status:feature.status,...(feature.workflow ? {workflow:feature.workflow.view} : {})});
        if (feature.summary) paragraph(feature.summary.text, 'Purpose / boundary');
        if (feature.status === 'catalog-only') { paragraph('Catalog only — detailed behavior is TBC.'); question(feature.question); continue; }
        heading(4, 'Process Workflow');
        const asset = resources.views?.[feature.workflow.view];
        if (asset) {
          if (typeof asset.src !== 'string' || !/^assets\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(asset.src)) throw new Error('Feature workflow requires a portable local asset path.');
          nodes.push({type:'image',src:asset.src,caption:feature.workflow.caption});
        } else paragraph('Workflow asset is not supplied.');
        heading(4, 'Actions and outcomes');
        for (const action of feature.actions) {
          const activity = map.get(action.activity);
          heading(5, activity.title, action.id);
          const label = {user:'Full-function user action',system:'System operation',external:'External participant operation'}[action.performer];
          paragraph(action.summary.text, label);
          table(action.groups); questions(action.questions);
          for (const page of action.pages) {
            const base = map.get(page.interface), target = page.variant ? map.get(page.variant) : base;
            const title = `${base.title}${page.variant ? ` — ${target.title}` : ''}`;
            heading(6, title, page.id);
            // Images belong only to the explicitly bound page or variant, not
            // to its ancestors or other uses of a shared interface.
            for (const image of resources.prototypes?.[target.id] || []) {
              if (typeof image.src !== 'string' || !/^assets\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(image.src) || typeof image.caption !== 'string' || !image.caption.trim()) throw new Error('Feature page image requires a portable local path and caption.');
              nodes.push({type:'image',src:image.src,caption:image.caption});
            }
            if (!page.groups.length && !(page.questions || []).length) {
              paragraph(target.purpose || 'Page behavior is not modeled.', 'Page purpose');
              paragraph(target.gap || 'Detailed page behavior is not yet modeled.', 'TBC');
            }
            table(page.groups); questions(page.questions);
          }
        }
      }
    }
  }
  return {version:2,nodes,features,groups};
}
