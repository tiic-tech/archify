// Feature-centric authoring contract. Export and public projection are separate
// consumers and must not use this private-model validator as a disclosure check.
import { bindingQuestions, canonical, diagnostic, hash, predicateFields, serviceOwners } from './prd-model.mjs';
import { productServiceSelection } from './prd-product-document.mjs';
import { validateStandardDocumentV1 } from './prd-standard-v1.mjs';

const refs = (o, relation) => (o?.refs || []).filter(r => r.relation === relation).map(r => r.target);
const requirementTypes = new Set(['field', 'binding', 'element', 'action', 'rule']);
const groupSourceTypes = new Set([...requirementTypes, 'integration', 'state', 'transition', 'entity', 'evidence', 'decision', 'acceptance']);
const reservedKey = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

// Detect both full and partial opt-ins so consumers cannot silently drop the
// standard profile; unsupported consumers must continue to fail closed.
export const hasStandardProfileV1 = plan => Boolean(plan?.standard || plan?.modules?.some(m => m.subModules.some(s => s.features.some(f => f.standard))));

// Canonical JSON sorts object keys recursively but preserves authored array order.
// Callers must pass the actual audience-specific fact, never a private fallback.
export const reviewHashV2 = fact => hash(canonical(fact));
export const normalizeProductDocumentV2 = plan => JSON.parse(canonical(plan));

export function productReviewDependenciesV2(o, {boundedQuestion = false} = {}) {
  if (!o) return [];
  const predicates = [o.detail?.predicate, o.detail?.visibility, o.detail?.editable, o.detail?.required, o.rule?.condition, ...(o.rule?.exceptions || []).map(e => e.condition)];
  const relations = ['actor', 'uses', 'variant', 'action', 'integration', 'field', 'rule', 'entity', 'state', 'from', 'to'];
  const scoped = ['evidence', 'decision', 'question'].includes(o.type) && !(boundedQuestion && o.type==='question');
  return [...new Set([...relations.flatMap(r => refs(o, r)), ...(scoped ? [...(o.detail?.scope || []), ...refs(o, 'target')] : []), ...(o.rule?.scope || []), ...(o.rule?.exceptions || []).flatMap(e => e.scope), ...bindingQuestions(o), ...predicates.flatMap(p => predicateFields(p).map(f => f.id))])];
}

// A binding's question is a reviewed fact, but its other scope/target
// contexts are not functional dependencies of the binding. Find those edges
// without traversing questions first: a question reviewed on its own retains
// its ordinary explicit context closure. Entries from an earlier snapshot can
// include both the binding and its question and must refresh identically.
export function productReviewBoundedQuestionsV2(objects, ids) {
  const bounded=new Set(), scan=ids.filter(id=>objects.get(id)?.type!=='question'), scanned=new Set();
  for(let i=0;i<scan.length;i++) {
    const id=scan[i];if(scanned.has(id))continue;scanned.add(id);
    const o=objects.get(id);for(const q of bindingQuestions(o))bounded.add(q);
    for(const dep of productReviewDependenciesV2(o))if(objects.get(dep)?.type!=='question')scan.push(dep);
  }
  return bounded;
}

export function productReviewClosureV2(objects, ids) {
  const bounded=productReviewBoundedQuestionsV2(objects,ids), seen=new Set(), queue=[...ids];
  for(let i=0;i<queue.length;i++) {
    const id=queue[i];if(seen.has(id))continue;seen.add(id);
    queue.push(...productReviewDependenciesV2(objects.get(id),{boundedQuestion:bounded.has(id)}));
  }
  return seen;
}

// Explicit authoring helper, not an automatic review or approval. A public
// caller must supply only its already approved projected objects.
export function snapshotReviewedTextV2(objects, text, ids) {
  const map = new Map(objects.map(o => [o.id, o])), seen = productReviewClosureV2(map,ids);
  for(const id of seen) if(!map.has(id)) throw new Error(`Review source is unavailable: ${id}`);
  if (!seen.size) throw new Error('Review requires at least one source.');
  return { text, reviewed: [...seen].map(object => ({ object, sha256: reviewHashV2(map.get(object)) })) };
}

