const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {PNG}=require('pngjs'),jsQR=require('jsqr'),{createApp}=require('../server.cjs');
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port}
test('QR exports decode to the public restaurant menu, enforce owner access, and preserve the link after menu edits',async()=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'dayin-qr-')),port=await freePort(),origin=`http://127.0.0.1:${port}`;
 const app=await createApp({dataDir,port,origin,localMail:true});await new Promise(r=>app.server.listen(port,'127.0.0.1',r));
 let cookie='';const request=async(p,method='GET',data)=>{const r=await fetch(origin+p,{method,headers:{Connection:'close',Cookie:cookie,...(data?{Origin:origin,'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});for(const v of r.headers.getSetCookie())if(v.startsWith('dayin_session='))cookie=v.split(';')[0];return r};
 const endpoint='/api/restaurants/r1/qr';
 try{
   assert.equal((await request(endpoint+'?format=png')).status,401);
   const mail=app.db.prepare('SELECT body FROM mailbox WHERE recipient=?').get('aidos@dayin.test').body;
   const password=mail.match(/Временный пароль: (\S+)/)[1];
   await request('/api/auth/login','POST',{email:'aidos@dayin.test',password});
   assert.equal((await request(endpoint)).status,403);
   await request('/api/auth/password','POST',{password:'qr-test-password-long',confirmPassword:'qr-test-password-long'});
   const menuUrl=origin+'/menu/r1';assert.equal((await (await request(endpoint)).json()).menuUrl,menuUrl);
   assert.equal((await request(endpoint+'?format=jpg')).status,400);assert.equal((await request(endpoint+'?format=png&size=999999')).status,400);
   for(const size of [512,1024,2048]){
     const response=await request(endpoint+`?format=png&size=${size}&download=1`);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.ok(response.headers.get('content-disposition').includes('attachment'));
     const bytes=Buffer.from(await response.arrayBuffer());assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);
     const png=PNG.sync.read(bytes);assert.equal(png.width,size);assert.equal(png.height,size);assert.equal(jsQR(new Uint8ClampedArray(png.data),png.width,png.height).data,menuUrl);
   }
   const svgResponse=await request(endpoint+'?format=svg&download=1');assert.ok(svgResponse.headers.get('content-type').startsWith('image/svg+xml'));
   const svg=await svgResponse.text();assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'));assert.ok(!svg.includes('<script'));
   // Rasterize the actual exported SVG's horizontal module strokes and decode it independently.
   const dimension=Number(svg.match(/viewBox="0 0 (\d+)/)[1]),scale=8,width=dimension*scale;
   const rgba=new Uint8ClampedArray(width*width*4).fill(255),stroke=svg.match(/stroke="#[0-9a-fA-F]+" d="([^"]+)"/)[1];
   let x=0,y=0;for(const match of stroke.matchAll(/([Mmh])([\d.]+)(?: ([\d.]+))?/g)){
     const n=Number(match[2]);if(match[1]==='M'){x=n;y=Number(match[3])}else if(match[1]==='m'){x+=n;y+=Number(match[3])}else{for(let py=Math.round((y-.5)*scale);py<Math.round((y+.5)*scale);py++)for(let px=x*scale;px<(x+n)*scale;px++){const i=(py*width+px)*4;rgba[i]=rgba[i+1]=rgba[i+2]=0}x+=n}
   }
   assert.equal(jsQR(rgba,width,width).data,menuUrl);
   assert.equal((await request('/menu/r1')).status,200);assert.equal((await request('/menu/missing')).status,404);
   await request('/api/restaurants/r1/menu','POST',{id:'d1',name:'Новое блюдо',price:4000});assert.equal((await (await request(endpoint)).json()).menuUrl,menuUrl);
   await request('/api/auth/register','POST',{email:'other-qr@dayin.test',name:'Тест Владелец',restaurantName:'Другое кафе'});
   const otherMail=app.db.prepare('SELECT body FROM mailbox WHERE recipient=?').get('other-qr@dayin.test').body;
   await request('/api/auth/login','POST',{email:'other-qr@dayin.test',password:otherMail.match(/Временный пароль: (\S+)/)[1]});
   await request('/api/auth/password','POST',{password:'other-qr-password-long',confirmPassword:'other-qr-password-long'});
   assert.equal((await request(endpoint+'?format=svg')).status,403);
 }finally{await app.close();fs.rmSync(dataDir,{recursive:true,force:true})}
});
