import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Ajv from 'ajv';
import { workspace } from '../archify/explainer/workspace/generated-prd-validators.mjs';
import { validatePrd } from '../archify/explainer/workspace/prd-model.mjs';
import { composeProjectedFeatureDocument } from '../archify/explainer/workspace/prd-feature-composer.mjs';
import { validateStandardRefinementsV1 } from '../archify/explainer/workspace/prd-standard-refinements.mjs';
import { standardReadinessV1 } from '../archify/explainer/workspace/prd-standard-v1.mjs';

const read = name => JSON.parse(fs.readFileSync(new URL(`../${name}`, import.meta.url)));
const fixture = () => read('archify/examples/prd-equipment-standard-workspace.json');
const feature = m => m.profile.productDocument.modules[0].subModules[0].features[0];
const schema = read('archify/schemas/prd-workspace.schema.json');
const ajv = new Ajv({allErrors:true,strict:false}).compile(schema);

test('standard example is a closed schema-valid research draft, not ready for acceptance', () => {
  const m = fixture(), f = feature(m), sections = f.standard.sections;
  assert.equal(ajv(m), true, JSON.stringify(ajv.errors));
  assert.equal(workspace(m), true, JSON.stringify(workspace.errors));
  assert.equal(m.profile.productDocument.standard.version, 1);
  assert.deepEqual(sections.map(s => s.section), ['Description','Preconditions','Postconditions','Role based workflow map','Prototype with UI elements & rules','Integration points','Audit & Security','Acceptance Criteria']);
  assert.equal(sections[3].statusModel.completeness, 'incomplete');
  assert.equal(sections[4].screens[1].kind, 'missing-screen');
  assert.equal(sections[4].screens[1].question, 'screenQuestion');
  assert.equal(sections[4].screens[0].fields[1].binding, 'dateInput');
  assert.match(sections[4].businessRules[0].workedExample.text, /2027-03-15/);
  assert.equal(sections[4].screens[0].buttons[0].element, 'submitButton');
  assert.deepEqual(sections[4].screens[0].fields[2], {element:'inspectionUpload',question:'uploadQuestion'});
  assert.equal(m.profile.productDocument.standard.glossary[0].term.text, 'Equipment loan');
  assert.deepEqual(sections[4].screens[0].actionMatrix[0].actions, ['submitButton']);
  assert.deepEqual(sections[4].businessRules[0].boundaries, {question:'ruleQuestion'});
  assert.equal(validatePrd(m).ok, true, JSON.stringify(validatePrd(m).diagnostics));
  assert.ok(composeProjectedFeatureDocument({objects:m.objects,plan:m.profile.productDocument}).nodes.length);
});

test('standard schema rejects malformed sections, unbound gaps, ambiguous variants and unsupported fields', () => {
  const changes = [
    m => { m.profile.productDocument.standard.version = 2; },
    m => { delete m.profile.productDocument.standard; },
    m => { delete feature(m).standard; },
    m => { const s=feature(m).standard.sections; [s[0],s[1]]=[s[1],s[0]]; },
    m => { feature(m).standard.sections[2].success = []; },
    m => { delete feature(m).standard.sections[3].statusModel.question; },
    m => { delete feature(m).standard.sections[4].screens[1].question; },
    m => { feature(m).standard.sections[4].screens[1].interface = 'requestPage'; },
    m => { feature(m).standard.sections[4].screens[0].fields[0].dataType = 'Maybe'; },
    m => { feature(m).standard.sections[4].screens[0].fields[0].required = 'Usually'; },
    m => { feature(m).standard.sections[4].screens[0].fields[0].default = 'unknown'; },
    m => { feature(m).standard.sections[4].screens[0].fields[2].binding = 'dateInput'; },
    m => { delete feature(m).standard.sections[4].screens[0].fields[2].question; },
    m => { feature(m).standard.sections[4].screens[0].actionMatrix[0].permission = 'grant'; },
    m => { feature(m).standard.sections[3].steps[0].businessRules = [{feature:'x',id:'BR-1',name:'invented'}]; },
    m => { m.profile.productDocument.standard.glossary[0].definition = 'unknown'; },
    m => { delete feature(m).standard.sections[4].businessRules[0].workedExample; },
    m => { delete feature(m).standard.sections[4].processes[0].exceptions[0].id; },
    m => { feature(m).standard.sections[7].criteria[0].unexpected = 'private'; },
    m => { feature(m).standard.sections[3].steps = []; },
  ];
  for (const mutate of changes) {
    const m=fixture(); mutate(m);
    assert.equal(ajv(m), false, mutate.toString());
    assert.equal(workspace(m), false, mutate.toString());
  }
  const m=fixture(); feature(m).standard.sections[3].steps=[]; feature(m).standard.sections[3].question='statusQuestion';
  assert.equal(workspace(m), true, JSON.stringify(workspace.errors));
});

