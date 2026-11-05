import {testDirectory} from './test-helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseReferenceQuestion} from '../dist/reference-scope.js';
import {formatReferenceQuestion} from '../dist/career-sites.js';
import {CareerService} from './career.js';
import {AssistantService,CAREER_RULES} from './assistant.js';
import {hashBytes} from './core.js';

const id='government-employment';
test('government reference tag preserves repository selections and rejects retired sources',()=>{
 const p=parseReferenceQuestion('!취업정보 @student/course !정부취업정보 이 과제를 보완해줘');
 assert.deepEqual(p.repositories,['student/course']);assert.deepEqual(p.careerSites,[id]);assert.equal(p.question,'이 과제를 보완해줘');
 assert.deepEqual(parseReferenceQuestion(formatReferenceQuestion(p)),p);
 assert.equal(parseReferenceQuestion('질문 속 !취업정보는 예시').careerSites.length,0);
 for(const token of ['!사람인','!고용24','!링커리어','!https://evil.example'])assert.throws(()=>parseReferenceQuestion(token+' 질문'));
});
test('unknown government API remains pending even if old service keys exist',async()=>{
 const career=new CareerService({SARAMIN_ACCESS_KEY:'old-key',WORK24_AUTH_KEY:'old-key'});
 assert.equal(career.catalog().length,1);assert.equal(career.catalog()[0].ready,false);
 const r=await career.collect([id],'데이터 분석');assert.equal(r.documents.length,0);assert.equal(r.statuses[0].state,'unavailable');assert.match(r.statuses[0].message,/연결 대기/);
});
test('government adapter contract normalizes bounded sources, filters unrelated links and caches fetch timestamp',async()=>{
 let calls=0;
 const career=new CareerService({},{providers:{[id]:{enabled:true,allowedHosts:['employment.example'],search:async query=>{
  calls++;assert.equal(query,'데이터 분석');return [{title:'샘플기관 분석 직무',url:'https://employment.example/jobs/1',text:'공식 API에서 반환한 직무 조건',kind:'job-summary'},{title:'외부링크',url:'https://evil.example/',text:'읽으면 안 되는 출처'},{title:'인증키 포함 URL',url:'https://employment.example/api?serviceKey=PRIVATE',text:'공개 출처로 노출하면 안 됨'}];
 }}}});
 const first=await career.collect([id],'데이터 분석');assert.equal(first.documents.length,1);assert.match(first.documents[0].chunks[0].text,/직무 조건/);
 const again=await career.collect([id],'데이터 분석');assert.equal(calls,1);assert.equal(again.documents[0].checkedAt,first.documents[0].checkedAt);
});
test('unavailable or failing government adapters cannot produce fabricated references',async()=>{
 const career=new CareerService({},{providers:{[id]:{enabled:true,allowedHosts:['employment.example'],search:async()=>{throw Error('authentication failed');}}}});
 const r=await career.collect([id],'분석');assert.equal(r.documents.length,0);assert.equal(r.statuses[0].state,'error');
});
test('archive plus GitHub plus government selection retains honest pending status and optional career answer rules',async t=>{
 const dir=await testDirectory(t,'career-unit'),bytes=Buffer.from('내 필기의 과제 조건: 다중회귀 구현'),hash=hashBytes(bytes);await writeFile(resolve(dir,hash),bytes);
 const pool={query:async(sql,params)=>{assert.equal(params[0],'student-a');return{rows:[{path:'필기.md',hash,bytes:bytes.length}]};}};
 const gh={repositories:async()=>[{fullName:'student/course',branch:'main'}],snapshot:async()=>({head:'fixed',root:'/repos/student/course',tree:[{path:'model.py',type:'blob',mode:'100644',size:20,sha:'code'}]}),request:async()=>({encoding:'base64',size:20,content:Buffer.from('회귀모델 구현 코드').toString('base64')})};
 let payload;
 const service=new AssistantService(pool,gh,{OLLAMA_BASE_URL:'http://localhost:11434'},dir,{fetchImpl:async(url,options)=>{payload=JSON.parse(options.body);return new Response(JSON.stringify({response:'답변입니다.'}));}});
 const r=await service.ask('student-a','@student/course !취업정보 취업을 위한 과제 개선',{careerQuery:'데이터 분석 신입'});
 assert.equal(r.source,'combined');assert.equal(r.readCount,2);assert.equal(r.careerStatus.length,1);assert.equal(r.sources.filter(s=>s.sourceType==='career').length,0);assert.match(payload.prompt,/내 필기의 과제 조건/);assert.match(payload.prompt,/회귀모델 구현 코드/);assert.match(payload.prompt,/정부 API 연결 대기/);assert.match(payload.system,/조회 상태가 설정 필요/);
 await service.ask('student-a','회귀모델 설명');assert.ok(!payload.system.includes(CAREER_RULES));assert.match(payload.prompt,/취업 출처를 선택하지 않았다/);
 await assert.rejects(service.ask('student-a','!취업정보 취업을 위한 과제 개선'),e=>e.status===400);
});