export function validateProductDocumentV2(model, { eligible, reviewFacts } = {}) {
  const plan = model.profile.productDocument;
  // An ID allowlist alone is not a public projection: hashing the source
  // would bind private fields. Public callers must provide projected facts.
  if (eligible) return [diagnostic('product-document-v2', '/profile/productDocument', 'An ID allowlist is not an approved Feature projection.', {}, 'Validate an independently authored public plan against projected facts.')];
  const objects = new Map(model.objects.map(o => [o.id, o]));
  const children = new Map();
  for (const o of model.objects) if (o.parent) { if (!children.has(o.parent)) children.set(o.parent, []); children.get(o.parent).push(o); }
  // A section with only variant-scoped descendants from other states is not
  // part of this page. Empty and genuinely unscoped sections remain shared.
  function activeSection(section, variant, seen = new Set()) {
    if (seen.has(section.id)) return false;
    const next = new Set(seen); next.add(section.id);
    const items = children.get(section.id) || [];
    if (!items.length) return true;
    return items.some(child => {
      const variants = refs(child, 'variant');
      if (variants.length && !variants.every(v => v === variant)) return false;
      return child.type !== 'section' || activeSection(child, variant, next);
    });
  }
  const owners = serviceOwners(model);
  const views = new Map(model.nativeViews.map(v => [v.id, v]));
  const errors = [], anchors = new Set(), featureKeys = new Set(), byService = new Map();
  const error = (loc, message, evidence = {}) => errors.push(diagnostic('product-document-v2', loc, message, evidence, 'Correct the Feature plan or review the named source facts.'));
  const anchor = (id, loc) => { if (anchors.has(id)) error(loc, 'Presentation identity is duplicated.', { id }); anchors.add(id); };
  const portableKey = (key, loc) => { if (reservedKey.test(key)) error(loc, 'Business key is a reserved portable filename.', { key }); };
  const get = (id, types, loc) => {
    const o = objects.get(id);
    if (!o || !types.includes(o.type)) { error(loc, 'Reference is missing or has the wrong type.', { id, expected: types, actual: o?.type || null }); return null; }
    return o;
  };
  // Direct semantic references and predicate fields are transitive review
  // dependencies. Hash whole facts, including exceptions, without parsing prose.
  function reviewed(summary, required, loc, service) {
    const entries = new Map();
    for (const [i, r] of summary.reviewed.entries()) {
      const at = `${loc}/reviewed/${i}`;
      if (entries.has(r.object)) error(`${at}/object`, 'Reviewed object is duplicated.', { id: r.object });
      entries.set(r.object, r.sha256);
      const o = objects.get(r.object);
      if (!o) { error(`${at}/object`, 'Reviewed fact is missing.', { id: r.object }); continue; }
      if (owners[o.id] && owners[o.id] !== service) error(`${at}/object`, 'Reviewed fact belongs to another Service.', { id: o.id });
      const fact = reviewFacts ? reviewFacts.get(o.id) : o;
      if (!fact) { error(`${at}/object`, 'Reviewed fact is not approved.', { id: o.id }); continue; }
      const actual = reviewHashV2(fact);
      if (actual !== r.sha256) error(`${at}/sha256`, 'Reviewed summary is stale.', { id: o.id, expected: r.sha256, actual });
    }
    for (const id of productReviewClosureV2(objects,required)) if (!entries.has(id)) error(`${loc}/reviewed`, 'Summary is missing a source or semantic dependency review.', { id });
  }
  function questions(ids, loc, service, context, singular = false) {
    for (const [i, id] of (ids || []).entries()) {
      const at = singular ? loc : `${loc}/${i}`;
      const q = get(id, ['question'], at); if (!q) continue;
      if (owners[id] && owners[id] !== service) error(at, 'Question belongs to another Service.', { id });
      const scope = q.detail.scope || [], targets = refs(q, 'target');
      const common = scope.length && targets.length ? scope.filter(x => targets.includes(x)) : scope.length ? scope : targets;
      if (!common.some(x => context.has(x))) error(at, 'Question is not scoped to this Feature context.', { id });
    }
  }
  portableKey(plan.key, '/profile/productDocument/key');
  for (const [mi, module] of plan.modules.entries()) {
    const ml = `/profile/productDocument/modules/${mi}`; anchor(module.id, `${ml}/id`);
    for (const [si, sub] of module.subModules.entries()) {
      const sl = `${ml}/subModules/${si}`; anchor(sub.id, `${sl}/id`);
      for (const [fi, feature] of sub.features.entries()) {
        const fl = `${sl}/features/${fi}`; anchor(feature.id, `${fl}/id`); portableKey(feature.key, `${fl}/key`);
        if (featureKeys.has(feature.key)) error(`${fl}/key`, 'Feature business key is duplicated.', { key: feature.key }); featureKeys.add(feature.key);
        const service = get(feature.service, ['service'], `${fl}/service`); if (!service) continue;
        if (!byService.has(service.id)) byService.set(service.id, { activities: new Set(), questions: new Set(), relevant: new Set(), detailed: false, loc: fl });
        const coverage = byService.get(service.id);
        // Standard gaps are placements only; their scope and type are checked
        // by the standard validator below, never by treating an ID as approval.
        if (plan.standard) {
          const visit = value => { if (!value || typeof value !== 'object') return; if (typeof value.question === 'string') coverage.questions.add(value.question); for (const child of Object.values(value)) visit(child); };
          visit(feature.standard);
        }
        const { selected } = productServiceSelection(model, service.id);
        const local = (id, loc) => { if (!selected.has(id) || owners[id] && owners[id] !== service.id) { error(loc, 'Reference is outside the Feature Service context.', { id }); return false; } return true; };
        if (feature.summary) reviewed(feature.summary, [service.id], `${fl}/summary`, service.id);
        if (feature.status === 'catalog-only') {
          const contexts = new Set([...selected].filter(id => (!owners[id] || owners[id] === service.id) && !['project', 'source'].includes(objects.get(id)?.type)));
          questions([feature.question], `${fl}/question`, service.id, contexts, true);
          coverage.questions.add(feature.question);
          continue;
        }
        coverage.detailed = true;
        const view = views.get(feature.workflow.view);
        if (!view || view.diagramType !== 'workflow') error(`${fl}/workflow/view`, 'Feature requires a native workflow.', { id: feature.workflow.view });
        else if (view.service && view.service !== service.id || view.bindings.some(b => owners[b.object] && owners[b.object] !== service.id) || !view.service && !view.bindings.some(b => owners[b.object] === service.id)) error(`${fl}/workflow/view`, 'Workflow is outside the Feature Service context.', { id: view.id });
        const bound = new Set((view?.bindings || []).filter(b => b.type === 'activity').map(b => b.object));
        const featureActivities = new Set(feature.actions.map(a => a.activity));
        for (const id of bound) if (!featureActivities.has(id)) error(`${fl}/workflow/view`, 'Workflow binds an activity outside this Feature.', { id });
        for (const [ai, action] of feature.actions.entries()) {
          const al = `${fl}/actions/${ai}`; anchor(action.id, `${al}/id`);
          const activity = get(action.activity, ['activity'], `${al}/activity`);
          if (!activity) continue;
          if (owners[activity.id] !== service.id) error(`${al}/activity`, 'Activity is not owned by the Feature Service.', { id: activity.id });
          if (action.performer === 'user' && activity.detail.actorKind !== 'human' || action.performer === 'system' && activity.detail.actorKind !== 'system') error(`${al}/performer`, 'Performer classification conflicts with the modeled actor kind.', { id: activity.id });
          if (!bound.has(activity.id)) error(`${fl}/workflow/view`, 'Workflow does not bind a Feature activity.', { id: activity.id });
          coverage.activities.add(activity.id);
          reviewed(action.summary, [activity.id], `${al}/summary`, service.id);
          const actionContext = new Set([service.id, activity.id, ...refs(activity, 'evidence'), ...refs(activity, 'decision')]);
          for (const id of actionContext) coverage.relevant.add(id);
          const groups = (list, gl, page) => {
            // Traverse the current action/page only. A sibling page or another
            // activity cannot be used to disguise misplaced requirements.
            const reachable = new Set(), fields = new Set(), displayedFields = new Set();
            const placeholder = Boolean(page && !page.variant && refs(activity, 'variant').some(id => objects.get(id)?.parent === page.interface));
            const queue = page ? [page.interface, ...(page.variant ? [page.variant] : [])] : [activity.id];
            for (let i = 0; i < queue.length; i++) {
              const id = queue[i], o = objects.get(id); if (!o || reachable.has(id)) continue;
              reachable.add(id); coverage.relevant.add(id);
              for (const r of o.refs || []) if (['action', 'integration', 'field', 'entity', 'state', 'from', 'to', 'evidence', 'decision', 'acceptance'].includes(r.relation)) {
                queue.push(r.target);
                if (r.relation === 'field') { fields.add(r.target); if (['binding', 'element'].includes(o.type)) displayedFields.add(r.target); }
              }
              if (!(placeholder && id === page.interface)) for (const child of children.get(id) || []) if ((child.type !== 'variant' || child.id === page?.variant) && (!refs(child, 'variant').length || refs(child, 'variant').every(v => v === page?.variant)) && (child.type !== 'section' || activeSection(child, page?.variant))) queue.push(child.id);
            }
            for (const [gi, group] of list.entries()) {
              const pos = `${gl}/${gi}`; anchor(group.id, `${pos}/id`);
              const context = new Set([...actionContext, ...reachable]);
              if (placeholder) context.delete(page.interface);
              const validSources = new Set();
              for (const [i, id] of group.sources.entries()) {
                const o = get(id, [...groupSourceTypes], `${pos}/sources/${i}`);
                if (!o || !local(id, `${pos}/sources/${i}`)) continue;
                if (o.type === 'rule') {
                  if (!o.rule?.scope.some(x => context.has(x))) { error(`${pos}/sources/${i}`, 'Rule does not apply to this action or page.', { id }); continue; }
                } else if (!(reachable.has(id) || ['evidence', 'decision'].includes(o.type) && actionContext.has(id)) || o.type === 'field' && !fields.has(id)) {
                  error(`${pos}/sources/${i}`, 'Requirement is not connected to this action or page.', { id }); continue;
                }
                validSources.add(id);
              }
              reviewed(group.summary, group.sources, `${pos}/summary`, service.id);
              questions(group.questions, `${pos}/questions`, service.id, new Set([...context, ...validSources]));
              for (const id of group.questions || []) coverage.questions.add(id);
            }
            return { reachable, displayedFields, placeholder };
          };
          const actionReach = groups(action.groups, `${al}/groups`, null);
          const actionSources = action.groups.flatMap(g => g.sources);
          const checkContext = (reach, sources, context, loc) => {
            const covered = new Set(sources);
            for (const id of reach.reachable) {
              const o = objects.get(id);
              if (o && requirementTypes.has(o.type) && o.type !== 'rule' && selected.has(id) && (o.type !== 'field' || reach.displayedFields.has(id)) && !covered.has(id)) error(loc, 'Context requirement is not covered by a semantic group.', { id });
            }
            for (const o of model.objects) if (o.type === 'rule' && selected.has(o.id) && (!owners[o.id] || owners[o.id] === service.id) && o.rule?.scope.some(id => context.has(id))) {
              coverage.relevant.add(o.id);
              if (!covered.has(o.id)) error(loc, 'Context rule is not covered by a semantic group.', { id: o.id });
            }
          };
          questions(action.questions, `${al}/questions`, service.id, actionContext);
          for (const id of action.questions || []) coverage.questions.add(id);
          for (const [pi, page] of action.pages.entries()) {
            const pl = `${al}/pages/${pi}`; anchor(page.id, `${pl}/id`);
            const p = get(page.interface, ['interface'], `${pl}/interface`);
            if (p && (!local(p.id, `${pl}/interface`) || !refs(activity, 'uses').includes(p.id))) error(`${pl}/interface`, 'Page is not used by this activity.', { id: p.id });
            if (page.variant) { const v = get(page.variant, ['variant'], `${pl}/variant`); if (v && (v.parent !== page.interface || !refs(activity, 'variant').includes(v.id))) error(`${pl}/variant`, 'Variant is not used by this activity and page.', { id: v.id }); }
            const pageReach = groups(page.groups, `${pl}/groups`, page);
            const pageContext = new Set([...actionContext, ...pageReach.reachable]);
            if (pageReach.placeholder) pageContext.delete(page.interface);
            if (!pageReach.placeholder) checkContext(pageReach, [...actionSources, ...page.groups.flatMap(g => g.sources)], pageContext, `${pl}/groups`);
            questions(page.questions, `${pl}/questions`, service.id, pageContext);
            for (const id of page.questions || []) coverage.questions.add(id);
          }
          const ownPageSources = action.pages.flatMap(p => p.groups.flatMap(g => g.sources));
          checkContext(actionReach, [...actionSources, ...ownPageSources], new Set([...actionContext, ...actionReach.reachable]), `${al}/groups`);
        }
      }
    }
  }
  // Validate Service-wide union, not each Feature separately: several Features
  // may share a Service. An unmodeled catalog entry is never deemed detailed.
  for (const [service, coverage] of byService) {
    if (!coverage.detailed) continue;
    const { selected } = productServiceSelection(model, service);
    const allActions = plan.modules.flatMap(m => m.subModules.flatMap(s => s.features.filter(f => f.service === service && f.status === 'detailed').flatMap(f => f.actions)));
    for (const o of model.objects) {
      if (!selected.has(o.id) || owners[o.id] && owners[o.id] !== service) continue;
      if (o.type === 'activity' && owners[o.id] === service) {
        if (!coverage.activities.has(o.id)) error(coverage.loc, 'Selected activity is not represented by a Feature action.', { id: o.id });
        const pages = allActions.filter(a => a.activity === o.id).flatMap(a => a.pages);
        for (const id of refs(o, 'uses')) if (!pages.some(p => p.interface === id)) error(coverage.loc, 'Activity interface is not covered.', { id, activity: o.id });
        for (const id of refs(o, 'variant')) if (!pages.some(p => p.variant === id && p.interface === objects.get(id)?.parent)) error(coverage.loc, 'Activity variant is not covered.', { id, activity: o.id });
      }
      if (o.type === 'question') {
        const scope = o.detail.scope || [], targets = refs(o, 'target');
        const common = scope.length && targets.length ? scope.filter(x => targets.includes(x)) : scope.length ? scope : targets;
        if (common.some(id => coverage.relevant.has(id) && (!owners[id] || owners[id] === service) && !['project', 'source'].includes(objects.get(id)?.type)) && !coverage.questions.has(o.id)) error(coverage.loc, 'Selected question is not placed in the Feature plan.', { id: o.id });
      }
    }
  }
  // Standard validation selects by typed Service; retain the located v2
  // diagnostic rather than throwing on a malformed Feature reference.
  if (plan.standard && plan.modules.every(m=>m.subModules.every(s=>s.features.every(f=>objects.get(f.service)?.type==='service')))) errors.push(...validateStandardDocumentV1(model, {reviewFacts}));
  return errors;
}