test('upload gaps, matrix rows and qualified rule uses retain explicit modeled context', () => {
  const m=fixture(), f=feature(m), screens=f.standard.sections[4].screens;
  assert.deepEqual(validateStandardRefinementsV1(m), []);
  assert.ok(standardReadinessV1(m, 'loans').some(d=>d.subject.locator.includes('/screens/0/fields/2/question')));
  assert.equal(standardReadinessV1(m, 'other').length, 0);
  for (const [mutate, expected] of [
    [x => { feature(x).standard.sections[4].screens[0].fields[2].element='submitButton'; }, 'displayed upload'],
    [x => { feature(x).standard.sections[4].screens[0].fields[2].question='fieldQuestion'; }, 'scoped to that upload'],
    [x => { feature(x).standard.sections[4].screens[0].actionMatrix[0].role='staff'; }, 'actor of this page'],
    [x => { feature(x).standard.sections[4].screens[0].actionMatrix[0].state='checkedOutState'; x.objects.find(o=>o.id==='checkedOutState').type='field'; }, 'actual state'],
    [x => { feature(x).standard.sections[4].screens[0].actionMatrix[0].actions=['recordAction']; }, 'displayed page element'],
    [x => { feature(x).standard.sections[3].steps[0].businessRules=[{feature:'unknown',id:'BR-1'}]; }, 'does not resolve'],
  ]) { const copy=structuredClone(m); mutate(copy); assert.ok(validateStandardRefinementsV1(copy).some(e=>e.message.includes(expected)),expected); }
  // Isolate the cross-Feature reference check from the broader v2 ownership
  // validator; the second copy is not claimed to be a complete second Feature.
  const other=structuredClone(f); other.id='otherFeature'; other.standard.sections[4].businessRules=[];
  other.standard.sections[3].steps[0].businessRules=[{feature:f.id,id:'BR-1'}];
  other.standard.sections[4].screens[0].fields[1].businessRules=[{feature:f.id,id:'BR-1'}];
  for (const c of other.standard.sections[7].criteria) c.businessRules=c.businessRules.map(ref=>ref==='BR-1'?{feature:f.id,id:'BR-1'}:ref);
  m.profile.productDocument.modules[0].subModules[0].features.push(other);
  assert.equal(workspace(m), true, JSON.stringify(workspace.errors));
  assert.deepEqual(validateStandardRefinementsV1(m), []);
  other.standard.sections[4].businessRules.push(structuredClone(f.standard.sections[4].businessRules[0]));
  assert.ok(validateStandardRefinementsV1(m).some(e=>e.message.includes('more than one authored definition')));
});

test('legacy workspace and Feature contracts remain valid without opting in', () => {
  for (const name of ['test/fixtures/prd-workspace/garden.json','archify/examples/prd-equipment-workspace.json']) {
    const m=read(name);
    assert.equal(ajv(m), true, JSON.stringify(ajv.errors));
    assert.equal(workspace(m), true, JSON.stringify(workspace.errors));
    assert.equal(validatePrd(m).ok, true, JSON.stringify(validatePrd(m).diagnostics));
  }
});
