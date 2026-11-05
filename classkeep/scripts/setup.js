import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {root} from '../server/runtime-config.js';
const file=resolve(root,'../프로그램설정.txt');
if(process.platform==='win32'){const child=spawn('notepad.exe',[file],{detached:true,stdio:'ignore'});child.unref();}else console.log('프로그램설정.txt를 텍스트 편집기로 열어 수정해주세요.');
