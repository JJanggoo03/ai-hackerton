// Actual server integration. No simulated repository records or local comparison hashes.
const liveActions=document.createElement('div');liveActions.className='github-actions';
liveActions.innerHTML='<div class="action-primary"><button class="green" id="live-eluri" hidden>e-루리 과제 가져오기</button><button class="dark" id="live-all">GitHub에 전체 저장</button><button id="live-folder">현재 폴더 저장</button></div><details class="account-actions"><summary>GitHub · 계정 관리</summary><div class="account-panel"><button id="live-connect">GitHub 연결</button><button id="live-create">새 저장소 만들기</button><button id="live-disconnect" hidden>연결 해제</button><button id="live-logout">로그아웃</button></div></details>';
document.querySelector('.heading').append(liveActions);document.querySelector('#export').hidden=true;
const liveCompletion=document.createElement('p');liveCompletion.className='gh-transfer-completion';liveCompletion.setAttribute('role','status');liveCompletion.hidden=true;document.querySelector('.heading').after(liveCompletion);
const liveDialog=document.createElement('dialog');liveDialog.className='github-dialog';
liveDialog.innerHTML='<div class="github-dialog-head"><span>GitHub로 저장</span><button id="live-close" aria-label="닫기">×</button></div><h2>저장소와 파일 확인</h2><label for="live-repos">기존 저장소 선택</label><select id="live-repos"></select><p><a id="live-manage" target="_blank" rel="noopener">GitHub 저장소 접근 설정</a> <button id="live-reload">권한 변경 후 목록 새로고침</button></p><small>목록에는 현재 앱과 학생 계정 모두 쓰기 권한이 있는 저장소만 표시됩니다. 목록에 없다는 이유로 새 저장소를 자동 생성하지 않습니다.</small><p id="live-scope"></p><button id="live-compare">파일 비교하기</button><div id="live-items"></div><p id="live-result" role="status"></p><p>기존 파일 유지가 기본입니다. 보관함에서 삭제한 파일을 GitHub에서도 자동 삭제하지 않습니다.</p><button class="green" id="live-send" disabled>선택한 내용 전송</button>';
document.body.append(liveDialog);
const liveCreate=document.createElement('dialog');liveCreate.innerHTML='<form><h2>새 비공개 저장소 만들기</h2><p>연결한 GitHub 개인 계정에 실제로 생성됩니다.</p><label for="live-name">저장소 이름</label><input id="live-name" required maxlength="100" pattern="[A-Za-z0-9_.-]+" placeholder="예: course-archive-2026"><p>영문, 숫자, 점, 하이픈, 밑줄 사용</p><p id="live-create-result" role="status"></p><div class="modalactions"><button type="button" id="live-create-cancel">취소</button><button class="green">비공개 저장소 생성</button></div></form>';document.body.append(liveCreate);
const eluriDialog=document.createElement('dialog');eluriDialog.className='github-dialog eluri-progress-dialog';
eluriDialog.innerHTML='<div class="github-dialog-head"><span>e-루리 과제 백업</span><button id="eluri-close" aria-label="닫기">×</button></div><h2>과제를 GitHub에 업로드합니다</h2><p id="eluri-progress-message" role="status">작업을 준비하고 있습니다.</p><div class="eluri-progress-value"><span>진행률</span><strong id="eluri-percent">0%</strong></div><progress id="eluri-progress" max="100" value="0"></progress><small>처음 실행하면 서버 PC에서 e-루리 로그인 창이 열립니다. 로그인 후 보이는 창은 닫히고, 백그라운드 브라우저로 계속 진행합니다. 다음 실행에는 저장된 로그인 세션을 사용합니다.</small><p id="eluri-progress-result"></p></dialog>';document.body.append(eluriDialog);
const liveApi=(p,b)=>ServerArchive.api(p,b);
let liveScope='',liveFilePath=null,liveRepos=[],livePlan=null,liveBusy=false;
document.body.classList.add('single-file-transfer');
function invalidateLivePlan(){livePlan=null;const send=document.querySelector('#live-send');send.disabled=true;send.hidden=true;document.querySelector('#live-items').replaceChildren();}
async function updateLiveConnection(){const s=await ServerArchive.session();document.querySelector('#live-connect').textContent=s.github?`${s.github.login} · GitHub 다시 연결`:'GitHub 연결';document.querySelector('#live-disconnect').hidden=!s.github;document.querySelector('#live-eluri').hidden=!s.eluriConfigured;return s;}
let eluriActive=false;
const eluriButton=document.querySelector('#live-eluri');
function renderEluriJob(job){
 const percent=Math.max(0,Math.min(100,Number(job.percent)||0));document.querySelector('#eluri-progress').value=percent;document.querySelector('#eluri-percent').textContent=`${percent}%`;
 document.querySelector('#eluri-progress-message').textContent=job.message||'e-루리 처리 중입니다.';
 if(job.status==='done'&&job.result){const result=document.querySelector('#eluri-progress-result');result.textContent=`${job.result.repository} · ${job.result.fileCount}개 파일 · ${(job.result.bytes/1024/1024).toFixed(1)} MB `;const link=document.createElement('a');link.href=job.result.url;link.target='_blank';link.rel='noopener';link.textContent='GitHub 커밋 보기';result.append(link);}
 else if(job.status==='failed')document.querySelector('#eluri-progress-result').textContent=job.message||'작업에 실패했습니다.';
}
async function watchEluriJob(id){
 eluriActive=true;eluriButton.disabled=true;document.querySelector('#eluri-close').disabled=true;
 try{while(true){const job=await liveApi('/eluri/jobs/'+encodeURIComponent(id));renderEluriJob(job);if(job.status!=='running')break;await new Promise(resolve=>setTimeout(resolve,1200));}}
 catch(error){document.querySelector('#eluri-progress-message').textContent=error.message;}
 finally{eluriActive=false;eluriButton.disabled=false;document.querySelector('#eluri-close').disabled=false;}
}
eluriButton.onclick=async()=>{if(eluriActive)return;try{if(!await requireLiveConnection())return;document.querySelector('#eluri-progress').value=0;document.querySelector('#eluri-progress-result').textContent='';document.querySelector('#eluri-progress-message').textContent='작업을 시작하는 중입니다.';eluriDialog.showModal();const job=await liveApi('/eluri/jobs',{});await watchEluriJob(job.id);}catch(error){document.querySelector('#eluri-progress-message').textContent=error.message;document.querySelector('#eluri-close').disabled=false;}};
document.querySelector('#eluri-close').onclick=()=>{if(!eluriActive)eluriDialog.close();};
eluriDialog.addEventListener('cancel',event=>{if(eluriActive)event.preventDefault();});
async function resumeEluriJob(){try{const {job}=await liveApi('/eluri/jobs/active');if(job?.status==='running'){eluriDialog.showModal();renderEluriJob(job);await watchEluriJob(job.id);}}catch{}}
async function requireLiveConnection(){const s=await updateLiveConnection();if(!s.github){if(!s.githubConfigured)throw Error('프로그램설정.txt에 GitHub App 설정이 필요합니다. 파일 서버 보관은 먼저 사용할 수 있습니다.');const {url}=await liveApi('/github/connect',{});location.assign(url);return false;}return true;}
async function loadLiveRepos(){
 invalidateLivePlan();
 const result=await liveApi('/github/repositories');liveRepos=result.repositories;
 const {destinations}=await liveApi('/destinations');
 const saved=destinations.find(n=>n.scope===liveScope.split('/').slice(0,2).join('/'));
 const select=document.querySelector('#live-repos');select.innerHTML=liveRepos.map(r=>`<option value="${r.id}:${r.installationId}">${esc(r.fullName)}${r.private?' · 비공개':''}</option>`).join('');
 if(saved&&liveRepos.some(r=>String(r.id)===String(saved.repo_id)&&String(r.installationId)===String(saved.installation_id)))select.value=`${saved.repo_id}:${saved.installation_id}`;
 document.querySelector('#live-manage').href=result.manageUrl;
 document.querySelector('#live-result').textContent=liveRepos.length?'저장소를 선택하고 파일 비교하기를 누르세요.':'접근 가능한 저장소가 없습니다. GitHub 저장소 접근 설정에서 앱을 설치하거나 저장소를 추가하세요.';
 document.querySelector('#live-compare').disabled=!liveRepos.length;
}
async function openLiveScope(scope,filePath=null){try{if(!await requireLiveConnection())return;liveScope=scope;liveFilePath=filePath;document.querySelector('#live-scope').textContent=filePath?'전송 범위: 파일 1개 · '+filePath+' · 원래 전체 경로 유지':'전송 범위: '+(scope||'전체 보관함')+' · 원래 전체 경로 유지';liveDialog.showModal();await loadLiveRepos();}catch(e){toast(e.message);}}
document.querySelector('#live-all').onclick=()=>openLiveScope('');document.querySelector('#live-folder').onclick=()=>openLiveScope(current);
document.addEventListener('github-send-file',e=>{const path=e.detail?.path;if(!nodes.some(n=>n.kind==='file'&&n.path===path)){toast('전송할 파일을 찾을 수 없습니다. 새로고침 후 다시 선택해주세요.');return;}openLiveScope(parent(path),path);});
document.querySelector('#live-close').onclick=()=>{if(!liveBusy)liveDialog.close();};
liveDialog.addEventListener('cancel',e=>{if(liveBusy)e.preventDefault();});
document.querySelector('#live-send').hidden=true;
document.querySelector('#live-repos').onchange=()=>{invalidateLivePlan();document.querySelector('#live-result').textContent='저장소가 변경되었습니다. 파일 비교하기를 눌러 확인해주세요.';};
document.querySelector('#live-reload').onclick=async()=>{try{await loadLiveRepos();}catch(e){document.querySelector('#live-result').textContent=e.message;}};
document.querySelector('#live-connect').onclick=async()=>{try{const {url}=await liveApi('/github/connect',{});location.assign(url);}catch(e){toast(e.message);}};
document.querySelector('#live-disconnect').onclick=async()=>{if(!confirm('GitHub 연결과 과목별 저장 위치를 해제할까요? GitHub 파일은 삭제되지 않습니다.'))return;try{await liveApi('/github/disconnect',{});invalidateLivePlan();await updateLiveConnection();toast('연결을 해제했습니다. GitHub 앱 설치 자체는 GitHub 설정에서 관리할 수 있습니다.');}catch(e){toast(e.message);}};
document.querySelector('#live-logout').onclick=async()=>{try{await liveApi('/logout',{});location.reload();}catch(e){toast(e.message);}};
document.querySelector('#live-compare').onclick=async()=>{
 if(liveBusy)return;liveBusy=true;
 const b=document.querySelector('#live-compare'),repos=document.querySelector('#live-repos'),reload=document.querySelector('#live-reload');
 b.disabled=true;b.textContent='파일 비교 중…';repos.disabled=true;reload.disabled=true;liveDialog.setAttribute('aria-busy','true');invalidateLivePlan();
 document.querySelector('#live-result').textContent='GitHub 파일과 보관함 파일을 비교하고 있습니다. 잠시 기다려주세요.';
 try{
  const [repoId,installationId]=document.querySelector('#live-repos').value.split(':');
  const plan=await liveApi('/github/plan',{scope:liveScope,...(liveFilePath?{filePath:liveFilePath}:{}),repoId,installationId});livePlan=plan;
  document.querySelector('#live-items').innerHTML=plan.items.map((n,i)=>`<div class="gh-item"><div><b>${esc(basename(n.path))}</b><small>${esc(n.path)}</small></div>${n.status==='optional-readme'?`<label>저장소에 README가 있습니다<select data-live-choice="${i}"><option value="keep">기존 README 유지 · 이 파일 건너뛰기</option><option value="add">표시된 경로에 README 추가</option></select></label>`:n.status==='conflict'?`<label>덮어쓰기 여부<select data-live-choice="${i}"><option value="keep">기존 파일 유지</option><option value="replace">내 파일로 덮어쓰기</option></select></label>`:`<span>${n.status==='new'?'새로 추가':'변경 없음'}</span>`}</div>`).join('');
  document.querySelector('#live-result').textContent=`새 파일 ${plan.items.filter(n=>n.status==='new').length}개 · README 추가 여부 확인 ${plan.items.filter(n=>n.status==='optional-readme').length}개 · 충돌 ${plan.items.filter(n=>n.status==='conflict').length}개 · 변경 없음 ${plan.items.filter(n=>n.status==='same').length}개`;
  document.querySelector('#live-send').disabled=false;document.querySelector('#live-send').hidden=false;
 }catch(e){document.querySelector('#live-result').textContent=e.message;}finally{liveBusy=false;b.disabled=!liveRepos.length;b.textContent='파일 비교하기';repos.disabled=false;reload.disabled=false;liveDialog.removeAttribute('aria-busy');}
};
document.querySelector('#live-send').onclick=async()=>{
 if(!livePlan||liveBusy)return;liveBusy=true;
 const plan=livePlan,choices={};plan.items.forEach((n,i)=>{if(['conflict','optional-readme'].includes(n.status))choices[n.path]=document.querySelector(`[data-live-choice="${i}"]`).value;});
 const buttons=liveDialog.querySelectorAll('button,select');buttons.forEach(b=>b.disabled=true);
 document.querySelector('#live-send').textContent='전송 중…';liveDialog.setAttribute('aria-busy','true');
 document.querySelector('#live-result').textContent='GitHub에 전송 중입니다. 완료될 때까지 기다려주세요.';
 try{
  const result=await liveApi('/github/transfer',{id:plan.id,choices});
  document.querySelector('#live-result').textContent=`전송 완료: 추가 ${result.added}개, 덮어쓰기 ${result.replaced}개, 기존 유지 ${result.kept}개, 변경 없음 ${result.unchanged}개. `;
  const a=document.createElement('a');a.href=result.url;a.textContent='GitHub 결과 보기';a.target='_blank';a.rel='noopener';document.querySelector('#live-result').append(a);
  liveCompletion.replaceChildren(...Array.from(document.querySelector('#live-result').childNodes).map(n=>n.cloneNode(true)));liveCompletion.hidden=false;
  liveDialog.close();
 }catch(e){document.querySelector('#live-result').textContent=e.message+' 파일 비교부터 다시 진행해주세요.';}
 finally{liveBusy=false;livePlan=null;buttons.forEach(b=>b.disabled=false);const send=document.querySelector('#live-send');send.disabled=true;send.hidden=true;send.textContent='선택한 내용 전송';liveDialog.removeAttribute('aria-busy');}
};
document.querySelector('#live-create').onclick=async()=>{try{if(await requireLiveConnection()){document.querySelector('#live-create-result').textContent='';liveCreate.showModal();}}catch(e){toast(e.message);}};
document.querySelector('#live-create-cancel').onclick=()=>liveCreate.close();
liveCreate.querySelector('form').onsubmit=async e=>{
 e.preventDefault();const b=liveCreate.querySelector('button.green');b.disabled=true;
 try{const r=await liveApi('/github/repositories',{name:document.querySelector('#live-name').value.trim(),confirm:true});document.querySelector('#live-create-result').textContent=`${r.created.fullName} 비공개 저장소 생성 완료. 보내기 화면에서 선택하세요.`;document.querySelector('#live-name').value='';}
 catch(error){document.querySelector('#live-create-result').textContent=error.message+' 생성 권한이 없다면 앱 권한을 승인한 뒤 다시 시도해주세요.';}
 finally{b.disabled=false;}
};
document.addEventListener('archive-ready',()=>updateLiveConnection().then(resumeEluriJob).catch(e=>toast(e.message)));
