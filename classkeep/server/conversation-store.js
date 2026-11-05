import {randomUUID} from 'node:crypto';
export class ConversationStore {
 constructor(pool){this.pool=pool;this.busy=new Set();}
 async id(req){if(!req.session.assistantConversationId){req.session.assistantConversationId=randomUUID();await new Promise((ok,no)=>req.session.save(e=>e?no(e):ok()));}return req.session.assistantConversationId;}
 async read(req){const id=await this.id(req);const {rows:[row]}=await this.pool.query('SELECT messages,state FROM assistant_conversations WHERE id=$1 AND owner_id=$2',[id,String(req.session.userId)]);return {id,messages:row?JSON.parse(row.messages):[],state:row?JSON.parse(row.state):{}};}
 async save(req,memory,question,answer,state){const messages=[...memory.messages,{role:'user',content:question,at:Date.now()},{role:'assistant',content:answer,at:Date.now()}].slice(-100);await this.pool.query('INSERT INTO assistant_conversations(id,owner_id,messages,state) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET messages=EXCLUDED.messages,state=EXCLUDED.state,updated_at=now()',[memory.id,String(req.session.userId),JSON.stringify(messages),JSON.stringify(state||memory.state)]);}
 async reset(req){req.session.assistantConversationId=randomUUID();await new Promise((ok,no)=>req.session.save(e=>e?no(e):ok()));}
}
