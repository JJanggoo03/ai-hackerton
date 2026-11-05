import {openTeamSession} from './team-career-client.js';
import {discoveryLinks,createCompanyReader,companyPageUrl} from './company-web-reader.js';
import {normalizeCompanyName} from './company-plan.js';
const identity=s=>normalizeCompanyName(s).toLowerCase().replace(/[^a-z0-9가-힣]/g,'');
export function mapTeamReferences(data,company){
 const records=(data.records||[]).slice(0,8).filter(r=>r&&typeof r.text==='string'&&r.text.trim()&&typeof r.title==='string'&&companyPageUrl(r.url)&&r.retrieval_method==='crawler-extract'&&identity(String(r.company||''))===identity(company)).map(r=>({title:r.title.slice(0,300),url:r.url,text:r.text.slice(0,6000),company:r.company,kind:['company-profile','applicant-statistics','applicant-experience','interview-experience'].includes(r.kind)?r.kind:'company-reference'}));
 const verified=new Set(records.map(r=>r.url));
 const links=(Array.isArray(data.discovery_links)?data.discovery_links:[]).slice(0,16).flatMap(l=>l&&typeof l.url==='string'?discoveryLinks(l.url):[]).map(l=>({url:l.url,company,verified:verified.has(l.url),type:l.type==='search'?'search':'company'}));
 for(const r of records)if(!links.some(l=>l.url===r.url))links.push({url:r.url,company,verified:true,type:'company'});
 const warnings=(Array.isArray(data.warnings)?data.warnings:[]).slice(0,12).map(w=>String(w).slice(0,240));
 if((data.records||[]).length&&!records.length)warnings.push(company+': 반환된 본문의 기업명·출처 형식을 확인하지 못했습니다.');
 return {records,links,warnings};
}
export function createTeamCareerProvider(config,{fetchImpl=fetch,reader=createCompanyReader({fetchImpl})}={}){
 if(!config.CAREER_TEAM_BASE_URL||(config.CAREER_TEAM_AUTH_MODE!=='public'&&!config.CAREER_TEAM_PASSWORD))return null;
 return {enabled:true,needsCompanyPlan:true,name:'잡코리아 기업 웹 탐색',description:'자료로 기업 선정 → 친구 서버에서 링크 탐색 → 공개 본문 확인',status:'기업 웹 탐색 연결 설정됨',allowedHosts:['www.jobkorea.co.kr'],async search(query,{companyPlan,signal}={}){
  const records=[],warnings=[],links=[];
  const companies=companyPlan?.companies||[];
  if(!companies.length)return {records,warnings:['기업을 확정하지 못했습니다. 목표 기업명을 입력하거나 자료를 더 구체적으로 선택해주세요.'],discoveryLinks:links};
  const session=await openTeamSession(config,{fetchImpl,signal});
  await Promise.all(companies.slice(0,2).map(async planned=>{
   const company=normalizeCompanyName(planned.name);if(!company)return;
   try{
    const raw=await session.references(company);
    if(raw){const mapped=mapTeamReferences(raw,company);records.push(...mapped.records);warnings.push(...mapped.warnings);links.push(...mapped.links);return;}
    warnings.push(`${company}: 친구 서버가 이전 버전입니다. Python 교체 파일을 적용하면 원문을 직접 받을 수 있습니다.`);
    let found=discoveryLinks(await session.discover(company));
    // Known gateway syntax: a short name + supported lookup keyword, never the full question.
    if(!found.some(l=>l.type==='company'))found=[...found,...discoveryLinks(await session.discover(company+' 합격스펙'))];
    if(!found.length)found=[{url:'https://www.jobkorea.co.kr/Search/?stext='+encodeURIComponent(company),type:'search'}];
    links.push(...found.map(l=>({...l,company,verified:false})));
    const root=found.find(l=>l.type==='company');
    if(!root){warnings.push(`${company}: 기업 페이지를 찾지 못했습니다. 탐색 링크를 확인해주세요.`);return;}
    const id=new URL(root.url).pathname.match(/\/company\/(\d+)/i)[1];
    // URLs are candidates until the reader succeeds. AI-generated summaries are never evidence.
    const pages=[`https://www.jobkorea.co.kr/company/${id}`,`https://www.jobkorea.co.kr/company/${id}/PassAssay`,`https://www.jobkorea.co.kr/company/${id}/Review`];
    let restricted=false;
    for(const url of pages){
     if(signal?.aborted)throw signal.reason;
     if(restricted){links.push({url,company,type:'company',verified:false});continue;}
     try{const record=await reader.read(url,company,signal);records.push(record);links.push({url:record.url,company,type:'company',verified:true});}
     catch(e){if(signal?.aborted)throw e;warnings.push(`${company}: ${new URL(url).pathname} — ${e.message}`);links.push({url,company,type:'company',verified:false});if(/제한|접속 확인/.test(e.message))restricted=true;}
    }
   }catch(e){if(signal?.aborted)throw e;warnings.push(`${company}: 기업 탐색 서버 요청에 실패했습니다. 서버 실행·인증·연결을 확인해주세요.`);}
  }));
  return {records,warnings,discoveryLinks:[...new Map(links.map(l=>[l.url,l])).values()]};
 }};
}
