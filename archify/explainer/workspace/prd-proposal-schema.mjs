// Authoritative draft-07 change-request contract, compiled at build time.
const id={type:'string',pattern:'^[A-Za-z][A-Za-z0-9_-]{0,63}$'};
const sha={type:'string',pattern:'^[a-f0-9]{64}$'};
const text={type:'string',minLength:1,maxLength:10000,pattern:'\\S'};
const fact={type:'object',additionalProperties:false,properties:{value:text,gap:text},oneOf:[{required:['value']},{required:['gap']}]};
const value={anyOf:[{type:'null'},text,fact]};
export const requestSchema={type:'object',additionalProperties:false,properties:{kind:{const:'archify-prd-change-request'},schemaVersion:{const:1},workspaceId:{type:'string'},proposalId:id,baseRevision:sha,storeRevision:sha,objectId:id,operation:{enum:['replace','decision-correction']},path:{type:'string',maxLength:128},oldValue:value,oldHash:sha,newValue:value,commentIds:{type:'array',minItems:1,maxItems:100,uniqueItems:true,items:id}},required:['kind','schemaVersion','workspaceId','proposalId','baseRevision','storeRevision','objectId','operation','path','oldValue','oldHash','newValue','commentIds']};
