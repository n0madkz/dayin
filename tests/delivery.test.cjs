const {test}=require('node:test'),assert=require('node:assert/strict'),{createRecord}=require('../order-record.cjs');
test('delivery threshold is strict, computed from server prices and never adds a hidden charge',()=>{
const venue={id:'r1',status:'active',freeDeliveryAbove:10000},menu=[{id:'d',price:5000}],fields={name:'Guest',phone:'+77001234567',mode:'delivery',address:'Atyrau',items:[{id:'d',qty:2}],total:999999,freeDelivery:true};
let record=createRecord('orders',fields,venue,menu);assert.equal(record.total,10000);assert.equal(record.freeDelivery,false);assert.equal(record.deliveryFee,null);
record=createRecord('orders',{...fields,items:[{id:'d',qty:3}]},venue,menu);assert.equal(record.total,15000);assert.equal(record.freeDelivery,true);assert.equal(record.deliveryFee,0);
record=createRecord('orders',fields,{...venue,freeDeliveryAbove:null},menu);assert.equal(record.freeDelivery,false);
record=createRecord('orders',{...fields,mode:'pickup'},venue,menu);assert.equal(record.deliveryFee,0);assert.equal(record.freeDelivery,false);
});
