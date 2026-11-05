export async function boundedBody(response,max=1024*1024){
 const reader=response.body?.getReader();if(!reader)return Buffer.alloc(0);
 const parts=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)throw Error('Response too large');parts.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
 return Buffer.concat(parts);
}
function token(html){return html.match(/name=["']csrf-token["']\s+content=["']([^"']+)/i)?.[1]||html.match(/name=["']csrf_token["'][^>]*value=["']([^"']+)/i)?.[1];}
export async function openTeamSession(config,{fetchImpl=fetch,signal}={}){
 const base=new URL(config.CAREER_TEAM_BASE_URL);
 if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw Error('Invalid team server');
 const cookies=new Map();
 async function request(path,options={},timeout=35000){
  const response=await fetchImpl(new URL(path,base),{...options,headers:{...options.headers,...(cookies.size?{Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; ')}:{})},redirect:'manual',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout)});
  for(const cookie of response.headers.getSetCookie()){const part=cookie.split(';')[0],index=part.indexOf('=');if(index>0)cookies.set(part.slice(0,index),part.slice(index+1));}
  return response;
 }
 let csrf='';
 const authMode=config.CAREER_TEAM_AUTH_MODE||'password';
 if(authMode==='password'){
 let response=await request('/');if(!response.ok)throw Error('Team server unavailable');
 let html=(await boundedBody(response)).toString('utf8');csrf=token(html);if(!csrf)throw Error('Team login changed');
 response=await request('/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:base.origin,Referer:base.href},body:new URLSearchParams({csrf_token:csrf,password:config.CAREER_TEAM_PASSWORD})});
 if(![302,303].includes(response.status)||response.headers.get('location')!=='/'){await response.body?.cancel();throw Error('Team login failed');}await response.body?.cancel();
 response=await request('/');html=(await boundedBody(response)).toString('utf8');csrf=token(html);
 if(!response.ok||!csrf||/action=["']\/login["']/.test(html))throw Error('Team login failed');
 }else if(authMode!=='public')throw Error('Invalid team authentication mode');
 return {async references(company){
  const r=await request('/api/career/references',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf,Origin:base.origin,Referer:base.href},body:JSON.stringify({company_name:company})},90000);
  if(r.status===404){await r.body?.cancel();return null;}
  if(!r.ok){await r.body?.cancel();throw Error('Team reference request failed');}
  const data=JSON.parse((await boundedBody(r)).toString('utf8'));
  if(data.error||data.schema_version!==1||!Array.isArray(data.records))throw Error('Invalid reference response');
  return data;
 },async discover(company){
  const r=await request('/api/chat',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf,Origin:base.origin,Referer:base.href},body:JSON.stringify({message:company})});
  if(!r.ok){await r.body?.cancel();throw Error('Team discovery failed');}
  const data=JSON.parse((await boundedBody(r)).toString('utf8'));
  if(data.error||typeof data.reply!=='string'||!data.reply.trim())throw Error('Invalid team discovery response');
  return data.reply.slice(0,16000);
 }};
}
