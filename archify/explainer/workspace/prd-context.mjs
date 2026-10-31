// Read-only context projection for a validated P1 model. This does not create
// page ownership from co-occurrence: activity-owned bindings without an
// explicit variant stay at activity scope.
export function activityContext(model, activityId) {
  const objects = new Map(model.objects.map(object => [object.id, object]));
  const activity = objects.get(activityId);
  if (!activity || activity.type !== 'activity') throw new Error('Expected a validated activity ID.');
  const refs = (object, relation) => (object.refs || []).filter(ref => ref.relation === relation).map(ref => ref.target);
  const interfaces = refs(activity, 'uses');
  const variants = refs(activity, 'variant');
  const gaps = [];
  const interfaceOf = id => {
    const seen = new Set();
    let object = objects.get(id);
    while (object && !seen.has(object.id)) {
      if (object.type === 'interface') return object.id;
      seen.add(object.id);
      object = objects.get(object.parent);
    }
    return null;
  };
  for (const variant of variants) {
    const owner = interfaceOf(variant);
    if (!interfaces.includes(owner)) gaps.push({ object: activityId, target: variant, kind: 'variant-interface-not-used' });
  }
  const bindings = [];
  for (const binding of model.objects.filter(object => object.type === 'binding')) {
    const parent = objects.get(binding.parent);
    const bindingVariants = refs(binding, 'variant');
    const field = refs(binding, 'field')[0];
    if (parent?.id === activityId) {
      // A binding with multiple variant targets is intentionally not assigned
      // to any page; v1 does not express whether those targets are alternatives.
      const variant = bindingVariants.length === 1 ? bindingVariants[0] : null;
      const owner = variant && interfaceOf(variant);
      if (variant && variants.includes(variant) && interfaces.includes(owner)) {
        bindings.push({ binding: binding.id, field, scope: 'activity-variant', activity: activityId, interface: owner, variant });
      } else {
        bindings.push({ binding: binding.id, field, scope: 'activity', activity: activityId });
        gaps.push({ object: binding.id, kind: 'binding-interface-unmapped' });
      }
      continue;
    }
    const owner = interfaceOf(binding.id);
    if (!owner || !interfaces.includes(owner)) continue;
    // Variant-owned bindings and explicit variant references are applicable
    // only when the activity itself names that variant.
    const requiredVariants = [...new Set(parent?.type === 'variant' ? [parent.id, ...bindingVariants] : bindingVariants)];
    if (requiredVariants.some(id => interfaceOf(id) !== owner) || requiredVariants.length > 1) {
      bindings.push({ binding: binding.id, field, scope: parent.type, parent: parent.id, interface: owner, ambiguous: true });
      gaps.push({ object: binding.id, kind: 'binding-variant-ambiguous' });
      continue;
    }
    if (requiredVariants.some(id => !variants.includes(id))) continue;
    bindings.push({ binding: binding.id, field, scope: parent.type, interface: owner, ...(requiredVariants.length ? { variant: requiredVariants[0] } : {}) });
  }
  return { activity: activityId, interfaces, variants, bindings, gaps };
}
