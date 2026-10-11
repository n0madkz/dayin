import { DurableObject } from 'cloudflare:workers';
import recordsModule from '../order-record.cjs';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
export class RestaurantOrders extends DurableObject{
 constructor(ctx,env){super(ctx,env);ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,kind TEXT NOT NULL,guest TEXT NOT NULL,payload TEXT NOT NULL,revision INTEGER NOT NULL);CREATE INDEX IF NOT EXISTS orders_guest ON orders(guest,kind);CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,kind TEXT NOT NULL,guest TEXT NOT NULL,payload TEXT NOT NULL,revision INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS config(key TEXT PRIMARY KEY,value TEXT NOT NULL);`)}
 async submit(...args){try{return {record:await this.create(...args)}}catch(error){return {error:error.message,status:error.status||500}}}
 async update(...args){try{return {record:await this.change(...args)}}catch(error){return {error:error.message,status:error.status||500}}}
 async create(venueId,fields,kind,guest,ip,origin){
  const control=this.env.PLATFORM.getByName('dayin-platform-v1');
  const snapshot=await control.venue(venueId,origin);if(snapshot.error)fail(snapshot.status,snapshot.error);const {restaurant,menu}=snapshot;
  const bucket=ip+':'+Math.floor(Date.now()/600000);this.attempts??=new Map();const count=(this.attempts.get(bucket)||0)+1;this.attempts.set(bucket,count);if(count>60)fail(429,'Слишком много попыток. Попробуйте через 10 минут.');if(this.attempts.size>2000)this.attempts.clear();
  const record=recordsModule.createRecord(kind,fields,restaurant,menu,venueId+'~'+crypto.randomUUID());record.revision=1;
  this.ctx.storage.transactionSync(()=>{this.ctx.storage.sql.exec('INSERT INTO orders VALUES(?,?,?,?,?)',record.id,kind,guest,JSON.stringify(record),1);this.ctx.storage.sql.exec('INSERT INTO outbox VALUES(?,?,?,?,?)',record.id,kind,guest,JSON.stringify(record),1)});
  await this.flush(origin);return record;
 }
 async change(id,kind,fields,guest,user,origin){
  const row=this.ctx.storage.sql.exec('SELECT * FROM orders WHERE id=? AND kind=?',id,kind).toArray()[0];if(!row)fail(404,'Заявка не найдена');
  const record=recordsModule.updateRecord(JSON.parse(row.payload),fields,row.guest,guest,user);record.revision=row.revision+1;
  this.ctx.storage.transactionSync(()=>{this.ctx.storage.sql.exec('UPDATE orders SET payload=?,revision=? WHERE id=?',JSON.stringify(record),record.revision,id);this.ctx.storage.sql.exec('INSERT OR REPLACE INTO outbox VALUES(?,?,?,?,?)',id,row.kind,row.guest,JSON.stringify(record),record.revision)});
  await this.flush(origin);return record;
 }
 async flush(origin){this.ctx.storage.sql.exec("INSERT OR REPLACE INTO config VALUES('origin',?)",origin);
  try{const control=this.env.PLATFORM.getByName('dayin-platform-v1');for(const row of this.ctx.storage.sql.exec('SELECT * FROM outbox LIMIT 100').toArray()){await control.indexRecord(JSON.parse(row.payload),row.guest,row.kind,row.revision,origin);this.ctx.storage.sql.exec('DELETE FROM outbox WHERE id=? AND revision=?',row.id,row.revision)}}catch(error){console.error('Order index retry scheduled',error.message);await this.ctx.storage.setAlarm(Date.now()+60000)}
 }
 async lifecycle(deleteAt){if(deleteAt)this.ctx.storage.sql.exec("INSERT OR REPLACE INTO config VALUES('deleteAt',?)",String(deleteAt));else this.ctx.storage.sql.exec("DELETE FROM config WHERE key='deleteAt'");await this.scheduleAlarm()}
 async scheduleAlarm(){const deletion=this.ctx.storage.sql.exec("SELECT value FROM config WHERE key='deleteAt'").toArray()[0];const hasOutbox=this.ctx.storage.sql.exec('SELECT id FROM outbox LIMIT 1').toArray().length;const next=Math.min(deletion?Number(deletion.value):Infinity,hasOutbox?Date.now()+60000:Infinity);if(Number.isFinite(next))await this.ctx.storage.setAlarm(next);else await this.ctx.storage.deleteAlarm()}
 async alarm(){const deletion=this.ctx.storage.sql.exec("SELECT value FROM config WHERE key='deleteAt'").toArray()[0];if(deletion&&Number(deletion.value)<=Date.now()){await this.ctx.storage.deleteAll();return}const origin=this.ctx.storage.sql.exec("SELECT value FROM config WHERE key='origin'").toArray()[0]?.value;if(origin)await this.flush(origin);await this.scheduleAlarm()}
}
