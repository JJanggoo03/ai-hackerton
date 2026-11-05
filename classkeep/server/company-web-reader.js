import iconv from 'iconv-lite';
import {boundedBody} from './team-career-client.js';
const ORIGIN='https://www.jobkorea.co.kr';
const AGENT='Classkeep-Company-Search/1.0';
export function companyPageUrl(value){
 try{const u=new URL(value);if(u.origin!==ORIGIN||u.username||u.password||u.search||u.hash||!/^\/company\/\d{1,20}(?:\/(?:Info|PassAssay|Review|PassAvgSpec))?\/?$/i.test(u.pathname))return null;return u.href;}catch{return null;}
}
export function discoveryLinks(reply){
 const urls=[...reply.matchAll(/https?:\/\/[^\s<>"'\[\]]+/g)].map(m=>m[0].replace(/[),.;!?，。]+$/u,''));
 return [...new Set(urls)].map(value=>{try{const u=new URL(value);if(u.origin!==ORIGIN||u.username||u.password)return null;if(companyPageUrl(value))return {url:u.href,type:'company'};if(/^\/Search\/?$/i.test(u.pathname)&&[...u.searchParams.keys()].every(k=>k==='stext'))return {url:u.href,type:'search'};return null;}catch{return null;}}).filter(Boolean).slice(0,12);
}
export function robotsAllows(body,path){
 const groups=[];let agents=[],rules=[],started=false;
 const flush=()=>{if(agents.length)groups.push({agents,rules});agents=[];rules=[];started=false;};
 for(const raw of body.split(/\r?\n/)){const line=raw.split('#')[0].trim(),i=line.indexOf(':');if(i<0)continue;const key=line.slice(0,i).toLowerCase(),value=line.slice(i+1).trim();if(key==='user-agent'){if(started)flush();agents.push(value.toLowerCase());}else if(['allow','disallow'].includes(key)&&agents.length){started=true;if(value)rules.push({allow:key==='allow',value});}}
 flush();const exact=groups.filter(g=>g.agents.some(a=>a!=='*'&&AGENT.toLowerCase().includes(a))),selected=exact.length?exact:groups.filter(g=>g.agents.includes('*'));
 const matched=selected.flatMap(g=>g.rules).filter(r=>new RegExp('^'+r.value.replace(/[.+?^{}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*')).test(path)).sort((a,b)=>b.value.length-a.value.length||Number(b.allow)-Number(a.allow));
 return !matched.length||matched[0].allow;
}
function clean(html){return html.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style|noscript|header|footer|nav|form)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<\/(?:p|div|li|tr|h[1-6])>|<br\s*\/?>/gi,'\n').replace(/<[^>]*>/g,' ').replace(/&#(\d+);/g,(_,n)=>Number(n)<=0x10ffff?String.fromCodePoint(Number(n)):' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/[ \t]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();}
const identity=s=>s.normalize('NFKC').toLowerCase().replace(/주식회사|유한회사|\(주\)|\(유\)|[\s·.&]/g,'');
export function extractCompanyPage(html,url,company){
 const title=clean(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]||'');
 const name=identity(company);
 const observed=title.split(/\s+\d{4}년 기업정보|\s+기업정보|\s+합격자소서|\s+인적성|\s+면접|\s+합격\s*스펙/)[0];
 if(!/기업정보|합격|후기|자소서/.test(title)||identity(observed)!==name)throw Error('기업명 일치 여부를 확인하지 못했습니다.');
 const u=new URL(url),root=/^\/company\/\d+\/?$/i.test(u.pathname)||/\/Info\/?$/i.test(u.pathname);
 let content;
 if(root)content=html.match(/<table\b[^>]*class=["'][^"']*table-basic-infomation-primary[^"']*["'][^>]*>[\s\S]*?<\/table>/i)?.[0];
 else{
  content=html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1]||html;
  content=clean(content);
  const markers=/PassAssay/i.test(u.pathname)?['합격 자기소개서 리스트','합격자소서 하위메뉴']:/Review/i.test(u.pathname)?['인적성·면접·합격 후기','인적성 후기']:['합격스펙','합격 스펙'];
  for(const marker of markers){const index=content.indexOf(marker);if(index>=0){content=content.slice(index);break;}}
 }
 if(!content)throw Error('공개 본문을 찾지 못했습니다.');
 content=clean(content).slice(0,18000);
 if(content.length<60||/로그인 후.{0,20}(?:확인|이용|열람)/.test(content)&&content.length<200)throw Error('읽을 수 있는 공개 본문이 부족합니다.');
 return {title,text:`대상 기업: ${company}\n자료 구분: ${root?'기업 기본정보':'합격자·지원자 사례 또는 통계이며 공식 채용요건이 아님'}\n${content}`,url:u.href,company,kind:root?'company-profile':'applicant-experience'};
}
export function createCompanyReader({fetchImpl=fetch}={}){
 let robots=null;
 async function read(url,signal){
  // Redirects are checked before following: never fetch login, confirmation or arbitrary hosts.
  let current=url;
  for(let i=0;i<3;i++){
   const r=await fetchImpl(current,{headers:{'User-Agent':AGENT},redirect:'manual',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)});
   if([301,302,303,307,308].includes(r.status)){const location=r.headers.get('location');await r.body?.cancel();const next=new URL(location,current).href;if(!companyPageUrl(next)||!robotsAllows(robots.body,new URL(next).pathname))throw Error('접속 확인 또는 제한 화면으로 이동했습니다.');current=next;continue;}
   if(!r.ok){await r.body?.cancel();throw Error('페이지 조회 실패');}
   const bytes=await boundedBody(r,2*1024*1024),charset=r.headers.get('content-type')?.match(/charset=([^;\s]+)/i)?.[1]||'utf-8';
   if(!/text\/html/i.test(r.headers.get('content-type')||''))throw Error('HTML 페이지가 아닙니다.');
   return {html:iconv.decode(bytes,iconv.encodingExists(charset)?charset:'utf8'),url:current};
  }throw Error('페이지 이동 횟수 초과');
 }
 return {async read(url,company,signal){
  if(!companyPageUrl(url))throw Error('허용된 기업 페이지가 아닙니다.');
  if(!robots||robots.until<Date.now()){
   const r=await fetchImpl(ORIGIN+'/robots.txt',{headers:{'User-Agent':AGENT},redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(8000)]):AbortSignal.timeout(8000)});
   if(!r.ok){await r.body?.cancel();throw Error('자동 접근 규칙을 확인하지 못했습니다.');}
   const body=(await boundedBody(r,128000)).toString('utf8');if(!/^\s*User-agent\s*:/im.test(body))throw Error('자동 접근 규칙 형식이 올바르지 않습니다.');
   robots={body,until:Date.now()+10*60000};
  }
  if(!robotsAllows(robots.body,new URL(url).pathname))throw Error('자동 접근이 제한된 페이지입니다.');
  const result=await read(url,signal);return extractCompanyPage(result.html,result.url,company);
 }};
}
