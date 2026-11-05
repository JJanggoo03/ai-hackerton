// Loaded only by server.html. Existing static demo keeps its IndexedDB behavior.
window.ServerArchive = {
 csrf: '',
 async api(path, body) {
  const response = await fetch('/api' + path, {
   method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
   headers: body === undefined ? {} : {'Content-Type':'application/json','X-CSRF-Token':this.csrf},
   body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(Error(data.error || '서버 요청에 실패했습니다.'), {status:response.status});
  return data;
 },
 async session() { const s=await this.api('/session'); this.csrf=s.csrf;return s; },
 async encode(blob) {
  return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=()=>reject(r.error);r.readAsDataURL(blob);});
 },
 async operations(fn) {
  const pending=[];
  fn({put:n=>pending.push({action:'put',...n}),delete:path=>pending.push({action:'delete',path})});
  const operations=[];
  for(const n of pending) {
   if(n.kind==='meta') continue;
   operations.push({action:n.action,path:n.path,kind:n.kind,...(n.blob?{content:await this.encode(n.blob)}:{})});
  }
  if(operations.length) await this.api('/nodes/batch',{operations});
 },
 async nodes() {
  const result=await this.api('/nodes');
  return result.nodes.map(n=>{
   if(n.kind!=='file')return n;
   const bytes=Uint8Array.from(atob(n.content),c=>c.charCodeAt(0));
   return {...n,blob:new Blob([bytes],{type:n.mime||'application/octet-stream'})};
  });
 },
 async login() {
  const state=await this.session();if(state.authenticated)return;
  const dialog=document.createElement('dialog');
  dialog.innerHTML='<form><h2>시연용 보관함 로그인</h2><p>서버 설정 때 정한 접속 비밀번호를 입력하세요.</p><label for="demo-passcode">접속 비밀번호</label><input id="demo-passcode" type="password" autocomplete="current-password" required><p class="login-error" role="status"></p><div class="modalactions"><button class="green">로그인</button></div></form>';
  document.body.append(dialog);dialog.addEventListener('cancel',e=>e.preventDefault());dialog.showModal();
  await new Promise(resolve=>{
   dialog.querySelector('form').onsubmit=async e=>{
    e.preventDefault();const button=dialog.querySelector('button');button.disabled=true;
    try{const result=await this.api('/demo/login',{passcode:dialog.querySelector('input').value});this.csrf=result.csrf;dialog.close();dialog.remove();resolve();}
    catch(error){dialog.querySelector('.login-error').textContent=error.message;}
    finally{button.disabled=false;}
   };
  });
 },
 async init() {
  try {
   document.querySelector('.badge').textContent='● 서버에 저장';
   document.querySelector('.notice').textContent='해커톤 시연용 · 학교 공식 서비스가 아닙니다. 자료는 이 서버에 보관됩니다. 파일당 10MB, 전체 40MB까지 지원합니다. GitHub 전송은 버튼을 누를 때만 진행합니다.';
   await this.login();await refresh();
   if(!nodes.length){
    const operations=[];
    for(const path of ['2026-2학기','2026-2학기/인공지능','2026-2학기/인공지능/01주차','2026-2학기/인공지능/02주차','2026-2학기/자료구조']) {
     const n=readme(path);operations.push({action:'put',path,kind:'folder'},{action:'put',path:n.path,kind:'file',content:await this.encode(n.blob)});
    }
    await this.api('/nodes/batch',{operations});await refresh();
   }
   navigate(nodes.some(n=>n.path==='2026-2학기/인공지능')?'2026-2학기/인공지능':'');
   document.dispatchEvent(new Event('archive-ready'));
  } catch(e) {toast('서버 연결 실패: '+e.message);document.querySelector('#upload').disabled=true;document.querySelector('#newfolder').disabled=true;}
 }
};
