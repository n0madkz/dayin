const crypto=require('node:crypto');
function fail(status,message){throw Object.assign(new Error(message),{status})}
function text(value,label,max){if(typeof value!=='string'||!value.trim()||value.trim().length>max)fail(400,`Проверьте поле «${label}»`);return value.trim()}
function createRecord(kind,fields,venue,menu,id=crypto.randomUUID()){
 if(venue.status==='inactive'||venue.deleteAt)fail(409,'Заведение временно не принимает заказы и бронирования');
 const name=text(fields.name,'Имя',80),phone=text(fields.phone,'Телефон',20);if(!/^[+0-9 ()-]{10,20}$/.test(phone))fail(400,'Проверьте телефон');
 let record={id,restaurant:venue.id,name,phone,note:typeof fields.note==='string'?fields.note.slice(0,300):''};
 if(kind==='orders'){
  if(!['delivery','pickup'].includes(fields.mode)||!Array.isArray(fields.items)||!fields.items.length||fields.items.length>100)fail(400,'Некорректный заказ');
  const seen=new Set(),items=fields.items.map(item=>{const dish=menu.find(d=>d.id===item.id);if(!dish||!Number.isInteger(item.qty)||item.qty<1||item.qty>99||seen.has(item.id))fail(400,'Проверьте состав заказа');seen.add(item.id);return {...dish,qty:item.qty}});
  const subtotal=items.reduce((sum,d)=>sum+d.price*d.qty,0),freeDelivery=fields.mode==='delivery'&&Number.isInteger(venue.freeDeliveryAbove)&&subtotal>venue.freeDeliveryAbove;
  record={...record,items,total:subtotal,subtotal,freeDelivery,deliveryFee:fields.mode==='pickup'||freeDelivery?0:null,freeDeliveryAbove:venue.freeDeliveryAbove??null,address:fields.mode==='delivery'?text(fields.address,'Адрес',200):'',mode:fields.mode==='delivery'?'Доставка':'Самовывоз',status:'Новый',date:new Date().toLocaleString('ru-RU',{timeZone:'Asia/Bishkek'})};
 }else{
  const when=Date.parse(`${fields.date}T${fields.time}:00+06:00`),guests=Number(fields.guests);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(fields.date)||!['12:00','13:00','14:00','17:00','18:00','19:00','20:00','21:00'].includes(fields.time)||!Number.isFinite(when)||when<=Date.now()||!Number.isInteger(guests)||guests<1)fail(400,'Проверьте дату, время и количество гостей');
  if(guests>venue.maxGuests)fail(400,`Ресторан принимает максимум ${venue.maxGuests} гостей в одной брони. Выберите меньшее количество.`);
  record={...record,date:fields.date,time:fields.time,guests:String(guests),status:'Ожидает подтверждения'};
 }
 return record;
}
function updateRecord(record,fields,rowGuest,guest,user){
 if(fields.cancel){if(rowGuest!==guest)fail(403,'Нет доступа к этой заявке');if(['Завершён','Отменён','Отменено','Гости пришли'].includes(record.status))fail(409,'Заявка уже завершена');return {...record,status:record.items?'Отменён':'Отменено'}}
 if(!user)fail(401,'Войдите в личный кабинет');if(user.mustChangePassword)fail(403,'Сначала задайте новый пароль');if(user.role!=='admin'&&!(user.role==='owner'&&user.restaurant===record.restaurant))fail(403,'Нет доступа к этому заведению');
 const statuses=record.items?['Новый','Принят','Готовится','Готов к выдаче','В пути','Завершён','Отменён']:['Ожидает подтверждения','Подтверждено','Гости пришли','Отменено'];if(!statuses.includes(fields.status))fail(400,'Недопустимый статус');return {...record,status:fields.status};
}
module.exports={createRecord,updateRecord};
