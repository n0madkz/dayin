const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('admin uses an independent workspace with working operational sections',async()=>{
 const elements={},el=s=>elements[s]||(elements[s]={innerHTML:'',addEventListener(){},showModal(){}});
 const user={role:'admin',name:'Администратор',mustChangePassword:false},r={id:'r1',name:'Зелёный двор',type:'Европейская',address:'Алматы',halal:{status:'pending',issuer:'Организация',number:'CERT-1'}};
 const data={'/api/auth/session':{user},'/api/catalog':{restaurants:[r],menus:{r1:[]}},'/api/account':{user,restaurants:[r],orders:[],bookings:[],owners:[{restaurant:'r1',name:'Владелец',email:'owner@example.test',delivery:'local'}]}};
 const context=vm.createContext({document:{querySelector:el},localStorage:{getItem:()=>null,setItem(){}},location:{pathname:'/admin',origin:'http://127.0.0.1:4173'},fetch:async url=>({ok:true,json:async()=>data[url.split('?')[0]]}),console,setTimeout:()=>1,clearTimeout(){},window:{scrollTo(){}}});
 for(const script of ['app','auth','admin','customer'])vm.runInContext(fs.readFileSync(`dist/${script}.js`,'utf8'),context);
 await vm.runInContext('appReady',context);
 // openWorkspace is started by renderAccount; wait for its asynchronous catalog/account refresh.
 await new Promise(resolve=>setImmediate(resolve));
 let html=el('#app').innerHTML;assert.ok(html.includes('class="admin-shell"'));assert.ok(html.includes('Всё под контролем.'));assert.ok(html.includes('Сертификатов халал на проверке: 1.'));assert.ok(!html.includes('Мои заказы'));assert.ok(!html.includes('Избранное'));assert.ok(!html.includes('ВАШЕ ЗАВЕДЕНИЕ'));
 for(const section of ['restaurants','orders','bookings','certificates','overview']){
  vm.runInContext(`selectAdminSection('${section}')`,context);html=el('#app').innerHTML;
  assert.ok(html.includes('aria-current="page"'));assert.ok(html.includes('class="admin-shell"'));
  for(const match of html.matchAll(/\bon(?:click|submit|change)="([^"]*)"/g))assert.doesNotThrow(()=>new vm.Script(match[1]));
 }
 vm.runInContext("selectAdminSection('certificates')",context);assert.ok(el('#app').innerHTML.includes('CERT-1'));assert.ok(el('#app').innerHTML.includes('Подтвердить'));
 vm.runInContext("selectAdminSection('restaurants');newRestaurant()",context);assert.ok(el('#modal').innerHTML.includes('ФИО владельца'));
  assert.ok(el('#app').innerHTML.includes('Деактивировать'));assert.ok(el('#app').innerHTML.includes('Удалить через 7 дней'));
  vm.runInContext("confirmRestaurantDeletion('r1')",context);assert.ok(el('#modal').innerHTML.includes('Текущий пароль администратора'));
  vm.runInContext("db.restaurants[0].status='inactive';db.restaurants[0].deleteAt=Date.now()+604800000;selectAdminSection('restaurants')",context);
  assert.ok(el('#app').innerHTML.includes('Отменить удаление'));assert.ok(el('#app').innerHTML.includes('Удаление запланировано'));assert.ok(!el('#app').innerHTML.includes('Деактивировать'));
});
