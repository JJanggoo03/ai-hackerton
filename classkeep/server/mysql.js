import mysql from 'mysql2/promise';

export function sqlAndParams(sql, params=[]) {
 if(sql==='LOCK_USER')return {sql:'SELECT GET_LOCK(?,10) AS locked',params:['classkeep:'+String(params[0])]};
 if(sql==='UNLOCK_USER')return {sql:'SELECT RELEASE_LOCK(?) AS released',params:['classkeep:'+String(params[0])]};
 let statement=sql.replace(/::integer\b/gi,'').replace(/\bnow\(\)/gi,'CURRENT_TIMESTAMP');
 if(/\bON\s+CONFLICT\b/i.test(statement)){
  const update=statement.match(/\bON\s+CONFLICT\s*\([^)]*\)\s+DO\s+UPDATE\s+SET\s+([\s\S]*)$/i);
  if(update){statement=statement.replace(update[0],'ON DUPLICATE KEY UPDATE '+update[1].replace(/EXCLUDED\.([a-z_][a-z0-9_]*)/gi,'VALUES($1)'));}
  else statement=statement.replace(/\bON\s+CONFLICT(?:\s*\([^)]*\))?\s+DO\s+NOTHING\b/i,'');
 }
 const ordered=[];
 statement=statement.replace(/\$(\d+)/g,(_,n)=>{ordered.push(params[Number(n)-1]);return '?';});
 return {sql:statement.trimEnd(),params:ordered.length?ordered:params};
}
function adapt(connection) {
 return {
  async query(sql,params=[]){
   const q=sqlAndParams(sql,params);
   if(['BEGIN','COMMIT','ROLLBACK'].includes(q.sql.trim().toUpperCase())){
    if(q.sql.trim().toUpperCase()==='BEGIN')await connection.beginTransaction();
    else if(q.sql.trim().toUpperCase()==='COMMIT')await connection.commit();
    else await connection.rollback();
    return {rows:[],rowCount:0};
   }
   const [rows]=q.params.length?await connection.execute(q.sql,q.params):await connection.query(q.sql);
   return Array.isArray(rows)?{rows,rowCount:rows.length}:{rows:[],rowCount:rows.affectedRows||0,insertId:rows.insertId};
  },
  release(){connection.release();},
 };
}
export function createMysqlPool(config) {
 const raw=mysql.createPool({host:config.MYSQL_HOST,port:Number(config.MYSQL_PORT||3306),user:config.MYSQL_USER,password:config.MYSQL_PASSWORD||'',database:config.MYSQL_DATABASE,connectionLimit:10,connectTimeout:7000,waitForConnections:true,queueLimit:40,timezone:'Z',charset:'utf8mb4'});
 return {
  async query(sql,params=[]){const c=await raw.getConnection();try{return await adapt(c).query(sql,params);}finally{c.release();}},
  async connect(){return adapt(await raw.getConnection());},
  async end(){await raw.end();},
  async ping(){const c=await raw.getConnection();try{await c.ping();}finally{c.release();}},
 };
}
