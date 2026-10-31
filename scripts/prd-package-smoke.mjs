// Package-smoke helpers: reader ZIPs are deterministic stored entries; directory
// publication is intentionally Linux-only and remains fail-closed elsewhere.
import fs from 'node:fs';
import path from 'node:path';

export function frozenReadme(data) {
  const bytes=Buffer.from(data?.packageBase64||'','base64');
  let offset=0;
  while(offset+30<=bytes.length&&bytes.readUInt32LE(offset)===0x04034b50){
    if(bytes.readUInt16LE(offset+8)!==0)throw new Error('Reader package entry must be stored.');
    const size=bytes.readUInt32LE(offset+18),nameLength=bytes.readUInt16LE(offset+26),extra=bytes.readUInt16LE(offset+28);
    const start=offset+30+nameLength+extra,end=start+size;
    if(end>bytes.length)throw new Error('Reader package entry is truncated.');
    const name=bytes.subarray(offset+30,offset+30+nameLength).toString('utf8');
    if(name==='README.md')return bytes.subarray(start,end).toString('utf8');
    offset=end;
  }
  throw new Error('Reader package has no README.md.');
}

export function verifyPrdDirectoryExports({platform,dir,model,policy,call,reject,internalMd,publicMd}) {
  const cases=[['internal',[],internalMd],['client',['--audience','client','--disclosure',policy],publicMd]];
  for(const [audience,flags,expected] of cases){
    const target=path.join(dir,audience);
    const args=output=>['export',model,'-o',output,...flags,'--markdown-only'];
    if(platform==='linux'){
      call(...args(target));
      if(fs.readFileSync(path.join(target,'README.md'),'utf8')!==expected)throw new Error(`Packaged ${audience} directory export differs from the frozen reader Markdown.`);
    } else {
      const assertUnsupported=result=>{if(result.ok||!result.diagnostics?.some(d=>d.code==='prd/operation-failed'&&d.evidence?.reason==='Create-only directory publication currently requires Linux GNU mv.'))throw new Error('Unsupported directory export must report its fail-closed platform diagnostic.');};
      assertUnsupported(reject(...args(target)));
      if(fs.existsSync(target))throw new Error('Unsupported directory export created its destination.');
      fs.mkdirSync(target);const sentinel=path.join(target,'sentinel.txt');fs.writeFileSync(sentinel,'unchanged');
      assertUnsupported(reject(...args(target)));
      if(fs.readdirSync(target).join('\0')!=='sentinel.txt'||fs.readFileSync(sentinel,'utf8')!=='unchanged')throw new Error('Unsupported directory export changed an existing destination.');
    }
  }
}
