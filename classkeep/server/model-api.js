import {fail} from './core.js';
export function modelSettings(config){
 if(!config.OLLAMA_BASE_URL)fail(503,'AI 서버 주소가 설정되지 않았습니다. OLLAMA_BASE_URL을 확인해주세요.');
 let base;try{base=new URL(config.OLLAMA_BASE_URL);}catch{fail(503,'AI 서버 주소 형식을 확인해주세요.');}
 if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash)fail(503,'AI 서버 주소 설정을 확인해주세요.');
 const suffix=base.pathname.match(/\/api\/(chat|generate)\/?$/);
 const style=config.OLLAMA_API_STYLE||suffix?.[1]||'generate';
 if(!['chat','generate'].includes(style))fail(503,'OLLAMA_API_STYLE은 chat 또는 generate여야 합니다.');
 if(suffix)base.pathname=base.pathname.replace(/api\/(?:chat|generate)\/?$/,'');
 const url=new URL('api/'+style,base.href.endsWith('/')?base.href:base.href+'/');
 const task=config.OLLAMA_GATEWAY_TASK||'';
 if(task&&task!=='classkeep-study')fail(503,'AI 게이트웨이 작업 설정을 확인해주세요.');
 if(task&&style!=='chat')fail(503,'학습 도우미 게이트웨이는 chat 형식으로 설정해주세요.');
 return {url,style,model:config.OLLAMA_MODEL||'qwen2.5:7b',...(task?{task}:{})};
}
export function modelPayload(settings,payload){
 if(settings.style!=='chat')return payload;
 const {system,prompt,...rest}=payload;
 return {...rest,messages:[...(system?[{role:'system',content:system}]:[]),{role:'user',content:prompt}],...(settings.task?{task:settings.task}:{})};
}
export function modelText(settings,data){
 if(settings.task&&data.classkeep_study_version!==1)fail(503,'친구 서버에 자료 기반 질문용 교체 파일을 적용하고 다시 실행해주세요.');
 const text=settings.style==='chat'?data.message?.content:data.response;
 return typeof text==='string'?text.replace(/<think>[\s\S]*?<\/think>/g,'').trim():'';
}
