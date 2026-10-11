const assert=require('node:assert/strict');const origin=process.argv[2]||'http://127.0.0.1:8789';if(!['127.0.0.1','localhost'].includes(new URL(origin).hostname))throw Error('Local checks only');
async function send(path,data,cookie=''){return fetch(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(data)})}
async function patch(path,data,cookie=''){return fetch(origin+path,{method:'PATCH',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(data)})}
(async()=>{const created=await send('/api/orders',{restaurant:'r1',name:'Isolation check',phone:'+77001234567',mode:'pickup',items:[{id:'d1',qty:1}]});assert.equal(created.status,201);const cookie=created.headers.getSetCookie()[0].split(';')[0],{record}=await created.json();assert.ok(record.id.startsWith('r1~'));
assert.equal((await patch('/api/orders/'+record.id,{cancel:true})).status,403);
assert.equal((await patch('/api/bookings/'+record.id,{cancel:true},cookie)).status,404);
assert.equal((await patch('/api/orders/'+record.id,{status:'Готов'},'dayin_session='+'0'.repeat(64))).status,401);
assert.equal((await patch('/api/orders/'+record.id,{cancel:true},cookie)).status,200);
console.log('Sharded order privacy, record kind validation, invalid session and guest cancellation passed.');})().catch(e=>{console.error(e);process.exitCode=1});
