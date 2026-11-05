import test from 'node:test';
import assert from 'node:assert/strict';
import {careerIntent,careerAnswerRules,rankCareerEvidence,careerExcerpts,careerFacts,cleanCitationRuns,finalizeCareerAnswer} from './career-answer.js';
import {AssistantService} from './assistant.js';

test('direct company questions, assignment advice and actual draft requests use distinct modes',()=>{
 for(const q of ['삼성전자','삼성전자 설명해줘','삼성전자 합격 스펙','삼성전자 취업 가능성을 알려줘','깃허브와 과제를 보고 삼성전자에 들어갈 수 있을까','삼성전자 자소서 사례'])assert.equal(careerIntent(q).mode,'company-info');
 for(const q of ['이 과제를 취업에 유리하게 보완해줘','과제를 만드는 방법 알려줘','과제 만들어주지 말고 보완점을 추천해줘'])assert.equal(careerIntent(q).mode,'assignment-advice');
 for(const q of ['이 조건대로 과제를 만들어줘','자료를 기반으로 자소서를 써줘','과제 보고서를 작성해 주세요','R 코드를 짜줘','이걸 만들어줘'])assert.equal(careerIntent(q).mode,'assignment-create');
 assert.match(careerAnswerRules(careerIntent('합격 가능성')),/합격률·보장·합격선은 추정하지/);
 assert.match(careerAnswerRules(careerIntent('과제 만들어줘')),/실제 초안에 넣은 요소/);
});
test('statistics and essays survive document ranking and a long review cannot consume their budget',()=>{
 const records=[{company:'삼성전자',kind:'interview-experience',title:'삼성전자 R 회귀분석',text:'R 회귀분석 '.repeat(700),url:'https://example.com/review'}, {company:'삼성전자',kind:'applicant-statistics',title:'삼성전자 통계',text:'학점: 3.72/4.5 / 보유율 86% 보유',url:'https://example.com/spec'}, {company:'삼성전자',kind:'applicant-experience',title:'삼성전자 자소서',text:'소프트웨어개발자 프로젝트',url:'https://example.com/essay'}];
 const ranked=rankCareerEvidence(records,'삼성전자 R 회귀분석',{wantsStatistics:true});assert.equal(ranked[0].kind,'applicant-statistics');assert.equal(ranked[1].kind,'applicant-experience');
 const pieces=careerExcerpts(ranked.map(r=>({...r,path:r.title,chunks:[{text:r.text}]})),{wantsStatistics:true});assert.ok(pieces.some(p=>p.kind==='applicant-statistics'));assert.ok(pieces.some(p=>p.kind==='applicant-experience'));
});
test('fact extraction keeps the average, denominator, holder rate and original data date separate',()=>{
 const facts=careerFacts([{id:4,company:'삼성전자',kind:'applicant-statistics',url:'https://example.com/spec',text:'학점: 3.72/4.5 / 보유율 86% 보유\n토익: 833점 / 보유율 44% 보유\nOPIC: IM3 / 보유율 12% 보유\n자격증: 2.2개 / 보유율 54% 보유\n없는항목: 꾸며낸 조건 / 보유율 많음\n통계 갱신일: 2023.12.28'}]);
 assert.equal(facts[0].metrics.length,4);assert.deepEqual(facts[0].metrics[0],{label:'학점',average:'3.72/4.5',holders:'86%'});assert.equal(facts[0].updatedAt,'2023.12.28');assert.equal(facts[0].sourceId,4);assert.ok(!JSON.stringify(facts).includes('이상'));
 assert.deepEqual(careerFacts([{id:1,kind:'applicant-experience',text:'학점: 4.5 / 보유율 100% 보유'}]),[]);
});
test('a company question receives actual statistics despite unrelated local assignment material',async()=>{
 let payload;
 const stats='학점: 3.72/4.5 / 보유율 86% 보유\n자격증: 2.2개 / 보유율 54% 보유\n통계 갱신일: 2023.12.28';
 const service=new AssistantService(null,null,{OLLAMA_BASE_URL:'http://model.example'},'data/intent-test',{careerService:{async collect(ids,q,{profile}){assert.equal(profile.answerMode,'company-info');return {documents:[{path:'삼성전자 통계',company:'삼성전자',url:'https://example.com/spec',sourceType:'career',kind:'applicant-statistics',chunks:[{text:stats}]}],statuses:[]};}},fetchImpl:async(u,o)=>{payload=JSON.parse(o.body);return new Response(JSON.stringify({response:'평균과 보유율 답변'}));}});
 service.collect=async()=>({documents:[{path:'과제.md',origin:'내 보관함',chunks:[{text:'R 회귀분석 '.repeat(600)}]}],warnings:[],readCount:1,cacheHits:0,discovered:1});
 const r=await service.ask('test','!취업정보 삼성전자',{careerQuery:'삼성전자'});
 assert.equal(r.readCount,1);assert.equal(r.includeArchive,true);
 const only=await service.ask('test','!취업정보 내 과제와 비교해줘',{careerOnly:true,careerQuery:'삼성전자',assignmentPath:'이전.pdf'});
 assert.equal(only.readCount,0);assert.equal(only.careerProfile.answerMode,'company-info');assert.equal(only.careerFacts[0].metrics.length,2);
 assert.equal(r.careerFacts[0].metrics[0].average,'3.72/4.5');assert.match(payload.system,/과제 보완 답변으로 바꾸지 말고/);assert.match(payload.prompt,/3\.72\/4\.5/);assert.ok(r.sources.some(s=>s.kind==='applicant-statistics'));
});
test('citation loops collapse and invalid IDs are removed without changing fenced source code',()=>{
 const text='생성한 초안에 추가했습니다 '+('[1] [2] [3] [999] '.repeat(20))+'\n```r\nx[999] <- y[1]\n```';
 const cleaned=cleanCitationRuns(text,3);assert.ok(cleaned.includes('[1] [2] [3]'));assert.equal((cleaned.match(/\[3\]/g)||[]).length,1);assert.ok(cleaned.includes('x[999] <- y[1]'));assert.ok(!cleaned.split('```')[0].includes('[999]'));
 assert.equal(cleanCitationRuns('인덱스 `x[999] [1]` 와 x[1]',1),'인덱스 `x[999] [1]` 와 x[1]');
});
test('completion language is based on actual generated code and does not turn course skills into employer requirements',()=>{
 const answer='```r\nmae <- mean(abs(y-pred))\nrmse <- sqrt(mean((y-pred)^2))\n```\n이 코드는 삼성전자에서 요구하는 R 기술 스킬을 보여줍니다.';
 const final=finalizeCareerAnswer(answer,{mode:'assignment-create'},{companies:[{name:'삼성전자'}]});assert.match(final,/MAE 계산·RMSE 계산을 추가했습니다/);assert.ok(!final.includes('요구하는 R'));assert.ok(final.includes('mae <-'));
 assert.ok(!finalizeCareerAnswer('정보가 부족하여 초안을 작성할 수 없습니다.',{mode:'assignment-create'}).includes('추가했습니다'));
 assert.match(finalizeCareerAnswer('검증 결과를 설명해 보세요.',{mode:'assignment-advice'}),/추가하는 것을 권장드립니다/);
 assert.equal(finalizeCareerAnswer('통계 답변',{mode:'company-info'}),'통계 답변');
});
