import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { safePath, gitBlob, classify, inScope, destinationScope, seal, unseal } from './core.js';
import { parseReferenceQuestion } from '../dist/reference-scope.js';
test('question references: explicit leading GitHub scopes, deduplication and local prose',()=>{
 assert.deepEqual(parseReferenceQuestion('인공지능 자료를 정리해 줘'),{source:'archive',repositories:[],careerSites:[],question:'인공지능 자료를 정리해 줘'});
 assert.deepEqual(parseReferenceQuestion('  @student/course @student/notes @STUDENT/course 질문 내용'),{source:'github',repositories:['student/course','student/notes'],careerSites:[],question:'질문 내용'});
 assert.equal(parseReferenceQuestion('이 문장 속 @student/course는 예시').source,'archive');
 for(const text of ['@저장소 질문','@student/repo/../../secret 질문','@student/repo<script> 질문'])assert.throws(()=>parseReferenceQuestion(text));
 assert.throws(()=>parseReferenceQuestion('x'.repeat(8001)));
 assert.equal(parseReferenceQuestion('@student/course').question,'');
});
test('Korean paths preserved; traversal, metadata and invalid segments rejected',()=>{
 assert.equal(safePath('2026-2학기/인공지능/01주차/강의.hwp'),'2026-2학기/인공지능/01주차/강의.hwp');
 for(const p of ['../secret','/absolute','a//b','a/../b','a\\b','a/.git/config','a/\0x'])assert.throws(()=>safePath(p));
 assert.equal(safePath('',true),'');assert.equal(inScope('과목2/자료.pdf','과목'),false);
 assert.equal(destinationScope('2026-2학기/인공지능/01주차'),'2026-2학기/인공지능');
});
test('binary Git blob identity and remote path collisions',()=>{
 const bytes=Buffer.from([0,255,10,128]);const sha=gitBlob(bytes);
 const files=[{path:'same.bin',gitSha:sha},{path:'new.bin',gitSha:sha},{path:'different.bin',gitSha:sha},{path:'parent/file',gitSha:sha},{path:'link',gitSha:sha}];
 const tree=[{path:'same.bin',sha,type:'blob',mode:'100644'},{path:'different.bin',sha:'other',type:'blob',mode:'100644'},{path:'parent',type:'blob',mode:'100644'},{path:'link',sha,type:'blob',mode:'120000'}];
 assert.deepEqual(classify(files,tree).map(n=>n.status),['same','new','conflict','blocked','blocked']);
});
test('stored tokens encrypted and tampering rejected',()=>{
 const key=randomBytes(32).toString('hex'),data={access_token:'private-token',refresh_token:'private-refresh'};
 const sealed=seal(data,key);assert.ok(!sealed.includes('private-token'));assert.deepEqual(unseal(sealed,key),data);
 assert.throws(()=>unseal(sealed,randomBytes(32).toString('hex')));
 const bytes=Buffer.from(sealed,'base64');bytes[30]^=1;assert.throws(()=>unseal(bytes.toString('base64'),key));
});
