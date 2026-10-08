const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{parseHTML}=require('linkedom'),{jsPDF}=require('jspdf'),{webcrypto}=require('node:crypto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8'),{window}=parseHTML(html);let ctx,calls=[],emails=[],shares=[],shareError=null;
window.jspdf={jsPDF};window.supabase={createClient:()=>({rpc:async(name,payload)=>{calls.push({name,payload});
 if(name==='create_driver_invoice'){
 const p=payload.p_invoice,inv={...p,id:'issued',invoice_number:'DT-2026-0001',status:'unpaid',total:150,items:p.items.map(i=>({...i,line_total:150}))};vm.runInContext('appState.invoices=[]',ctx);ctx.fixture=inv;vm.runInContext('appState.invoices=[fixture]',ctx);return {data:inv.id,error:null};}
 return {data:'income-id',error:null};},functions:{invoke:async(name,payload)=>{emails.push(payload.body);return {data:{ok:true,id:'accepted'},error:null}}}})};
const navigator={canShare:()=>true,share:async payload=>{if(shareError)throw shareError;shares.push(payload);}};
ctx=vm.createContext({window,document:window.document,console,Date,setTimeout:()=>0,Blob,File,URL,navigator,crypto:webcrypto,confirm:()=>true});
const script=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).find(x=>x.includes('let appState'));vm.runInContext(script,ctx);const run=s=>vm.runInContext(s,ctx),doc=window.document;
for(const id of ['invoice-list-filter','invoice-payment-income'])Object.defineProperty(doc.getElementById(id),'value',{writable:true,value:id==='invoice-list-filter'?'all':''});
doc.getElementById('invoice-create-form').reset=()=>{};
run("appState.currentUser={id:'driver',email:'driver@example.test'};appState.profile={full_name:'Test Driver'};fetchUserData=async()=>{};showToast=()=>{};");
assert.equal(run('calculateInvoiceTotal([{quantity:1.1,unit_price:10.01}])'),11.01);assert.throws(()=>run('calculateInvoiceTotal([{quantity:-1,unit_price:10}])'));
(async()=>{
 run('openInvoiceCreate()');assert.equal(doc.getElementById('invoice-seller-name').value,'Test Driver');
 for(const[id,value]of [['seller-address','1 Test Road, Birmingham'],['seller-contact','driver@example.test'],['customer-name','Example Customer'],['customer-address','2 Test Road, Birmingham'],['customer-email','customer@example.test'],['payment-details','Bank transfer - use invoice number']])doc.getElementById('invoice-'+id).value=value;
 const row=doc.querySelector('.invoice-item');row.querySelector('[data-invoice-field="description"]').value='Airport transfer';row.querySelector('[data-invoice-field="unit_price"]').value='150';
 run('updateInvoiceTotal()');assert.ok(doc.getElementById('invoice-total-preview').textContent.includes('£150.00'));
 await run('issueDriverInvoice({preventDefault(){}})');assert.equal(calls.length,0);doc.getElementById('invoice-non-vat').checked=true;
 await run('issueDriverInvoice({preventDefault(){}})');assert.equal(calls.length,1);assert.equal(calls[0].payload.p_invoice.customer_name,'Example Customer');assert.ok(calls[0].payload.p_request_id);assert.equal(run('appState.transactions.length'),0);
 assert.ok(doc.getElementById('invoice-detail-content').textContent.includes('£150.00'));assert.ok(doc.getElementById('invoice-detail-title').textContent.includes('DT-2026-0001'));
 const bytes=await run('buildInvoicePdfBlob(invoiceById())').arrayBuffer();assert.equal(Buffer.from(bytes).subarray(0,5).toString(),'%PDF-');fs.writeFileSync('/tmp/drivertax-tested-invoice.pdf',Buffer.from(bytes));
 ctx.longInvoice=JSON.parse(JSON.stringify(run('invoiceById()')));ctx.longInvoice.items=Array.from({length:20},()=>({description:'Long service description '.repeat(18),quantity:1,unit_price:10,line_total:10}));ctx.longInvoice.total=200;ctx.longInvoice.notes='Additional payment notes '.repeat(80);
 const longBytes=Buffer.from(await run('buildInvoicePdfBlob(longInvoice)').arrayBuffer());assert.ok((longBytes.toString('latin1').match(/\/Type \/Page\b/g)||[]).length>1);fs.writeFileSync('/tmp/drivertax-long-invoice.pdf',longBytes);
 await run("shareInvoice('whatsapp')");assert.equal(shares.length,1);assert.equal(shares[0].files[0].name,'DT-2026-0001.pdf');
 shareError={name:'NotAllowedError'};await run("shareInvoice('whatsapp')");assert.equal(doc.getElementById('invoice-share-fallback').querySelector('a').getAttribute('href'),'https://wa.me/');
 run('openInvoicePayment()');assert.equal(doc.getElementById('invoice-payment-income').value,'new');
 run("appState.transactions=[{id:'existing',type:'income',date:driverToday(),amount:150,source:'Private booking'}];renderInvoicePaymentOptions()");assert.equal(doc.getElementById('invoice-payment-income').value,'');assert.ok(doc.getElementById('invoice-payment-income').textContent.includes('Link existing'));assert.ok(!doc.getElementById('invoice-payment-income').textContent.includes('Add a new'));
 await run('recordInvoicePayment()');assert.equal(calls.length,1);doc.getElementById('invoice-payment-income').value='existing';await run('recordInvoicePayment()');assert.equal(calls[1].payload.p_income_id,'existing');
 run("appState.transactions=[];appState.periodEntries=[{period_start:driverToday(),period_end:driverToday()}];renderInvoicePaymentOptions()");assert.ok(doc.getElementById('invoice-payment-hint').textContent.includes('catch-up'));assert.ok(!doc.getElementById('invoice-payment-income').textContent.includes('Add a new'));
 ctx.encodeBase64=file=>file.arrayBuffer().then(a=>Buffer.from(a).toString('base64'));run('fileToBase64=encodeBase64');await run('sendInvoiceEmail()');assert.equal(emails.length,1);assert.equal(emails[0].attachments[0].filename,'DT-2026-0001.pdf');assert.ok(doc.getElementById('invoice-email-status').textContent.includes('Accepted'));
 run("appState.invoices[0].customer_name='<img src=x onerror=alert(1)>';openInvoiceDetail('issued')");assert.equal(doc.getElementById('invoice-detail-content').querySelector('img'),null);
 console.log('PASS: invoice form/rounding/non-VAT validation, issuance payload, no unpaid income, real PDF, share fallback, existing-income matching/catch-up guard, mocked email and escaped customer details. No real invoice emailed.');
})().catch(e=>{console.error(e);process.exit(1)});
