// Lightweight BM25 retrieval. No second LLM call or remote embedding request.
const CONCEPTS=[
 {id:'regression',label:'회귀분석',terms:['회귀','regression','잔차','다중회귀']},
 {id:'statistics',label:'통계분석',terms:['통계','statistics','statistical','가설검정']},
 {id:'data-analysis',label:'데이터 분석',terms:['데이터 분석','데이터분석','data analysis','data analyst','전처리','시각화']},
 {id:'machine-learning',label:'머신러닝',terms:['머신러닝','기계학습','machine learning','교차검증','과적합']},
 {id:'python',label:'Python',pattern:/\bpython\b|파이썬|\.py\b/i},
 {id:'r',label:'R',pattern:/\br\b|rstudio|r studio|\.rmd\b/i},
 {id:'sql',label:'SQL',pattern:/\bsql\b|데이터베이스|database|쿼리/i},
 {id:'pandas',label:'pandas',pattern:/\bpandas\b/i},
 {id:'backend',label:'백엔드',terms:['백엔드','backend','back-end','서버 개발','rest api']},
 {id:'frontend',label:'프론트엔드',terms:['프론트엔드','frontend','front-end','react','vue']},
 {id:'testing',label:'테스트·검증',terms:['단위 테스트','unit test','테스트 코드','검증','평가지표']},
 {id:'qualification',label:'자격요건',terms:['자격증','sqld','정보처리기사','adsp','빅데이터분석기사']}
];
const STOP=new Set(['과제','자료','정보','내용','질문','관련','추천','분석을','어떻게','해주세요','알려줘','보완해줘','권장','대한','합니다','있습니다','the','and','for','with','from']);
function concepts(text){const lower=text.toLowerCase();return CONCEPTS.filter(c=>c.pattern?c.pattern.test(text):c.terms.some(t=>lower.includes(t)));}
export function tokenize(text){
 const clean=String(text).normalize('NFKC').toLowerCase();
 const words=clean.match(/[a-z][a-z0-9+#.-]*|[가-힣]{2,}|\d+/g)||[];
 const tokens=words.filter(w=>!STOP.has(w));
 for(const c of concepts(clean))tokens.push('concept:'+c.id);
 // Korean inflections vary; retain bounded word bigrams as fallback matching features.
 for(const w of words.filter(w=>/^[가-힣]{3,12}$/.test(w)&&!STOP.has(w)))for(let i=0;i<w.length-1;i++)tokens.push('ko:'+w.slice(i,i+2));
 return tokens;
}
export function buildCareerProfile({question,target,documents,assignmentPath='',assignmentOrigin='내 보관함'}){
 const selected=assignmentPath?documents.filter(d=>d.path===assignmentPath&&d.origin===assignmentOrigin):[];
 const assignmentText=selected.slice(0,2).map(d=>d.chunks.map(c=>c.text).join('\n').slice(0,10000)).join('\n');
 const related=rankBM25(documents.map(d=>({text:d.chunks.slice(0,4).map(c=>c.text).join('\n'),title:d.path})),question+' '+target,{limit:4,dropZero:false});
 const material=related.map(d=>d.text).join('\n').slice(0,12000);
 // Assignment requirements take precedence over examples or existing implementation.
 const strongest=concepts(target+' '+question+' '+assignmentText);
 const detected=[...strongest,...concepts(material)].filter((c,i,a)=>a.findIndex(n=>n.id===c.id)===i).slice(0,8);
 const preferred=detected.filter(c=>!['testing','qualification'].includes(c.id));
 const extras=preferred.map(c=>c.label).filter(label=>!target.toLowerCase().includes(label.toLowerCase())).slice(0,2);
 const searchQuery=[target,...extras].join(' ').trim().slice(0,120);
 const constraints=assignmentText.split(/\r?\n|(?<=[.!?。])\s+/).map(s=>s.trim()).filter(s=>/필수|반드시|제출|금지|평가|배점|마감|요구|조건|must|required|deadline|rubric/i.test(s)).slice(0,10).map(s=>s.slice(0,240));
 const apiKinds=['jobs'];
 if(/회사|기업|사업|산업|company/i.test(question))apiKinds.push('companies');
 if(/자격|가산점|우대점|sqld|adsp/i.test(question+' '+target+' '+assignmentText))apiKinds.push('qualifications');
 return {target,question,skills:detected.map(c=>c.label),constraints,assignmentText:assignmentText.slice(0,5000),assignmentSources:selected.slice(0,2).map(d=>({path:d.path,origin:d.origin})),searchQuery,rankingQuery:[target,question,...detected.map(c=>c.label)].join(' ').slice(0,1500),apiKinds,limit:5};
}
export function rankBM25(records,query,{limit=5,dropZero=true}={}){
 if(!records.length)return [];
 const docs=records.map(r=>tokenize([r.title||r.path||'',r.company||'',r.text||''].join(' '))),queries=[...new Set(tokenize(query))];
 const average=docs.reduce((sum,d)=>sum+d.length,0)/docs.length||1;
 const df=new Map();for(const d of docs)for(const token of new Set(d))df.set(token,(df.get(token)||0)+1);
 const ranked=records.map((record,index)=>{
  const tokens=docs[index],tf=new Map();for(const token of tokens)tf.set(token,(tf.get(token)||0)+1);
  let score=0;for(const q of queries){const frequency=tf.get(q)||0;if(!frequency)continue;const idf=Math.log(1+(records.length-(df.get(q)||0)+0.5)/((df.get(q)||0)+0.5));score+=idf*(frequency*2.2)/(frequency+1.2*(0.25+0.75*tokens.length/average));}
  return {...record,score};
 });
 return ranked.filter(r=>!dropZero||r.score>0).sort((a,b)=>b.score-a.score).slice(0,limit);
}
export function deduplicateRecords(records){
 const seen=new Set();return records.filter(record=>{
  const url=new URL(record.url);url.hash='';for(const key of [...url.searchParams.keys()])if(/^utm_/i.test(key))url.searchParams.delete(key);
  const key=url.href;if(seen.has(key))return false;seen.add(key);return true;
 });
}
