const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('public navigation has one restaurant and no cabinet shortcut; first login is a separate screen',async()=>{
  const elements={};const el=s=>elements[s]||(elements[s]={innerHTML:'',textContent:'',style:{},querySelector(){return null},addEventListener(){},focus(){},setSelectionRange(){},showModal(){}});
  const r={id:'r1',name:'Зелёный двор',type:'Европейская',desc:'Кухня',address:'Алматы',rating:'—',time:'25–35',avg:6500,img:'photo-1414235077428-338989a2e8c0',tag:'Зарегистрированное заведение'};
  const data={'/api/auth/session':{user:null,localMail:true},'/api/catalog':{restaurants:[r],menus:{r1:[]}},'/api/my':{orders:[],bookings:[]},'/api/restaurants/r1/menu':{restaurant:r,menu:[]}};
  const storage={};const context=vm.createContext({document:{querySelector:el},localStorage:{getItem:key=>storage[key]||null,setItem(key,value){storage[key]=value}},location:{pathname:'/',origin:'http://127.0.0.1:4173',hostname:'127.0.0.1'},URLSearchParams,window:{scrollTo(){}},fetch:async url=>({ok:true,json:async()=>data[url.split('?')[0]]}),console,setTimeout:()=>1,clearTimeout(){},FormData:class{constructor(f){return new Map(Object.entries(f))}}});
  vm.runInContext(fs.readFileSync('dist/app.js','utf8'),context);vm.runInContext(fs.readFileSync('dist/auth.js','utf8'),context);vm.runInContext(fs.readFileSync('dist/admin.js','utf8'),context);vm.runInContext(fs.readFileSync('dist/customer.js','utf8'),context);await vm.runInContext('appReady',context);
  const html=el('#app').innerHTML;assert.equal((html.match(/class="card"/g)||[]).length,1);assert.ok(!html.includes('Кабинет ресторана'));assert.ok(!html.includes('Кабинеты'));assert.ok(!html.includes('Администратор'));assert.ok(!html.includes('/register'));assert.ok(!html.includes('class="avatar"'));assert.ok(!html.includes('>Г</')); 
  assert.ok(html.includes('onclick="chooseCity()"'));vm.runInContext('chooseCity()',context);assert.ok(el('#modal').innerHTML.includes('Сейчас сервис доступен в Атырау.'));vm.runInContext('selectCity("Алматы")',context);assert.equal(storage['dayin-city'],undefined);elements['#modal'].close=()=>{};vm.runInContext('selectCity("Атырау")',context);assert.equal(storage['dayin-city'],'Атырау');
  vm.runInContext('db.menus.r1=[{id:"salad",name:"Салат",category:"Салаты",price:1000},{id:"burger",name:"Бургер",category:"Фастфуд",price:2000}];current="r1";page="detail"',context);
  assert.ok(vm.runInContext('detail()',context).includes('role="tablist"'));
  vm.runInContext('selectDishCategory(1)',context);assert.equal(vm.runInContext('visibleDishes(current)[0].id',context),'salad');assert.equal(vm.runInContext('visibleDishes(current).length',context),1);
  vm.runInContext('startMenuSwipe({touches:[{clientX:200,clientY:100}]});endMenuSwipe({changedTouches:[{clientX:50,clientY:110}]})',context);assert.equal(vm.runInContext('visibleDishes(current)[0].id',context),'burger');
  vm.runInContext('startMenuSwipe({touches:[{clientX:50,clientY:100}]});endMenuSwipe({changedTouches:[{clientX:200,clientY:110}]})',context);assert.equal(vm.runInContext('selectedDishCategory',context),'Салаты');
  vm.runInContext('startMenuSwipe({touches:[{clientX:50,clientY:100}]});endMenuSwipe({changedTouches:[{clientX:65,clientY:250}]})',context);assert.equal(vm.runInContext('selectedDishCategory',context),'Салаты');
  assert.ok(vm.runInContext('editMenu()',context).includes('name="category"'));vm.runInContext('selectedDishCategory="Все блюда";db.menus.r1=[]',context);
  vm.runInContext('registration()',context);assert.ok(el('#app').innerHTML.includes('ФИО владельца'));assert.ok(el('#app').innerHTML.includes('Электронная почта'));
  vm.runInContext("authUser={name:'Сәрсенов Айдос Нұрланұлы',mustChangePassword:true};changePassword()",context);assert.ok(el('#app').innerHTML.includes('Повторите новый пароль'));assert.ok(!el('#app').innerHTML.includes('Редактор меню'));
  vm.runInContext('authUser=null;renderAccount()',context);assert.ok(el('#app').innerHTML.includes('Логин — электронная почта'));
  vm.runInContext("authUser={name:'Владелец',role:'owner',restaurant:'r1'};tab='qr'",context);
  const panel=vm.runInContext('business()',context);assert.ok(panel.includes('QR меню'));assert.ok(panel.includes('Сгенерировать QR-код'));assert.ok(panel.includes('Скачать SVG'));assert.ok(panel.includes('Скачать PNG'));assert.ok(panel.includes('/menu/r1'));
  vm.runInContext("qrGeneratedFor='r1'",context);assert.ok(vm.runInContext('qrPanel()',context).includes('/api/restaurants/r1/qr?format=svg'));
  context.location.pathname='/menu/r1';await vm.runInContext('start()',context);assert.ok(el('#app').innerHTML.includes('Меню ресторана'));
  for(const maxGuests of [1,3,12]){
    vm.runInContext(`db.restaurants[0].maxGuests=${maxGuests};bookingModal('r1')`,context);
    const select=el('#modal').innerHTML.match(/<select name="guests">([\s\S]*?)<\/select>/)[1];
    assert.equal((select.match(/<option/g)||[]).length,maxGuests);
    assert.ok(!select.includes(`>${maxGuests+1}</option>`));
  }
  vm.runInContext("editRestaurantModal('r1')",context);assert.ok(el('#modal').innerHTML.includes('name="maxGuests"'));assert.ok(el('#modal').innerHTML.includes('value="12"'));
  assert.ok(el('#modal').innerHTML.includes('Сертификация халал'));
  assert.ok(!vm.runInContext("card(db.restaurants[0])",context).includes('class="halal-badge"'));
  for(const status of ['pending','rejected']){vm.runInContext(`db.restaurants[0].halal={status:'${status}',issuer:'Организация',number:'TEST',validUntil:'2099-12-12',certificateUrl:'https://example.com/certificate.pdf'}`,context);assert.ok(!vm.runInContext('halalBadge(db.restaurants[0])',context))}
  vm.runInContext("db.restaurants[0].halal.status='verified'",context);assert.ok(vm.runInContext('card(db.restaurants[0])',context).includes('class="halal-badge"'));assert.ok(vm.runInContext('detail()',context).includes('class="halal-badge"'));
  vm.runInContext("showHalalCertificate('r1')",context);assert.ok(el('#modal').innerHTML.includes('Сертификат халал'));assert.ok(el('#modal').innerHTML.includes('https://example.com/certificate.pdf'));
  vm.runInContext("db.restaurants[0].halal.validUntil='2000-01-01'",context);assert.ok(!vm.runInContext('halalBadge(db.restaurants[0])',context));
  vm.runInContext('authUser=null;page="discover";render()',context);assert.ok(el('#app').innerHTML.includes('aria-label="Основная навигация"'));assert.ok(el('#app').innerHTML.includes('<span>Еда</span>'));assert.ok(el('#app').innerHTML.includes('<span>Корзина '));assert.ok(!el('#app').innerHTML.includes('Войти'));assert.ok(!el('#app').innerHTML.includes('/profile'));assert.equal(vm.runInContext('typeof customerEntry',context),'undefined');
  vm.runInContext('page="cart";render()',context);assert.ok(el('#app').innerHTML.includes('Пока ничего не выбрано'));
  vm.runInContext('authUser={role:"customer",name:"Айша",email:"aisha@dayin.test"};page="profile";render()',context);assert.ok(!el('#app').innerHTML.includes('Здравствуйте, Айша'));assert.ok(!el('#app').innerHTML.includes('<span>Кабинет</span>'));assert.equal(vm.runInContext('page',context),'discover');
  vm.runInContext('authUser=null;db.menus.r1=[{id:"test-dish",name:"Салат",price:3900,img:"photo-test"}];current="r1";add("test-dish");page="cart";render()',context);assert.ok(el('#app').innerHTML.includes('Оформить без регистрации'));assert.ok(el('#app').innerHTML.includes('Салат'));
  assert.ok(!el('#app').innerHTML.includes('Войти'));assert.ok(!el('#app').innerHTML.includes('личном кабинете'));
  assert.equal(JSON.parse(storage['dayin-cart']).items['test-dish'],1);
  vm.runInContext('cart={};cartRestaurant=null;restoreCart()',context);assert.equal(vm.runInContext('cartCount()',context),1);
  vm.runInContext('db.restaurants.push({...db.restaurants[0],id:"r2",name:"Второй ресторан"});db.menus.r2=[{id:"second-dish",name:"Суп",price:2500}];current="r2"',context);
  for(const deliveryMode of ['delivery','pickup']){
    vm.runInContext(`mode='${deliveryMode}';add('second-dish')`,context);
    assert.equal(vm.runInContext('cartRestaurant',context),'r1');
    assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(cart)',context)),{'test-dish':1});
    assert.ok(vm.runInContext('detail()',context).includes('В корзине уже есть блюда из другого ресторана'));
  }
  const orderButton={disabled:false},orderEvent={preventDefault(){},target:{name:'Гость',phone:'+77001234567',querySelector:()=>orderButton}};
  context.orderEvent=orderEvent;
  vm.runInContext('const originalApi=api;api=async()=>{throw Error("Временно недоступно")}',context);
  await vm.runInContext('submitOrder(orderEvent)',context);
  assert.equal(vm.runInContext('cartRestaurant',context),'r1');assert.equal(vm.runInContext('cartCount()',context),1);
  vm.runInContext('let submittedOrder;api=async(url,method,data)=>{if(url==="/api/orders")submittedOrder=data;return {orders:[],bookings:[]}}',context);
  await vm.runInContext('submitOrder(orderEvent)',context);
  assert.equal(vm.runInContext('submittedOrder.restaurant',context),'r1');
  assert.equal(vm.runInContext('cartRestaurant',context),null);assert.equal(vm.runInContext('cartCount()',context),0);
  assert.equal(JSON.parse(storage['dayin-cart']).restaurant,null);
  vm.runInContext('current="r2";add("second-dish");api=originalApi',context);
  assert.equal(vm.runInContext('cartRestaurant',context),'r2');assert.equal(vm.runInContext('cartCount()',context),1);
  vm.runInContext('adjust("second-dish",-1)',context);assert.equal(vm.runInContext('cartRestaurant',context),null);
  for(const html of [el('#app').innerHTML,el('#modal').innerHTML])for(const match of html.matchAll(/\bon(?:click|submit|change|load|error)="([^"]*)"/g))assert.doesNotThrow(()=>new vm.Script(match[1].replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&')));
  vm.runInContext(`const base=db.restaurants[0];db.restaurants=[
    {...base,id:'eu',name:'CERT_EURO',type:'Европейская',halal:{status:'verified',validUntil:'2099-12-12'}},
    {...base,id:'it',name:'CERT_ITALIAN',type:'Итальянская',halal:{status:'verified',validUntil:'2099-12-12'}},
    {...base,id:'pending',name:'PENDING',type:'Европейская',halal:{status:'pending',validUntil:'2099-12-12'}},
    {...base,id:'expired',name:'EXPIRED',type:'Европейская',halal:{status:'verified',validUntil:'2000-01-01'}},
    {...base,id:'none',name:'NO_CERT',type:'Казахская',halal:null}
  ];page='discover';category='Все';halalOnly=true;query=''`,context);
  let filtered=vm.runInContext('catalog()',context);assert.equal((filtered.match(/class="card"/g)||[]).length,2);assert.ok(!filtered.includes('PENDING'));assert.ok(!filtered.includes('EXPIRED'));assert.ok(!filtered.includes('NO_CERT'));assert.ok(filtered.includes('aria-pressed="true"'));
  vm.runInContext("category='Итальянская'",context);filtered=vm.runInContext('catalog()',context);assert.equal((filtered.match(/class="card"/g)||[]).length,1);assert.ok(filtered.includes('CERT_ITALIAN'));assert.ok(!filtered.includes('CERT_EURO'));
  vm.runInContext("query='CERT_EURO'",context);filtered=vm.runInContext('catalog()',context);assert.ok(!filtered.includes('class="card"'));assert.ok(filtered.includes('Ничего не найдено'));
  vm.runInContext('resetCatalogFilters()',context);assert.equal((el('#app').innerHTML.match(/class="card"/g)||[]).length,5);assert.ok(el('#app').innerHTML.includes('Все виды кухни'));
  vm.runInContext("halalOnly=true;toggleCuisine('Европейская');toggleCuisine('Итальянская')",context);
  assert.equal((el('#app').innerHTML.match(/class="card"/g)||[]).length,2);assert.ok(el('#app').innerHTML.includes('Выбрано: 2'));
  const chips=vm.runInContext('catalogFilters()',context);assert.ok(chips.includes('class="cuisine-chips"'));assert.ok(!chips.includes('<select'));assert.ok(!chips.includes('<details'));assert.ok(chips.includes('onclick="toggleCuisine(\'Итальянская\')"'));
  vm.runInContext("toggleCuisine('Европейская')",context);assert.equal((el('#app').innerHTML.match(/class="card"/g)||[]).length,1);
  vm.runInContext("resetCatalogFilters();db.restaurants[0].cuisines=['Европейская','Казахская'];toggleCuisine('Казахская')",context);
  assert.ok(el('#app').innerHTML.includes('CERT_EURO'));assert.ok(el('#app').innerHTML.includes('NO_CERT'));
  assert.ok(vm.runInContext('cuisineSettings(db.restaurants[0])',context).includes('value="Казахская" checked'));
  assert.ok(vm.runInContext('cuisineSettings(db.restaurants[0])',context).includes('value="Европейская" checked'));
  vm.runInContext('halalOnly=true;clearCuisineSelection()',context);assert.equal(vm.runInContext('selectedCuisines.length',context),0);assert.equal(vm.runInContext('halalOnly',context),true);
});
