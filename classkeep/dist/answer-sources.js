// Separate source presentation from model-generated answer text.
export function separateSources(text){
 const sources=[],byUrl=new Map();
 function add(url,label){
  try{const parsed=new URL(url);if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password)return '';if([...parsed.searchParams.keys()].some(k=>/^(authkey|servicekey|token|access_token|api_key)$/i.test(k)))return '';url=parsed.href;}catch{return '';}
  if(!byUrl.has(url)){byUrl.set(url,sources.length+1);sources.push({url,label:label||new URL(url).hostname});}
  return '[출처 '+byUrl.get(url)+']';
 }
 let body=String(text||'').replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s<>]+?)\)/g,(_,label,url)=>label+' '+add(url,label));
 body=body.replace(/https?:\/\/[^\s<>"'\)\]）]+/g,url=>{const clean=url.replace(/[.,;!?]+$/,'');return add(clean,'')+url.slice(clean.length);});
 const lines=[];
 for(const line of body.split('\n')){
  const clean=line.replace(/^[\s#*\-\d.)]+/,'').trim();
  if(/^(출처|참고\s*(자료|링크)|원문\s*링크)\s*[:：]?\s*$/.test(clean))continue;
  if(/^(출처|합격스펙 원문|합격자소서 목록|사례 원문)/.test(clean)&&line.includes('[출처 '))continue;
  if(/^(?:\(?\[출처 \d+\]\)?[,\s]*)+(?:를?\s*참고하세요[.!]?)?$/.test(clean))continue;
  if(/^출처\s*[:：]/.test(clean)&&!line.includes('[출처 ')){sources.push({label:clean.replace(/^출처\s*[:：]\s*/,''),url:null});continue;}
  lines.push(line);
 }
 return {body:lines.join('\n').replace(/\n{3,}/g,'\n\n').trim(),sources};
}
export function sourceSection(sources){
 const section=document.createElement('section');section.className='assistant-sources';const title=document.createElement('h4');title.textContent='출처';section.append(title);
 const list=document.createElement('ol');for(const source of sources){const item=document.createElement('li');if(source.url){const a=document.createElement('a');a.href=source.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=source.label;const url=document.createElement('small');url.textContent=source.url;item.append(a,url);}else item.textContent=source.label;list.append(item);}section.append(list);return section;
}
