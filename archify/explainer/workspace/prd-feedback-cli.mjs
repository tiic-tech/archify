import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isStaleReviewDiagnostic, preparePrd } from './prd-prepare.mjs';
import { diagnostic } from './prd-model.mjs';
import { validatePackage, validatePublicPackage, importFeedback, exportFeedback, inspectFeedback } from './prd-feedback.mjs';
import { mapPublicFeedback } from './prd-feedback-public.mjs';
import { makeProposal, applyProposal } from './prd-proposal.mjs';
import { proposeQuestions } from './prd-questions.mjs';

function readJson(file,limit=16*1024*1024){const bytes=fs.readFileSync(file); if(bytes.length>limit) throw new Error(`File exceeds ${limit} bytes: ${file}`); return JSON.parse(bytes.toString('utf8'));}
export async function commandFeedback(args){
  let result,temp;
  try {
    const [verb,input,...argsOptions]=args;
    if(!['validate','import','export','inspect','propose','apply','questions','map-public'].includes(verb)||!input||input.startsWith('-')) throw new Error('Expected feedback validate|import|export|inspect|propose|apply|questions|map-public INPUT.');
    const options={};
    for(let i=0;i<argsOptions.length;i++){
      const key=argsOptions[i];
      if(key==='--json'){if(options.json) throw new Error('Duplicate --json.'); options.json=true; continue;}
      if(!['-o','--model','--store','--expect-store','--disclosure','--expect-revision','--expect-snapshot'].includes(key)||options[key]!==undefined) throw new Error(`Unknown or duplicate option ${key}.`);
      const value=argsOptions[++i]; if(!value||value.startsWith('-')) throw new Error(`Missing value for ${key}.`); options[key]=value;
    }
    if(!options.json) throw new Error('Use --json.');
    const allowed={validate:[],import:['-o','--model','--store','--expect-store'],export:['-o'],inspect:['--model'],propose:['-o','--model','--store','--expect-store'],apply:['-o','--model','--store','--expect-store'],questions:['-o'],'map-public':['-o','--model','--disclosure','--expect-revision','--expect-snapshot']}[verb];
    for(const key of Object.keys(options)) if(key!=='json'&&!allowed.includes(key)) throw new Error(`Option ${key} is not supported for ${verb}.`);
    if(['import','export','propose','apply','questions','map-public'].includes(verb)&&!options['-o']) throw new Error('An output path is required.');
    if(['import','inspect','propose','apply','map-public'].includes(verb)&&!options['--model']) throw new Error('A model path is required.');
    if(['propose','apply'].includes(verb)&&(!options['--store']||!options['--expect-store'])) throw new Error('An explicitly expected store revision and store are required.');
    if(options['--expect-store']&&!options['--store']) throw new Error('--expect-store requires --store.');
    if(verb==='map-public'&&(!options['--disclosure']||!options['--expect-revision']||!options['--expect-snapshot'])) throw new Error('Public mapping requires --disclosure, --expect-revision and --expect-snapshot.');
    const doc=readJson(input),modelPath=verb==='questions'?path.resolve(input):options['--model']&&path.resolve(options['--model']);
    let model,revision,baseManifest;
    if(modelPath){
      model=verb==='questions'?doc:readJson(modelPath);
      const prepared=await preparePrd(model,{inputPath:modelPath});
      if(!prepared.ok){result=prepared; throw Object.assign(new Error('Model validation failed.'),{reported:true});}
      revision=prepared.manifest.revision; baseManifest=prepared.manifest;
    }
    const store=options['--store']?readJson(options['--store']):null;
    if(verb==='validate') result=doc?.kind==='archify-prd-public-feedback'?validatePublicPackage(doc):validatePackage(doc);
    if(verb==='map-public') {const policy=readJson(options['--disclosure']);const projection=await (await import('./prd-reader-build.mjs')).buildPrdReader(baseManifest,{audience:'client',policy,inputPath:modelPath,returnConfig:true});result=mapPublicFeedback(doc,baseManifest,policy,projection,{expectRevision:options['--expect-revision'],expectSnapshot:options['--expect-snapshot']});}
    if(verb==='import') result=importFeedback(model,doc,store,options['--expect-store']);
    if(verb==='export') result=exportFeedback(doc);
    if(verb==='inspect') result=inspectFeedback(model,revision,doc);
    if(verb==='questions') result=proposeQuestions(model,revision);
    if(verb==='propose') {
      result=makeProposal(doc,model,revision,store,options['--expect-store']);
      if(result.ok){
        const candidate=applyProposal(result.proposal,model,revision,store,options['--expect-store']);
        const checked=candidate.ok?await preparePrd(candidate.model,{inputPath:modelPath,baseManifest,expectRevision:revision,feedbackCandidate:true}):candidate;
        if(!checked.ok) result=checked;
        else result={...result,diagnostics:checked.diagnostics.filter(isStaleReviewDiagnostic)};
      }
    }
    if(verb==='apply') {
      result=applyProposal(doc,model,revision,store,options['--expect-store']);
      if(result.ok){
        const targetDir=fs.realpathSync(path.dirname(path.resolve(options['-o'])));
        if(targetDir!==fs.realpathSync(path.dirname(modelPath))) throw new Error('Applied model must be in the same directory as the original, preserving relative assets.');
        const checked=await preparePrd(result.model,{inputPath:modelPath,baseManifest,expectRevision:revision,feedbackCandidate:true});
        if(!checked.ok) result=checked;
        else result={...result,revision:checked.candidateRevision,diagnostics:checked.diagnostics.filter(isStaleReviewDiagnostic)};
      }
    }
    if(result.ok&&['import','export','propose','apply','questions','map-public'].includes(verb)){
      if(verb==='import'&&options['--store']&&result.added===0){result={ok:true,added:0,revision:result.store.revision,output:path.resolve(options['--store']),diagnostics:[]};}
      else {
        const target=path.resolve(options['-o']),dir=fs.realpathSync(path.dirname(target)),output=path.join(dir,path.basename(target));
        const value=verb==='import'?result.store:['export','map-public'].includes(verb)?result.package:verb==='propose'?result.proposal:verb==='apply'?result.model:result;
        const data=JSON.stringify(value,null,2)+'\n';
        if(Buffer.byteLength(data)>16*1024*1024) throw new Error('Feedback output exceeds 16 MiB.');
        temp=path.join(dir,`.archify-feedback-${randomUUID()}.tmp`); fs.writeFileSync(temp,data,{flag:'wx',mode:0o600}); fs.linkSync(temp,output);
        result={ok:true,output,...(verb==='import'?{added:result.added,revision:result.store.revision}:verb==='propose'?{digest:result.proposal.digest}:verb==='apply'?{revision:result.revision,changedIds:result.changedIds,summaryIds:result.summaryIds,history:result.history}:verb==='questions'?{proposals:result.proposals.length,covered:result.covered.length}:verb==='map-public'?{publicIdentity:result.publicIdentity,mapping:result.mapping}:{}),diagnostics:result.diagnostics||[]};
      }
    }
  } catch(error){if(!error.reported) result={ok:false,diagnostics:error.diagnostics||[diagnostic('feedback-operation-failed','/','Feedback operation failed without replacing an output.',{reason:error.message},'Correct the input or choose a new output path and retry.')]};}
  finally {if(temp){try{fs.unlinkSync(temp);}catch{/* best effort */}}}
  console.log(JSON.stringify(result)); if(!result.ok) process.exitCode=1;
}
