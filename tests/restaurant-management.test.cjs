const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server.cjs');const {RETENTION_MS}=require('../restaurant-lifecycle.cjs');
test('multiple cuisines, admin-only statuses, password-confirmed deferred deletion, cancellation and restart cleanup',async()=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'dayin-management-'));let now=Date.now(),app=await createApp({dataDir,port:0,localMail:true,lifecycleNow:()=>now});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));let origin=`http://127.0.0.1:${app.server.address().port}`;
 // Host/origin checks require the allocated port in createApp's origin. Reopen the same database.
 const port=app.server.address().port;await app.close();app=await createApp({dataDir,port,origin,localMail:true,lifecycleNow:()=>now});await new Promise(r=>app.server.listen(port,'127.0.0.1',r));
 function client(){let cookie='';return async(p,method='GET',data)=>{const r=await fetch(origin+p,{method,headers:{Connection:'close',Cookie:cookie,...(data?{Origin:origin,'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});for(const v of r.headers.getSetCookie())if(v.startsWith('dayin_session='))cookie=v.split(';')[0];const body=await r.json();return {status:r.status,body}}}
 const admin=client(),owner=client(),guest=client(),password='Administrator-password-2026',ownerPassword='Restaurant-password-2026';
 const temp=email=>app.db.prepare('SELECT body FROM mailbox WHERE recipient=?').get(email).body.match(/Временный пароль: (\S+)/)[1];
 try{
  assert.equal((await admin('/api/auth/login','POST',{email:'admin@dayin.test',password:temp('admin@dayin.test')})).status,200);
  assert.equal((await admin('/api/auth/password','POST',{password,confirmPassword:password})).status,200);
  await owner('/api/auth/login','POST',{email:'aidos@dayin.test',password:temp('aidos@dayin.test')});await owner('/api/auth/password','POST',{password:ownerPassword,confirmPassword:ownerPassword});
  const settings={name:'Зелёный двор',desc:'Кухня',address:'Алматы',avg:5000,maxGuests:8,cuisines:['Казахская','Европейская']};
  const edited=await owner('/api/restaurants/r1','PATCH',settings);assert.equal(edited.status,200);assert.deepEqual(edited.body.restaurant.cuisines,settings.cuisines);
  assert.equal((await guest('/api/restaurants/r1/menu')).body.menu[0].category,'Салаты');
  assert.equal((await owner('/api/restaurants/r1/menu','POST',{id:'d1',name:'Салат с burrata',price:3900,category:'Закуски'})).status,200);
  assert.equal((await guest('/api/restaurants/r1/menu')).body.menu[0].category,'Закуски');
  assert.equal((await owner('/api/restaurants/r1/menu','POST',{id:'d1',name:'Салат с burrata',price:3900,category:'invalid'})).status,400);
  assert.equal((await guest('/api/restaurants/r1/menu','POST',{id:'d1',name:'Салат',price:3900,category:'Салаты'})).status,401);
  const threshold=await owner('/api/restaurants/r1','PATCH',{...settings,freeDeliveryAbove:10000});assert.equal(threshold.status,200);assert.equal(threshold.body.restaurant.freeDeliveryAbove,10000);
  assert.equal((await guest('/api/catalog')).body.restaurants[0].freeDeliveryAbove,10000);
  for(const freeDeliveryAbove of [-1,1.5,1000001,'invalid'])assert.equal((await owner('/api/restaurants/r1','PATCH',{...settings,freeDeliveryAbove})).status,400);
  assert.equal((await guest('/api/restaurants/r1','PATCH',{...settings,freeDeliveryAbove:0})).status,401);
  const cleared=await owner('/api/restaurants/r1','PATCH',{...settings,freeDeliveryAbove:''});assert.equal(cleared.body.restaurant.freeDeliveryAbove,null);
  for(const cuisines of [[],['Unknown'],['Казахская','Казахская'],'Казахская'])assert.equal((await owner('/api/restaurants/r1','PATCH',{...settings,cuisines})).status,400);
  const lifecycle='/api/restaurants/r1/lifecycle';
  assert.equal((await guest(lifecycle,'POST',{action:'status',status:'inactive'})).status,401);
  assert.equal((await owner(lifecycle,'POST',{action:'status',status:'inactive'})).status,403);
  assert.equal((await admin(lifecycle,'POST',{action:'status',status:'invalid'})).status,400);
  assert.equal((await admin(lifecycle,'POST',{action:'status',status:'inactive'})).status,200);
  assert.equal((await guest('/api/catalog')).body.restaurants.length,0);
  assert.equal((await guest('/api/catalog?manage=1')).status,401);
  assert.equal((await owner('/api/catalog?manage=1')).body.restaurants.length,1);
  assert.equal((await admin('/api/catalog?manage=1')).body.restaurants.length,1);
  const order={name:'Гость',phone:'+77001234567',restaurant:'r1',mode:'pickup',items:[{id:'d1',qty:1}]};
  assert.equal((await guest('/api/orders','POST',order)).status,409);
  assert.equal((await guest('/api/bookings','POST',{name:'Гость',phone:'+77001234567',restaurant:'r1',date:'2099-12-12',time:'19:00',guests:2})).status,409);
  await admin(lifecycle,'POST',{action:'status',status:'active'});assert.equal((await guest('/api/orders','POST',order)).status,201);
  const adminAccount=(await admin('/api/account')).body;assert.deepEqual(adminAccount.orders,[]);assert.deepEqual(adminAccount.bookings,[]);assert.equal(adminAccount.stats.orders,undefined);assert.equal((await owner('/api/account')).body.orders.length,1);
  assert.equal((await admin(lifecycle,'POST',{action:'schedule-delete',password:'wrong'})).status,403);
  assert.equal((await guest('/api/catalog')).body.restaurants[0].deleteAt,null);
  const scheduled=await admin(lifecycle,'POST',{action:'schedule-delete',password});assert.equal(scheduled.status,200);assert.equal(scheduled.body.restaurant.deleteAt,now+RETENTION_MS);assert.equal(scheduled.body.restaurant.status,'inactive');
  assert.equal((await admin(lifecycle,'POST',{action:'status',status:'active'})).status,409);
  assert.equal((await admin(lifecycle,'POST',{action:'schedule-delete',password})).status,409);
  assert.equal((await owner(lifecycle,'POST',{action:'cancel-delete'})).status,403);
  assert.equal((await admin(lifecycle,'POST',{action:'cancel-delete'})).status,200);assert.equal((await guest('/api/catalog')).body.restaurants[0].status,'active');
  await admin(lifecycle,'POST',{action:'schedule-delete',password});now+=RETENTION_MS-1;
  assert.equal((await admin('/api/catalog?manage=1')).body.restaurants.length,1);assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM records').get().n,1);
  await app.close();now++;app=await createApp({dataDir,port,origin,localMail:true,lifecycleNow:()=>now});await new Promise(r=>app.server.listen(port,'127.0.0.1',r));
  assert.equal((await admin('/api/catalog?manage=1')).body.restaurants.length,0);
  for(const table of ['restaurants','menus','records'])assert.equal(app.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0);
  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='owner'").get().n,0);
  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM mailbox WHERE recipient='aidos@dayin.test'").get().n,0);
  assert.equal((await owner('/api/account')).status,401);assert.equal((await admin('/api/account')).status,200);
 }finally{await app.close();fs.rmSync(dataDir,{recursive:true,force:true})}
});
