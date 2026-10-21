const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/../invoice-workspace.js','utf8').split('(() => {')[0],ctx=vm.createContext({});vm.runInContext(source,ctx);const calc=(items,vat=false,basis='exclusive',type='none',value=0)=>ctx.invoiceDiscountTotals(items,vat,basis,type,value);
const item=(price,rate=20,quantity=1)=>({description:'Work',unit_price:price,vat_rate:rate,quantity});
let t=calc([item(100)],true,'exclusive','percent',10);assert.equal(t.total,108);assert.equal(t.subtotal,90);assert.equal(t.vat_total,18);
t=calc([item(120)],true,'inclusive','fixed',12);assert.equal(t.total,108);assert.equal(t.subtotal,90);assert.equal(t.vat_total,18);
t=calc([item(100,20),item(100,5),item(100,0)],true,'exclusive','fixed',30);assert.equal(t.total,292.5);assert.equal(t.vat_total,22.5);assert.equal(t.discount_amount,30);
t=calc([item(.01),item(.01),item(.01)],false,'exclusive','fixed',.02);assert.equal(t.total,.01);assert.equal(t.items.reduce((s,i)=>s+Math.round(i.discount_amount*100),0),2);
assert.equal(calc([item(10)],false,'exclusive','percent',100).total,0);
for(const [type,value]of [['fixed',11],['percent',101],['fixed',-1],['percent',NaN],['fixed',Infinity],['percent',1.005]])assert.throws(()=>calc([item(10)],false,'exclusive',type,value));
for(let k=1;k<300;k++){const items=[item(k/100,20,1.1),item((k+17)/100,5,2),item((k+3)/100,0)],t=calc(items,true,'inclusive','percent',17.35);assert.equal(Math.round(t.total*100),Math.round(t.before_discount*100)-Math.round(t.discount_amount*100));assert.equal(Math.round(t.total*100),Math.round(t.subtotal*100)+Math.round(t.vat_total*100));assert.equal(t.items.reduce((s,i)=>s+Math.round(i.discount_amount*100),0),Math.round(t.discount_amount*100));}
assert.equal(calc([item(1.005)],false).total,1.01);
console.log('PASS: exact discount/VAT totals, mixed rates, inclusive/exclusive, penny allocation, 100% preview and invalid discount rejection.');
