// Deterministic uncompressed ZIP for the frozen export files. This is a
// transport, not a second renderer or an authoritative copy of the model.
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(bytes){let n=0xffffffff;for(const byte of bytes)n=crcTable[(n^byte)&255]^(n>>>8);return (n^0xffffffff)>>>0;}
export function readerZip(files){
  if(files.size>65535)throw new Error('Reader package exceeds the ZIP file-count limit.');
  const local=[],central=[];let offset=0;
  for(const [name,bytes] of files){
    if(!Buffer.isBuffer(bytes)||name.startsWith('/')||name.split('/').some(part=>!part||part==='.'||part==='..')||name.includes('\\'))throw new Error('Invalid reader package path.');
    const filename=Buffer.from(name,'utf8'),crc=crc32(bytes);if(filename.length>65535||bytes.length>0xffffffff||offset>0xffffffff)throw new Error('Reader package exceeds ZIP bounds.');
    const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(0x21,12);h.writeUInt32LE(crc,14);h.writeUInt32LE(bytes.length,18);h.writeUInt32LE(bytes.length,22);h.writeUInt16LE(filename.length,26);local.push(h,filename,bytes);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(0x21,14);c.writeUInt32LE(crc,16);c.writeUInt32LE(bytes.length,20);c.writeUInt32LE(bytes.length,24);c.writeUInt16LE(filename.length,28);c.writeUInt32LE(offset,42);central.push(c,filename);offset+=h.length+filename.length+bytes.length;
  }
  const centralSize=central.reduce((n,b)=>n+b.length,0);if(offset+centralSize>0xffffffff)throw new Error('Reader package exceeds ZIP bounds.');const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.size,8);end.writeUInt16LE(files.size,10);end.writeUInt32LE(centralSize,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,...central,end]);
}
