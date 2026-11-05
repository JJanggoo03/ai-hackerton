import {testDirectory} from './test-helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createApp } from './app.js';
import { Github } from './github.js';
import { gitBlob, seal } from './core.js';

test('real PostgreSQL API: login, originals, permissions, conflicts, commit and retries', {skip:!process.env.TEST_DATABASE_URL},async t=>{
 const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL});
 await pool.query(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
 const key=randomBytes(32).toString('hex');
 const repo={id:101,installationId:201,fullName:'student/archive',branch:'main',private:true};
 let head='head-1',writes=[],accessible=true,tree=[],created=0;
 const mock={
  configured:()=>true,
  repositories:async()=>accessible?[repo]:[],
  accessible:async(userId,id,installation)=>{if(!accessible||String(id)!=='101'||String(installation)!=='201')throw Object.assign(Error('권한 없음'),{status:403});return repo;},
  snapshot:async()=>({head,treeSha:'base-tree',tree,root:'/repos/student/archive'}),
  request:async(userId,method,path,body)=>{
   writes.push({method,path,body});
   if(path==='/user/repos'){created++;return{id:102,full_name:'student/new-repo'};}
   if(path.endsWith('/git/blobs'))return{sha:gitBlob(Buffer.from(body.content,'base64'))};
   if(path.endsWith('/git/trees'))return{sha:'tree-new'};
   if(path.endsWith('/git/commits'))return{sha:'commit-new'};
   if(method==='PATCH'){assert.equal(body.force,false);head=body.sha;return{};}
   throw Error('Unexpected mock request');
  }
 };
 const directory=await testDirectory(t,'test-blobs');
 const aiRequests=[];
 const app=await createApp(pool,{PUBLIC_URL:'http://localhost:3000',SESSION_SECRET:randomBytes(48).toString('hex'),TOKEN_KEY:key,DEMO_PASSCODE:'test-password-12345',DATA_DIR:directory,GITHUB_APP_SLUG:'classkeep-test',OLLAMA_BASE_URL:'http://test-ai.invalid'},mock,{assistantFetch:async(url,options)=>{aiRequests.push(JSON.parse(options.body));return new Response(JSON.stringify({response:'과적합 설명입니다. [1]'}));}});
 const server=app.listen(0,'127.0.0.1');await new Promise(ok=>server.once('listening',ok));
 t.after(async()=>{await new Promise(ok=>server.close(ok));await pool.end();});
 const base=`http://127.0.0.1:${server.address().port}`;
 let cookie='',csrf='';
 const request=async(path,body,extra={})=>{
  const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{cookie,...(body===undefined?{}:{'Content-Type':'application/json',Origin:'http://localhost:3000','X-CSRF-Token':csrf}),...extra},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
  if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];
  return {status:r.status,data:r.headers.get('content-type')?.includes('application/json')?await r.json():await r.text()};
 };
 assert.equal((await request('/api/nodes')).status,401);
 csrf=(await request('/api/session')).data.csrf;
 assert.equal((await request('/api/demo/login',{passcode:'test-password-12345'},{Origin:'https://evil.example'})).status,403);
 assert.equal((await request('/api/demo/login',{passcode:'bad'})).status,401);
 let result=await request('/api/demo/login',{passcode:'test-password-12345'});assert.equal(result.status,200);csrf=result.data.csrf;
 assert.equal((await request('/api/nodes/batch',{operations:[{action:'put',path:'../escape',kind:'folder'}]})).status,400);
 const binary=Buffer.from([0,255,10,128,1,2,3]),b64=binary.toString('base64');
 const operations=[{action:'put',path:'2026',kind:'folder'},{action:'put',path:'2026/인공지능',kind:'folder'},{action:'put',path:'2026/인공지능/강의.hwp',kind:'file',content:b64}];
 assert.equal((await request('/api/nodes/batch',{operations})).status,200);
 result=await request('/api/nodes');assert.equal(result.data.nodes.find(n=>n.kind==='file').content,b64);
 const otherUser='00000000-0000-4000-8000-000000000002';
 await pool.query("INSERT INTO users(id,name) VALUES($1,'과제 선택 권한 테스트') ON CONFLICT(id) DO NOTHING",[otherUser]);
 await pool.query("INSERT INTO archive_nodes(user_id,path,kind,hash,bytes,date) VALUES($1,'다른사용자.pdf','file',$2,7,$3) ON CONFLICT(user_id,path) DO NOTHING",[otherUser,'a'.repeat(64),Date.now()]);
 await request('/api/nodes/batch',{operations:[{action:'put',path:'내과제안내.pdf',kind:'file',content:Buffer.from('fixture PDF listing only').toString('base64')}]});
 const assignments=await request('/api/assistant/assignments');assert.equal(assignments.status,200);assert.deepEqual(assignments.data.files.map(f=>f.path),['내과제안내.pdf']);
 await request('/api/nodes/batch',{operations:[{action:'delete',path:'내과제안내.pdf'}]});await pool.query('DELETE FROM users WHERE id=$1',[otherUser]);
 // Partial malformed batch rolls back all metadata updates.
 assert.equal((await request('/api/nodes/batch',{operations:[{action:'put',path:'rollback',kind:'folder'},{action:'put',path:'missing/child',kind:'folder'}]})).status,409);
 assert.ok(!(await request('/api/nodes')).data.nodes.some(n=>n.path==='rollback'));
 const uid='00000000-0000-4000-8000-000000000001';
 await pool.query('INSERT INTO github_links(user_id,github_id,login,credentials) VALUES($1,1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET credentials=EXCLUDED.credentials',[uid,'student',seal({access_token:'fake'},key)]);
 result=await request('/api/assistant/prepare',{text:'강의 요약'});assert.equal(result.status,200);assert.equal(result.data.source,'archive');assert.equal(result.data.fileCount,1);assert.equal(result.data.aiConnected,false);
 result=await request('/api/assistant/prepare',{text:'@student/archive 강의 요약'});assert.equal(result.status,200);assert.equal(result.data.repositories[0].id,101);assert.equal(result.data.question,'강의 요약');
 assert.equal((await request('/api/assistant/prepare',{text:'@other/private 강의 요약'})).status,403);
 assert.equal((await request('/api/assistant/prepare',{text:'@student/archive'})).status,400);
 assert.equal((await request('/api/assistant/prepare',{text:'@student/archive/../private 질문'})).status,400);
 assert.equal((await request('/api/assistant/ask',{text:'@other/private 질문'})).status,403);assert.equal(aiRequests.length,0);
 const lecture=Buffer.from('과적합은 학습 데이터에 과도하게 적응하는 현상입니다.');
 assert.equal((await request('/api/nodes/batch',{operations:[{action:'put',path:'2026/인공지능/lecture.md',kind:'file',content:lecture.toString('base64')}]})).status,200);
 result=await request('/api/assistant/ask',{text:'과적합 설명'});assert.equal(result.status,200);assert.equal(result.data.readCount,1);assert.equal(result.data.sources[0].path,'2026/인공지능/lecture.md');assert.match(aiRequests[0].prompt,/과도하게 적응/);
 assert.equal((await request('/api/nodes/batch',{operations:[{action:'delete',path:'2026/인공지능/lecture.md'}]})).status,200);
 const plan=async()=>request('/api/github/plan',{scope:'2026/인공지능',repoId:101,installationId:201});
 result=await plan();assert.equal(result.status,200);assert.equal(result.data.items[0].status,'new');
 const first=result.data.id;
 head='someone-else';assert.equal((await request('/api/github/transfer',{id:first,choices:{}})).status,409);assert.equal(writes.length,0);
 result=await plan();
 const id=result.data.id;
 result=await request('/api/github/transfer',{id,choices:{}});assert.equal(result.status,200);assert.equal(result.data.added,1);
 assert.equal(writes.filter(n=>n.method==='PATCH').length,1);assert.equal(writes.find(n=>n.path.endsWith('/git/blobs')).body.content,b64);
 assert.equal(writes.find(n=>n.path.endsWith('/git/trees')).body.base_tree,'base-tree');
 assert.equal((await request('/api/github/transfer',{id,choices:{}})).status,200);assert.equal(writes.filter(n=>n.method==='PATCH').length,1);
 assert.equal((await request('/api/destinations')).data.destinations[0].scope,'2026/인공지능');
 tree=[{path:'2026',type:'tree',mode:'040000',sha:'x'},{path:'2026/인공지능',type:'tree',mode:'040000',sha:'y'},{path:'2026/인공지능/강의.hwp',type:'blob',mode:'100644',sha:'different'}];
 result=await plan();assert.equal(result.data.items[0].status,'conflict');const conflict=result.data.id;
 assert.equal((await request('/api/github/transfer',{id:conflict,choices:{}})).status,400);
 result=await request('/api/github/transfer',{id:conflict,choices:{'2026/인공지능/강의.hwp':'keep'}});assert.equal(result.data.kept,1);assert.equal(writes.filter(n=>n.method==='PATCH').length,1);
 result=await plan();const revoked=result.data.id;accessible=false;
 assert.equal((await request('/api/github/transfer',{id:revoked,choices:{'2026/인공지능/강의.hwp':'replace'}})).status,403);accessible=true;
 // Single-file plans never include siblings, and unrelated edits do not invalidate them.
 const singlePlan=()=>request('/api/github/plan',{filePath:'2026/인공지능/강의.hwp',scope:'ignored-client-scope',repoId:101,installationId:201});
 assert.equal((await request('/api/github/plan',{filePath:'../secret',repoId:101,installationId:201})).status,400);
 assert.equal((await request('/api/github/plan',{filePath:'2026/인공지능',repoId:101,installationId:201})).status,400);
 result=await singlePlan();assert.equal(result.status,200);assert.equal(result.data.items.length,1);assert.equal(result.data.items[0].path,'2026/인공지능/강의.hwp');assert.equal(result.data.scope,'2026/인공지능');
 const singleId=result.data.id;
 assert.equal((await request('/api/nodes/batch',{operations:[{action:'put',path:'2026/인공지능/다른파일.txt',kind:'file',content:Buffer.from('보내지 않을 형제 파일').toString('base64')}]})).status,200);
 const beforeSingle=writes.length;
 result=await request('/api/github/transfer',{id:singleId,choices:{'2026/인공지능/강의.hwp':'replace'}});assert.equal(result.status,200);assert.equal(result.data.replaced,1);
 const singleWrites=writes.slice(beforeSingle);assert.equal(singleWrites.filter(n=>n.path.endsWith('/git/blobs')).length,1);assert.equal(singleWrites.find(n=>n.path.endsWith('/git/blobs')).body.content,b64);
 assert.deepEqual(singleWrites.find(n=>n.path.endsWith('/git/trees')).body.tree.map(n=>n.path),['2026/인공지능/강의.hwp']);
 result=await singlePlan();const removedFilePlan=result.data.id;
 await request('/api/nodes/batch',{operations:[{action:'delete',path:'2026/인공지능/강의.hwp'}]});
 const beforeRemoved=writes.length;
 assert.equal((await request('/api/github/transfer',{id:removedFilePlan,choices:{'2026/인공지능/강의.hwp':'replace'}})).status,409);assert.equal(writes.length,beforeRemoved);
 await request('/api/nodes/batch',{operations:[{action:'put',path:'2026/인공지능/강의.hwp',kind:'file',content:b64},{action:'delete',path:'2026/인공지능/다른파일.txt'}]});
 assert.equal((await request('/api/github/repositories',{name:'new-repo'})).status,400);assert.equal(created,0);
 assert.equal((await request('/api/github/repositories',{name:'new-repo',confirm:true})).status,201);assert.equal(created,1);assert.equal(writes.find(n=>n.path==='/user/repos').body.private,true);
 assert.equal((await request('/api/github/disconnect',{})).status,200);assert.equal((await request('/api/destinations')).data.destinations.length,0);
 assert.equal((await pool.query('SELECT * FROM github_links')).rowCount,0);
 assert.equal((await request('/github/callback?code=untrusted&state=fake')).status,400);
 assert.equal((await request('/api/logout',{})).status,200);assert.equal((await request('/api/nodes')).status,401);
});

test('GitHub listing follows pagination and intersects installation/write access',async()=>{
 const gh=new Github(null,{GITHUB_APP_ID:'123'});const calls=[];
 gh.request=async(uid,method,path)=>{calls.push(path);if(path.startsWith('/user/installations?'))return{installations:[{id:1,app_id:123},{id:2,app_id:999}]};return{repositories:[{id:1,full_name:'user/allowed',permissions:{push:true},default_branch:'main',private:true},{id:2,full_name:'user/read-only',permissions:{push:false}},{id:3,full_name:'user/archived',permissions:{push:true},archived:true}]};};
 const repos=await gh.repositories('user');assert.equal(repos.length,1);assert.equal(repos[0].fullName,'user/allowed');assert.equal(calls.length,2);
});
