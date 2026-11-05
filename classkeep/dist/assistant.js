import {separateSources,sourceSection} from './answer-sources.js';
import { parseReferenceQuestion } from './reference-scope.js';
import {CAREER_SITES,formatReferenceQuestion} from './career-sites.js';

document.body.classList.add('has-archive-assistant');
const assistant=document.createElement('section');assistant.className='archive-assistant';assistant.setAttribute('aria-labelledby','assistant-heading');
assistant.innerHTML=`<div class="assistant-top"><div><span class="assistant-eyebrow">나의 취업·학습 도우미</span><h2 id="assistant-heading">다음 준비를 함께 찾아볼까요?</h2></div><span class="assistant-connection">AI 설정 확인 중</span></div>
<p class="assistant-intro">취업·훈련 질문은 고용24에서 필요한 정보를 찾아 답합니다. 보관함과 GitHub 자료를 함께 참고하고, 같은 로그인 세션의 이전 대화를 기억합니다.</p>
<form id="assistant-form"><label class="assistant-label" for="assistant-question">질문</label><div class="assistant-input-row"><textarea id="assistant-question" maxlength="8000" rows="3" placeholder="예: 데이터 분석가를 준비하고 있어. 내일배움카드 훈련과정을 추천해줘" required></textarea><div class="assistant-source-buttons"><button type="button" id="assistant-repositories" aria-haspopup="dialog">＋ GitHub 저장소 선택</button><button type="button" id="assistant-career-sites">＋ 취업정보 참조</button></div></div>
<label class="assistant-local-toggle"><input type="checkbox" id="assistant-include-archive" checked>내 보관함 자료도 함께 참조</label>
<div id="assistant-references" class="assistant-references" aria-label="참조할 저장소"></div>
<div id="assistant-career-query-wrap" hidden><label class="assistant-label" for="assistant-career-query">목표 기업·직무 (선택)</label><input id="assistant-career-query" maxlength="120" placeholder="비워두면 질문·과제·자료로 관련 기업을 추천합니다"><small>기업명을 질문에 적으면 해당 기업을 우선 찾습니다. 기업 웹 탐색을 선택하면 자료 발췌로 기업을 고르고, 친구 서버에는 회사명만 보냅니다.</small></div><div><label class="assistant-label" for="assistant-assignment">과제 안내 PDF (선택)</label><input id="assistant-assignment" type="file" accept=".pdf,application/pdf"><button type="button" id="assistant-remove-pdf" hidden>첨부 해제</button><small>과제 안내 PDF를 첨부하세요 (최대 10MB). 첨부하지 않으면 질문 내용에 따라 답변합니다. 기업·취업 질문은 취업 통계와 사례를 우선 조회합니다.</small></div>
<div class="assistant-bottom"><button type="button" id="assistant-reset">새 대화</button><span id="assistant-scope" role="status">참조 범위 · 내 보관함 전체</span><button class="dark" type="submit">AI에게 질문하기</button></div></form>
<p class="assistant-pending">질문하면 선택 범위의 PDF·DOCX·텍스트에서 본문 일부를 읽어 연결된 AI 서버에 전달합니다. 메모장 파일은 UTF-8·UTF-16·한글 ANSI를 지원합니다. 스캔 PDF의 글자 인식과 HWP·PPTX 본문 읽기는 아직 지원하지 않습니다.</p><details id="assistant-history"><summary>이전 대화</summary><div id="assistant-history-items"></div></details><div id="assistant-result" role="status" hidden></div>`;
document.querySelector('.readme').after(assistant);
const picker=document.createElement('dialog');picker.className='assistant-picker';
picker.innerHTML='<div class="assistant-picker-head"><h2>참조할 GitHub 저장소</h2><button type="button" id="assistant-picker-close" aria-label="저장소 선택 닫기">×</button></div><p>여러 저장소를 선택하면 질문 앞에 @소유자/저장소가 들어갑니다. 이 질문은 선택한 GitHub 저장소를 참조합니다.</p><input id="assistant-repo-search" aria-label="저장소 검색" placeholder="저장소 이름 검색"><div id="assistant-repo-options"></div><p id="assistant-picker-status" role="status"></p><div class="modalactions"><button type="button" id="assistant-picker-reload">목록 새로고침</button><button type="button" class="green" id="assistant-picker-apply">선택 적용</button></div>';
document.body.append(picker);
const input=document.querySelector('#assistant-question'),scopeLabel=document.querySelector('#assistant-scope'),result=document.querySelector('#assistant-result');
let repositories=[],draft=new Set();
const includeArchive=document.querySelector('#assistant-include-archive');
function parsed(){return parseReferenceQuestion(input.value);}
function reflect(){
 const chips=document.querySelector('#assistant-references');chips.replaceChildren();
 try{
  const p=parsed(),scope=[];
  if(includeArchive.checked)scope.push('내 보관함 전체');if(p.repositories.length)scope.push(`GitHub 저장소 ${p.repositories.length}개`);if(p.careerSites.length)scope.push(`취업 사이트 ${p.careerSites.length}개`);
  scopeLabel.textContent='참조 범위 · '+(scope.join(' + ')||'선택된 자료 없음');
  document.querySelector('#assistant-career-query-wrap').hidden=!p.careerSites.length;document.querySelector('#assistant-career-query').required=false;

  for(const name of p.repositories){const chip=document.createElement('button');chip.type='button';chip.className='assistant-chip';chip.textContent='@'+name+' ×';chip.setAttribute('aria-label',name+' 참조 제외');chip.onclick=()=>{const now=parsed();input.value=formatReferenceQuestion({...now,repositories:now.repositories.filter(r=>r!==name)});reflect();};chips.append(chip);}
  for(const id of p.careerSites){const site=CAREER_SITES.find(s=>s.id===id),chip=document.createElement('button');chip.type='button';chip.className='assistant-chip assistant-career-chip';chip.textContent=site.token+' ×';chip.setAttribute('aria-label',site.name+' 참조 제외');chip.onclick=()=>{const now=parsed();input.value=formatReferenceQuestion({...now,careerSites:now.careerSites.filter(s=>s!==id)});reflect();};chips.append(chip);}
 }catch(e){scopeLabel.textContent=e.message;}
}
input.addEventListener('input',reflect);
const assignmentInput=document.querySelector('#assistant-assignment');
const removePdf=document.querySelector('#assistant-remove-pdf');
assignmentInput.addEventListener('change',()=>{removePdf.hidden=!assignmentInput.files.length;});
removePdf.addEventListener('click',()=>{
 assignmentInput.value='';
 removePdf.hidden=true;
 assignmentInput.focus();
});
includeArchive.onchange=reflect;
function renderRepositories(){
 const query=document.querySelector('#assistant-repo-search').value.toLowerCase(),container=document.querySelector('#assistant-repo-options');container.replaceChildren();
 for(const repo of repositories.filter(r=>r.fullName.toLowerCase().includes(query))){
  const label=document.createElement('label');label.className='assistant-repo-option';
  const box=document.createElement('input');box.type='checkbox';box.setAttribute('aria-label',repo.fullName);box.checked=draft.has(repo.fullName);box.onchange=()=>{box.checked?draft.add(repo.fullName):draft.delete(repo.fullName);};
  const name=document.createElement('span');name.textContent=repo.fullName;const badge=document.createElement('small');badge.textContent=repo.private?'비공개':'공개';label.append(box,name,badge);container.append(label);
 }
 if(!container.childElementCount){const empty=document.createElement('p');empty.textContent='표시할 저장소가 없습니다.';container.append(empty);}
}
async function loadRepositories(){
 const status=document.querySelector('#assistant-picker-status');status.textContent='현재 접근 가능한 저장소를 확인하고 있습니다.';
 try{
  const s=await ServerArchive.session();if(!s.authenticated)throw Error('보관함에 먼저 로그인해주세요.');if(!s.github)throw Error('화면 위쪽 GitHub 연결을 먼저 진행해주세요.');
  repositories=(await ServerArchive.api('/assistant/repositories')).repositories;
  renderRepositories();status.textContent='';
 }catch(error){status.textContent=error.message;}
}
document.querySelector('#assistant-repositories').onclick=()=>{draft=new Set(parsed().repositories);picker.showModal();loadRepositories();};
document.querySelector('#assistant-picker-close').onclick=()=>picker.close();
document.querySelector('#assistant-picker-reload').onclick=loadRepositories;
document.querySelector('#assistant-repo-search').oninput=renderRepositories;
document.querySelector('#assistant-picker-apply').onclick=()=>{input.value=formatReferenceQuestion({...parsed(),repositories:[...draft]});reflect();picker.close();};
document.querySelector('#assistant-career-sites').onclick=()=>{
 try{
  const current=parsed();
  const careerSites=[...new Set([...current.careerSites,CAREER_SITES[0].id])];
  input.value=formatReferenceQuestion({...current,careerSites})+(current.question?'':' ');
  reflect();
  input.focus();
  input.setSelectionRange(input.value.length,input.value.length);
 }catch(error){scopeLabel.textContent=error.message;}
};
document.querySelector('#assistant-form').onsubmit=async event=>{
 event.preventDefault();const submitted=input.value,button=event.currentTarget.querySelector('[type=submit]');
 button.disabled=true;document.querySelector('#assistant-reset').disabled=true;result.hidden=false;result.textContent='자료를 확인하고 답변을 생성하고 있습니다…';
 try{
  const file=document.querySelector('#assistant-assignment').files[0];
  let assignmentUpload=null;
  if(file){
   if(!/\.pdf$/i.test(file.name)||file.size>10*1024*1024)throw Error('과제 안내는 10MB 이하 PDF 파일을 첨부해주세요.');
   const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(Error('PDF 파일을 읽지 못했습니다.'));reader.readAsDataURL(file);});
   assignmentUpload={name:file.name,data};
  }
  const response=await ServerArchive.api('/assistant/ask',{text:submitted,includeArchive:includeArchive.checked,careerQuery:document.querySelector('#assistant-career-query').value.trim(),assignmentUpload});
  result.replaceChildren();
  input.value='';reflect();await restoreConversation(true);
  const title=document.createElement('h3');title.textContent='AI 답변';
  const question=document.createElement('p');question.className='assistant-submitted';question.textContent='질문: '+submitted;
  const answer=document.createElement('div');answer.className='assistant-answer';const formatted=separateSources(response.answer);answer.textContent=formatted.body;
  const meta=document.createElement('p');meta.className='assistant-answer-meta';meta.textContent=`${[...(response.includeArchive?['내 보관함']:[]),...response.repositories.map(r=>'GitHub '+r)].join(' + ')||'취업 정보'} · 읽은 파일 ${response.readCount}개 · ${response.model}`;
  result.append(title,question,answer);
  if(formatted.sources.length)result.append(sourceSection(formatted.sources));
  result.append(meta);
  if(response.toolCalls?.length){const info=document.createElement('p');info.className='assistant-tool-status';info.textContent='외부 정보 조회 '+response.toolCalls.filter(t=>t.ok).length+'회 완료'+(response.toolCalls.some(t=>!t.ok)?' · 일부 조회 실패':'');result.append(info);}
  if(response.careerProfile?.companyPlan){const plan=response.careerProfile.companyPlan,p=document.createElement('p');p.textContent=(plan.mode==='explicit'?'사용자가 지정한 기업: ':plan.mode==='recommended'?'자료로 추천한 기업: ':'기업을 확정하지 못했습니다. ')+plan.companies.map(c=>c.name+' — '+c.reason).join(' / ');result.insertBefore(p,answer);}
  if(response.careerProfile?.answerMode){const p=document.createElement('p');p.className='assistant-answer-mode';p.textContent=({'company-info':'기업 취업정보 · 수집한 통계와 사례 중심','assignment-advice':'과제 설명·보완 권장','assignment-create':'결과물 초안 작성 · 실제 반영 내용 설명'})[response.careerProfile.answerMode]||'';result.insertBefore(p,answer);}
  for(const fact of response.careerFacts||[]){
   const section=document.createElement('section');section.className='assistant-career-facts';
   const heading=document.createElement('h4');heading.textContent=fact.company+' · 수집한 합격자 통계';section.append(heading);
   const wrap=document.createElement('div');wrap.className='assistant-facts-scroll';const table=document.createElement('table'),thead=document.createElement('thead'),head=document.createElement('tr');
   for(const label of ['항목','보유자 평균·수준','보유율']){const th=document.createElement('th');th.scope='col';th.textContent=label;head.append(th);}thead.append(head);table.append(thead);
   const body=document.createElement('tbody');for(const metric of fact.metrics){const tr=document.createElement('tr');for(const value of [metric.label,metric.average,metric.holders]){const td=document.createElement('td');td.textContent=value;tr.append(td);}body.append(tr);}table.append(body);wrap.append(table);section.append(wrap);
   const note=document.createElement('p');note.textContent='지원자 표본 통계이며 필수 조건·최소 합격선이 아닙니다. 평균과 보유율은 별개입니다.'+(fact.updatedAt?' 원문 통계 갱신일: '+fact.updatedAt:' 원문 통계 갱신일은 확인되지 않았습니다.');section.append(note);
   const link=document.createElement('a');link.href=fact.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='['+fact.sourceId+'] 잡코리아 통계 원문';section.append(link);result.insertBefore(section,answer);
  }
  const foundLinks=(response.careerStatus||[]).flatMap(s=>s.discoveryLinks||[]);
  if(foundLinks.length){const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='기업 탐색 링크 · 본문 확인 여부';details.append(summary);for(const found of foundLinks){const p=document.createElement('p'),a=document.createElement('a');a.href=found.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=`${found.company} · ${found.verified?'본문 확인':'본문 미확인'} · ${found.url}`;p.append(a);details.append(p);}result.append(details);}
  if(response.careerStatus?.length){const status=document.createElement('div');status.className='assistant-career-notice';const label=document.createElement('b');label.textContent='취업 정보 조회 상태';status.append(label);for(const site of response.careerStatus){const p=document.createElement('p');p.textContent=`${site.name}: ${site.message}${site.cacheHit?' · 최근 조회 결과 재사용':''}`;status.append(p);for(const warning of site.warnings||[]){const note=document.createElement('p');note.textContent=warning;status.append(note);}}if(response.careerProfile){const p=document.createElement('p');p.textContent=(response.careerProfile.answerMode==='company-info'?'기업 조회: ':'과제 기반 검색어: ')+response.careerProfile.searchQuery;status.append(p);}result.insertBefore(status,answer);}
  if(response.timings){const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='처리 시간 확인';details.append(summary);const times=response.timings,p=document.createElement('p');p.textContent=`자료 읽기 ${(times.documentsMs/1000).toFixed(1)}초 · 취업 조회 ${(times.careerMs/1000).toFixed(1)}초 · AI 답변 ${(times.generationMs/1000).toFixed(1)}초 · 전체 ${(times.totalMs/1000).toFixed(1)}초${response.textCacheHits?' · 본문 재사용 '+response.textCacheHits+'개':''}`;details.append(p);result.append(details);}
  if(response.sources.length){
   const details=document.createElement('details'),label=document.createElement('summary');label.textContent='AI에 전달한 자료 발췌';const list=document.createElement('ul');
   for(const source of response.sources){const item=document.createElement('li');const text=`[${source.id}] ${source.origin} / ${source.path}${source.page?' · '+source.page+'페이지':''}${source.checkedAt?' · 확인 '+new Date(source.checkedAt).toLocaleString('ko-KR'):''}`;
    if(source.url){const link=document.createElement('a');link.textContent=text;link.href=source.url;link.target='_blank';link.rel='noopener';item.append(link);}else item.textContent=text;list.append(item);
   }details.append(label,list);result.append(details);
  }
  if(response.warnings.length){const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='자료 읽기 안내 '+response.warnings.length+'건';details.append(summary);for(const warning of response.warnings){const p=document.createElement('p');p.textContent=warning;details.append(p);}result.append(details);}
 }catch(error){result.textContent=error.message;result.hidden=false;}finally{button.disabled=false;document.querySelector('#assistant-reset').disabled=false;}
};
async function updateAssistantStatus(){try{const s=await ServerArchive.session();document.querySelector('.assistant-connection').textContent=s.aiConfigured?'AI 요청 가능':'AI 서버 설정 필요';}catch{document.querySelector('.assistant-connection').textContent='서버 연결 확인 필요';}}
document.addEventListener('archive-ready',updateAssistantStatus);
updateAssistantStatus();
reflect();

