import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeTextFile} from './text-encoding.js';
import {extractDocument} from './assistant.js';

const sample='과적합과 머신러닝 수업 메모입니다.';
const ansi=Buffer.from('b0fac0fbc7d5b0fa20b8d3bdc5b7afb4d720bcf6bef720b8deb8f0c0d4b4cfb4d92e','hex');
test('Notepad UTF8, UTF8 BOM, Korean ANSI, UTF16 LE and BE retain the same Korean text',async()=>{
 const utf8=Buffer.from(sample),le=Buffer.from(sample,'utf16le'),be=Buffer.from(le).swap16();
 const cases=[utf8,Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),utf8]),ansi,Buffer.concat([Buffer.from([0xff,0xfe]),le]),Buffer.concat([Buffer.from([0xfe,0xff]),be])];
 for(const bytes of cases){
  const original=Buffer.from(bytes);assert.equal(decodeTextFile(bytes),sample);assert.deepEqual(bytes,original);
  assert.equal((await extractDocument('수업메모.txt',bytes))[0].text,sample);
 }
});
test('BOM-less UTF16 with Latin text, Korean and line breaks is detected in both byte orders',()=>{
 const text='AI class notes\r\n과적합 수업\nLine 2';const le=Buffer.from(text,'utf16le');
 assert.equal(decodeTextFile(le),text);assert.equal(decodeTextFile(Buffer.from(le).swap16()),text);
});
test('Windows CP949 extension Hangul is supported beyond basic EUC-KR',()=>{
 assert.equal(decodeTextFile(Buffer.from('8c63b9e6b0a2c7cf','hex')),'똠방각하');
});
test('Malformed BOM-marked Unicode and binary text fail instead of silently replacing characters',()=>{
 for(const bytes of [Buffer.from([0xff,0xfe,0x41]),Buffer.from([0xef,0xbb,0xbf,0xff]),Buffer.from([0,0,0,0]),Buffer.from([0x50,0x4b,0x03,0x04,0]),Buffer.from([0xff,0xfe,0,0,0x41,0,0,0])])assert.throws(()=>decodeTextFile(bytes));
 assert.equal(decodeTextFile(Buffer.from('plain ASCII\ttext\n')),'plain ASCII\ttext\n');
});
