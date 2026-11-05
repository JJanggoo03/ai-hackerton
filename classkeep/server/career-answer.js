import {rankBM25} from './career-ranking.js';

export function careerIntent(question){
 const q=question.normalize('NFKC');
 const stats=/합격\s*스펙|평균\s*스펙|학점|토익|어학|자격증|스펙\s*비교/.test(q);
 const info=stats||/합격\s*(?:가능|확률|조건)|취업\s*(?:가능|정보)|채용\s*(?:조건|정보)|지원\s*자격|자소서\s*(?:예시|사례)|면접\s*(?:질문|후기)|어떤\s*회사|기업\s*정보|(?:입사|취업|들어갈|합격할).{0,12}(?:수\s*있|가능)/.test(q);
 const task=/과제|프로젝트|보고서|코드|프로그램|자소서|자기소개서|발표자료/.test(q);
 const negated=/만들(?:어)?\s*주지\s*말|만들지\s*말|작성하지\s*말|쓰지\s*말/.test(q);
 const creating=(task||!info)&&!negated&&/(?:만들어|작성해|구현해|생성해|완성해|해결해)\s*(?:줘|주세요|주라|줄래)|(?:써|짜)\s*(?:줘|주세요|주라)/.test(q);
 const improving=task&&/보완|개선|추가|수정|고쳐|권장|어떻게|만드는\s*방법|취업.{0,12}(?:도움|유리)/.test(q);
 const mode=creating?'assignment-create':(info&&!improving||!task&&!/자료|필기|파일|보완|개선|권장|이거|이걸|첨부/.test(q))?'company-info':'assignment-advice';
 return {mode,wantsStatistics:mode==='company-info'||stats};
}

export function careerAnswerRules(intent){
 const common=`지원자 표본 평균과 보유율은 서로 다른 값이다. '평균 3.72/4.5, 보유율 86%'를 '86%가 3.72 이상'이라고 바꾸지 않는다. 평균 개수/횟수에 '이상', '필수', '최소'를 붙이지 않는다. 통계 갱신일과 수집일을 구분한다. 자소서는 직무·연도·문항의 요지·경험의 흐름을 요약하고 원문 문장을 길게 복사하지 않는다. 실제 제공된 자료 번호로 인용하고 링크를 만들어내지 않는다.`;
 if(intent.mode==='company-info')return `질문 유형: 기업 취업정보·스펙·가능성 질문. 과제 보완 답변으로 바꾸지 말고 질문한 기업의 수집 정보를 먼저 구체적으로 답한다.\n순서: 1) 수집한 합격자 통계: 학점·어학·자격증·활동의 실제 평균과 보유율을 숫자 그대로 보여준다. 없는 수치는 확인하지 못했다고 말한다. 2) 관련 직무의 자소서 사례: 문항 요지와 경험 구성 요약. 3) 사용자가 합격 가능성을 물었다면 제공한 본인 정보와 확인된 표본의 차이를 설명하고 부족한 본인 정보만 묻는다. 합격률·보장·합격선은 추정하지 않는다. 4) 출처와 자료 시점.\n보관함의 R·회귀분석 경험을 기업의 필수 스펙으로 바꾸지 않는다. 기업 기본정보·지원자 표본·공식 채용요건을 구분하고, 현재 공식 채용공고가 없으면 필수조건은 확인하지 못했다고 짧게 밝힌다.\n${common}`;
 if(intent.mode==='assignment-create')return `질문 유형: 결과물 초안 작성. 먼저 요청한 코드·보고서·과제·자소서의 실제 초안을 작성한다. 과제 조건을 지키고 사용자의 확인된 활동만 사용한다. 실제 관련 외부 근거가 있는 경우에만 그 다음 '취업 관점에서 반영한 내용'에서 실제 초안에 넣은 요소에 한해서 어떤 직무 역량에 왜 도움이 되는지 구체적으로 적고 '추가했습니다'로 설명한다. 초안에 없는 요소나 저장하지 않은 파일·GitHub 변경을 완료했다고 말하지 않는다. 막연한 조언만 쓰고 과제를 완성했다고 말하지 않는다. OO·XX 같은 빈칸 표기를 그대로 출력하지 않는다. 초안, 반영한 내용, 근거 순서로 간결하게 끝낸다. 출처는 문장당 최대2개만 붙이며 출처 번호를 반복하지 않는다.\n${common}`;
 return `질문 유형: 과제 설명·보완 조언. 먼저 과제 질문에 답한 뒤, 실제 취업 사례와 과제 조건이 연결되는 경우에만 그 근거를 설명하면서 'OO 역량을 보여주는 데 도움이 되므로 XX를 추가하는 것을 권장드립니다'라고 제안한다. 결과물을 생성하지 않았다면 '추가했습니다'라고 말하지 않는다. 합격 가능성을 보장하지 않는다. ${intent.wantsStatistics?'사용자가 통계도 물었으므로 확인한 평균·보유율을 함께 제시한다.':'합격 스펙 전체를 나열하기보다 과제와 관련된 경험·직무 정보를 사용한다.'}\n${common}`;
}

