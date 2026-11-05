import test from 'node:test';
import assert from 'node:assert/strict';
import {AssistantService} from './assistant.js';
const config={OLLAMA_BASE_URL:'http://127.0.0.1:8001',OLLAMA_MODEL:'qwen2.5:7b',OLLAMA_API_STYLE:'chat',OLLAMA_GATEWAY_TASK:'classkeep-study',CAREER_TEAM_BASE_URL:'http://127.0.0.1:8001'};
function service(documents=[]){
 const calls=[];let collects=0;
 const assistant=new AssistantService(null,null,config,'data',{careerService:{requiresCompanyPlan(){throw Error('redundant company planning');},collect(){throw Error('redundant external retrieval');}},fetchImpl:async(url,options)=>{
  const payload=JSON.parse(options.body);calls.push(payload);
  return new Response(JSON.stringify({classkeep_study_version:1,message:{content:'조회한 과정 안내입니다. [1]\n\n출처\nhttps://www.work24.go.kr/'},career_state:{user_facts:['학점 3.7']},tool_events:[{name:'search_training',ok:true}],retrieval_mode:'career-tools'}));
 }});
 assistant.collect=async()=>{collects++;return {documents,warnings:[],discovered:documents.length,readCount:documents.length,cacheHits:0};};
 return {assistant,calls,collects:()=>collects};
}
test('integrated training requests call tools gateway once without gov.kr discovery or required target',async()=>{
 const {assistant,calls}=service();
 const result=await assistant.ask('u','!취업정보 내일배움카드 파이썬 강의 추천해줘',{includeArchive:false});
 assert.equal(calls.length,1);assert.equal(calls[0].task,'classkeep-study');
 assert.match(calls[0].messages[0].content,/실제 도구 조회 결과/);
 assert.doesNotMatch(calls[0].messages.at(-1).content,/정부24 크롤링 본문에 있는 제도 정보만/);
 assert.equal(result.retrievalMode,'career-tools');assert.equal(result.toolCalls[0].name,'search_training');
 assert.match(result.answer,/\[1\]/);assert.match(result.answer,/https:\/\/www.work24.go.kr/);
});
test('integrated conversation retains selected archive evidence, target and prior user facts',async()=>{
 const {assistant,calls}=service([{path:'프로젝트.md',origin:'내 보관함',url:'/api/nodes/original?path=test',chunks:[{text:'파이썬 프로젝트를 구현했습니다.'}]}]);
 const memory={messages:[{role:'user',content:'학점 3.7입니다.'}],state:{user_facts:['학점 3.7']}};
 const result=await assistant.ask('u','!취업정보 이것도 비교해줘',{careerQuery:'삼성전자',memory});
 assert.equal(calls.length,1);assert.equal(calls[0].career_target,'삼성전자');assert.deepEqual(calls[0].conversation,memory.messages);assert.deepEqual(calls[0].career_state,memory.state);
 assert.match(calls[0].messages.at(-1).content,/파이썬 프로젝트/);assert.equal(result.sources[0].path,'프로젝트.md');assert.equal(result.readCount,1);
});
test('career-only integrated request avoids archive read and still reaches tool gateway',async()=>{
 const {assistant,calls,collects}=service();
 const result=await assistant.ask('u','!취업정보 합격스펙을 알려줘',{includeArchive:false,careerOnly:true,careerQuery:'삼성전자'});
 assert.equal(collects(),0);assert.equal(result.readCount,0);assert.equal(calls.length,1);
});
