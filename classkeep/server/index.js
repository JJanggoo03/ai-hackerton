import {loadRuntimeConfig} from './runtime-config.js';
import pg from 'pg';
import {createMysqlPool} from './mysql.js';
import { readFile } from 'node:fs/promises';
import { createApp } from './app.js';

const config=loadRuntimeConfig();
function isPrivateLanIPv4(host){
 const parts=host.split('.').map(Number);if(parts.length!==4||parts.some(n=>!Number.isInteger(n)||n<0||n>255))return false;
 return parts[0]===10||parts[0]===192&&parts[1]===168||parts[0]===172&&parts[1]>=16&&parts[1]<=31;
}
for(const k of ['PUBLIC_URL','SESSION_SECRET','TOKEN_KEY','DEMO_PASSCODE'])if(!config[k])throw Error(`${k} 설정이 없습니다. 프로그램설정.txt를 수정해주세요.`);
if(config.SESSION_SECRET.length<32||!/^[0-9a-f]{64}$/i.test(config.TOKEN_KEY)||config.DEMO_PASSCODE.length<12)throw Error('서버 비밀값 길이를 확인해주세요. 프로그램설정.txt의 보안 항목을 확인해주세요.');
const url=new URL(config.PUBLIC_URL);
if(url.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(url.hostname)&&!(url.protocol==='http:'&&isPrivateLanIPv4(url.hostname)))throw Error('외부 서버 주소에는 HTTPS가 필요합니다. HTTP는 localhost 또는 사설 LAN IPv4 주소에서만 허용됩니다.');
const dialect=config.DATABASE_DRIVER||'postgres';
if(!['postgres','mysql'].includes(dialect))throw Error('DATABASE_DRIVER는 postgres 또는 mysql이어야 합니다.');
if(dialect==='postgres'&&!config.DATABASE_URL)throw Error('DATABASE_URL이 없습니다.');
if(dialect==='mysql'&&!['MYSQL_HOST','MYSQL_USER','MYSQL_DATABASE'].every(k=>config[k]))throw Error('MySQL 연결정보 MYSQL_HOST, MYSQL_USER, MYSQL_DATABASE를 프로그램설정.txt에 설정해주세요. MYSQL_PASSWORD는 계정에 비밀번호가 있을 때만 입력하세요.');
const pool=dialect==='mysql'?createMysqlPool(config):new pg.Pool({connectionString:config.DATABASE_URL,connectionTimeoutMillis:5000});
try{
 const schema=await readFile(new URL(dialect==='mysql'?'./schema.mysql.sql':'./schema.sql',import.meta.url),'utf8');
 if(dialect==='mysql')for(const statement of schema.split(';').map(s=>s.trim()).filter(Boolean))await pool.query(statement);
 else await pool.query(schema);
 if(dialect==='mysql'){
  const {rows:[index]}=await pool.query("SELECT COUNT(*) AS present FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='github_links' AND index_name='github_links_github_id_uq'");
  if(Number(index.present)===0)await pool.query('CREATE UNIQUE INDEX github_links_github_id_uq ON github_links(github_id)');
 }else await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS github_links_github_id_uq ON github_links(github_id)');
 const app=await createApp(pool,config);
 const server=app.listen(Number(config.PORT||3000),config.HOST||'127.0.0.1',()=>console.log(`수업 자료 보관함 서버: ${config.PUBLIC_URL}/#archive`));
 const stop=()=>server.close(()=>pool.end().then(()=>process.exit(0)));
 process.on('SIGINT',stop);process.on('SIGTERM',stop);
}catch(e){const message=e.code==='28P01'?'PostgreSQL 접속 비밀번호를 확인해주세요.':e.code==='ER_HOST_NOT_PRIVILEGED'?'MySQL이 앱 서버의 접속 위치를 허용하지 않습니다. MySQL 계정의 Host 권한과 서버의 원격 접속 IP 허용 목록을 확인해주세요.':e.code==='ER_ACCESS_DENIED_ERROR'?'MySQL 사용자명과 비밀번호, 해당 서버 접속 권한을 확인해주세요.':e.code==='ER_BAD_DB_ERROR'?'MYSQL_DATABASE에 지정한 데이터베이스가 없습니다.':e.code==='ECONNREFUSED'?'선택한 SQL 서버의 주소·포트와 서버 실행 상태를 확인해주세요.':e.code||e.name;console.error('서버 시작 실패:',message);await pool.end();process.exitCode=1;}
