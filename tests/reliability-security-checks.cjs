const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{parseHTML}=require('linkedom'),{webcrypto}=require('node:crypto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8'),{window}=parseHTML(html),doc=window.document;
let updateCalls=0,signOutCalls=0,invalid=false,failUpdate=false,failLogout=false,resolveReads,pending=false,splitCalled=null,undoCalls=0,splitChecked=true;
window.location={href:'https://earnavik.com/?recover=1',origin:'https://earnavik.com',pathname:'/',search:'?recover=1'};window.history={replaceState(){}};
const client={auth:{getUser:async()=>invalid?{error:Error('expired')}:{data:{user:{id:'b'}}},updateUser:async()=>{updateCalls++;return failUpdate?{error:Error('network unavailable')}:{data:{user:{id:'b'}}}},signOut:async()=>{signOutCalls++;return failLogout?{error:Error('offline')}:{error:null}}},from:table=>{const q={select:()=>q,eq:()=>q,order:()=>q,range:()=>q,single:()=>q,maybeSingle:()=>q,then:resolve=>{if(pending){resolveReads=()=>resolve({data:[],error:null});return;}resolve({data:table==='profiles'?{}:table==='tax_profiles'||table==='vat_profiles'?null:[],error:null});}};return q;},rpc:async(name)=>{if(name==='undo_driver_invoice_payment'){undoCalls++;return {data:{status:'unpaid',income_removed:true}};}return {data:'saved-expense'};}};
window.supabase={createClient:()=>client};const ctx=vm.createContext({window,document:doc,console,Date,URL,URLSearchParams,Blob,File,crypto:webcrypto,setTimeout:()=>0,confirm:()=>true});
const source=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).find(x=>x.includes('let appState'));vm.runInContext(source,ctx);const run=s=>vm.runInContext(s,ctx);
for(const [id,value] of [['receipt-category','Other'],['income-source','Other']])Object.defineProperty(doc.getElementById(id),'value',{writable:true,value});
run("showToast=()=>{};showAuthSuccess=()=>{};switchAuthMode=()=>{};renderUI=()=>{};refreshTaxPayments=async()=>{};populateIncomeSources=()=>{};populateExpenseCategories=()=>{};renderRegularCostLists=()=>{};");
(async()=>{
 // Switch and sign-out erase every account's working state, including pending files.
 run("setCurrentAccount({id:'a'});appState.transactions=[{id:'private'}];appState.profile={full_name:'Private name'};appState.pendingReceiptFile={private:true};appState.bankCsv=[['private']];setCurrentAccount({id:'b'});");
 assert.equal(run('appState.transactions.length'),0);assert.equal(run('appState.profile'),null);assert.equal(run('appState.pendingReceiptFile'),null);assert.equal(run('appState.bankCsv'),undefined);
 assert.equal(doc.getElementById('account-data-gate').classList.contains('hidden'),false);
 // A stale request for A returns before it can write any data into B.
 let release;ctx.oldRead=new Promise(resolve=>release=resolve);run("setCurrentAccount({id:'a'});fetchAllUserRows=async()=>oldRead;");const old=run("fetchUserData('a')");await Promise.resolve();run("setCurrentAccount({id:'b'});appState.profile={full_name:'B only'};");release({data:[]});await old;assert.equal(run('appState.profile.full_name'),'B only');
 // Recovery validates inputs/session and retains the form after network failure.
 ctx.event={preventDefault(){}};run('openPasswordRecovery()');const pw=doc.getElementById('recovery-password'),repeat=doc.getElementById('recovery-password-confirm');pw.value='short';repeat.value='short';await run('saveRecoveryPassword(event)');assert.equal(updateCalls,0);
 pw.value='A-long-test-password-123';repeat.value='different';await run('saveRecoveryPassword(event)');assert.equal(updateCalls,0);
 repeat.value=pw.value;invalid=true;await run('saveRecoveryPassword(event)');assert.equal(updateCalls,0);assert.match(doc.getElementById('recovery-password-message').textContent,/expired/);
 invalid=false;failUpdate=true;await run('saveRecoveryPassword(event)');assert.equal(pw.value,'A-long-test-password-123');assert.equal(doc.getElementById('recovery-password-save').disabled,false);
 failUpdate=false;await run('saveRecoveryPassword(event)');assert.equal(pw.value,'');assert.equal(repeat.value,'');assert.equal(signOutCalls,1);assert.equal(doc.getElementById('password-recovery-modal').classList.contains('hidden'),true);
 // Save captures split intent before the review reset clears it.
 run("ensureBatchFeatures();appState.currentUser={id:'b'};appState.pendingReceiptPath='b/file.jpg';appState.receiptEvidenceStatus='ready';appState.pendingReceiptHash='hash';appState.pendingReceiptSaveId='request';appState.pendingReceiptItems=[{description:'Tools',amount:20}];findSavedReceiptHash=async()=>null;matchingReceiptExpense=()=>null;readExpenseTaxFields=()=>({});fetchUserData=async()=>{};switchTab=()=>{};");
 doc.getElementById('receipt-amount').value='20';doc.getElementById('receipt-merchant').value='Shop';doc.getElementById('receipt-date').value='2026-10-19';doc.getElementById('receipt-split-after').checked=true;
 ctx.captureSplit=(id,items)=>{splitCalled={id,items}};run('openItemSplit=captureSplit');await run('confirmReceiptExpense()');assert.equal(splitCalled.id,'saved-expense');assert.equal(splitCalled.items[0].description,'Tools');assert.equal(doc.getElementById('receipt-split-after').checked,false);
 // Linked income opens its invoice rather than an unusable income editor.
 ctx.opened=null;run("appState.transactions=[{id:'payment',type:'income'}];appState.invoices=[{id:'inv',status:'paid',income_id:'payment',payment_mode:'new'}];openInvoiceDetail=id=>opened=id;editIncomeRecord('payment');");assert.equal(ctx.opened,'inv');assert.equal(run('appState.editingIncomeId'),null);
 run("appState.selectedInvoiceId='inv'");await run('undoInvoicePayment()');assert.equal(undoCalls,1);assert.equal(run('appState.invoiceUndoing'),false);
 assert.ok(!html.includes("${t.purpose ||"));
 console.log('PASS: account state reset and stale-response rejection; password validation/expired link/retry/success; receipt split intent; invoice-linked edit routing and undo; mileage HTML escaping. No live email or password changed.');
})().catch(e=>{console.error(e);process.exit(1)});
