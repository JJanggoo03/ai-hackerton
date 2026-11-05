// Offline fixture benchmark. No government API credentials, user files or AI requests.
import {buildCareerProfile} from '../server/career-ranking.js';
import {CareerService} from '../server/career.js';
import {createFederatedAdapter} from '../server/career-federation.js';
let calls=0;
const adapter=createFederatedAdapter([{id:'fixture-jobs',label:'가상 채용공고',capabilities:['jobs'],allowedHosts:['fixture.example'],async search(){calls++;await new Promise(ok=>setTimeout(ok,60));return [...Array.from({length:10},(_,i)=>({title:'[가상] 매장 판매직 '+i,url:'https://fixture.example/sales/'+i,text:'매장 판매 계산 및 고객 응대'})),...Array.from({length:10},(_,i)=>({title:'[가상] 데이터 분석가 '+i,url:'https://fixture.example/data/'+i,text:'RStudio 다중회귀 통계 분석과 잔차 평가 역량'}))];}}]);
const career=new CareerService({},{providers:{'government-employment':adapter}});
const profile=buildCareerProfile({target:'데이터 분석 신입',question:'다중회귀 과제 보완',assignmentPath:'과제안내.pdf',documents:[{path:'과제안내.pdf',origin:'내 보관함',chunks:[{page:1,text:'반드시 RStudio로 다중회귀를 구현하고 잔차 분석을 제출하세요.'}]}]});
console.log('가상 응답만 사용하는 오프라인 검사입니다. 실제 API/AI 속도 측정이 아닙니다.');console.log('검색어:',profile.searchQuery);
for(const name of ['첫 조회','반복 조회']){
 const start=performance.now(),result=await career.collect(['government-employment'],profile.searchQuery,{profile}),status=result.statuses[0];
 console.log(JSON.stringify({test:name,elapsedMs:Math.round(performance.now()-start),candidateCount:status.candidateCount,selectedCount:status.count,cacheHit:status.cacheHit,apiCallsTotal:calls,selected:result.documents.map(d=>d.path)}));
}
