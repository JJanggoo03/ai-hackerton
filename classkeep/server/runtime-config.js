import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
export const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function parseSettings(text){
 const values={};for(const [index,raw] of text.replace(/^\uFEFF/,'').split(/\r?\n/).entries()){
  const line=raw.trim();if(!line||line.startsWith('#'))continue;const pos=line.indexOf('=');const key=line.slice(0,pos).trim();let value=line.slice(pos+1).trim();
  if(pos<0||!/^([A-Z][A-Z0-9_]*)$/.test(key))throw Error(`설정 ${index+1}번째 줄: 항목=값 형식을 확인해주세요.`);
  if(Object.hasOwn(values,key))throw Error(`설정 항목이 중복되었습니다: ${key}`);
  if(value.startsWith('"')||value.startsWith("'")){if(value.length<2||value.at(-1)!==value[0])throw Error(`설정 따옴표를 확인해주세요: ${key}`);value=value.slice(1,-1);}values[key]=value;
 }return values;
}
export function loadRuntimeConfig(){
 const path=process.env.CLASSKEEP_SETTINGS_FILE||resolve(root,'../프로그램설정.txt');let text;try{text=readFileSync(path,'utf8');}catch{throw Error('프로그램설정.txt 파일을 찾을 수 없습니다.');}
 const config={...process.env,...parseSettings(text)};
 for(const key of ['DATA_DIR','ELURI_SCRIPT_PATH','ELURI_PYTHON','ELURI_PROFILE_DIR'])if(config[key])config[key]=resolve(root,config[key]);
 // The Python launcher supplies a private local gateway; the text file always names the real Ollama server.
 if(process.env.CLASSKEEP_GATEWAY_URL){const url=new URL(process.env.CLASSKEEP_GATEWAY_URL);if(url.hostname!=='127.0.0.1'||url.protocol!=='http:')throw Error('내부 AI 게이트웨이 주소를 확인해주세요.');config.OLLAMA_BASE_URL=url.origin;config.OLLAMA_API_STYLE='chat';config.OLLAMA_GATEWAY_TASK='classkeep-study';config.CAREER_TEAM_BASE_URL=url.origin;config.CAREER_TEAM_AUTH_MODE='public';}
 else {config.OLLAMA_API_STYLE='chat';delete config.OLLAMA_GATEWAY_TASK;delete config.CAREER_TEAM_BASE_URL;}
 Object.assign(process.env,config);return config;
}
