const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{parseHTML}=require('linkedom');
const html=fs.readFileSync(__dirname+'/../index.html','utf8'),{window}=parseHTML(html),doc=window.document;
let failTable=null,failOffset=-1,reads=[],reports=[],wait=false,release;
const rowTables=['income','expenses','mileage','tax_reserve','period_entries','recurring_expenses','receipts','invoices','invoice_drafts','vat_purchases','invoice_credits','vat_classifications','vat_return_reviews','tax_payment_records'];
const client={functions:{invoke:async(name,args)=>{reports.push(args.body.code);return {data:{ok:true}};}},from(table){let a=0,b=499,owner,orders=[];const q={select:()=>q,eq:(k,v)=>{owner=v;return q;},order:(column,options)=>{orders.push([column,options.ascending]);return q;},range:(start,end)=>{a=start;b=end;return q;},single:()=>q,maybeSingle:()=>q,then:resolve=>{
 reads.push({table,a,b,owner,orders});
 const data=table==='profiles'?{}:table==='tax_profiles'||table==='vat_profiles'?null:rowTables.includes(table)?Array.from({length:1001},(_,i)=>({id:String(i).padStart(5,'0'),expense_id:String(i),invoice_id:String(i),user_id:owner})).slice(a,b+1):[];
 const result=failTable===table&&a===failOffset?{error:Error('offline')}:{data,error:null};if(wait){release=()=>resolve(result);return;}resolve(result);
 }};return q;}};
window.supabase={createClient:()=>client};const ctx=vm.createContext({window,document:doc,console:{error(){},log:console.log},Date,setTimeout:()=>0});const main=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).find(x=>x.includes('let appState'));vm.runInContext(main,ctx);const run=s=>vm.runInContext(s,ctx);
(async()=>{
 run("appState.currentUser={id:'owner'};showToast=()=>{};renderUI=()=>{};populateIncomeSources=()=>{};populateExpenseCategories=()=>{};renderRegularCostLists=()=>{};refreshTaxPayments=async()=>{};");
 for(const table of rowTables){const r=await run(`fetchAllUserRows('${table}','owner',${JSON.stringify(table==='vat_purchases'?{key:'expense_id'}:table==='invoice_credits'?{key:'invoice_id'}:{})})`);assert.equal(r.data.length,1001);assert.ok(reads.some(r=>r.table===table&&r.a===1000));}
 assert.ok(reads.every(r=>r.owner==='owner'&&r.b-r.a===499));
 failTable='invoices';failOffset=500;const failed=await run("fetchAllUserRows('invoices','owner')");assert.ok(failed.error);assert.equal(failed.data,undefined);failTable=null;
 wait=true;const pending=run("fetchAllUserRows('income','owner')");await Promise.resolve();const before=reads.length;run("setCurrentAccount({id:'other'})");release();const stale=await pending;assert.ok(stale.error);assert.equal(reads.length,before);wait=false;
 // Use empty fixture arrays for the actual load transformation.
 rowTables.splice(0);run("setCurrentAccount({id:'owner'})");await run("fetchUserData('owner')");assert.equal(reports.length,0,'Successful refresh must not report failure');
 failTable='expenses';failOffset=0;await run("fetchUserData('owner')");assert.deepEqual(reports,['cloud_load_failed']);
 assert.ok(reads.find(r=>r.table==='vat_purchases').orders.some(([key])=>key==='expense_id'));
 console.log('PASS: 1,001-row reads cover every growing ledger, stable owner-scoped paging, composite/date ordering support, mid-page failure is not accepted as complete, account changes stop work, successful refresh emits no failure report.');
})().catch(e=>{console.error(e);process.exit(1)});
