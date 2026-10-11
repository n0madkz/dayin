const fs=require('fs'),assert=require('node:assert/strict');
const origin=process.argv[2]||'http://127.0.0.1:8787';
const secrets=JSON.parse(fs.readFileSync('.runtime/cloudflare-secrets.json','utf8'));
const cookies={};
async function request(path,method='GET',data){const r=await fetch(origin+path,{method,headers:{Cookie:Object.entries(cookies).map(([k,v])=>k+'='+v).join('; '),...(data?{Origin:origin,'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});for(const item of r.headers.getSetCookie()){const pair=item.split(';')[0],index=pair.indexOf('=');cookies[pair.slice(0,index)]=pair.slice(index+1)}return r}
(async()=>{
 assert.equal((await request('/')).status,200);assert.equal((await request('/dev/mail')).status,404);
 let login=await request('/api/auth/login','POST',{email:'admin@dayin.test',password:secrets.ADMIN_BOOTSTRAP_PASSWORD});if(login.status===401)login=await request('/api/auth/login','POST',{email:'admin@dayin.test',password:secrets.ADMIN_BOOTSTRAP_PASSWORD+'!Changed'});assert.equal(login.status,200);const user=(await login.json()).user;
 if(user.mustChangePassword){const password=secrets.ADMIN_BOOTSTRAP_PASSWORD+'!Changed';assert.equal((await request('/api/auth/password','POST',{password,confirmPassword:password})).status,200)}
 assert.equal((await request('/api/account')).status,200);
 const catalog=await (await request('/api/catalog?manage=1')).json();assert.equal(catalog.restaurants.length,1);
 for(const format of ['svg','png']){const qr=await request('/api/restaurants/r1/qr?format='+format+'&size=512');assert.equal(qr.status,200);assert.ok((await qr.arrayBuffer()).byteLength>100)}
 const record=await request('/api/orders','POST',{restaurant:'r1',name:'Проверка Cloudflare',phone:'+77001234567',mode:'pickup',items:[{id:'d1',qty:1}]});assert.equal(record.status,201);
 const id=(await record.json()).record.id;assert.equal((await request('/api/orders/'+id,'PATCH',{cancel:true})).status,200);
 console.log('Cloudflare runtime: assets, closed mailbox, login, password change, persistent SQL, QR SVG/PNG, checkout and cancellation passed.');
})().catch(error=>{console.error(error.stack);process.exitCode=1});
