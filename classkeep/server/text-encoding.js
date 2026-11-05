// Local decoding only. Uploaded originals and GitHub blobs are never rewritten.
import iconv from 'iconv-lite';
function checkText(text){
 if(/[\x00-\x08\x0b\x0e-\x1f\x7f]/.test(text))throw Error('일반 텍스트가 아닌 제어 문자가 들어 있습니다.');
 return text;
}
function decode(bytes,encoding){
 if(encoding.startsWith('utf-16')&&bytes.length%2)throw Error('UTF-16 파일의 바이트 수가 올바르지 않습니다.');
 const text=new TextDecoder(encoding,{fatal:true}).decode(bytes);
 return checkText(text);
}
export function decodeTextFile(input){
 const bytes=Buffer.from(input);
 if(bytes.length>=4&&((bytes[0]===0xff&&bytes[1]===0xfe&&bytes[2]===0&&bytes[3]===0)||(bytes[0]===0&&bytes[1]===0&&bytes[2]===0xfe&&bytes[3]===0xff)))throw Error('UTF-32는 지원하지 않습니다. UTF-8로 저장해주세요.');
 // Explicit BOM wins. Do not reinterpret damaged Unicode as another encoding.
 if(bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf)return decode(bytes.subarray(3),'utf-8');
 if(bytes[0]===0xff&&bytes[1]===0xfe)return decode(bytes.subarray(2),'utf-16le');
 if(bytes[0]===0xfe&&bytes[1]===0xff)return decode(bytes.subarray(2),'utf-16be');
 // BOM-less UTF-16 with an ASCII-like zero-byte pattern is recognizable.
 if(bytes.length>=4&&bytes.length%2===0){
  const pairs=Math.min(bytes.length/2,2048);let evenZeros=0,oddZeros=0;
  for(let i=0;i<pairs;i++){if(bytes[i*2]===0)evenZeros++;if(bytes[i*2+1]===0)oddZeros++;}
  if(oddZeros/pairs>=0.25&&evenZeros/pairs<0.05)return decode(bytes,'utf-16le');
  if(evenZeros/pairs>=0.25&&oddZeros/pairs<0.05)return decode(bytes,'utf-16be');
 }
 try{return decode(bytes,'utf-8');}catch{}
 // Explicit CP949 table: native ICU euc-kr does not reliably cover all Windows extensions.
 try{
  const text=iconv.decode(bytes,'cp949');
  if(!iconv.encode(text,'cp949').equals(bytes))throw Error('손상된 CP949 바이트입니다.');
  return checkText(text);
 }catch{throw Error('UTF-8, UTF-16 또는 한글 ANSI(CP949/EUC-KR)로 읽을 수 없습니다. UTF-8로 다시 저장해주세요.');}
}
