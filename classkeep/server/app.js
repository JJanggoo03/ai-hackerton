import {ConversationStore} from './conversation-store.js';
import express from 'express';
import session from 'express-session';
import connectPg from 'connect-pg-simple';
import { MysqlSessionStore } from './mysql-session-store.js';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Github } from './github.js';
import { EluriJobs } from './eluri-jobs.js';
import { fail, safePath, hashBytes, gitBlob, inScope, destinationScope, classify, seal } from './core.js';
import { parseReferenceQuestion } from '../dist/reference-scope.js';
import { AssistantService } from './assistant.js';

const asyncSave=s=>new Promise((ok,no)=>s.save(e=>e?no(e):ok()));
const regenerate=s=>new Promise((ok,no)=>s.regenerate(e=>e?no(e):ok()));
export async function createApp(pool, config, githubOverride, {assistantFetch=fetch}={}) {
 const app=express(), gh=githubOverride||new Github(pool,config), origin=new URL(config.PUBLIC_URL).origin;
 const dataRoot=resolve(config.DATA_DIR||'data/blobs');await mkdir(dataRoot,{recursive:true});
 const assistant=new AssistantService(pool,gh,config,dataRoot,{fetchImpl:assistantFetch});
 const eluriJobs=new EluriJobs(gh,config);
 const conversations=new ConversationStore(pool);
 app.disable('x-powered-by');
 if(config.TRUST_PROXY==='1') app.set('trust proxy',1);
 app.use((req,res,next)=>{
  res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY',
   'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"});next();
 });
 app.use(express.json({limit:'60mb'}));
 const PgStore=connectPg(session);
 const sessionStore=config.DATABASE_DRIVER==='mysql'?new MysqlSessionStore(pool):new PgStore({pool,createTableIfMissing:true});
 app.use(session({name:'classkeep.sid',store:sessionStore,secret:config.SESSION_SECRET,resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax',secure:origin.startsWith('https:'),maxAge:7*86400000}}));
 app.get('/api/health',async(req,res)=>{await pool.query('SELECT 1');res.json({ok:true,githubConfigured:gh.configured()});});
 app.use('/api',(req,res,next)=>{
  res.set('Cache-Control','no-store');
  if(!['GET','HEAD','OPTIONS'].includes(req.method)) {
   if(req.get('origin')!==origin) return next(Object.assign(Error('요청 출처를 확인할 수 없습니다.'),{status:403}));
   const token=req.get('x-csrf-token');
   if(!token||token!==req.session.csrf) return next(Object.assign(Error('화면을 새로고침한 뒤 다시 시도해주세요.'),{status:403}));
  }
  next();
 });
 app.get('/api/session',async(req,res)=>{
  req.session.csrf ||= randomBytes(32).toString('hex');
  const {rows:[link]}=req.session.userId?await pool.query('SELECT login FROM github_links WHERE user_id=$1',[req.session.userId]):{rows:[]};
  res.json({authenticated:!!req.session.userId,csrf:req.session.csrf,github:link?{login:link.login}:null,githubConfigured:gh.configured(),eluriConfigured:!!config.ELURI_SCRIPT_PATH,aiConfigured:!!config.OLLAMA_BASE_URL});
 });
 const attempts=new Map();
 app.post('/api/demo/login',async(req,res)=>{
  const key=req.ip,now=Date.now(),entry=attempts.get(key);
  const count=entry&&entry.until>now?entry:{count:0,until:now+600000};
  attempts.set(key,count);if(++count.count>10)fail(429,'로그인 시도가 많습니다. 10분 후 다시 시도해주세요.');
  for(const [k,v] of attempts)if(v.until<now)attempts.delete(k);
  const given=Buffer.from(String(req.body.passcode||'')),expected=Buffer.from(config.DEMO_PASSCODE);
  if(given.length!==expected.length||!timingSafeEqual(given,expected))fail(401,'접속 비밀번호가 맞지 않습니다.');
  // One private presenter account. Public multi-student login is intentionally not enabled.
  let user;
  if(config.DATABASE_DRIVER==='mysql'){
   await pool.query("INSERT INTO users(id,name) VALUES('00000000-0000-4000-8000-000000000001','김학생 · 시연 계정') ON DUPLICATE KEY UPDATE name=VALUES(name)");
   ({rows:[user]}=await pool.query("SELECT id FROM users WHERE id='00000000-0000-4000-8000-000000000001'"));
  }else ({rows:[user]}=await pool.query("INSERT INTO users(id,name) VALUES('00000000-0000-4000-8000-000000000001','김학생 · 시연 계정') ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name RETURNING id"));
  await regenerate(req.session);req.session.userId=user.id;req.session.csrf=randomBytes(32).toString('hex');
  attempts.delete(key);await asyncSave(req.session);res.json({ok:true,csrf:req.session.csrf});
 });
 app.use('/api',(req,res,next)=>req.session.userId?next():res.status(401).json({error:'시연 계정으로 먼저 로그인해주세요.'}));
 app.get('/api/eluri/jobs/active',(req,res)=>res.json({job:eluriJobs.forUser(req.session.userId)}));
 app.get('/api/eluri/jobs/:id',(req,res)=>res.json(eluriJobs.get(req.session.userId,req.params.id)));
 app.post('/api/eluri/jobs',(req,res)=>res.status(202).json(eluriJobs.start(req.session.userId)));
 app.post('/api/logout',async(req,res)=>{await new Promise((ok,no)=>req.session.destroy(e=>e?no(e):ok()));res.clearCookie('classkeep.sid');res.json({ok:true});});
 app.get('/api/nodes/original',async(req,res)=>{
  const path=safePath(req.query.path);
  const {rows}=await pool.query("SELECT hash FROM archive_nodes WHERE user_id=$1 AND path=$2 AND kind='file'",[req.session.userId,path]);
  if(!rows.length)fail(404,'원본 파일을 찾을 수 없습니다.');
  res.download(join(dataRoot,rows[0].hash),path.split('/').pop());
 });
 app.get('/api/nodes',async(req,res)=>{
  const {rows}=await pool.query('SELECT path,kind,hash,bytes,mime,date FROM archive_nodes WHERE user_id=$1 ORDER BY path',[req.session.userId]);
  // Demo-sized snapshots only. Raw originals are read from private hash-named storage.
  const nodes=[];
  for(const n of rows)nodes.push({...n,date:Number(n.date),...(n.kind==='file'?{content:(await readFile(join(dataRoot,n.hash))).toString('base64')}:{})});
  res.json({nodes});
 });
 app.post('/api/nodes/batch',async(req,res)=>{
  const ops=req.body.operations;if(!Array.isArray(ops)||ops.length>2000)fail(400,'저장할 항목을 확인해주세요.');
  const prepared=[];
  for(const op of ops) {
   if(!['put','delete'].includes(op.action))fail(400,'알 수 없는 저장 요청입니다.');
   const path=safePath(op.path);
   if(op.action==='delete'){prepared.push({action:'delete',path});continue;}
   if(!['file','folder'].includes(op.kind))fail(400,'항목 형식을 확인해주세요.');
   let hash=null,bytes=0,mime=null;
   if(op.kind==='file') {
    if(typeof op.content!=='string')fail(400,'파일 데이터가 올바르지 않습니다.');
    const b=Buffer.from(op.content,'base64');bytes=b.length;
    if(b.toString('base64')!==op.content)fail(400,'파일 데이터가 올바르지 않습니다.');
    if(bytes>10*1024*1024)fail(413,'시연 서버는 파일당 10MB까지 지원합니다.');
    hash=hashBytes(b);mime='application/octet-stream';
    try{await writeFile(join(dataRoot,hash),b,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}
   }
   prepared.push({action:'put',path,kind:op.kind,hash,bytes,mime,date:Date.now()});
  }
  const client=await pool.connect();
  try{
   await client.query('BEGIN');await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[req.session.userId]);
   for(const op of prepared) {
    if(op.action==='delete')await client.query('DELETE FROM archive_nodes WHERE user_id=$1 AND path=$2',[req.session.userId,op.path]);
    else await client.query('INSERT INTO archive_nodes(user_id,path,kind,hash,bytes,mime,date) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id,path) DO UPDATE SET kind=EXCLUDED.kind,hash=EXCLUDED.hash,bytes=EXCLUDED.bytes,mime=EXCLUDED.mime,date=EXCLUDED.date',[req.session.userId,op.path,op.kind,op.hash,op.bytes,op.mime,op.date]);
   }
   const {rows:all}=await client.query('SELECT path,kind,bytes FROM archive_nodes WHERE user_id=$1',[req.session.userId]);
   if(all.length>1500||all.reduce((sum,n)=>sum+n.bytes,0)>40*1024*1024)fail(413,'시연 계정은 전체 40MB, 1,500개 항목까지 보관할 수 있습니다.');
   const map=new Map(all.map(n=>[n.path,n.kind]));
   for(const n of all){const parts=n.path.split('/');for(let i=1;i<parts.length;i++)if(map.get(parts.slice(0,i).join('/'))!=='folder')fail(409,'상위 폴더가 없거나 파일과 폴더 경로가 충돌합니다.');}
   await client.query('COMMIT');res.json({ok:true});
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 });
 app.post('/api/github/connect',async(req,res)=>{
  if(!gh.configured())fail(503,'프로그램설정.txt에 GitHub App 설정을 먼저 입력해주세요.');
  req.session.oauth={state:randomBytes(32).toString('hex'),at:Date.now()};await asyncSave(req.session);
  const params=new URLSearchParams({client_id:config.GITHUB_CLIENT_ID,redirect_uri:origin+'/github/callback',state:req.session.oauth.state});
  res.json({url:'https://github.com/login/oauth/authorize?'+params});
 });
 app.get('/github/callback',async(req,res)=>{
  const pending=req.session.oauth;delete req.session.oauth;await asyncSave(req.session);
  if(!req.session.userId||!pending||Date.now()-pending.at>600000||typeof req.query.state!=='string'||req.query.state!==pending.state||typeof req.query.code!=='string')fail(400,'GitHub 연결 요청이 만료되었거나 일치하지 않습니다. 다시 연결해주세요.');
  const credentials=await gh.oauth({code:req.query.code,redirect_uri:origin+'/github/callback'});
  const user=await gh.raw(credentials.access_token,'GET','/user');
  // Changing GitHub accounts invalidates every saved destination and pending plan.
  const client=await pool.connect();let mysqlLocked=false;
  try{
   await client.query('BEGIN');
   if(config.DATABASE_DRIVER==='mysql'){
    const {rows:[lock]}=await client.query('LOCK_USER',[req.session.userId]);mysqlLocked=Number(lock.locked)===1;
    if(!mysqlLocked)fail(409,'다른 계정 연결 작업이 진행 중입니다. 잠시 뒤 다시 시도해주세요.');
   }else await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[req.session.userId]);
   const {rows:[previous]}=await client.query('SELECT github_id FROM github_links WHERE user_id=$1 FOR UPDATE',[req.session.userId]);
   if(previous&&String(previous.github_id)!==String(user.id)){
    req.session.assistantConversationId=randomUUID();
    await client.query('DELETE FROM destinations WHERE user_id=$1',[req.session.userId]);
    await client.query("UPDATE transfers SET state='cancelled' WHERE user_id=$1 AND state='ready'",[req.session.userId]);
   }
   await client.query('INSERT INTO github_links(user_id,github_id,login,credentials) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET github_id=EXCLUDED.github_id,login=EXCLUDED.login,credentials=EXCLUDED.credentials,updated_at=now()',[req.session.userId,user.id,user.login,seal(credentials,config.TOKEN_KEY)]);
   await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}finally{if(mysqlLocked)await client.query('UNLOCK_USER',[req.session.userId]).catch(()=>{});client.release();}
  await asyncSave(req.session);res.redirect('/#archive');
 });
 app.get('/github/setup',async(req,res)=>{
  if(!req.session.userId) return res.redirect('/#archive');
  // Installation id in a redirect is untrusted. The API independently re-lists accessible installations.
  await gh.repositories(req.session.userId);res.redirect('/#archive');
 });
 app.post('/api/github/disconnect',async(req,res)=>{
  const client=await pool.connect();let mysqlLocked=false;try{
   await client.query('BEGIN');
   if(config.DATABASE_DRIVER==='mysql'){
    const {rows:[lock]}=await client.query('LOCK_USER',[req.session.userId]);mysqlLocked=Number(lock.locked)===1;
    if(!mysqlLocked)fail(409,'다른 GitHub 계정 연결 작업이 진행 중입니다. 잠시 뒤 다시 시도해주세요.');
   }else await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[req.session.userId]);
   await client.query('DELETE FROM github_links WHERE user_id=$1',[req.session.userId]);
   await client.query('DELETE FROM destinations WHERE user_id=$1',[req.session.userId]);
   await client.query("UPDATE transfers SET state='cancelled' WHERE user_id=$1 AND state='ready'",[req.session.userId]);
   await client.query('COMMIT');res.json({ok:true});
  }catch(e){await client.query('ROLLBACK');throw e;}finally{if(mysqlLocked)await client.query('UNLOCK_USER',[req.session.userId]).catch(()=>{});client.release();}
 });
 app.get('/api/github/repositories',async(req,res)=>res.json({repositories:await gh.repositories(req.session.userId),manageUrl:`https://github.com/apps/${encodeURIComponent(config.GITHUB_APP_SLUG)}/installations/new`}));
 app.post('/api/github/repositories',async(req,res)=>{
  const name=req.body.name;
  if(typeof name!=='string'||!/^[A-Za-z0-9_.-]{1,100}$/.test(name)||['.','..'].includes(name))fail(400,'저장소 이름은 영문·숫자·점·하이픈·밑줄 1~100자로 입력해주세요.');
  if(req.body.confirm!==true)fail(400,'새 비공개 저장소 생성을 확인해주세요.');
  const r=await gh.request(req.session.userId,'POST','/user/repos',{name,private:true,auto_init:true,description:'수업 자료 보관함에서 생성한 개인 자료 저장소'});
  const repos=await gh.repositories(req.session.userId);
  res.status(201).json({created:{id:r.id,fullName:r.full_name},repository:repos.find(n=>n.id===r.id)||null});
 });
 app.get('/api/github/browse',async(req,res)=>{
 const repos=await gh.repositories(req.session.userId,{writeOnly:false});const repo=repos.find(r=>String(r.id)===String(req.query.repoId));if(!repo)fail(403,'저장소 접근 권한을 확인해주세요.');
 const path=String(req.query.path||'');if(path.length>2000||path.startsWith('/')||path.split('/').some(s=>s==='..'||s==='.'))fail(400,'잘못된 경로입니다.');
 const data=await gh.request(req.session.userId,'GET','/repos/'+repo.fullName.split('/').map(encodeURIComponent).join('/')+'/contents/'+path.split('/').map(encodeURIComponent).join('/')+'?ref='+encodeURIComponent(repo.branch));
 if(!Array.isArray(data))fail(400,'폴더를 선택해주세요.');res.json({entries:data.map(n=>({name:n.name,path:n.path,type:n.type,size:n.size,url:n.html_url}))});
 });
 app.get('/api/assistant/repositories',async(req,res)=>res.json({repositories:await gh.repositories(req.session.userId,{writeOnly:false})}));
 app.get('/api/assistant/career-sites',(req,res)=>res.json({sites:assistant.career.catalog()}));
 app.get('/api/assistant/assignments',async(req,res)=>{const {rows}=await pool.query("SELECT path,bytes FROM archive_nodes WHERE user_id=$1 AND kind='file' AND lower(path) LIKE '%.pdf' ORDER BY path",[req.session.userId]);res.json({files:rows});});
 app.get('/api/assistant/history',async(req,res)=>{const memory=await conversations.read(req);res.json({messages:memory.messages});});
 app.post('/api/assistant/reset',async(req,res)=>{await conversations.reset(req);res.json({ok:true});});
 app.post('/api/assistant/ask',async(req,res)=>{
  const memory=await conversations.read(req);if(conversations.busy.has(memory.id))fail(409,'이전 질문의 답변을 기다려주세요.');conversations.busy.add(memory.id);
  try{const answer=await assistant.ask(req.session.userId,req.body.text,{includeArchive:req.body.includeArchive??true,careerQuery:req.body.careerQuery??'',careerOnly:req.body.careerOnly===true,assignmentUpload:req.body.assignmentUpload??null,memory});
   const state=answer._careerState;delete answer._careerState;await conversations.save(req,memory,req.body.text,answer.answer,state);res.json(answer);
  }finally{conversations.busy.delete(memory.id);}
 });
 app.post('/api/assistant/prepare',async(req,res)=>{
  let parsed;try{parsed=parseReferenceQuestion(req.body.text);}catch(e){fail(400,e.message);}
  if(!parsed.question)fail(400,'참조할 저장소 뒤에 질문을 입력해주세요.');
  if(parsed.source==='github'){
   const allowed=await gh.repositories(req.session.userId,{writeOnly:false});
   const repositories=parsed.repositories.map(name=>allowed.find(r=>r.fullName.toLowerCase()===name.toLowerCase()));
   if(repositories.some(r=>!r))fail(403,'선택한 저장소의 현재 접근 권한을 확인해주세요.');
   return res.json({prepared:true,aiConnected:false,source:'github',question:parsed.question,repositories});
  }
  const {rows:[count]}=await pool.query("SELECT count(*)::integer AS files FROM archive_nodes WHERE user_id=$1 AND kind='file'",[req.session.userId]);
  res.json({prepared:true,aiConnected:false,source:'archive',question:parsed.question,fileCount:count.files});
 });
 app.get('/api/destinations',async(req,res)=>{const {rows}=await pool.query('SELECT scope,repo_id,installation_id,full_name,branch FROM destinations WHERE user_id=$1',[req.session.userId]);res.json({destinations:rows});});
 app.post('/api/github/plan',async(req,res)=>{
  const filePath=req.body.filePath===undefined?null:safePath(req.body.filePath);
  const scope=filePath?filePath.split('/').slice(0,-1).join('/'):safePath(req.body.scope,true);
  const repo=await gh.accessible(req.session.userId,req.body.repoId,req.body.installationId);
  const branch=repo.branch;
  const snapshot=await gh.snapshot(req.session.userId,repo,branch);
  const {rows}=await pool.query("SELECT path,hash,bytes FROM archive_nodes WHERE user_id=$1 AND kind='file' ORDER BY path",[req.session.userId]);
  const files=[];for(const n of rows.filter(n=>filePath?n.path===filePath:inScope(n.path,scope)))files.push({...n,gitSha:gitBlob(await readFile(join(dataRoot,n.hash)))});
  if(!files.length)fail(400,'보낼 파일이 없습니다.');
  const items=classify(files,snapshot.tree);
  const isReadme=path=>/(?:^|\/)read(?:me\.md|\.me)$/i.test(path);
  if(snapshot.tree.some(entry=>entry.type==='blob'&&isReadme(entry.path))){
   for(const item of items)if(item.status==='new'&&isReadme(item.path))item.status='optional-readme';
  }
  if(items.some(n=>n.status==='blocked'))fail(409,'GitHub에 폴더·파일 또는 특수 파일 경로 충돌이 있습니다. 저장 위치를 변경해주세요.');
  const id=randomUUID(),plan={scope,filePath,repo,branch,head:snapshot.head,treeSha:snapshot.treeSha,root:snapshot.root,items};
  await pool.query('INSERT INTO transfers(id,user_id,plan) VALUES($1,$2,$3)',[id,req.session.userId,plan]);
  res.json({id,scope,filePath,repository:repo.fullName,items:items.map(({path,status})=>({path,status}))});
 });
 app.post('/api/github/transfer',async(req,res)=>{
  const {id,choices}=req.body;
  if(typeof id!=='string'||!/^[0-9a-f-]{36}$/.test(id)||!choices||typeof choices!=='object'||Array.isArray(choices))fail(400,'전송 요청을 확인해주세요.');
  const client=await pool.connect();let locked=false,claimed=false,remoteStarted=false;
  try{
   // Per presenter serialization also prevents disconnect/reconnect from silently reusing a pending job.
   const {rows:[lock]}=await client.query(config.DATABASE_DRIVER==='mysql'?'LOCK_USER':'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',[req.session.userId]);locked=config.DATABASE_DRIVER==='mysql'?Number(lock.locked)===1:lock.locked;
   if(!locked)fail(409,'다른 전송을 처리 중입니다. 완료 후 다시 시도해주세요.');
   const {rows:[job]}=await client.query('SELECT * FROM transfers WHERE id=$1 AND user_id=$2',[id,req.session.userId]);
   if(!job)fail(404,'전송 계획을 찾을 수 없습니다.');
   if(job.state==='done')return res.json(job.result);
   if(job.state!=='ready')fail(409,'이 전송은 다시 사용할 수 없습니다. 파일 비교부터 다시 진행해주세요.');
   if(Date.now()-new Date(job.created_at).getTime()>15*60000)fail(409,'파일 비교가 만료되었습니다. 다시 비교해주세요.');
   const p=job.plan;
   for(const n of p.items)if(n.status==='optional-readme'&&!['keep','add'].includes(choices[n.path]))fail(400,'README 전송 여부를 선택해주세요.');
   for(const n of p.items)if(n.status==='conflict'&&!['keep','replace'].includes(choices[n.path]))fail(400,'충돌한 모든 파일의 처리 방법을 선택해주세요.');
   await client.query("UPDATE transfers SET state='running' WHERE id=$1",[id]);claimed=true;
   const repo=await gh.accessible(req.session.userId,p.repo.id,p.repo.installationId);
   if(repo.fullName!==p.repo.fullName)fail(409,'저장소 이름이나 소유자가 바뀌었습니다. 다시 비교해주세요.');
   const snapshot=await gh.snapshot(req.session.userId,repo,p.branch);
   if(snapshot.head!==p.head)fail(409,'GitHub 파일이 비교 후 변경되었습니다. 다시 비교해주세요.');
   const {rows:local}=await client.query("SELECT path,hash FROM archive_nodes WHERE user_id=$1 AND kind='file'",[req.session.userId]);
   const active=local.filter(n=>p.filePath?n.path===p.filePath:inScope(n.path,p.scope)),map=new Map(active.map(n=>[n.path,n.hash]));
   if(active.length!==p.items.length||p.items.some(n=>map.get(n.path)!==n.hash))fail(409,'보관함 파일이 비교 후 변경되었습니다. 다시 비교해주세요.');
   const selected=p.items.filter(n=>n.status==='new'||n.status==='optional-readme'&&choices[n.path]==='add'||n.status==='conflict'&&choices[n.path]==='replace');
   let commitSha=p.head;
   if(selected.length){
    const tree=[];
    for(const n of selected){const content=(await readFile(join(dataRoot,n.hash))).toString('base64');const blob=await gh.request(req.session.userId,'POST',p.root+'/git/blobs',{content,encoding:'base64'});tree.push({path:n.path,mode:'100644',type:'blob',sha:blob.sha});}
    const createdTree=await gh.request(req.session.userId,'POST',p.root+'/git/trees',{base_tree:p.treeSha,tree});
    const commit=await gh.request(req.session.userId,'POST',p.root+'/git/commits',{message:'수업 자료 보관: '+(p.filePath||p.scope||'전체'),tree:createdTree.sha,parents:[p.head]});
    const latest=await gh.snapshot(req.session.userId,repo,p.branch);
    if(latest.head!==p.head)fail(409,'전송 준비 중 GitHub가 변경되었습니다. 다시 비교해주세요.');
    remoteStarted=true;
    // Never force: a competing commit will fail instead of overwriting other work.
    await gh.request(req.session.userId,'PATCH',`${p.root}/git/refs/heads/${encodeURIComponent(p.branch)}`,{sha:commit.sha,force:false});commitSha=commit.sha;
   }
   const result={ok:true,added:selected.filter(n=>n.status!=='conflict').length,replaced:selected.filter(n=>n.status==='conflict').length,kept:p.items.filter(n=>choices[n.path]==='keep'&&['conflict','optional-readme'].includes(n.status)).length,unchanged:p.items.filter(n=>n.status==='same').length,url:`https://github.com/${repo.fullName}/commit/${commitSha}`};
   await client.query('BEGIN');
   await client.query('INSERT INTO destinations(user_id,scope,repo_id,installation_id,full_name,branch) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,scope) DO UPDATE SET repo_id=EXCLUDED.repo_id,installation_id=EXCLUDED.installation_id,full_name=EXCLUDED.full_name,branch=EXCLUDED.branch',[req.session.userId,destinationScope(p.scope),repo.id,repo.installationId,repo.fullName,p.branch]);
   await client.query("UPDATE transfers SET state='done',result=$2 WHERE id=$1",[id,result]);await client.query('COMMIT');res.json(result);
  }catch(e){
   await client.query('ROLLBACK').catch(()=>{});
   if(claimed)await client.query("UPDATE transfers SET state=$2 WHERE id=$1",[id,remoteStarted?'uncertain':'failed']).catch(()=>{});
   if(remoteStarted && !e.status)fail(502,'GitHub 반영 여부를 확정하지 못했습니다. GitHub 결과를 확인하고 다시 비교해주세요.');
   throw e;
  }finally{if(locked)await client.query(config.DATABASE_DRIVER==='mysql'?'UNLOCK_USER':'SELECT pg_advisory_unlock(hashtext($1))',[req.session.userId]).catch(()=>{});client.release();}
 });
 app.get('/index.html',(req,res)=>res.redirect('/'));
 app.use(express.static(resolve('dist'),{index:'server.html',dotfiles:'deny'}));
 app.use((err,req,res,next)=>{
  const status=err.status&&err.status>=400&&err.status<600?err.status:500;
  // Never log tokens, connection strings, raw GitHub responses or uploaded contents.
  if(status===500)console.error('Server error:',err.code||err.name);
  const message=status===500?'서버 처리에 실패했습니다. 서버 실행 상태를 확인해주세요.':err.type==='entity.too.large'?'업로드 용량이 너무 큽니다.':err.message;
  if(req.path.startsWith('/api/'))res.status(status).json({error:message});
  else res.status(status).type('text').send(message);
 });
 return app;
}
