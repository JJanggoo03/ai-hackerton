import {CAREER_SITES} from '../dist/career-sites.js';
import {deduplicateRecords} from './career-ranking.js';
import {rankCareerEvidence} from './career-answer.js';
import {createGovernmentProviders} from './government-provider.js';

function publicUrl(value,domains){
 try{const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||[...url.searchParams.keys()].some(k=>/^(servicekey|authkey|access[-_]?key|api[-_]?key|authorization|token)$/i.test(k))||!domains.some(d=>url.hostname===d||url.hostname.endsWith('.'+d)))return null;return url.href;}catch{return null;}
}
export class CareerService{
 constructor(config,{providers=createGovernmentProviders(config)}={}){this.config=config;this.providers=providers;this.cache=new Map();this.pending=new Map();}
 catalog(){return CAREER_SITES.map(site=>{
  const adapter=this.providers[site.id];
  const ready=adapter?.enabled===true&&typeof adapter.search==='function'&&Array.isArray(adapter.allowedHosts)&&adapter.allowedHosts.length>0;
  return {...site,...(ready&&adapter.name?{name:adapter.name,description:adapter.description}:{}),ready,status:ready?(adapter.status||'정부 API 연결 설정됨'):'정부 API 연결 대기 — 서비스 정보 확인 필요'};
 });}
 requiresCompanyPlan(ids){return ids.some(id=>this.providers[id]?.needsCompanyPlan);}
 async candidates(id,query,profile){
  const key=JSON.stringify([id,query,profile?.apiKinds||['jobs'],profile?.skills||[],profile?.companyPlan?.companies?.map(c=>c.name)||[]]);
  const cached=this.cache.get(key);if(cached&&cached.until>Date.now())return {...cached,cacheHit:true};
  if(this.pending.has(key))return {...await this.pending.get(key),cacheHit:true};
  const work=(async()=>{
   const adapter=this.providers[id],controller=new AbortController();let timer;
   const timeout=Math.min(20000,Math.max(1000,Number(this.config.CAREER_LOOKUP_TIMEOUT_MS)||20000));
   try{
    // Only public search criteria leave the server. No notes, filenames, raw question or assignment text.
    const context={apiKinds:profile?.apiKinds||['jobs'],skills:profile?.skills||[],searchTarget:profile?.target||query,limit:10,signal:controller.signal};
    if(adapter.needsCompanyPlan)context.companyPlan=profile?.companyPlan;
    const result=await Promise.race([Promise.resolve().then(()=>adapter.search(query,context)),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('career lookup timeout'));},timeout);})]);
    const raw=Array.isArray(result)?result:result?.records;if(!Array.isArray(raw))throw Error('invalid provider response');
    const warnings=Array.isArray(result.warnings)?result.warnings.slice(0,10).map(w=>String(w).slice(0,200)):[];
    const records=deduplicateRecords(raw.slice(0,100).map(record=>({...record,url:publicUrl(record?.url,adapter.allowedHosts)})).filter(record=>record.url&&typeof record.title==='string'&&typeof record.text==='string'&&record.text.trim()).map(r=>({...r,title:r.title.slice(0,300),text:r.text.slice(0,6000)})));
    const discoveryLinks=Array.isArray(result.discoveryLinks)?result.discoveryLinks.slice(0,24).filter(l=>l&&publicUrl(l.url,adapter.allowedHosts)).map(l=>({url:publicUrl(l.url,adapter.allowedHosts),company:String(l.company||'').slice(0,80),verified:l.verified===true,type:l.type==='search'?'search':'company'})):[];
    const entry={records,warnings,discoveryLinks,taskTimings:Array.isArray(result.taskTimings)?result.taskTimings:[],checkedAt:new Date().toISOString(),until:Date.now()+(warnings.length?5000:10*60000)};
    if(this.cache.size>=100)this.cache.delete(this.cache.keys().next().value);this.cache.set(key,entry);return {...entry,cacheHit:false};
   }finally{clearTimeout(timer);}
  })();this.pending.set(key,work);
  try{return await work;}finally{this.pending.delete(key);}
 }
 async collect(ids,query,{profile}={}){
  const results=await Promise.all(ids.map(async id=>{
   const started=performance.now(),site=this.catalog().find(s=>s.id===id);if(!site)throw Error('unknown career source');
   if(!site.ready)return {documents:[],status:{id,name:site.name,state:'unavailable',message:site.status,count:0,lookupMs:0}};
   try{
    const data=await this.candidates(id,query,profile),lookupMs=Math.round(performance.now()-started),rankStart=performance.now();
    const ranked=rankCareerEvidence(data.records,[profile?.rankingQuery||query,...(profile?.companyPlan?.companies||[]).map(c=>c.name)].join(' '),profile);
    const documents=ranked.map(record=>({path:record.title,origin:site.name,url:record.url,company:record.company,sourceType:'career',site:id,checkedAt:data.checkedAt,kind:record.kind||'government-reference',retrievalScore:record.score,chunks:[{text:record.text.slice(0,3000)}]}));
    const failed=data.warnings.length>0&&!data.records.length;
    return {documents,status:{id,name:site.name,state:documents.length?(data.warnings.length?'partial':'ok'):failed?'error':'empty',message:documents.length?`후보 ${data.records.length}건에서 관련 취업 정보 ${documents.length}건 선택`:failed?'취업 정보 본문을 확인하지 못했습니다.':'관련 검색 결과 없음',count:documents.length,candidateCount:data.records.length,cacheHit:data.cacheHit,checkedAt:data.checkedAt,warnings:data.warnings,discoveryLinks:data.discoveryLinks,lookupMs,rankingMs:Math.round(performance.now()-rankStart),taskTimings:data.taskTimings}};
   }catch{return {documents:[],status:{id,name:site.name,state:'error',message:'취업 API 조회 실패 또는 대기 시간 초과 — 인증·서버 연결을 확인해주세요.',count:0,lookupMs:Math.round(performance.now()-started)}};}
  }));
  return {documents:results.flatMap(r=>r.documents),statuses:results.map(r=>r.status)};
 }
}
