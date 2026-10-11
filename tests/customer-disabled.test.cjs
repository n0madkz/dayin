const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const {createApp}=require('../server.cjs');
const {customerAuth,normalizePhone,futureRegistrationRequest,sendWhatsAppCode}=require('../future/customer-auth.cjs');
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port}
test('future customer contract uses phone and WhatsApp without sending messages',async()=>{
 assert.equal(customerAuth.enabled,false);assert.equal(customerAuth.identity,'phone');assert.equal(customerAuth.verificationChannel,'whatsapp');
 assert.equal(normalizePhone('+7 (700) 123-45-67'),'+77001234567');
 assert.deepEqual(futureRegistrationRequest({phone:'+7 700 123 45 67'}),{phone:'+77001234567',channel:'whatsapp',purpose:'customer-sign-in'});
 for(const phone of ['aisha@example.com','87001234567','+00001234','+7','+7700abc12345'])assert.throws(()=>normalizePhone(phone));
 await assert.rejects(sendWhatsAppCode(),/отключена/);
});
test('customer routes, legacy email login, and old sessions are disabled; guest checkout stays available',async()=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'dayin-disabled-')),port=await freePort(),origin=`http://127.0.0.1:${port}`;
 const app=await createApp({dataDir,port,origin,localMail:true});await new Promise(r=>app.server.listen(port,'127.0.0.1',r));
 const salt='1234567890abcdef',password='legacy-test-password',digest=salt+':'+crypto.scryptSync(password,salt,64).toString('hex');
 const token='a'.repeat(64);let cookie='dayin_session='+token;
 const request=async(p,method='GET',data)=>{const r=await fetch(origin+p,{method,headers:{Connection:'close',Cookie:cookie,...(data?{Origin:origin,'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});for(const value of r.headers.getSetCookie()){const pair=value.split(';')[0];if(pair.startsWith('dayin_guest='))cookie+='; '+pair}return r};
 try{
  app.db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,?)').run('legacy','old@dayin.test','Клиент',null,'customer',digest,0,null,'local',1);
  app.db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(crypto.createHash('sha256').update(token).digest('hex'),'legacy',Date.now()+28800000);
  const state=await (await request('/api/auth/session')).json();assert.equal(state.user,null);assert.equal(state.customerAuth.enabled,false);assert.equal(state.customerAuth.verificationChannel,'whatsapp');
  for(const route of ['/profile','/login','/signup','/api/customer/profile'])assert.equal((await request(route)).status,404);
  assert.equal((await request('/api/customer/register','POST',{phone:'+77001234567'})).status,404);
  assert.equal((await request('/api/customer/register','POST',{name:'Клиент',email:'new@dayin.test'})).status,404);
  assert.equal((await request('/api/auth/login','POST',{email:'old@dayin.test',password})).status,404);
  assert.equal((await request('/api/auth/login','POST',{email:'old@dayin.test',password,audience:'customer'})).status,404);
  assert.equal((await request('/api/auth/password','POST',{password:'another-long-password',confirmPassword:'another-long-password'})).status,401);
  assert.equal((await request('/api/account')).status,401);
  const order=await request('/api/orders','POST',{name:'Гость',phone:'+77001234567',restaurant:'r1',mode:'pickup',items:[{id:'d1',qty:1}]});assert.equal(order.status,201);
  const booking=await request('/api/bookings','POST',{name:'Гость',phone:'+77001234567',restaurant:'r1',date:'2099-12-12',time:'19:00',guests:'2'});assert.equal(booking.status,201);
  const history=await (await request('/api/my')).json();assert.equal(history.orders.length,1);assert.equal(history.bookings.length,1);
  assert.equal(app.db.prepare('SELECT customer FROM records WHERE id=?').get(history.orders[0].id).customer,null);
  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='customer'").get().n,1);
 }finally{await app.close();fs.rmSync(dataDir,{recursive:true,force:true})}
});
