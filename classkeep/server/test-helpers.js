import {mkdtemp,rm,mkdir,rmdir,lstat} from 'node:fs/promises';
import {join,resolve,dirname,basename} from 'node:path';

export async function testDirectory(t,label){
 if(!/^[a-z0-9-]+$/i.test(label))throw Error('Invalid test directory label');
 const parent=resolve('.test-tmp'),prefix='classkeep-'+label+'-';
 let directory;
 for(let attempt=0;attempt<3;attempt++){
  await mkdir(parent,{recursive:true});
  if((await lstat(parent)).isSymbolicLink())throw Error('Test root must not be a link');
  try{directory=await mkdtemp(join(parent,prefix));break;}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 if(!directory)throw Error('Unable to create isolated test directory');
 t.after(async()=>{
  const target=resolve(directory);
  if(dirname(target)!==parent||!basename(target).startsWith(prefix))throw Error('Refusing to clean an unrelated directory');
  await rm(target,{recursive:true,force:true,maxRetries:3,retryDelay:100});
  await rmdir(parent).catch(e=>{if(!['ENOENT','ENOTEMPTY','EEXIST'].includes(e.code))throw e;});
 });
 return directory;
}
