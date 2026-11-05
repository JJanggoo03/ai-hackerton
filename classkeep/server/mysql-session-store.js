import session from 'express-session';
export class MysqlSessionStore extends session.Store {
 constructor(pool){super();this.pool=pool;}
 get(sid,callback){this.pool.query('SELECT sess FROM sessions WHERE sid=? AND expires>CURRENT_TIMESTAMP',[sid]).then(({rows})=>{
  let sess=rows[0]?.sess||null;
  // MariaDB exposes its JSON alias as text, while MySQL may return a parsed object.
  if(typeof sess==='string')try{sess=JSON.parse(sess);}catch{sess=null;}
  callback(null,sess);
 },callback);}
 set(sid,sess,callback=()=>{}){
  const expiry=sess.cookie?.expires?new Date(sess.cookie.expires):new Date(Date.now()+86400000);
  this.pool.query('INSERT INTO sessions(sid,expires,sess) VALUES(?,?,?) ON DUPLICATE KEY UPDATE expires=VALUES(expires),sess=VALUES(sess)',[sid,expiry,JSON.stringify(sess)]).then(()=>callback(null),callback);
 }
 destroy(sid,callback=()=>{}){this.pool.query('DELETE FROM sessions WHERE sid=?',[sid]).then(()=>callback(null),callback);}
 touch(sid,sess,callback=()=>{}){const expiry=sess.cookie?.expires?new Date(sess.cookie.expires):new Date(Date.now()+86400000);this.pool.query('UPDATE sessions SET expires=? WHERE sid=?',[expiry,sid]).then(()=>callback(null),callback);}
}
