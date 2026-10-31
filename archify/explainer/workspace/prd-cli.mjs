import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { preparePrd } from './prd-prepare.mjs';

function failure(code,message,locator,evidence,fix){return {ok:false,diagnostics:[{code:`prd/${code}`,severity:'error',message,subject:{locator},evidence,supportedFixes:[fix]}]};}
function readJson(file,limit){const bytes=fs.readFileSync(file); if(bytes.length>limit) throw new Error(`File exceeds ${limit} bytes.`); return JSON.parse(bytes.toString('utf8'));}
export async function commandPrd(args){
  let result,temp;
  try{
    const [verb,input,...options]=args;
    if(verb==='feedback') { await (await import('./prd-feedback-cli.mjs')).commandFeedback(args.slice(1)); return; }
    if(!['validate','compile','build','export'].includes(verb)||!input||input.startsWith('-')) throw new Error('Expected prd validate|compile|build|export MODEL.json.');
    let output,expected,ready,base,audience,disclosure,serviceId,historyFile,incrementalFrom,json=false,pdf=false,markdownOnly=false;
    for(let i=0;i<options.length;i++){
      const option=options[i];
      if(option==='--json'&&!json) json=true;
      else if(option==='--pdf'&&!pdf) pdf=true;
      else if(option==='--markdown-only'&&!markdownOnly) markdownOnly=true;
      else if(['-o','--expect-revision','--ready','--base-manifest','--audience','--disclosure','--service','--service-history','--incremental-from'].includes(option)){
        const value=options[++i]; if(!value||value.startsWith('-')) throw new Error(`Missing value for ${option}.`);
        if(option==='-o'&&output===undefined) output=value;
        else if(option==='--expect-revision'&&expected===undefined) expected=value;
        else if(option==='--ready'&&ready===undefined) ready=value;
        else if(option==='--base-manifest'&&base===undefined) base=value;
        else if(option==='--audience'&&audience===undefined) audience=value;
        else if(option==='--disclosure'&&disclosure===undefined) disclosure=value;
        else if(option==='--service'&&serviceId===undefined) serviceId=value;
        else if(option==='--service-history'&&historyFile===undefined) historyFile=value;
        else if(option==='--incremental-from'&&incrementalFrom===undefined) incrementalFrom=value;
        else throw new Error(`Duplicate option ${option}.`);
      } else throw new Error(`Unknown or duplicate option ${option}.`);
    }
    if(['build','export'].includes(verb)&&audience===undefined) audience='internal';
    if(!json||(['compile','build','export'].includes(verb)&&!output)||(verb==='validate'&&(output||expected||ready||base))||(verb==='build'&&(expected||ready||base))||(!['build','export'].includes(verb)&&(audience||disclosure))||(verb!=='export'&&(pdf||markdownOnly))||(pdf&&markdownOnly)||(['build','export'].includes(verb)&&(!['internal','client'].includes(audience)||Boolean(disclosure)!==(audience==='client')))) throw new Error('Use --json; compile, build and export require -o; build accepts no compile options; build/export accept --audience internal|client (default internal), client requires --disclosure, and --markdown-only cannot be combined with --pdf.');
    if((serviceId||historyFile||incrementalFrom)&&(verb!=='export'||!serviceId||!historyFile||!markdownOnly||pdf||expected||ready||base)) throw new Error('Service export requires --service ID, --service-history FILE and --markdown-only; --incremental-from is optional, and PDF and compile ancestry options are not supported.');
    const inputPath=path.resolve(input), model=readJson(inputPath,16*1024*1024);
    const baseManifest=base?readJson(path.resolve(base),128*1024*1024):undefined;
    const prepareStart=performance.now();
    result=await preparePrd(model,{inputPath,expectRevision:expected,ready,baseManifest});
    const prepareMs=performance.now()-prepareStart;
    if(verb==='export'&&result.ok){
      const policy=disclosure?readJson(path.resolve(disclosure),16*1024*1024):undefined;
      const {renderPrd,publishDirectory}=await import('./prd-export.mjs');
      let service,prior;
      if(serviceId){const {createServiceExport,loadServiceBase,serviceWorkspace}=await import('./prd-service-export.mjs');const workspace=serviceWorkspace(result.manifest.model);prior=incrementalFrom?loadServiceBase(incrementalFrom,workspace,audience):undefined;service=createServiceExport({id:serviceId,history:readJson(path.resolve(historyFile),1024*1024),audience,workspace,base:prior});}
      const renderStart=performance.now();
      const rendered=await renderPrd(result.manifest,{audience,policy,inputPath,markdownOnly,service});
      const renderMs=performance.now()-renderStart, publishStart=performance.now();
      const outputPath=await publishDirectory(output,rendered.files,{pdf,beforePublish:prior?()=>prior.verify():undefined});
      const publishMs=performance.now()-publishStart;
      result={ok:true,revision:service?service.semantic:rendered.identity.revision,output:outputPath,audience,diagnostics:result.diagnostics,...(service?{workspaceRevision:result.manifest.revision,historyIdentity:rendered.identity.historyIdentity,cache:service.counts,timingMs:{prepare:prepareMs,projectionAndRender:renderMs,publish:publishMs},baseReceipt:prior?.receipt||null}:{})};
    }
    if(verb==='validate'&&result.ok) result={ok:true,revision:result.manifest.revision,diagnostics:result.diagnostics};
    if(['compile','build'].includes(verb)&&result.ok){
      const outputPath=path.resolve(output),dir=fs.realpathSync(path.dirname(outputPath)),target=path.join(dir,path.basename(outputPath));
      const serialized=verb==='build' ? await (await import('./prd-reader-build.mjs')).buildPrdReader(result.manifest,{audience,policy:disclosure?readJson(path.resolve(disclosure),16*1024*1024):undefined,inputPath}) : `${JSON.stringify(result.manifest,null,2)}\n`;
      if(Buffer.byteLength(serialized)>128*1024*1024) throw new Error('Output exceeds 128 MiB.');
      temp=path.join(dir,`.archify-prd-${randomUUID()}.tmp`);
      fs.writeFileSync(temp,serialized,{flag:'wx',mode:0o600});
      fs.linkSync(temp,target);
      result={ok:true,revision:result.manifest.revision,digest:result.manifest.digest,output:target,diagnostics:result.diagnostics};
    }
  }catch(error){result=error.diagnostics?{ok:false,diagnostics:error.diagnostics}:failure('operation-failed','PRD operation failed without replacing an output.','/',{reason:error.message},'Correct the input or choose a new output path and retry.');}
  finally{if(temp){try{fs.unlinkSync(temp);}catch{/* best effort */}}}
  console.log(JSON.stringify(result)); if(!result.ok) process.exitCode=1;
}
