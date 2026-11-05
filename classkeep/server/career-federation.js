// Each task owns its URL, credentials and response mapping. Only independent tasks run together.
// Dependencies such as list -> detail belong inside a task's search function.
export function createFederatedAdapter(tasks,{concurrency=3,timeoutMs=20000}={}){
 const enabledTasks=tasks.filter(t=>t.enabled!==false&&typeof t.search==='function');
 const allowedHosts=[...new Set(enabledTasks.flatMap(t=>t.allowedHosts||[]))];
 return {enabled:enabledTasks.length>0,allowedHosts,async search(query,context={}){
  const kinds=context.apiKinds||['jobs'];
  const selected=enabledTasks.filter(t=>!t.capabilities?.length||t.capabilities.some(k=>kinds.includes(k)));
  const records=[],warnings=[],taskTimings=[];let cursor=0;
  async function worker(){while(cursor<selected.length){
   const task=selected[cursor++],start=performance.now();const controller=new AbortController();let timer;
   try{
    const signal=context.signal?AbortSignal.any([context.signal,controller.signal]):controller.signal;
    const result=await Promise.race([Promise.resolve().then(()=>task.search(query,{...context,signal})),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('timeout'));},timeoutMs);})]);
    if(!Array.isArray(result))throw Error('invalid task response');
    records.push(...result.slice(0,50).map(r=>({...r,apiTask:task.id})));
    taskTimings.push({id:task.id,milliseconds:Math.round(performance.now()-start),ok:true});
   }catch{warnings.push(`${task.label||task.id}: 조회하지 못했습니다.`);taskTimings.push({id:task.id,milliseconds:Math.round(performance.now()-start),ok:false});}
   finally{clearTimeout(timer);}
  }}
  await Promise.all(Array.from({length:Math.min(Math.max(1,concurrency),selected.length)},worker));
  return {records,warnings,taskTimings};
 }};
}
