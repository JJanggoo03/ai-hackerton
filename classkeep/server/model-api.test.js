import test from 'node:test';
import assert from 'node:assert/strict';
import {modelSettings,modelPayload,modelText} from './model-api.js';
import {planCompanies} from './company-plan.js';
import {AssistantService} from './assistant.js';
import {openTeamSession} from './team-career-client.js';
test('root and endpoint settings resolve exactly one API path and preserve native generation',()=>{
 assert.equal(modelSettings({OLLAMA_BASE_URL:'http://model:11434'}).url.href,'http://model:11434/api/generate');
 assert.equal(modelSettings({OLLAMA_BASE_URL:'http://team:8000/api/chat'}).url.href,'http://team:8000/api/chat');
 assert.equal(modelSettings({OLLAMA_BASE_URL:'http://team:8000',OLLAMA_API_STYLE:'chat'}).url.href,'http://team:8000/api/chat');
 assert.throws(()=>modelSettings({OLLAMA_BASE_URL:'http://team',OLLAMA_API_STYLE:'bad'}));
});
test('chat conversion preserves source instructions, JSON mode and options; reply format is explicit',()=>{
 const settings=modelSettings({OLLAMA_BASE_URL:'http://team:8000',OLLAMA_API_STYLE:'chat',OLLAMA_GATEWAY_TASK:'classkeep-study'});
 const payload=modelPayload(settings,{model:settings.model,system:'SOURCE_RULES',prompt:'PRIVATE_MATERIAL',format:'json',stream:false,options:{num_ctx:8192}});
 assert.equal(payload.messages[0].content,'SOURCE_RULES');assert.equal(payload.messages[1].content,'PRIVATE_MATERIAL');assert.equal(payload.format,'json');assert.equal(payload.task,'classkeep-study');assert.ok(!('prompt' in payload));
 assert.equal(modelText(settings,{message:{content:'Answer'},classkeep_study_version:1}),'Answer');
 assert.throws(()=>modelText(settings,{message:{content:'Lost source instructions'}}),/교체/);
});
test('chat model supports both structured company planning and long document answers',async()=>{
 const config={OLLAMA_BASE_URL:'http://team:8000',OLLAMA_API_STYLE:'chat',OLLAMA_GATEWAY_TASK:'classkeep-study',OLLAMA_MODEL:'qwen2.5:7b'};
 let received;
 const fetchImpl=async(u,o)=>{received=JSON.parse(o.body);assert.equal(String(u),'http://team:8000/api/chat');return new Response(JSON.stringify({classkeep_study_version:1,message:{content:received.format==='json'?JSON.stringify({mode:'explicit',companies:[{name:'삼성 전자',reason:'지정'}]}):'자료 답변 [1]'}}));};
 const plan=await planCompanies({settings:modelSettings(config),fetchImpl,question:'삼성 전자 과제',target:'',profile:{skills:[],constraints:[]},excerpts:[]});assert.equal(plan.companies[0].name,'삼성전자');
 const service=new AssistantService(null,null,config,'data/model-test',{fetchImpl});service.collect=async()=>({documents:[{origin:'내 보관함',path:'과제.txt',chunks:[{text:'자료 '.repeat(1000)}]}],warnings:[],readCount:1,cacheHits:0,discovered:1});
 const r=await service.ask('test','자료를 요약해줘');assert.equal(r.answer,'자료 답변 [1]');assert.ok(received.messages.at(-1).content.length>2000);assert.match(received.messages[0].content,/이모티콘/);
});
test('public team access is explicit and never attempts the removed login route',async()=>{
 const paths=[];const s=await openTeamSession({CAREER_TEAM_BASE_URL:'http://team:8000',CAREER_TEAM_AUTH_MODE:'public'},{fetchImpl:async(u,o)=>{paths.push(new URL(u).pathname);assert.equal(o.headers['X-CSRF-Token'],'');return new Response(JSON.stringify({schema_version:1,records:[]}));}});
 assert.equal((await s.references('삼성전자')).schema_version,1);assert.deepEqual(paths,['/api/career/references']);
});
