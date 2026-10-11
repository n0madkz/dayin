const fs=require('fs'),assert=require('node:assert/strict');
const origin=process.argv[2];if(!origin)throw Error('Pass the deployed HTTPS URL');
const secrets=JSON.parse(fs.readFileSync('.runtime/cloudflare-secrets.json','utf8'));
(async()=>{
 for(const path of ['/','/admin','/account','/theme.css','/api/catalog'])assert.equal((await fetch(origin+path)).status,200,path);
 for(const path of ['/dev/mail','/api/dev/mail','/profile'])assert.equal((await fetch(origin+path)).status,404,path);
 for(const [email,key]of [['admin@dayin.test','ADMIN_BOOTSTRAP_PASSWORD'],['aidos@dayin.test','OWNER_BOOTSTRAP_PASSWORD']]){
  const response=await fetch(origin+'/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email,password:secrets[key],audience:'business'})});assert.equal(response.status,200,email);
  const user=(await response.json()).user;assert.equal(user.mustChangePassword,true);
  const cookie=response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
  assert.equal((await fetch(origin+'/api/account',{headers:{Cookie:cookie}})).status,403);
  await fetch(origin+'/api/auth/logout',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:'{}'});
 }
 console.log('Live HTTPS: catalog, assets, admin/owner login, required password change, and disabled public mailbox passed.');
})().catch(error=>{console.error(error.stack);process.exitCode=1});
