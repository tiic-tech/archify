// Additional reference checks used by the standard-profile validator.
import { diagnostic, serviceOwners } from './prd-model.mjs';
import { productServiceSelection } from './prd-product-document.mjs';
import { pageContext } from './prd-standard-context.mjs';

const refs = (object, relation) => (object?.refs || []).filter(r => r.relation === relation).map(r => r.target);
const objectContext = (object, target) => {
  const scope = object?.detail?.scope || [], targets = refs(object, 'target');
  const common = scope.length && targets.length ? scope.filter(id => targets.includes(id)) : scope.length ? scope : targets;
  return common.includes(target);
};

// Input must already pass the workspace schema. The caller remains responsible
// for ordinary v2 validation, all other standard semantics and audience closure.
export function validateStandardRefinementsV1(model) {
  const plan = model.profile.productDocument, errors = [];
  if (plan?.version !== 2 || !plan.standard) return errors;
  const objects = new Map(model.objects.map(o => [o.id, o]));
  const owners = serviceOwners(model);
  const features = new Map();
  const error = (loc, message, evidence = {}) => errors.push(diagnostic('standard-refinement', loc, message, evidence, 'Correct the explicitly modeled reference or its scope.'));
  for (const [mi, module] of plan.modules.entries()) for (const [si, sub] of module.subModules.entries()) for (const [fi, feature] of sub.features.entries()) {
    const loc = `/profile/productDocument/modules/${mi}/subModules/${si}/features/${fi}`;
    if (features.has(feature.id)) error(`${loc}/id`, 'Feature identity is duplicated.', {id:feature.id});
    else features.set(feature.id, {feature,loc});
  }
  const ruleDefinitions = new Map();
  for (const {feature,loc} of features.values()) {
    const rules = feature.standard.sections[4].businessRules;
    for (const [i, rule] of rules.entries()) {
      const at = `${loc}/standard/sections/4/businessRules/${i}`, key = `${feature.id}:${rule.id}`;
      if (ruleDefinitions.has(key)) error(`${at}/id`, 'Business rule identity is duplicated within the Feature.', {id:rule.id});
      else ruleDefinitions.set(key, {feature,rule,at});
      if (objects.get(rule.rule)?.type !== 'rule') error(`${at}/rule`, 'Business rule must reference a typed rule.', {id:rule.rule});
    }
  }
  // A typed rule is authored in exactly one owner Feature. This prevents a
  // qualified use from quietly introducing a second formula authority.
  const ownerByRule = new Map();
  for (const {feature,rule,at} of ruleDefinitions.values()) {
    if (ownerByRule.has(rule.rule)) error(`${at}/rule`, 'A modeled business rule has more than one authored definition.', {id:rule.rule,owner:ownerByRule.get(rule.rule)});
    else ownerByRule.set(rule.rule, feature.id);
  }
  for (const {feature,loc} of features.values()) {
    const standard = feature.standard, workflow = standard.sections[3], prototype = standard.sections[4], acceptance = standard.sections[7];
    const selected = productServiceSelection(model, feature.service).selected;
    const local = id => selected.has(id) && (!owners[id] || owners[id] === feature.service);
    const context = new Set(), placed = new Set();
    for(const action of feature.actions||[]){const activity=objects.get(action.activity),actionSources=action.groups.flatMap(group=>group.sources);for(const id of actionSources)placed.add(id);for(const id of pageContext(objects,activity,null,actionSources))context.add(id);
      for(const page of action.pages){const ids=page.groups.flatMap(group=>group.sources);for(const id of ids)placed.add(id);for(const id of pageContext(objects,activity,page,ids))context.add(id);}
    }
    const checkRefs = (list, at) => {
      for (const [i, reference] of list.entries()) {
        const owner = typeof reference === 'string' ? feature.id : reference.feature;
        const id = typeof reference === 'string' ? reference : reference.id;
        const definition = ruleDefinitions.get(`${owner}:${id}`);
        if (!definition) { error(`${at}/${i}`, 'Business rule reference does not resolve to an authored Feature definition.', {feature:owner,id}); continue; }
        const modeled = objects.get(definition.rule.rule);
        if (!local(definition.rule.rule) || !modeled?.rule?.scope.some(id => context.has(id) || id===feature.service&&placed.has(modeled.id))) error(`${at}/${i}`, 'Referenced business rule is outside the Feature Service context or does not apply to it.', {feature:owner,id});
      }
    };
    for (const [i,step] of workflow.steps.entries()) checkRefs(step.businessRules,`${loc}/standard/sections/3/steps/${i}/businessRules`);
    for (const [i,process] of prototype.processes.entries()) checkRefs(process.businessRules,`${loc}/standard/sections/4/processes/${i}/businessRules`);
    for (const [i,criterion] of acceptance.criteria.entries()) checkRefs(criterion.businessRules,`${loc}/standard/sections/7/criteria/${i}/businessRules`);
    const pageById = new Map((feature.actions || []).flatMap(action => action.pages.map(page => [page.id, {page,action}])));
    const states = new Set(workflow.statusModel.states.map(row => row.state));
    for (const [i,screen] of prototype.screens.entries()) {
      if (screen.kind !== 'screen') continue;
      const at = `${loc}/standard/sections/4/screens/${i}`, page = pageById.get(screen.page);
      if (!page || page.page.interface !== screen.interface || page.page.variant !== screen.variant) error(`${at}/page`, 'Screen must identify the exact Feature page and variant.', {id:screen.page});
      const elements = new Set(screen.elements);
      const onPage = id => {
        let current = objects.get(id), seen = new Set();
        while (current && !seen.has(current.id)) {
          if (refs(current, 'variant').some(id => id !== screen.variant)) return false;
          if (current.id === screen.interface) return true;
          if (current.type === 'variant' && current.id !== screen.variant) return false;
          seen.add(current.id); current = objects.get(current.parent);
        }
        return false;
      };
      for (const [j,row] of screen.fields.entries()) {
        const pos = `${at}/fields/${j}`;
        if (Object.hasOwn(row, 'element')) {
          const element = objects.get(row.element), question = objects.get(row.question);
          if (element?.type !== 'element' || element.detail.kind !== 'upload' || !elements.has(row.element) || !local(row.element) || !onPage(row.element)) error(`${pos}/element`, 'Missing field specification must reference a displayed upload element on this page.', {id:row.element});
          if (question?.type !== 'question' || !local(row.question) || !objectContext(question,row.element)) error(`${pos}/question`, 'Missing field specification requires a question scoped to that upload element.', {id:row.question});
        } else checkRefs(row.businessRules,`${pos}/businessRules`);
      }
      for (const [j,row] of (screen.actionMatrix || []).entries()) {
        const pos = `${at}/actionMatrix/${j}`, role = objects.get(row.role), state = objects.get(row.state);
        if (state?.type !== 'state' || !states.has(row.state) || !local(row.state)) error(`${pos}/state`, 'Matrix status must be an actual state in this Feature status model.', {id:row.state});
        if (role?.type !== 'role' || !page || !refs(objects.get(page.action.activity), 'actor').includes(row.role)) error(`${pos}/role`, 'Matrix role must be an actor of this page activity.', {id:row.role});
        for (const [k,id] of row.actions.entries()) {
          const action = objects.get(id);
          if (!local(id) || !(action?.type === 'element' && elements.has(id) && onPage(id) || action?.type === 'action' && [...elements].some(element => refs(objects.get(element),'action').includes(id)))) error(`${pos}/actions/${k}`, 'Matrix action must be a displayed page element or its modeled action.', {id});
        }
      }
    }
  }
  return errors;
}