export function rankCareerEvidence(records,query,profile){
 const ranked=rankBM25(records,query,{limit:records.length});
 if(!profile?.wantsStatistics)return ranked.slice(0,5);
 // Reserve statistics and essay evidence for each requested company before broad prose.
 const selected=[];
 const add=r=>{if(r&&!selected.some(s=>s.url===r.url)&&selected.length<5)selected.push(r);};
 const companies=[...new Set(ranked.map(r=>r.company||''))];
 for(const company of companies)add(ranked.find(r=>(r.company||'')===company&&r.kind==='applicant-statistics'));
 for(const company of companies)add(ranked.find(r=>(r.company||'')===company&&r.kind==='applicant-experience'));
 for(const r of ranked)add(r);
 return selected;
}

export function careerExcerpts(documents,profile){
 const budget=profile.wantsStatistics?8000:4000;
 const priority=d=>profile.wantsStatistics?(d.kind==='applicant-statistics'?0:d.kind==='applicant-experience'?1:2):0;
 const sorted=documents.map((d,i)=>({d,i})).sort((a,b)=>priority(a.d)-priority(b.d)||a.i-b.i);
 const pieces=[];let left=budget;
 for(const {d} of sorted){
  if(pieces.length>=5||left<100)break;
  const cap=d.kind==='applicant-statistics'?1800:d.kind==='company-profile'?600:profile.wantsStatistics?1600:1000;
  const text=d.chunks.map(c=>c.text).join('\n').slice(0,Math.min(left,cap));
  if(!text.trim())continue;
  pieces.push({text,path:d.path,origin:d.origin,url:d.url,sourceType:d.sourceType,kind:d.kind,checkedAt:d.checkedAt,company:d.company});left-=text.length;
 }
 return pieces;
}

const METRICS=new Set(['학점','토익','토익스피킹','OPIC','외국어(기타)','자격증','해외경험','인턴','수상내역','교내/사회/봉사']);
export function careerFacts(excerpts){
 return excerpts.filter(e=>e.kind==='applicant-statistics').map(e=>{
  const metrics=e.text.split(/\r?\n/).flatMap(line=>{
   const match=line.match(/^([^:\n]{1,40}):\s*(.{1,80}?)\s*\/\s*보유율\s+(.{1,40})$/);
   if(!match||!METRICS.has(match[1].trim()))return [];
   const average=match[2].trim(),holders=match[3].replace(/\s*보유\s*$/,'').trim();
   if(!/\d|^(?:IH|IM[123]?|AL|AM|AH|IL|NH|NM|NL|-)$/i.test(average)||!/^\d+(?:\.\d+)?%$/.test(holders))return [];
   return [{label:match[1].trim(),average,holders}];
  });
  return {company:e.company||e.path.split(' / ')[0],sourceId:e.id,url:e.url,updatedAt:e.text.match(/통계 갱신일:\s*(\d{4}\.\d{2}\.\d{2})/)?.[1]||null,checkedAt:e.checkedAt,metrics};
 }).filter(f=>f.metrics.length);
}

export function cleanCitationRuns(answer,sourceCount){
 // Clean model citation loops without touching array indexing in fenced code blocks.
 return answer.split(/(```[\s\S]*?```|`[^`\n]*`)/g).map(part=>part.startsWith('```')||/^`[^`\n]*`$/.test(part)?part:part.replace(/(?:\[\d+(?:\s*,\s*\d+)*\][ \t\n]*){2,}/g,run=>{
  const ids=[...new Set((run.match(/\d+/g)||[]).map(Number).filter(id=>id>=1&&id<=sourceCount))].slice(0,3);
  return ids.map(id=>'['+id+']').join(' ')+(run.endsWith('\n')?'\n':run.endsWith(' ')?' ':'');
 })).join('').trim();
}

export function finalizeCareerAnswer(answer,intent,{companies=[],officialJob=false}={}){
 if(!intent||!answer.trim())return answer;
 const chunks=answer.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
 const names=companies.map(c=>c.name).filter(Boolean);
 const cleaned=chunks.map(part=>part.startsWith('`')||officialJob?part:part.split(/(?<=[.!?。])\s+|\n/).filter(sentence=>{
  const assertsRequirement=/(?:에서|가|는|의)\s*(?:요구하는|필수로\s*요구|필수\s*스펙|필수\s*조건)/.test(sentence);
  const qualifies=/확인.{0,10}(?:못|않|없)|아니|단정|불명|확정.{0,6}(?:못|않)/.test(sentence);
  return !(assertsRequirement&&!qualifies&&names.some(name=>sentence.includes(name)));
 }).join('\n')).join('').trim();
 if(intent.mode==='company-info')return cleaned;
 return cleaned;
}
