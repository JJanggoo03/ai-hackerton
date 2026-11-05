import {testDirectory} from './test-helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCompanyName,planCompanies} from './company-plan.js';
import {companyPageUrl,discoveryLinks,robotsAllows,extractCompanyPage,createCompanyReader} from './company-web-reader.js';
import {createTeamCareerProvider,mapTeamReferences} from './team-career-provider.js';
import {CareerService} from './career.js';
import {AssistantService} from './assistant.js';
const config={CAREER_TEAM_BASE_URL:'http://team.example:8000',CAREER_TEAM_PASSWORD:'test-password'};
const profile={companyPlan:{mode:'explicit',companies:[{name:'삼성 전자',reason:'PRIVATE_REASON'}]},skills:['Python'],question:'PRIVATE_QUESTION',assignmentText:'PRIVATE_NOTES'};
const csrf='<meta name="csrf-token" content="test-csrf">';
function gateway(reply,requests=[]){return async(url,options={})=>{
 const path=new URL(url).pathname;requests.push({url:String(url),path,...options});
 if(path==='/')return new Response(csrf,{headers:{'Set-Cookie':'session=isolated; HttpOnly'}});
 if(path==='/login'){assert.equal(new URLSearchParams(options.body).get('password'),'test-password');return new Response(null,{status:302,headers:{Location:'/'}});}
 if(path==='/api/chat')return new Response(JSON.stringify({reply}));
 if(path==='/api/career/references')return new Response(null,{status:404});
 throw Error('Unexpected endpoint');
};}
test('company names normalize Korean whitespace and legal affixes without swallowing an English word boundary',()=>{
 assert.equal(normalizeCompanyName('  (주) 삼성 전자  '),'삼성전자');
 assert.equal(normalizeCompanyName('주식회사 작은 회사'),'작은회사');
 assert.equal(normalizeCompanyName('Acme   Labs'),'Acme Labs');
 assert.equal(normalizeCompanyName('http://localhost'),'');
});
test('company planner supports explicit names and material-based SMEs without querying a fixed catalog',async()=>{
 for(const mode of ['explicit','recommended']){
  let sent;
  const result=await planCompanies({settings:{url:'http://model.example/api/generate',model:'test'},question:'작은 회사를 위한 과제',target:'',profile:{skills:['Python'],constraints:[]},excerpts:[{text:'자료의 과제 조건'}],fetchImpl:async(u,o)=>{sent=JSON.parse(o.body);return new Response(JSON.stringify({response:JSON.stringify({mode,companies:[{name:'작은 회사',reason:'자료 관련'}]})}));}});
  assert.equal(result.companies[0].name,'작은회사');assert.equal(result.mode,mode);assert.match(sent.prompt,/자료의 과제 조건/);
 }
});
test('only approved public company pages and search navigation links survive remote AI output',()=>{
 const links=discoveryLinks('[기업](https://www.jobkorea.co.kr/Company/123/) https://www.jobkorea.co.kr/Search/?stext=test http://127.0.0.1:8000/ https://www.jobkorea.co.kr.evil.example/company/123 https://www.jobkorea.co.kr/company/123?token=SECRET');
 assert.equal(links.length,2);assert.equal(links[0].type,'company');
 assert.equal(companyPageUrl('https://www.jobkorea.co.kr/NET/login'),null);
 assert.equal(companyPageUrl('https://www.jobkorea.co.kr/company/123/../../login'),null);
});
test('robots rules and title identity checks exclude disallowed or wrong companies',()=>{
 assert.equal(robotsAllows('User-agent: *\nDisallow: /company/\nAllow: /company/123','/company/456'),false);
 assert.equal(robotsAllows('User-agent: *\nDisallow: /company/\nAllow: /company/123','/company/123'),true);
 const html='<title>다른기업 기업정보</title><table class="table-basic-infomation-primary"><tr><td>공개 사업 정보</td></tr></table>';
 assert.throws(()=>extractCompanyPage(html,'https://www.jobkorea.co.kr/company/123','삼성전자'),/기업명/);
 assert.throws(()=>extractCompanyPage(html.replace('다른기업','삼성전자서비스'),'https://www.jobkorea.co.kr/company/123','삼성전자'),/기업명/);
});
test('reader never follows a confirmation redirect or sends a team cookie to the public site',async()=>{
 const requested=[];
 const reader=createCompanyReader({fetchImpl:async(u,o)=>{requested.push(String(u));assert.ok(!o.headers.Cookie);if(String(u).endsWith('/robots.txt'))return new Response('User-agent: *\nDisallow: /login/');return new Response(null,{status:302,headers:{Location:'/NET/jkWebModule/jkConfirm.aspx'}});}});
 await assert.rejects(reader.read('https://www.jobkorea.co.kr/company/123','삼성전자'),/접속 확인/);
 assert.equal(requested.length,2);assert.ok(!requested.some(u=>u.includes('jkConfirm')));
});
test('the gateway receives only a normalized name; remote AI prose cannot become a reference',async()=>{
 const requests=[],adapter=createTeamCareerProvider(config,{fetchImpl:gateway('평균 학점 9.99 https://www.jobkorea.co.kr/Company/123/',requests),reader:{read:async(url,company)=>({title:'삼성전자 기업정보',company,url,text:'실제 읽은 삼성전자 소프트웨어 사업',kind:'company-profile'})}});
 const result=await adapter.search('PRIVATE_QUERY',{...profile,companyPlan:profile.companyPlan});
 assert.equal(result.records.length,3);assert.ok(!JSON.stringify(result.records).includes('9.99'));
 const chat=requests.find(r=>r.path==='/api/chat');assert.deepEqual(JSON.parse(chat.body),{message:'삼성전자'});
 assert.ok(!JSON.stringify(requests).includes('PRIVATE_'));assert.ok(!requests.some(r=>r.path==='/api/history'));
});
test('link-only discovery and blocked pages stay visible but never count as read evidence',async()=>{
 let reads=0;
 const adapter=createTeamCareerProvider(config,{fetchImpl:gateway('https://www.jobkorea.co.kr/company/123'),reader:{read:async()=>{reads++;throw Error('접속 확인 또는 제한 화면으로 이동했습니다.');}}});
 const career=new CareerService({},{providers:{'government-employment':adapter}});
 const result=await career.collect(['government-employment'],'삼성전자',{profile});
 assert.equal(reads,1);assert.equal(result.documents.length,0);assert.equal(result.statuses[0].state,'error');assert.ok(result.statuses[0].discoveryLinks.length>=3);assert.ok(result.statuses[0].discoveryLinks.every(l=>!l.verified));
 const searchOnly=createTeamCareerProvider(config,{fetchImpl:gateway('못 찾았습니다. https://www.jobkorea.co.kr/Search/?stext=test'),reader:{read(){throw Error('Must not read search results');}}});
 const empty=await searchOnly.search('',{companyPlan:profile.companyPlan});assert.equal(empty.records.length,0);assert.equal(empty.discoveryLinks[0].type,'search');
});
test('unresolved company plans make no remote request and company-specific caches cannot mix',async()=>{
 let requests=0;
 const adapter=createTeamCareerProvider(config,{fetchImpl:async()=>{requests++;throw Error('Must not call');}});
 assert.equal((await adapter.search('',{companyPlan:{companies:[]}})).records.length,0);assert.equal(requests,0);
 let calls=0;
 const career=new CareerService({},{providers:{'government-employment':{enabled:true,needsCompanyPlan:true,allowedHosts:['www.jobkorea.co.kr'],async search(q,c){calls++;return [{title:c.companyPlan.companies[0].name,text:'삼성전자 현대자동차 기업정보',url:'https://www.jobkorea.co.kr/company/'+calls}];}}}});
 await career.collect(['government-employment'],'same',{profile});
 await career.collect(['government-employment'],'same',{profile:{...profile,companyPlan:{companies:[{name:'현대자동차'}]}}});assert.equal(calls,2);
});
test('end-to-end assistant selects a company from materials, reads source text, preserves links and keeps normal chat unchanged',async t=>{
 const requests=[],adapter=createTeamCareerProvider(config,{fetchImpl:gateway('평균 학점 9.99 https://www.jobkorea.co.kr/company/123',requests),reader:{read:async(url,company)=>({title:company+' Python 프로젝트',text:'공개 본문: Python 소프트웨어 프로젝트 경험을 설명한 지원자 사례입니다.',company,url,kind:'applicant-experience'})}});
 const career=new CareerService({},{providers:{'government-employment':adapter}});
 let plans=0,answers=0,last;
 const service=new AssistantService({},null,{OLLAMA_BASE_URL:'http://model.example'},await testDirectory(t,'web-pipeline'),{careerService:career,fetchImpl:async(u,o)=>{
  const p=JSON.parse(o.body);if(p.format==='json'){plans++;assert.match(p.prompt,/PRIVATE_MATERIAL/);return new Response(JSON.stringify({response:JSON.stringify({mode:'recommended',companies:[{name:'작은 회사',reason:'Python 과제와 관련'}]})}));}
  answers++;last=p;return new Response(JSON.stringify({response:'자료 기반 답변 [1]'}));
 }});
 service.collect=async()=>({documents:[{origin:'내 보관함',path:'안내.pdf',chunks:[{text:'PRIVATE_MATERIAL Python 과제 필수 구현'}]}],warnings:[],readCount:1,cacheHits:0,discovered:1});
 const r=await service.ask('student','!잡코리아 이 과제를 취업 관점에서 보완해줘');
 assert.equal(plans,1);assert.equal(answers,1);assert.equal(r.careerProfile.companyPlan.mode,'recommended');assert.ok(r.sources.some(s=>s.sourceType==='career'));assert.ok(r.careerStatus[0].discoveryLinks.length);assert.match(last.prompt,/공개 본문/);assert.ok(!last.prompt.includes('9.99'));assert.ok(!JSON.stringify(requests).includes('PRIVATE_MATERIAL'));assert.equal(JSON.parse(requests.find(r=>r.path==='/api/chat').body).message,'작은회사');
 await service.ask('student','이 과제만 요약해줘');assert.equal(plans,1);assert.equal(answers,2);
});
test('structured crawler text replaces gateway prose and never triggers a second local crawl',async()=>{
 let chatCalls=0,rawCalls=0;
 const adapter=createTeamCareerProvider(config,{fetchImpl:async(u,o)=>{
  if(new URL(u).pathname==='/api/career/references'){
   rawCalls++;assert.deepEqual(JSON.parse(o.body),{company_name:'삼성전자'});
   return new Response(JSON.stringify({schema_version:1,records:[{company:'삼성전자㈜',title:'삼성전자 기업정보',url:'https://www.jobkorea.co.kr/company/123',text:'실제 크롤러가 읽은 소프트웨어 사업 본문',kind:'company-profile',retrieval_method:'crawler-extract'}],warnings:['자소서 페이지는 읽지 못함'],discovery_links:[{url:'https://www.jobkorea.co.kr/company/123/Review',verified:true}]}));
  }
  if(new URL(u).pathname==='/api/chat')chatCalls++;
  return gateway('Must not use this reply')(u,o);
 },reader:{read(){throw Error('Must not fetch locally');}}});
 const result=await adapter.search('',{companyPlan:profile.companyPlan});assert.equal(rawCalls,1);assert.equal(chatCalls,0);assert.equal(result.records.length,1);assert.match(result.records[0].text,/실제 크롤러/);assert.equal(result.discoveryLinks.find(l=>l.url.endsWith('/Review')).verified,false);
 const excluded=mapTeamReferences({records:[{company:'삼성전자서비스',url:'https://www.jobkorea.co.kr/company/123',text:'다른 기업',title:'다른 기업',retrieval_method:'crawler-extract'},{company:'삼성전자',url:'http://localhost/admin',title:'비공개',text:'금지',retrieval_method:'crawler-extract'}]},'삼성전자');assert.equal(excluded.records.length,0);
});
