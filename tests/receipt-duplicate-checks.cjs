const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const {parseHTML}=require('linkedom');const {webcrypto}=require('node:crypto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');const {window}=parseHTML(html);
let rows=[],receipts=[],calls=[],rpcError=null;
function query(table){let filters=[];const q={select:()=>q,eq:(key,value)=>{filters.push([key,value]);return q},limit:()=>q,then:(resolve,reject)=>Promise.resolve({data:(table==='receipts'?receipts:rows).filter(r=>filters.every(([k,v])=>r[k]===v)),error:null}).then(resolve,reject)};return q;}
window.supabase={createClient:()=>({from:query,rpc:async(name,payload)=>{calls.push(payload);return {data:rpcError?null:'saved-id',error:rpcError}},storage:{from:()=>({upload:async()=>({error:null})})},functions:{invoke:async()=>({data:{data:{merchant:'Shell',date:'2026-10-08',amount:30,confidence:0.9}},error:null})}})};
const ctx=vm.createContext({window,document:window.document,crypto:webcrypto,console,Date,setTimeout,URL:{createObjectURL:()=> 'blob:mock'}});
const source=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).find(x=>x.includes('let appState'));
vm.runInContext(source,ctx);const run=s=>vm.runInContext(s,ctx);
run("appState.currentUser={id:'driver',email:'test@example.test'};fetchUserData=async()=>{};switchTab=()=>{};showToast=()=>{};");
function prepare(){run("appState.pendingReceiptPath='driver/image.jpg';appState.pendingReceiptHash='a'.repeat(64);appState.pendingReceiptSaveId=crypto.randomUUID();appState.receiptDuplicateOverride=null;appState.receiptDuplicateCandidate=null;appState.receiptScanning=false;appState.pendingReceiptFile={name:'receipt.jpg',size:3,type:'image/jpeg'};document.getElementById('receipt-merchant').value='Shell';document.getElementById('receipt-date').value='2026-10-08';document.getElementById('receipt-amount').value='30';");}
(async()=>{
 const bytes=Buffer.from('same photo');ctx.sample={arrayBuffer:async()=>bytes};const hash=await run('receiptFileHash(sample)');assert.equal(hash,await run('receiptFileHash(sample)'));
 assert.equal(run("matchingReceiptExpense([{merchant:' SHELL ',expense_date:'2026-10-08',amount:'30.00'}],'Shell','2026-10-08',30)!==null"),true);
 assert.equal(run("matchingReceiptExpense([{merchant:'Shell',expense_date:'2026-10-08',amount:31}],'Shell','2026-10-08',30)"),null);
 receipts=[{id:'old',user_id:'driver',content_sha256:'a'.repeat(64)}];prepare();await run('confirmReceiptExpense()');assert.equal(calls.length,0);assert.equal(window.document.getElementById('receipt-duplicate-warning').classList.contains('hidden'),false);
 run('appState.receiptDuplicateOverride=appState.receiptDuplicateCandidate');await run('confirmReceiptExpense()');assert.equal(calls.length,1);assert.equal(calls[0].p_receipt.duplicate_override,true);
 receipts=[];rows=[{id:'old',user_id:'driver',merchant:' Shell ',expense_date:'2026-10-08',amount:30}];prepare();await run('confirmReceiptExpense()');assert.equal(calls.length,1);
 run("appState.receiptDuplicateOverride=appState.receiptDuplicateCandidate;document.getElementById('receipt-amount').value='30.00'");await run('confirmReceiptExpense()');assert.equal(calls.length,2);
 rows=[];prepare();run('appState.receiptSaving=true');await run('confirmReceiptExpense()');assert.equal(calls.length,2);run('appState.receiptSaving=false');
 rpcError={message:'receipt_duplicate',code:'P0001'};await run('confirmReceiptExpense()');assert.equal(window.document.getElementById('receipt-duplicate-warning').classList.contains('hidden'),false);assert.equal(run('appState.pendingReceiptPath'),'driver/image.jpg');
 console.log('PASS: file hashes, merchant/date/total matches, exact duplicate warning, Save anyway, possible duplicate warning, double taps, concurrent-save warning.');
})().catch(e=>{console.error(e);process.exit(1)});
