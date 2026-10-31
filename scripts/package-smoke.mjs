#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { assertThirdPartyNotices } from './third-party-notices-contract.mjs';
import { verifyPackagedUpdateChecker } from './package-update-smoke.mjs';
import { frozenReadme, verifyPrdDirectoryExports } from './prd-package-smoke.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const noticeComparisonRoot = path.resolve(
  process.env.ARCHIFY_PACKAGE_SMOKE_NOTICE_ROOT || repoRoot,
);
const defaultPackageRoot = process.env.RUNNER_TEMP
  ? path.join(process.env.RUNNER_TEMP, 'archify-package', 'archify')
  : path.join(repoRoot, 'archify');
const skillRoot = path.resolve(process.argv[2] || defaultPackageRoot);
const cli = path.join(skillRoot, 'bin', 'archify.mjs');
const updateChecker = path.join(skillRoot, 'scripts', 'check-update.mjs');
const updateContract = path.join(skillRoot, 'scripts', 'update-contract.mjs');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-package-smoke-'));

function requireAbsent(relative) {
  if (fs.existsSync(path.join(skillRoot, relative))) {
    throw new Error(`packaged skill must not contain ${relative}`);
  }
}

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: skillRoot,
    encoding: 'utf8',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error([
      `archify ${args.join(' ')} failed with ${result.status}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  return result.stdout;
}

function runExpectFailure(args, options = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: skillRoot,
    encoding: 'utf8',
    ...options,
  });
  if (result.status === 0) throw new Error(`archify ${args.join(' ')} unexpectedly passed`);
  return result.stdout;
}

async function verifyPackagedExplainer() {
  // Exercise the installed parser, preparation, native diagram runtime, reader
  // assets, document checker and patcher through public CLI calls outside cwd.
  const explainerInput = path.join(scratch, 'package-explainer.md');
  const explainerOutput = path.join(scratch, 'package-explainer.html');
  const explainerText = '# How does the request move? {#package-explainer}\n\nThe API sends the request to Redis.\n\n'
    + '## What is the route? {#route}\n\nRead the [API](node:request.api) before following the request.\n\n'
    + '@sequence id=request\n| actor api | API | backend |\n| actor redis | Redis | database |\n| api | redis | GET key |\n\n'
    + '## What can change? {#notes}\n\nThis panel can be revised independently.\n';
  fs.writeFileSync(explainerInput, explainerText);
  const explainerOptions = { cwd: scratch, env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' } };
  const validateExplainer = JSON.parse(run(['validate', 'explainer', explainerInput, '--json'], explainerOptions));
  if (!validateExplainer.ok || validateExplainer.type !== 'explainer' || !validateExplainer.candidate?.sha256) {
    throw new Error('packaged explainer did not validate the authored parser input');
  }
  const deliveredExplainer = JSON.parse(run(['deliver', 'explainer', explainerInput, explainerOutput, '--json'], explainerOptions));
  const checkedExplainer = JSON.parse(run(['check', explainerOutput, '--require-provenance', '--json'], explainerOptions));
  if (!deliveredExplainer.ok || !checkedExplainer.ok || checkedExplainer.deliveryReceiptId !== deliveredExplainer.receiptId) {
    throw new Error('packaged explainer delivery did not bind its strict checker receipt');
  }
  const { scanHtml } = await import(pathToFileURL(path.join(skillRoot, 'explainer/check.mjs')).href);
  const preparedExplainer = file => {
    const payload = scanHtml(fs.readFileSync(file, 'utf8')).scripts.find(script => script.attrs.id === 'archify-explainer-prepared');
    return JSON.parse(payload?.text || 'null');
  };
  const originalExplainer = preparedExplainer(explainerOutput);
  const requestDiagram = originalExplainer?.preparedDiagrams?.diagrams?.request;
  if (originalExplainer?.sourceText !== explainerText || requestDiagram?.checks?.check?.ok !== true
      || !requestDiagram.semantic.nodes.some(node => node.id === 'api')
      || !requestDiagram.semantic.nodes.some(node => node.id === 'redis')
      || !requestDiagram.semantic.edges.some(edge => edge.from === 'api' && edge.to === 'redis')) {
    throw new Error('packaged explainer lost authored text or native semantic graph evidence');
  }
  const replacementPanel = path.join(scratch, 'package-replacement.md');
  const patchedExplainerOutput = path.join(scratch, 'package-explainer-patched.html');
  fs.writeFileSync(replacementPanel, '## What can change? {#notes}\n\nThe selected panel has updated content.\n');
  const patchedExplainer = JSON.parse(run(['patch', 'explainer', explainerOutput, 'notes', replacementPanel, patchedExplainerOutput, '--json'], explainerOptions));
  const patchedPrepared = preparedExplainer(patchedExplainerOutput);
  if (!patchedExplainer.ok || patchedExplainer.command !== 'patch'
      || patchedPrepared.document.panels[1].blocks[0].text !== 'The selected panel has updated content.'
      || JSON.stringify(patchedPrepared.document.panels[0]) !== JSON.stringify(originalExplainer.document.panels[0])
      || patchedPrepared.preparedDiagrams.diagrams.request.sha256 !== requestDiagram.sha256) {
    throw new Error('packaged explainer patch changed an untouched native diagram or failed to replace its panel');
  }
  run(['check', patchedExplainerOutput, '--require-provenance', '--json'], explainerOptions);
  const browserUnavailable = JSON.parse(runExpectFailure(['browser-check', explainerOutput, '--require-provenance', '--json'], {
    ...explainerOptions, env: { ...explainerOptions.env, ARCHIFY_CHROME: path.join(scratch, 'missing-explainer-chrome') },
  }));
  if (browserUnavailable.status !== 'skipped' || browserUnavailable.chrome?.status !== 'unavailable') {
    throw new Error('packaged explainer browser runtime did not report the explicit unavailable browser');
  }
  process.stdout.write('packaged explainer parser, native graph, delivery, strict check and panel patch passed without dependencies\n');

}

function verifyPackagedPrd(){
  const options={cwd:scratch,env:{...process.env,NODE_PATH:'',ARCHIFY_UPDATE_CHECK_DISABLED:'1'}},fixture=path.join(repoRoot,'test/fixtures/prd-workspace-reader'),dir=path.join(scratch,'prd');fs.mkdirSync(dir);
  const write=(name,value)=>{const target=path.join(dir,name);fs.writeFileSync(target,JSON.stringify(value));return target;},call=(...args)=>JSON.parse(run(['prd',...args,'--json'],options)),reject=(...args)=>JSON.parse(runExpectFailure(['prd',...args,'--json'],options));
  const reader=JSON.parse(fs.readFileSync(path.join(fixture,'reader.json')));reader.workspaceId='1fd09445-b9d9-4884-ac67-cc8e607708d9';for(const name of ['event-plan.txt','prototype.png'])fs.copyFileSync(path.join(fixture,name),path.join(dir,name));
  const input=write('reader.json',reader),invalid=structuredClone(reader);invalid.objects[0].unknownPrivateField=true;const bad=write('invalid.json',invalid),badResult=reject('validate',bad);if(badResult.ok||!badResult.diagnostics?.some(d=>d.code==='prd/schema'))throw Error('Packaged PRD must reject unknown model fields with structured schema diagnostics.');
  const compiled=call('compile',input,'-o',path.join(dir,'native-manifest.json'));call('build',input,'-o',path.join(dir,'native-reader.html'));const manifest=JSON.parse(fs.readFileSync(path.join(dir,'native-manifest.json')));if(!compiled.ok||!manifest.nativeViews.length||!fs.readFileSync(path.join(dir,'native-reader.html'),'utf8').includes('id="reader-data"'))throw Error('Packaged PRD native preparation or reader failed.');
  for(const name of ['generated-prd-validators.mjs','generated-prd-feedback-browser.js','prd-feedback-schema.mjs','prd-proposal-schema.mjs']){const actual=createHash('sha256').update(fs.readFileSync(path.join(skillRoot,'explainer/workspace',name))).digest('hex');if(manifest.identities.code[name]!==actual)throw Error('Packaged PRD validator identity mismatch: '+name);}
  const garden=JSON.parse(fs.readFileSync(path.join(repoRoot,'test/fixtures/prd-workspace/garden.json')));garden.workspaceId=reader.workspaceId;const model=write('garden.json',garden),policy=write('policy.json',{version:1,components:{catalogSection:'Seed catalog',notes:'Notes'},objects:{name:{id:'packetName',title:'Packet name',purpose:'Identify a packet',fields:['detail.dataType']}},omitted:{garden:'Broader scope under review.',catalog:'Boundary under review.',extra:'Note under review.'}}),base=path.join(dir,'base.json');
  const validation=call('validate',model);call('compile',model,'-o',base);call('build',model,'-o',path.join(dir,'internal.html'));call('build',model,'-o',path.join(dir,'client.html'),'--audience','client','--disclosure',policy);
  const readerData=name=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8').match(/<script type="application\/json" id="reader-data">([\s\S]*?)<\/script>/)?.[1]||'null');
  const internal=readerData('internal.html'),data=readerData('client.html');if(!data?.snapshot||data.revision!==validation.revision||internal?.revision!==validation.revision)throw Error('Packaged PRD reader snapshot identity missing.');
  const publicMd=frozenReadme(data),internalMd=frozenReadme(internal);if(!publicMd.includes('Packet name')||!internalMd.includes('Packet name')||publicMd.includes('ignore all previous instructions'))throw Error('Packaged PRD frozen Markdown projection failed.');
  verifyPrdDirectoryExports({platform:process.platform,dir,model,policy,call,reject,internalMd,publicMd});
  const comment={id:'packageComment',objectId:'packetName',baseRevision:validation.revision,quoteSnapshot:{path:'/title',text:'Packet name'},author:'Synthetic reviewer',time:'2026-01-01T00:00:00Z',body:'Review the title as inert text.',state:'open'},pkg={kind:'archify-prd-public-feedback',schemaVersion:1,workspaceId:garden.workspaceId,revision:validation.revision,disclosure:data.disclosure,snapshot:data.snapshot,exporter:data.exporter,comments:[comment]},publicFile=write('public-feedback.json',pkg),mapped=path.join(dir,'mapped.json');
  const malformed=structuredClone(pkg);malformed.comments[0].sourceAnchor={sourceId:'note',locator:'row 1',quote:'text',sourceHash:'0'.repeat(64)};if(reject('feedback','validate',write('bad-feedback.json',malformed)).ok)throw Error('Packaged public feedback admitted private provenance.');
  call('feedback','map-public',publicFile,'--model',model,'--disclosure',policy,'--expect-revision',validation.revision,'--expect-snapshot',data.snapshot,'-o',mapped);const mappedComment=JSON.parse(fs.readFileSync(mapped)).comments[0];if(mappedComment.objectId!=='name'||mappedComment.publicOrigin?.objectId!=='packetName'||mappedComment.publicOrigin.snapshot!==data.snapshot)throw Error('Packaged feedback lost its projection origin.');
  const store=path.join(dir,'store.json'),imported=call('feedback','import',mapped,'--model',model,'-o',store),inspection=call('feedback','inspect',store,'--model',model);if(inspection.comments[0]?.review!=='current')throw Error('Packaged feedback exact quote is not current.');
  const request={kind:'archify-prd-change-request',schemaVersion:1,workspaceId:garden.workspaceId,proposalId:'packageProposal',baseRevision:validation.revision,storeRevision:imported.revision,objectId:'name',operation:'replace',path:'/title',oldValue:'Packet name',oldHash:createHash('sha256').update(JSON.stringify('Packet name')).digest('hex'),newValue:'Seed packet name',commentIds:['packageComment']},requestFile=write('request.json',request),proposal=path.join(dir,'proposal.json'),updated=path.join(dir,'updated.json');const malformedRequest=structuredClone(request);malformedRequest.commentIds.push('packageComment');if(reject('feedback','propose',write('bad-request.json',malformedRequest),'--model',model,'--store',store,'--expect-store',imported.revision,'-o',path.join(dir,'bad-proposal.json')).ok)throw Error('Packaged proposal admitted duplicate comments.');
  call('feedback','propose',requestFile,'--model',model,'--store',store,'--expect-store',imported.revision,'-o',proposal);const applied=call('feedback','apply',proposal,'--model',model,'--store',store,'--expect-store',imported.revision,'-o',updated);const after=call('compile',updated,'--base-manifest',base,'--expect-revision',validation.revision,'-o',path.join(dir,'updated-manifest.json'));if(!after.ok||after.revision!==applied.revision)throw Error('Packaged PRD proposal/base compile failed.');
  process.stdout.write(`packaged PRD native reader, strict validation, frozen Markdown projections, ${process.platform==='linux'?'directory exports':'fail-closed directory export'} and mapped feedback/proposal passed without dependencies\n`);
}

function verifyPackagedStory(){
  const input=path.join(skillRoot,'examples/workflow-agent-tool-call-rendered.html'),brief=path.join(scratch,'story-brief.json'),output=path.join(scratch,'story-enhanced.html');
  const options={cwd:scratch,env:{...process.env,NODE_PATH:'',ARCHIFY_UPDATE_CHECK_DISABLED:'1'}};
  const draft=JSON.parse(run(['story','draft',input,brief,'--json'],options));
  if(!draft.ok)throw Error('packaged story draft failed');
  const facts=JSON.parse(fs.readFileSync(draft.sourceMap,'utf8')),edge=facts.edges[0];
  fs.writeFileSync(brief,JSON.stringify({version:2,title:'Read the tool handoff',intro:'Establish its context.',outro:'Return to the original graph.',scenes:[{title:'Read the relationship',points:[{anchor:edge.to,via:edge.id,title:'Follow this handoff',text:'Explain the selected connection with its source endpoints.'}]}]}));
  const receipt=JSON.parse(run(['story','attach',input,brief,output,'--json'],options));
  if(!receipt.ok)throw Error('packaged story attachment failed');
  const html=fs.readFileSync(output,'utf8'),start=html.indexOf('<style id="archify-story-attachment-style">');
  if(start<0||html.slice(0,start)+html.slice(html.lastIndexOf('</body>'))!==fs.readFileSync(input,'utf8'))throw Error('packaged story changed the native HTML');
  process.stdout.write('packaged story scan, draft and attachment passed without dependencies\n');
}

async function verifyPackage() {
  if (!fs.existsSync(cli)) throw new Error(`packaged CLI not found at ${cli}`);
  requireAbsent('node_modules');
  requireAbsent('package-lock.json');
  requireAbsent(path.join('scripts', 'generate-validators.mjs'));
  requireAbsent(path.join('scripts', 'generate-brand-marks.mjs'));
  requireAbsent('test');
  requireAbsent('.hive');
  requireAbsent('.workbuddy');

  if (process.argv.includes('--prd-only')) {
    verifyPackagedPrd();
    process.stdout.write(`PRD package smoke passed on ${process.platform} (${skillRoot})\n`);
    return;
  }
  if (process.argv.includes('--explainer-only')) {
    await verifyPackagedExplainer();
    process.stdout.write(`explainer package smoke passed on ${process.platform} (${skillRoot})\n`);
    return;
  }
  const packageLicensePath = path.join(skillRoot, 'LICENSE');
  if (!fs.existsSync(packageLicensePath)) {
    throw new Error('packaged skill is missing LICENSE');
  }
  const packageLicense = fs.readFileSync(packageLicensePath, 'utf8');
  const repositoryLicense = fs.readFileSync(path.join(repoRoot, 'LICENSE'), 'utf8');
  if (packageLicense !== repositoryLicense) {
    throw new Error('packaged LICENSE must byte-match the repository LICENSE');
  }
  for (const name of ['LICENSE-MIT', 'NOTICE']) {
    const target = path.join(skillRoot, name);
    if (!fs.existsSync(target)) throw new Error(`packaged skill is missing ${name}`);
    if (!fs.readFileSync(target).equals(fs.readFileSync(path.join(repoRoot, name)))) {
      throw new Error(`packaged ${name} must byte-match the repository ${name}`);
    }
  }
  const legacyLicense = fs.readFileSync(path.join(skillRoot, 'LICENSE-MIT'), 'utf8');
  if (!legacyLicense.split(/\r?\n/).includes('Copyright (c) 2025 Cocoon AI') ||
      !legacyLicense.includes('The above copyright notice and this permission notice shall be included in all')) {
    throw new Error('packaged LICENSE-MIT is missing the original MIT copyright and permission notice');
  }

  const packageNoticesPath = path.join(skillRoot, 'THIRD_PARTY_NOTICES.md');
  if (!fs.existsSync(packageNoticesPath)) {
    throw new Error('packaged skill is missing THIRD_PARTY_NOTICES.md');
  }
  const packageNotices = fs.readFileSync(packageNoticesPath, 'utf8');
  const repositoryNotices = fs.readFileSync(path.join(noticeComparisonRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  const embeddedFonts = /data:font\/woff2/.test(fs.readFileSync(path.join(skillRoot, 'assets/template.html'), 'utf8'));
  if (embeddedFonts && !fs.existsSync(path.join(skillRoot, 'assets/JetBrainsMono-OFL.txt'))) {
    throw new Error('embedded viewer font requires assets/JetBrainsMono-OFL.txt');
  }
  assertThirdPartyNotices(repositoryNotices, 'repository THIRD_PARTY_NOTICES.md', { embeddedFonts });
  assertThirdPartyNotices(packageNotices, 'packaged THIRD_PARTY_NOTICES.md', { embeddedFonts });
  if (packageNotices !== repositoryNotices) {
    throw new Error('packaged THIRD_PARTY_NOTICES.md must byte-match the repository notice');
  }

  if (!fs.existsSync(updateChecker)) {
    throw new Error(`packaged update checker not found at ${updateChecker}`);
  }
  if (!fs.existsSync(updateContract)) {
    throw new Error(`packaged update contract not found at ${updateContract}`);
  }

  const packageJson = JSON.parse(fs.readFileSync(path.join(skillRoot, 'package.json'), 'utf8'));
  const dependencyFields = [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
    'bundledDependencies',
    'bundleDependencies',
  ];
  const declaredDependencyField = dependencyFields.find((field) => (
    Object.prototype.hasOwnProperty.call(packageJson, field)
  ));
  if (declaredDependencyField) {
    throw new Error(`packaged skill must not declare dependency metadata: ${declaredDependencyField}`);
  }

  const skillRelease = JSON.parse(fs.readFileSync(path.join(skillRoot, 'skill-release.json'), 'utf8'));
  const contract = await import(pathToFileURL(updateContract).href);
  let validatedRelease;
  try {
    validatedRelease = contract.validateLocalRelease(skillRelease);
  } catch {
    throw new Error('packaged skill-release.json violates the shared update contract');
  }
  if (validatedRelease.version !== packageJson.version) {
    throw new Error('packaged skill-release.json does not match the package release identity');
  }

  await verifyPackagedUpdateChecker(skillRoot, path.join(scratch, 'update-cache'));

  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  const skillReferences = [...skill.matchAll(
    /`((?:assets|bin|examples|explainer|recipes|references|renderers|schemas|scripts)\/[^`\s]+)`/g,
  )]
    .map((match) => match[1])
    .filter((reference) => !/[<>{}*\[\]]/.test(reference));
  if (skillReferences.length === 0) {
    throw new Error('packaged SKILL.md did not expose any literal package paths');
  }
  for (const reference of new Set(skillReferences)) {
    if (!fs.existsSync(path.join(skillRoot, reference))) {
      throw new Error(`packaged SKILL.md references missing path ${reference}`);
    }
  }

  run(['--help']);
  run(['doctor']);
  const brands = JSON.parse(run(['brands', 'openai', '--json']));
  if (!brands.marks.some((mark) => mark.id === 'openai')) {
    throw new Error('packaged brand catalogue did not resolve openai');
  }
  const capturedPreset = JSON.parse(run(['brands', 'capture', 'https://github.com/', '--json']));
  if (capturedPreset.brand !== 'github' || capturedPreset.evidence.status !== 'preset') {
    throw new Error('packaged brand capture did not resolve a known domain without network capture');
  }
  run(['demo', path.join(scratch, 'demo')]);
  run(['examples']);

  const fixtures = [
    ['architecture', 'production-deployment.architecture.json'],
    ['workflow', 'agent-tool-call.workflow.json'],
    ['sequence', 'cache-miss-request.sequence.json'],
    ['dataflow', 'product-analytics.dataflow.json'],
    ['lifecycle', 'agent-run.lifecycle.json'],
  ];
  for (const [mode, fixture] of fixtures) {
    const receipt = JSON.parse(run([
      'validate', mode, path.join(skillRoot, 'examples', fixture), '--json',
    ]));
    if (!receipt.ok || receipt.type !== mode) {
      throw new Error(`${mode} package validation returned an invalid receipt`);
    }
    if (mode === 'architecture' && receipt.engineeringProfile !== 'deployment-ownership') {
      throw new Error('deployment package validation omitted the engineering profile receipt');
    }
  }

  await verifyPackagedExplainer();

  verifyPackagedPrd();
  verifyPackagedStory();

  const workflowLayout = JSON.parse(run([
    'validate', 'workflow', path.join(skillRoot, 'examples', fixtures[1][1]),
    '--layout-json', '--quality', 'showcase',
  ]));
  if (workflowLayout.contract !== 'readable-v2'
    || workflowLayout.columns?.length !== 6
    || workflowLayout.diagnostics?.length !== 0) {
    throw new Error('packaged workflow compiler did not expose a passing readable-v2 layout receipt');
  }

  const legacyWorkflow = {
    schema_version: 1,
    diagram_type: 'workflow',
    meta: {
      title: 'Package migration smoke',
      output: 'package-migration-smoke.html',
      viewBox: [720, 400],
      legend: { mode: 'hidden' },
    },
    lanes: [{ id: 'main', label: 'Main' }],
    nodes: [
      { id: 'source', lane: 'main', col: 0, type: 'frontend', label: 'Source' },
      { id: 'target', lane: 'main', col: 2, type: 'backend', label: 'Target' },
    ],
    edges: [{ id: 'flow', from: 'source', to: 'target', label: 'request' }],
  };
  const legacyWorkflowPath = path.join(scratch, 'legacy.workflow.json');
  const migratedWorkflowPath = path.join(scratch, 'migrated.workflow.json');
  const migratedAgainPath = path.join(scratch, 'migrated-again.workflow.json');
  fs.writeFileSync(legacyWorkflowPath, `${JSON.stringify(legacyWorkflow, null, 2)}\n`);
  const migrationReceipt = JSON.parse(run([
    'migrate', 'workflow', legacyWorkflowPath, migratedWorkflowPath,
    '--to-schema', '2', '--json',
  ]));
  if (!migrationReceipt.ok || migrationReceipt.fromSchemaVersion !== 1
    || migrationReceipt.toSchemaVersion !== 2 || !fs.existsSync(migratedWorkflowPath)) {
    throw new Error('packaged workflow migrator did not produce a schema-v2 destination');
  }
  const idempotenceReceipt = JSON.parse(run([
    'migrate', 'workflow', migratedWorkflowPath, migratedAgainPath,
    '--to-schema', '2', '--json',
  ]));
  if (!idempotenceReceipt.ok || idempotenceReceipt.fromSchemaVersion !== 2
    || idempotenceReceipt.source?.sha256 !== idempotenceReceipt.destination?.sha256
    || !fs.readFileSync(migratedWorkflowPath).equals(fs.readFileSync(migratedAgainPath))) {
    throw new Error('packaged workflow migrator did not preserve byte-identical v2 idempotence');
  }

  const deployment = path.join(scratch, 'deployment.html');
  run(['render', 'architecture', path.join(skillRoot, 'examples', fixtures[0][1]), deployment]);
  run(['check', deployment]);

  // Bundled Viewer catalogs resolve from the installed package, not the cwd,
  // and the artifact embeds only the selected catalog.
  const manifest = JSON.parse(fs.readFileSync(path.join(skillRoot, 'locales', 'manifest.json'), 'utf8'));
  for (const { file } of manifest.catalogs) {
    if (!fs.existsSync(path.join(skillRoot, 'locales', file))) {
      throw new Error(`packaged locale manifest lists a missing catalog: ${file}`);
    }
  }
  const localized = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', fixtures[0][1]), 'utf8'));
  localized.meta.locale = 'ko';
  localized.meta.output = 'localized.html';
  const localizedInput = path.join(scratch, 'localized.architecture.json');
  const localizedOutput = path.join(scratch, 'localized.html');
  fs.writeFileSync(localizedInput, JSON.stringify(localized));
  run(['render', 'architecture', localizedInput, localizedOutput], { cwd: os.tmpdir() });
  const localizedHtml = fs.readFileSync(localizedOutput, 'utf8');
  const embeddedLocale = localizedHtml.match(/<script id="archify-i18n-data" type="application\/json">([\s\S]*?)<\/script>/);
  if (!localizedHtml.startsWith('<!DOCTYPE html>\n<html lang="ko"')
    || !localizedHtml.includes('>범례</text>')
    || JSON.parse(embeddedLocale?.[1] || '{}').locale !== 'ko') {
    throw new Error('packaged renderer did not select the bundled ko catalog from meta.locale');
  }

  const compareReceipt = JSON.parse(run([
    'compare', 'architecture',
    path.join(skillRoot, 'examples', 'checkout-platform.base.architecture.json'),
    path.join(skillRoot, 'examples', 'checkout-platform.head.architecture.json'),
    path.join(scratch, 'architecture-delta.html'), '--json',
  ]));
  if (!compareReceipt.ok || compareReceipt.completeness !== 'complete'
    || compareReceipt.validation?.checksPassed !== compareReceipt.validation?.checkCount) {
    throw new Error('packaged Architecture compare did not return a complete passing receipt');
  }

  const delivered = JSON.parse(run([
    'deliver', 'workflow', path.join(skillRoot, 'examples', fixtures[1][1]),
    path.join(scratch, 'workflow-delivered.html'), '--quality', 'showcase', '--json',
  ]));
  if (!delivered.ok || delivered.validation?.compositionStatus !== 'pass'
    || !/^[a-f0-9]{64}$/.test(delivered.specification?.sha256 || '')
    || !(delivered.specification?.bytes > 0)) {
    throw new Error('packaged workflow delivery did not return a passing receipt');
  }

  const visualSkipped = JSON.parse(runExpectFailure([
    'visual-check', delivered.output, '--json',
  ], {
    env: { ...process.env, ARCHIFY_CHROME: path.join(scratch, 'missing-chrome') },
  }));
  if (visualSkipped.status !== 'skipped' || visualSkipped.visualReview !== 'pending'
    || visualSkipped.chrome?.status !== 'unavailable') {
    throw new Error('packaged visual-check did not return the expected Chrome-unavailable receipt');
  }

  const emptyPath = path.join(scratch, 'empty-path');
  fs.mkdirSync(emptyPath);
  const openReceipt = JSON.parse(run([
    'deliver', 'workflow', path.join(skillRoot, 'examples', fixtures[1][1]),
    path.join(scratch, 'workflow-open-fallback.html'), '--open', '--json',
  ], { env: { ...process.env, PATH: emptyPath } }));
  if (!openReceipt.ok || openReceipt.open?.status !== 'unsupported') {
    throw new Error('packaged open fallback did not remain a successful unsupported handoff');
  }

  const invalidWorkflow = JSON.parse(fs.readFileSync(
    path.join(skillRoot, 'examples', fixtures[1][1]), 'utf8',
  ));
  invalidWorkflow.nodes[0].colour = 'cyan';
  const invalidPath = path.join(scratch, 'invalid-workflow.json');
  fs.writeFileSync(invalidPath, JSON.stringify(invalidWorkflow));
  const failure = JSON.parse(runExpectFailure(['validate', 'workflow', invalidPath, '--json']));
  if (failure.ok || !failure.diagnostics?.some((diagnostic) => diagnostic.code === 'schema/additionalProperties')) {
    throw new Error('packaged skill did not return the expected unknown-field diagnostic');
  }

  const tangentEndpoint = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Endpoint direction smoke', output: 'endpoint-direction-smoke.html' },
    components: [
      { id: 'source', type: 'external', label: 'Source', pos: [300, 100], size: [100, 60] },
      { id: 'target', type: 'backend', label: 'Target', pos: [100, 240], size: [100, 60] },
    ],
    connections: [{
      id: 'tangent',
      from: 'source',
      to: 'target',
      fromSide: 'bottom',
      toSide: 'top',
      via: [[350, 200], [100, 200], [100, 240]],
    }],
  };
  const tangentPath = path.join(scratch, 'tangent-endpoint.architecture.json');
  fs.writeFileSync(tangentPath, JSON.stringify(tangentEndpoint));
  const tangentFailure = JSON.parse(runExpectFailure(['validate', 'architecture', tangentPath, '--json']));
  const tangentDiagnostic = tangentFailure.diagnostics?.find((diagnostic) => (
    diagnostic.code === 'clean-flow/endpoint-side-direction'
  ));
  if (tangentFailure.ok || tangentDiagnostic?.evidence?.authoredField !== 'toSide'
    || tangentDiagnostic?.evidence?.side !== 'top') {
    throw new Error('packaged skill did not reject a tangential target-port entry with structured repair evidence');
  }

  const inferredBridge = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Inferred endpoint bridge smoke', output: 'inferred-endpoint-bridge.html' },
    components: [
      { id: 'workspace', type: 'frontend', label: 'Workspace UI', pos: [40, 300], size: [120, 60] },
      { id: 'runtime-server', type: 'backend', label: 'Runtime Server', pos: [220, 300], size: [120, 60] },
      { id: 'runtime-store', type: 'backend', label: 'Runtime Store', pos: [400, 300], size: [120, 60] },
      { id: 'stream-hub', type: 'messagebus', label: 'Terminal Stream Hub', pos: [700, 100], size: [120, 60] },
    ],
    connections: [{ id: 'terminal-return', from: 'stream-hub', to: 'workspace' }],
  };
  const inferredBridgePath = path.join(scratch, 'inferred-bridge.architecture.json');
  const inferredBridgeHtml = path.join(scratch, 'inferred-bridge.html');
  fs.writeFileSync(inferredBridgePath, JSON.stringify(inferredBridge));
  run(['render', 'architecture', inferredBridgePath, inferredBridgeHtml]);
  run(['check', inferredBridgeHtml]);
  const inferredBridgeArtifact = fs.readFileSync(inferredBridgeHtml, 'utf8');
  const bridgePoints = inferredBridgeArtifact.match(/data-edge-id="terminal-return"[^>]*data-composition-points="([^"]+)"/)?.[1]
    .split(';').map(point => point.split(',').map(Number));
  // Automatic sides and port offsets may improve; attachment and normals must hold.
  const leavesBoxNormally = ([px, py], [nx, ny], { pos: [x, y], size: [w, h] }) => (
    (px === x && py >= y && py <= y + h && nx < px && ny === py)
    || (px === x + w && py >= y && py <= y + h && nx > px && ny === py)
    || (py === y && px >= x && px <= x + w && ny < py && nx === px)
    || (py === y + h && px >= x && px <= x + w && ny > py && nx === px)
  );
  if (!bridgePoints || bridgePoints.length < 2
    || !bridgePoints.every(point => point.length === 2 && point.every(Number.isFinite))
    || !leavesBoxNormally(bridgePoints[0], bridgePoints[1], inferredBridge.components[3])
    || !leavesBoxNormally(bridgePoints.at(-1), bridgePoints.at(-2), inferredBridge.components[0])) {
    throw new Error('packaged skill did not preserve inferred endpoint normals with a side-aware bridge');
  }

  process.stdout.write(`package smoke passed on ${process.platform} (${skillRoot})\n`);
}

try {
  await verifyPackage();
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
