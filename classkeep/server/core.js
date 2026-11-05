import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

export function fail(status, message) { throw Object.assign(new Error(message), { status }); }
export function safePath(value, empty = false) {
 if (empty && value === '') return value;
 if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 1024 || /[\\\x00-\x1f\x7f]/.test(value) || value.split('/').some(p => !p || p === '.' || p === '..' || p.toLowerCase() === '.git')) fail(400, '파일 경로를 확인해주세요.');
 return value;
}
export const hashBytes = b => createHash('sha256').update(b).digest('hex');
export const gitBlob = b => createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
export const inScope = (path, scope) => !scope || path.startsWith(scope + '/');
export const destinationScope = scope => scope.split('/').slice(0,2).join('/');
export function classify(files, tree) {
 const remote = new Map(tree.map(n => [n.path, n]));
 return files.map(n => {
  const r = remote.get(n.path);
  const ancestor = n.path.split('/').slice(0,-1).some((_,i,a) => { const p=a.slice(0,i+1).join('/'); return remote.has(p) && remote.get(p).type !== 'tree'; });
  return { ...n, status: ancestor || (r && (r.type !== 'blob' || !['100644','100755'].includes(r.mode))) ? 'blocked' : !r ? 'new' : r.sha === n.gitSha ? 'same' : 'conflict' };
 });
}
export function seal(data, key) {
 const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', Buffer.from(key,'hex'), iv);
 const body = Buffer.concat([c.update(JSON.stringify(data)), c.final()]);
 return Buffer.concat([iv,c.getAuthTag(),body]).toString('base64');
}
export function unseal(value, key) {
 const b=Buffer.from(value,'base64'), d=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),b.subarray(0,12));
 d.setAuthTag(b.subarray(12,28));
 return JSON.parse(Buffer.concat([d.update(b.subarray(28)),d.final()]).toString());
}
