const {test}=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite'),{catalogPage}=require('../catalog.cjs');
test('1000 venues: bounded pages, stable cursors, full-catalog filtering and owner isolation',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE restaurants(id TEXT PRIMARY KEY,payload TEXT NOT NULL)');
 const insert=db.prepare('INSERT INTO restaurants VALUES(?,?)');for(let n=0;n<1000;n++){const id='r'+String(n).padStart(4,'0');insert.run(id,JSON.stringify({id,name:n===999?'100% cafe':'Cafe '+n,status:n===998?'inactive':'active',deleteAt:null,cuisines:[n%2?'Казахская':'Итальянская'],halal:n===999?{status:'verified',validUntil:'2099-01-01'}:null}))}
 let page=catalogPage(db,new URLSearchParams(),null);assert.equal(page.total,999);assert.equal(page.restaurants.length,24);assert.deepEqual(page.menus,{});
 const ids=new Set();do{page.restaurants.forEach(r=>{assert.ok(!ids.has(r.id));ids.add(r.id)});if(!page.nextCursor)break;page=catalogPage(db,new URLSearchParams({cursor:page.nextCursor}),null)}while(true);assert.equal(ids.size,999);
 page=catalogPage(db,new URLSearchParams({query:'100%'}),null);assert.equal(page.total,1);assert.equal(page.restaurants[0].id,'r0999');
 page=catalogPage(db,new URLSearchParams('cuisine=Казахская&halal=1'),null);assert.equal(page.total,1);
 page=catalogPage(db,new URLSearchParams('cuisine=Казахская&cuisine=Итальянская'),null);assert.equal(page.total,999);
 page=catalogPage(db,new URLSearchParams({limit:'1000'}),{role:'admin'});assert.equal(page.restaurants.length,48);assert.equal(page.total,1000);
 page=catalogPage(db,new URLSearchParams(),{role:'owner',restaurant:'r0998'});assert.equal(page.total,1);assert.equal(page.restaurants[0].id,'r0998');db.close();
});
