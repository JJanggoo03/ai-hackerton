import { fail, seal, unseal } from './core.js';

export class Github {
 constructor(pool, config) { this.pool=pool; this.config=config; this.refreshes=new Map(); }
 configured() { return ['GITHUB_CLIENT_ID','GITHUB_CLIENT_SECRET','GITHUB_APP_ID','GITHUB_APP_SLUG'].every(k=>this.config[k]); }
 async oauth(body) {
  const r=await fetch('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({client_id:this.config.GITHUB_CLIENT_ID,client_secret:this.config.GITHUB_CLIENT_SECRET,...body}),signal:AbortSignal.timeout(30000)});
  const data=await r.json();
  if(!r.ok || data.error || !data.access_token) fail(401,'GitHub 승인이 만료되었거나 거부되었습니다. 다시 연결해주세요.');
  return {...data,expires_at:data.expires_in?Date.now()+data.expires_in*1000:null};
 }
 async raw(token, method, path, body) {
  const r=await fetch('https://api.github.com'+path,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
  const data=r.status===204?null:await r.json();
  if(!r.ok) {
   const status=r.status===404?404:r.status===401?401:r.status===403?403:r.status===409||r.status===422?409:502;
   const messages={401:'GitHub 연결을 다시 확인해주세요.',403:'GitHub 권한 또는 API 사용 한도를 확인해주세요.',404:'저장소가 없거나 현재 접근 권한이 없습니다.',409:'GitHub 상태가 변경되었거나 이름·브랜치 설정이 충돌합니다. 다시 확인해주세요.',502:'GitHub 요청에 실패했습니다. 잠시 후 다시 시도해주세요.'};
   fail(status,messages[status]);
  }
  return data;
 }
 async token(userId) {
  if(this.refreshes.has(userId)) return this.refreshes.get(userId);
  const work=(async()=>{
   const {rows:[link]}=await this.pool.query('SELECT * FROM github_links WHERE user_id=$1',[userId]);
   if(!link) fail(401,'먼저 GitHub 계정을 연결해주세요.');
   let c=unseal(link.credentials,this.config.TOKEN_KEY);
   if(c.expires_at && c.expires_at<Date.now()+60000) {
    if(!c.refresh_token) fail(401,'GitHub 연결이 만료되었습니다. 다시 연결해주세요.');
    c=await this.oauth({grant_type:'refresh_token',refresh_token:c.refresh_token});
    await this.pool.query('UPDATE github_links SET credentials=$2,updated_at=now() WHERE user_id=$1',[userId,seal(c,this.config.TOKEN_KEY)]);
   }
   return c.access_token;
  })();
  this.refreshes.set(userId,work);
  try{return await work;}finally{this.refreshes.delete(userId);}
 }
 async request(userId, method, path, body) { return this.raw(await this.token(userId),method,path,body); }
 async ensureEuris(userId) {
  const {rows:[link]}=await this.pool.query('SELECT login FROM github_links WHERE user_id=$1',[userId]);
  if(!link)fail(401,'GitHub 계정 연결을 확인해주세요.');
  const path='/repos/'+encodeURIComponent(link.login)+'/euris';
  try{return {repo:await this.request(userId,'GET',path),created:false};}
  catch(error){if(error.status!==404)throw error;}
  const repo=await this.request(userId,'POST','/user/repos',{name:'euris',private:true,auto_init:true,description:'개인 보관함 저장소'});
  return {repo,created:true};
 }
 async pages(userId,path,key) {
  const result=[];
  for(let page=1;page<=100;page++) {
   const data=await this.request(userId,'GET',`${path}${path.includes('?')?'&':'?'}per_page=100&page=${page}`);
   const list=key?data[key]:data; result.push(...list);
   if(list.length<100) return result;
  }
  fail(413,'저장소가 너무 많습니다. 앱 접근 대상을 줄여주세요.');
 }
 async repositories(userId,{writeOnly=true}={}) {
  const installs=(await this.pages(userId,'/user/installations','installations')).filter(i=>String(i.app_id)===String(this.config.GITHUB_APP_ID)&&!i.suspended_at);
  const result=[];
  for(const i of installs) {
   const repos=await this.pages(userId,`/user/installations/${i.id}/repositories`,'repositories');
   result.push(...repos.filter(r=>(writeOnly?r.permissions?.push:(r.permissions?.pull||r.permissions?.push))&&!r.archived&&!r.disabled).map(r=>({id:r.id,installationId:i.id,fullName:r.full_name,branch:r.default_branch,private:r.private})));
  }
  return result;
 }
 async accessible(userId, repoId, installationId) {
  const repos=await this.repositories(userId);
  const r=repos.find(r=>String(r.id)===String(repoId)&&String(r.installationId)===String(installationId));
  if(!r) fail(403,'이 저장소에 대한 현재 쓰기 권한이 없습니다. GitHub 접근 설정을 확인해주세요.');
  return r;
 }
 async snapshot(userId,repo,branch) {
  const root='/repos/'+repo.fullName.split('/').map(encodeURIComponent).join('/');
  let ref;
  try{ref=await this.request(userId,'GET',`${root}/git/ref/heads/${encodeURIComponent(branch)}`);}catch(e){if(e.status===409)fail(409,'비어 있는 저장소입니다. GitHub에서 README를 만든 뒤 다시 시도해주세요.');throw e;}
  const commit=await this.request(userId,'GET',`${root}/git/commits/${ref.object.sha}`);
  const tree=await this.request(userId,'GET',`${root}/git/trees/${commit.tree.sha}?recursive=1`);
  if(tree.truncated) fail(413,'저장소가 너무 커서 안전하게 비교할 수 없습니다. 별도 수업 자료 저장소를 선택해주세요.');
  return {head:ref.object.sha,treeSha:commit.tree.sha,tree:tree.tree,root};
 }
}
