import { DurableObject } from 'cloudflare:workers';
import serverModule from '../server.cjs';
import lifecycleModule from '../restaurant-lifecycle.cjs';

class SqlAdapter{
 constructor(storage){this.storage=storage}
 exec(sql){this.storage.sql.exec(sql)}
 prepare(sql){const storage=this.storage;return {all(...args){return storage.sql.exec(sql,...args).toArray()},get(...args){return storage.sql.exec(sql,...args).toArray()[0]},run(...args){const cursor=storage.sql.exec(sql,...args);cursor.toArray();return {changes:cursor.rowsWritten}}}}
 transaction(fn){return this.storage.transactionSync(fn)}
 close(){}
}
async function derive(password,salt,pepper){if(!pepper)throw Error('Password pepper secret is required');const encoder=new TextEncoder();const pepperKey=await crypto.subtle.importKey('raw',encoder.encode(pepper),{name:'HMAC',hash:'SHA-256'},false,['sign']);const protectedPassword=await crypto.subtle.sign('HMAC',pepperKey,encoder.encode(password));const key=await crypto.subtle.importKey('raw',protectedPassword,'PBKDF2',false,['deriveBits']);return new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:100000},key,256))}
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
async function passwordHash(password,pepper){const salt=crypto.getRandomValues(new Uint8Array(16));return `pbkdf2:${hex(salt)}:${hex(await derive(password,salt,pepper))}`}
async function passwordMatches(password,hash,pepper){const parts=hash.split(':');const valid=parts[0]==='pbkdf2'&&/^[a-f0-9]{32}$/.test(parts[1])&&/^[a-f0-9]{64}$/.test(parts[2]);const salt=valid?Uint8Array.from(parts[1].match(/../g),x=>parseInt(x,16)):new Uint8Array(16);const actual=hex(await derive(password,salt,pepper)),expected=valid?parts[2]:'0'.repeat(64);let diff=0;for(let i=0;i<actual.length;i++)diff|=actual.charCodeAt(i)^expected.charCodeAt(i);return valid&&diff===0}
function bridgeServer(handler){return {handler,close(fn){fn()},listen(){}}}
async function dispatch(app,request){return new Promise((resolve,reject)=>{
 const url=new URL(request.url),headers=Object.fromEntries(request.headers);headers.host=url.host;
 const req={url:url.pathname+url.search,method:request.method,headers,socket:{remoteAddress:headers['cf-connecting-ip']||'unknown'},async *[Symbol.asyncIterator](){if(request.body)for await(const chunk of request.body)yield Buffer.from(chunk)}};
 const responseHeaders=new Headers();const res={headersSent:false,statusCode:200,setHeader(name,value){responseHeaders.delete(name);for(const item of Array.isArray(value)?value:[value])responseHeaders.append(name,String(item))},getHeader(name){if(name.toLowerCase()==='set-cookie')return responseHeaders.getSetCookie();return responseHeaders.get(name)},writeHead(status,values={}){this.statusCode=status;for(const [k,v]of Object.entries(values))this.setHeader(k,v);this.headersSent=true},end(data){resolve(new Response(request.method==='HEAD'?null:data,{status:this.statusCode,headers:responseHeaders}))}};
 Promise.resolve(app.server.handler(req,res)).catch(reject);
 })}
export class DayinPlatform extends DurableObject{
 constructor(ctx,env){super(ctx,env);this.db=new SqlAdapter(ctx.storage);this.apps=new Map()}
 async fetch(request){const origin=new URL(request.url).origin;
  if(!this.apps.has(origin))this.apps.set(origin,this.ctx.blockConcurrencyWhile(()=>serverModule.createApp({db:this.db,origin,localMail:false,env:this.env,bootstrap:{admin:this.env.ADMIN_BOOTSTRAP_PASSWORD,owner:this.env.OWNER_BOOTSTRAP_PASSWORD},passwordHash:p=>passwordHash(p,this.env.PASSWORD_PEPPER),passwordMatches:(p,h)=>passwordMatches(p,h,this.env.PASSWORD_PEPPER),disableTimer:true,createServer:bridgeServer,readAsset:async asset=>{const response=await this.env.ASSETS.fetch(new Request(origin+'/'+asset));if(!response.ok)throw Error('Asset not found');return new Uint8Array(await response.arrayBuffer())}})));
  const app=await this.apps.get(origin);const response=await dispatch(app,request);
  const next=this.db.prepare('SELECT payload FROM restaurants').all().map(row=>JSON.parse(row.payload).deleteAt).filter(Number.isFinite).sort((a,b)=>a-b)[0];
  if(next)await this.ctx.storage.setAlarm(next);else await this.ctx.storage.deleteAlarm();
  return response;
 }
 async alarm(){lifecycleModule.purgeDueRestaurants(this.db);const next=this.db.prepare('SELECT payload FROM restaurants').all().map(row=>JSON.parse(row.payload).deleteAt).filter(Number.isFinite).sort((a,b)=>a-b)[0];if(next)await this.ctx.storage.setAlarm(next)}
}
export default{async fetch(request,env){return env.PLATFORM.getByName('dayin-platform-v1').fetch(request)}};