let historyRequest=0;
async function restoreConversation(excludeLatest=false){
 const version=++historyRequest;const box=document.querySelector('#assistant-history-items');
 try{const {messages}=await ServerArchive.api('/assistant/history');if(version!==historyRequest)return;box.replaceChildren();const list=excludeLatest?messages.slice(0,-2):messages;for(const m of list.slice(-20)){const article=document.createElement('article');article.className='assistant-history-message';const label=document.createElement('strong');label.textContent=m.role==='user'?'나':'도우미';const text=document.createElement('div');const formatted=separateSources(m.content);text.textContent=formatted.body;article.append(label,text);if(formatted.sources.length)article.append(sourceSection(formatted.sources));box.append(article);}if(!list.length)box.textContent='이 대화에 저장된 이전 메시지가 없습니다.';document.querySelector('#assistant-history summary').textContent='이전 대화 · '+Math.floor(list.length/2)+'회';}
 catch(e){box.textContent='대화 기록을 불러오지 못했습니다. '+e.message;}
}
document.querySelector('#assistant-reset').onclick=async()=>{const button=document.querySelector('#assistant-reset');button.disabled=true;try{await ServerArchive.api('/assistant/reset',{});input.value='';result.replaceChildren();result.hidden=true;reflect();await restoreConversation();}catch(e){result.hidden=false;result.textContent=e.message;}finally{button.disabled=false;}};
document.addEventListener('archive-ready',()=>restoreConversation());
ServerArchive.session().then(s=>{if(s.authenticated)restoreConversation();}).catch(()=>{});
