// Explicit authoring-side mapping; never embed this reverse mapping in a reader.
import { validatePublicPackage, validatePackage } from './prd-feedback.mjs';
import { diagnostic } from './prd-model.mjs';
const fail=(loc,message,evidence={})=>({ok:false,diagnostics:[diagnostic('feedback-public-mapping',loc,message,evidence,'Use the exact model, disclosure policy and projected snapshot; review changed wording explicitly.')]});
const get=(object,path)=>path.slice(1).split('/').reduce((value,key)=>value?.[key],object);
export function mapPublicFeedback(pkg,manifest,policy,projection,{expectRevision,expectSnapshot}){
  const checked=validatePublicPackage(pkg);if(!checked.ok)return checked;
  if(!manifest.model.workspaceId||pkg.workspaceId!==manifest.model.workspaceId)return fail('/workspaceId','Workspace identity does not match.');
  if(!expectRevision||pkg.revision!==expectRevision||manifest.revision!==expectRevision)return fail('/revision','Public feedback revision does not match the explicitly expected source revision.');
  if(!expectSnapshot||pkg.snapshot!==expectSnapshot||projection.snapshot!==expectSnapshot)return fail('/snapshot','Public feedback snapshot does not match the explicitly expected projection.');
  if(pkg.disclosure!==projection.disclosure||pkg.exporter!==projection.exporter)return fail('/disclosure','Disclosure or exporter identity does not match the reconstructed projection.');
  const publicObjects=new Map(projection.objects.map(o=>[o.id,o])),privateObjects=new Map(manifest.model.objects.map(o=>[o.id,o])),aliases=new Map();
  for(const [id,value] of Object.entries(policy.objects||{})){if(aliases.has(value.id))return fail('/objects','Public object alias is ambiguous.');aliases.set(value.id,id);}
  const assetAliases=new Map();for(const [id,value] of Object.entries(policy.assets||{})){if(assetAliases.has(value.id))return fail('/assets','Public asset alias is ambiguous.');assetAliases.set(value.id,id);}
  const comments=[],mapping=[];
  for(const [i,c] of pkg.comments.entries()){
    const original=aliases.get(c.objectId),publicObject=publicObjects.get(c.objectId),privateObject=privateObjects.get(original),at=`/comments/${i}`;
    if(!privateObject||!publicObject)return fail(at+'/objectId','Public alias is not uniquely present in the exact projection.');
    const publicValue=get(publicObject,c.quoteSnapshot.path),privateValue=get(privateObject,c.quoteSnapshot.path);
    if(typeof publicValue!=='string'||publicValue!==c.quoteSnapshot.text)return fail(at+'/quoteSnapshot','Public property or complete quote does not match the exact projection.');
    if(typeof privateValue!=='string')return fail(at+'/quoteSnapshot/path','The source property is missing or not a string.');
    const mapped={...c,objectId:original,publicOrigin:{workspaceId:pkg.workspaceId,revision:pkg.revision,disclosure:pkg.disclosure,snapshot:pkg.snapshot,exporter:pkg.exporter,objectId:c.objectId,sourceSnapshot:{path:c.quoteSnapshot.path,text:privateValue},...(c.assetAnchor?{assetId:c.assetAnchor.assetId}:{})}};
    if(c.assetAnchor){const id=assetAliases.get(c.assetAnchor.assetId),asset=manifest.assets.find(a=>a.id===id),publicAsset=projection.assets.find(a=>a.id===c.assetAnchor.assetId);if(!id||!asset||!publicAsset||!privateObject.assetIds?.includes(id)||!publicObject.assetIds?.includes(c.assetAnchor.assetId)||asset.sha256!==c.assetAnchor.sha256||publicAsset.sha256!==c.assetAnchor.sha256)return fail(at+'/assetAnchor','Public image alias, association or bytes do not match the retained source.');mapped.assetAnchor={...c.assetAnchor,assetId:id};}
    comments.push(mapped);mapping.push({commentId:c.id,publicObject:c.objectId,sourceObject:original,path:c.quoteSnapshot.path,publicQuote:publicValue,sourceValue:privateValue,review:publicValue===privateValue?'current':'needs-review',...(publicValue===privateValue?{}:{reason:'public wording differs from the source; retain the public quote for manual review'})});
  }
  const out={kind:'archify-prd-feedback',schemaVersion:1,workspaceId:pkg.workspaceId,comments};const valid=validatePackage(out);if(!valid.ok)return valid;
  if(Buffer.byteLength(JSON.stringify(mapping))>16*1024*1024)return fail('/comments','Complete mapping report exceeds the 16 MiB limit.');
  return {ok:true,package:out,mapping,publicIdentity:{workspaceId:pkg.workspaceId,revision:pkg.revision,disclosure:pkg.disclosure,snapshot:pkg.snapshot,exporter:pkg.exporter},diagnostics:[]};
}
