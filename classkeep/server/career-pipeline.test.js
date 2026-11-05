import {testDirectory} from './test-helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {buildCareerProfile,rankBM25,deduplicateRecords} from './career-ranking.js';
import {createFederatedAdapter} from './career-federation.js';
import {CareerService} from './career.js';
import {TextExtractionCache} from './text-cache.js';
import {AssistantService} from './assistant.js';
import {hashBytes} from './core.js';

const providerId='government-employment';
test('assignment PDF requirements drive the profile; public query excludes private instructions',()=>{
 const profile=buildCareerProfile({question:'학번123 과제를 취업 관점으로 보완해줘',target:'데이터 분석 신입',assignmentPath:'과제안내.pdf',documents:[{path:'과제안내.pdf',origin:'내 보관함',chunks:[{page:1,text:'과제 안내\n반드시 RStudio로 다중회귀와 잔차 분석을 구현한다.\n제출 마감 금요일. 비공개 학번123.'}]},{path:'예제.py',origin:'student/course',chunks:[{text:'Python 예제'}]}]});
 assert.ok(profile.skills.includes('R'));assert.ok(profile.skills.includes('회귀분석'));assert.ok(profile.constraints.some(s=>s.includes('반드시')));assert.equal(profile.assignmentSources[0].path,'과제안내.pdf');assert.ok(!profile.searchQuery.includes('학번123'));assert.ok(!profile.searchQuery.includes('금요일'));assert.deepEqual(profile.apiKinds,['jobs']);
});
test('BM25 selects matching roles and synonyms ahead of unrelated jobs; tracking URLs deduplicate',()=>{
 const records=[{title:'간호직',text:'병동 환자 돌봄',url:'https://jobs.example/1'},{title:'분석가',text:'RStudio regression 통계 분석',url:'https://jobs.example/2'},{title:'판매직',text:'매장 계산 판매',url:'https://jobs.example/3'}];
 const ranked=rankBM25(records,'회귀분석 R');assert.equal(ranked[0].url,'https://jobs.example/2');assert.ok(!ranked.some(r=>r.title==='간호직'));
 assert.equal(deduplicateRecords([{url:'https://jobs.example/1?utm_source=x'},{url:'https://jobs.example/1#top'}]).length,1);
});
test('candidate cache stores the pool, while each question reranks it and returns at most five',async()=>{
 let calls=0;const contexts=[];
 const adapter={enabled:true,allowedHosts:['jobs.example'],search:async(query,context)=>{calls++;contexts.push(context);return [...Array.from({length:8},(_,i)=>({title:'R 통계분석 '+i,text:'RStudio regression 회귀분석',url:'https://jobs.example/r/'+i})),...Array.from({length:8},(_,i)=>({title:'Python 개발 '+i,text:'Python pandas 머신러닝',url:'https://jobs.example/python/'+i}))];}};
 const career=new CareerService({},{providers:{[providerId]:adapter}});
 const profile={apiKinds:['jobs'],skills:[],target:'분석',rankingQuery:'R 회귀분석',question:'SECRET',assignmentText:'PRIVATE'};
 const first=await career.collect([providerId],'분석',{profile});assert.equal(first.documents.length,5);assert.ok(first.documents.every(d=>d.url.includes('/r/')));assert.equal(first.statuses[0].candidateCount,16);
 const second=await career.collect([providerId],'분석',{profile:{...profile,rankingQuery:'Python pandas'}});assert.equal(calls,1);assert.ok(second.statuses[0].cacheHit);assert.ok(second.documents.every(d=>d.url.includes('/python/')));assert.ok(!JSON.stringify(contexts[0]).includes('PRIVATE'));assert.ok(!JSON.stringify(contexts[0]).includes('SECRET'));
});
test('independent APIs have bounded concurrency, unused routes are skipped and partial failures survive',async()=>{
 let active=0,maxActive=0,unused=0;
 const task=(id,fail=false)=>({id,allowedHosts:['jobs.example'],capabilities:['jobs'],async search(){active++;maxActive=Math.max(maxActive,active);await new Promise(ok=>setTimeout(ok,12));active--;if(fail)throw Error('failed');return[{title:id,text:'R 회귀분석',url:'https://jobs.example/'+id}];}});
 const adapter=createFederatedAdapter([task('a'),task('b',true),task('c'),{id:'qualifications',capabilities:['qualifications'],search:async()=>{unused++;return[];}}],{concurrency:2,timeoutMs:1000});
 const result=await adapter.search('R',{apiKinds:['jobs']});assert.equal(maxActive,2);assert.equal(unused,0);assert.equal(result.records.length,2);assert.equal(result.warnings.length,1);assert.equal(result.taskTimings.length,3);
});
test('API deadline aborts the task instead of waiting indefinitely',async()=>{
 let aborted=false;
 const adapter=createFederatedAdapter([{id:'slow',allowedHosts:['jobs.example'],search:async(query,{signal})=>new Promise((ok,no)=>{signal.addEventListener('abort',()=>{aborted=true;no(Error('aborted'));},{once:true});})}],{timeoutMs:20});
 const result=await adapter.search('R');assert.ok(aborted);assert.equal(result.records.length,0);assert.equal(result.warnings.length,1);
});
test('extracted text persists across cache instances and invalidates on content signature change',async t=>{
 const dir=await testDirectory(t,'text-cache-unit');let loaded=0,extracted=0;
 const load=async()=>{loaded++;return Buffer.from('R 과제 안내');},extract=async()=>{extracted++;const chunks=[{page:1,text:'R 과제 안내'}];chunks.truncated=true;return chunks;};
 const first=await new TextExtractionCache(dir).get('hash-a','안내.pdf',load,extract);assert.equal(first.hit,false);
 const second=await new TextExtractionCache(dir).get('hash-a','안내.pdf',load,extract);assert.equal(second.hit,true);assert.ok(second.chunks.truncated);assert.equal(loaded,1);assert.equal(extracted,1);
 await new TextExtractionCache(dir).get('hash-b','안내.pdf',load,extract);assert.equal(extracted,2);
});
test('career-only pipeline uses no extra model calls, honors assignment and reuses extraction; plain chat skips it',async t=>{
 const dir=await testDirectory(t,'pipeline-unit'),bytes=Buffer.from('test PDF contents'),hash=hashBytes(bytes);await writeFile(resolve(dir,hash),bytes);
 const pool={query:async(sql,params)=>{assert.equal(params[0],'student-a');return {rows:[{path:'과제안내.pdf',hash,bytes:bytes.length}]};}};
 let extracted=0,modelCalls=0,careerCalls=0,payload;
 const career={collect:async(ids,query,{profile})=>{careerCalls++;assert.ok(profile.skills.includes('R'));assert.ok(!query.includes('학번123'));return{documents:[],statuses:[{id:providerId,name:'정부 취업정보',state:'unavailable',message:'연결 대기'}]};}};
 const service=new AssistantService(pool,null,{OLLAMA_BASE_URL:'http://localhost:11434'},dir,{careerService:career,extract:async()=>{extracted++;return[{page:1,text:'반드시 RStudio로 다중회귀를 구현합니다. 제출 마감 금요일.'}];},fetchImpl:async(url,options)=>{modelCalls++;payload=JSON.parse(options.body);return new Response(JSON.stringify({response:'답변',load_duration:2000000}));}});
 await service.ask('student-a','과제 요약');assert.equal(careerCalls,0);assert.ok(!payload.prompt.includes('과제 안내 본문'));
 const first=await service.ask('student-a','!취업정보 학번123 취업을 위한 과제 보완',{careerQuery:'데이터 분석',assignmentPath:'과제안내.pdf'});assert.equal(first.textCacheHits,0);assert.equal(first.timings.modelLoadMs,2);assert.match(payload.prompt,/반드시 RStudio/);
 const second=await service.ask('student-a','!취업정보 학번123 취업을 위한 과제 보완',{careerQuery:'데이터 분석',assignmentPath:'과제안내.pdf'});assert.equal(second.textCacheHits,1);assert.equal(extracted,2);assert.equal(modelCalls,3);assert.equal(careerCalls,2);
 assert.equal(second.careerProfile.answerMode,'company-info');
 const attached=await service.ask('student-a','!취업정보 취업을 위한 과제 보완',{careerQuery:'데이터 분석',assignmentUpload:{name:'과제안내.pdf',data:Buffer.from('%PDF-test').toString('base64')}});
 assert.equal(attached.careerProfile.answerMode,'assignment-advice');
});
