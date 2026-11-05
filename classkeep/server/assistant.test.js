import {testDirectory} from './test-helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {hashBytes} from './core.js';
import {AssistantService,extractDocument,selectExcerpts} from './assistant.js';

function simplePdf(text){
 let out='%PDF-1.4\n';const offsets=[0];
 const stream=`BT /F1 12 Tf 40 150 Td (${text}) Tj ET`;
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
 for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(out));out+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
 const xref=Buffer.byteLength(out);out+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 return Buffer.from(out);
}
test('PDF extraction retains source page and UTF8 text is preserved',async()=>{
 const chunks=await extractDocument('lecture.pdf',simplePdf('Overfitting means learning the training data too closely.'));
 assert.equal(chunks[0].page,1);assert.match(chunks[0].text,/Overfitting/);
 assert.match((await extractDocument('노트.md',Buffer.from('과적합은 일반화 성능을 낮춥니다.')))[0].text,/과적합/);
 await assert.rejects(extractDocument('강의.hwp',Buffer.from('unsupported')));
});
test('excerpt selection uses body evidence, preserves pages and limits prompt',()=>{
 const docs=[{path:'01.pdf',origin:'보관함',chunks:[{text:'unrelated introduction',page:1},{text:'과적합 regularization 설명',page:2}]},{path:'02.txt',origin:'보관함',chunks:[{text:'다른 과목 내용'}]}];
 const selected=selectExcerpts(docs,'과적합',2000);assert.equal(selected[0].page,2);assert.match(selected[0].text,/과적합/);assert.ok(selected.reduce((s,n)=>s+n.text.length,0)<=2000);
});
const config={OLLAMA_BASE_URL:'http://127.0.0.1:11434',OLLAMA_MODEL:'qwen3.8:27b'};
test('archive answer sends only owned original text; uses no-emoji system and safe source metadata',async t=>{
 const dir=await testDirectory(t,'assistant-unit'),bytes=Buffer.from('과적합: 학습 데이터에 과도하게 적응하는 현상.');const hash=hashBytes(bytes);await writeFile(resolve(dir,hash),bytes);
 let sent;
 const pool={query:async(sql,params)=>{assert.deepEqual(params,['student-a']);return{rows:[{path:'인공지능/강의.md',hash,bytes:bytes.length}]};}};
 const service=new AssistantService(pool,null,config,dir,{fetchImpl:async(url,options)=>{sent=JSON.parse(options.body);assert.equal(url.href,'http://127.0.0.1:11434/api/generate');return new Response(JSON.stringify({response:'과적합은 학습 데이터에 과도하게 적응하는 현상입니다. [1]'}));}});
 const r=await service.ask('student-a','과적합이 뭐야?');assert.equal(r.sources[0].path,'인공지능/강의.md');assert.equal(r.readCount,1);assert.match(sent.system,/이모티콘/);assert.match(sent.prompt,/학습 데이터에 과도하게/);assert.equal(sent.stream,false);assert.equal(sent.model,'qwen3.8:27b');
});
test('GitHub requests are restricted to currently allowed repositories and pinned blob version',async()=>{
 let sent,calls=[];
 const gh={repositories:async(uid,options)=>{assert.equal(options.writeOnly,false);return[{id:1,fullName:'student/course',branch:'main'}];},snapshot:async()=>({root:'/repos/student/course',head:'commit-fixed',tree:[{path:'notes.md',type:'blob',mode:'100644',size:30,sha:'blob-fixed'}]}),request:async(uid,method,path)=>{calls.push(path);return{encoding:'base64',size:30,content:Buffer.from('강의 자료 근거 본문').toString('base64')};}};
 const service=new AssistantService({query:async()=>({rows:[]})},gh,config,'data',{fetchImpl:async(url,options)=>{sent=JSON.parse(options.body);return new Response(JSON.stringify({response:'요약 [1]'}));}});
 await assert.rejects(service.ask('student-a','@other/private 요약'),e=>e.status===403);assert.equal(calls.length,0);assert.equal(sent,undefined);
 const r=await service.ask('student-a','@student/course 강의 요약');assert.equal(calls[0],'/repos/student/course/git/blobs/blob-fixed');assert.match(r.sources[0].url,/commit-fixed/);assert.match(sent.prompt,/근거 본문/);
});
test('unavailable models and timeouts return actionable errors; empty sources are explicit',async()=>{
 const empty={query:async()=>({rows:[]})};let prompt;
 const missing=new AssistantService(empty,null,config,'data',{fetchImpl:async()=>new Response('{}',{status:404})});await assert.rejects(missing.ask('u','질문'),e=>e.status===503);
 const timeout=new AssistantService(empty,null,config,'data',{fetchImpl:async()=>{throw Object.assign(Error(),{name:'TimeoutError'});}});await assert.rejects(timeout.ask('u','질문'),e=>e.status===504);
 const noFiles=new AssistantService(empty,null,config,'data',{fetchImpl:async(url,options)=>{prompt=JSON.parse(options.body).prompt;return new Response(JSON.stringify({response:'참고 자료가 없습니다.'}));}});
 const r=await noFiles.ask('u','질문');assert.equal(r.sources.length,0);assert.match(prompt,/읽을 수 있는 참고 자료가 없습니다/);
});
