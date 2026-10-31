// Experimental P0 sibling bundle. This is not the portable workspace host.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareExplainer } from '../prepare.mjs';
import { renderExplainer } from '../render.mjs';

const filename = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]*\.html$/.test(value);
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function page(document, bundle) {
  return renderExplainer(document, { preparedBundle: bundle, sourceText: bundle.sourceText,
    preparedSources: bundle.preparedSources, preparedDiagrams: bundle.preparedDiagrams });
}

// Preserve the same safe sibling and context rules used by the native Viewer.
// `from` is only ever a sibling, not an arbitrary URL.
function navigation(html, fallback, label, useFrom = false) {
  const bar = `<nav aria-label="Bundle navigation" style="padding:12px 24px"><a id="workspace-bundle-navigation" href="${escape(fallback)}">${escape(label)}</a></nav>`;
  const script = `<script>(()=>{const link=document.getElementById('workspace-bundle-navigation');const safe=s=>typeof s==='string'&&s.length<=512&&/^[A-Za-z0-9][A-Za-z0-9._-]*\\.html(?:\\?[A-Za-z0-9._~\\/=&%+!?$-]*)?(?:#[A-Za-z0-9._~\\/=&%+!?$-]*)?$/.test(s);const params=new URLSearchParams(location.search);const from=params.get('from');let target=${JSON.stringify(fallback)};if(${JSON.stringify(useFrom)}&&safe(from))target=from;const parts=target.split('#');const query=parts[0].split('?');const next=new URLSearchParams(query[1]||'');for(const key of ['theme','embed','present'])if(!next.has(key)&&params.has(key))next.set(key,params.get(key));link.href=query[0]+(next.toString()?'?'+next.toString():'')+(parts.length>1?'#'+parts.slice(1).join('#'):'');})();</script>`;
  const withBar = html.replace('<body>', '<body>' + bar);
  const end = withBar.lastIndexOf('</body>');
  if (end < 0) throw new Error('Explainer output has no closing body.');
  return withBar.slice(0, end) + script + withBar.slice(end);
}

/** Build into an existing empty directory; no authored workflow topology is modified. */
export async function buildSiblingBundle(input, directory) {
  if (!input || !filename(input.serviceFile) || !filename(input.workflowFile) || !Array.isArray(input.details) || !input.details.length) throw new Error('A service, workflow and details with sibling filenames are required.');
  const names = [input.serviceFile, input.workflowFile, ...input.details.map(detail => detail.file)];
  if (names.some(name => !filename(name)) || new Set(names).size !== names.length) throw new Error('Bundle filenames must be distinct sibling HTML filenames.');
  if (!fs.statSync(directory).isDirectory() || fs.readdirSync(directory).length) throw new Error('Output directory must be empty.');
  const spec = input.workflow;
  if (spec?.diagram_type !== 'workflow' || spec?.meta?.parentHref !== input.serviceFile || !Array.isArray(spec.nodes)) throw new Error('Workflow must explicitly name the service parent.');
  const known = new Set(input.details.map(detail => detail.file));
  for (const node of spec.nodes) {
    const targets = node.drilldowns ?? (node.href ? [{href: node.href}] : []);
    if (!Array.isArray(targets) || targets.some(target => !target || !known.has(target.href))) throw new Error(`Unknown detail target on ${node.id}.`);
  }
  const source = JSON.stringify({schema_version:1,diagram_type:'explainer',meta:{id:'bundle-workflow',title:spec.meta.title,locale:'en'},answer:{summary:'Workflow navigation.'},panels:[{id:'workflow-panel',title:'Workflow',blocks:[{id:'workflow',type:'diagram',diagramType:'workflow',spec}]}],sources:[]});
  const prepared = await prepareExplainer(source, {inputPath:path.join(directory,'workflow-input.json'), quality:'standard'});
  const native = prepared.preparedDiagrams.diagrams.workflow.html;
  const renderDocument = async (document, name) => {
    const text = JSON.stringify(document);
    const bundle = await prepareExplainer(text, {inputPath:path.join(directory,`${name}.json`),quality:'standard'});
    return page(bundle.document,bundle);
  };
  const outputs = new Map();
  outputs.set(input.serviceFile,navigation(await renderDocument(input.service,'service'),input.workflowFile,'Open workflow'));
  outputs.set(input.workflowFile,native);
  for (const detail of input.details) outputs.set(detail.file,navigation(await renderDocument(detail.document,detail.file),input.workflowFile,'Back',true));
  for (const [name, html] of outputs) fs.writeFileSync(path.join(directory,name),html,{flag:'wx'});
  return {files:[...outputs.keys()]};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 4) throw new Error('Usage: node sibling-bundle.mjs INPUT.json EMPTY_OUTPUT_DIRECTORY');
  const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  console.log(JSON.stringify(await buildSiblingBundle(input, path.resolve(process.argv[3]))));
}
