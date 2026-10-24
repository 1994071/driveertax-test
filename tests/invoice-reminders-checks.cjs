const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript'),{webcrypto}=require('node:crypto'),{parseHTML}=require('linkedom');
(async()=>{
 const token='a'.repeat(64),hash=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex');let handler,allowed=true,quotaError=false,claim=true,providerStatus=200,providerBody={id:'accepted'},calls=[],rpc=[],finish=[];
 const raw=fs.readFileSync(__dirname+'/../supabase/functions/invoice-reminders/index.ts','utf8').replace(/^import .*;\s*$/gm,'');
 const compiled=ts.transpileModule(raw,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});assert.equal(compiled.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
 const ctx={Request,Response,crypto:webcrypto,TextEncoder,Uint8Array,Intl,Date,AbortSignal,console,setTimeout:fn=>fn(),Deno:{serve:fn=>handler=fn,env:{get:()=> 'test'}},createClient:()=>({from:()=>({select(){return this},eq(){return this},single:async()=>({data:{token_hash:hash}})}),rpc:async(name,args)=>{rpc.push(name);if(name==='list_due_invoice_reminders')return {data:[{invoice_id:'invoice',user_id:'owner',stage:'due'}]};if(name==='consume_paid_api_request')return {data:allowed,error:quotaError?'fail':null};if(name==='claim_invoice_reminder')return {data:claim?{invoice_id:'invoice',user_id:'owner',recipient:'customer@example.test',invoice_number:'EV-1',seller_name:'Example',total:120,due_date:'2026-10-24',payment_details:'Use invoice number',stage:'due'}:null};finish.push(args);return {data:null};}}),fetch:async(url,args)=>{calls.push(args);return new Response(JSON.stringify(providerBody),{status:providerStatus});}};
 vm.createContext(ctx);vm.runInContext(compiled.outputText,ctx);
 const req=(auth=token)=>handler(new Request('https://example.test',{method:'POST',headers:{Authorization:'Bearer '+auth},body:'{}'}));
 assert.equal((await req('user-jwt')).status,401);assert.equal(calls.length,0);assert.equal(rpc.length,0);
 assert.equal((await req('b'.repeat(64))).status,401);assert.equal(rpc.length,0);
 allowed=false;await req();assert.equal(calls.length,0);assert.ok(!rpc.includes('claim_invoice_reminder'));allowed=true;quotaError=true;await req();assert.equal(calls.length,0);quotaError=false;
 claim=false;await req();assert.equal(calls.length,0);claim=true;
 await req();assert.equal(calls.length,1);assert.ok(calls[0].headers['Idempotency-Key'].endsWith('/invoice/due'));assert.equal(JSON.parse(calls[0].body).to[0],'customer@example.test');assert.equal(finish.at(-1).p_provider_id,'accepted');
 providerStatus=403;providerBody={message:'provider private details'};await req();assert.equal(finish.at(-1).p_provider_id,null);assert.ok(finish.at(-1).p_error.includes('403'));assert.ok(!finish.at(-1).p_error.includes('private details'));
 providerStatus=200;providerBody={};await req();assert.equal(finish.at(-1).p_provider_id,null);
 // Actual UI data path: defaults off, owner-scoped upsert, account-switch guard and errors.
 const {window}=parseHTML(fs.readFileSync(__dirname+'/../index.html','utf8'));let saved=null,settings=null,failLoad=false;
 const appState={currentUser:{id:'owner'},selectedInvoiceId:'invoice'};
 const ui={window,document:window.document,appState,invoiceById:()=>({id:'invoice',status:'unpaid',customer_email:'customer@example.test'}),showToast:()=>{},supabaseClient:{from:table=>({select(){return this},eq(){return this},order:async()=>({data:[],error:failLoad?'offline':null}),maybeSingle:async()=>({data:settings,error:failLoad?'offline':null}),upsert:async(data)=>{saved=data;settings=data;return {error:null};}})}};
 vm.createContext(ui);vm.runInContext(fs.readFileSync(__dirname+'/../invoice-reminders.js','utf8'),ui);
 await window.loadInvoiceReminders('invoice');assert.equal(window.document.getElementById('invoice-reminders-enabled').checked,false);
 window.document.getElementById('invoice-reminders-enabled').checked=true;await window.saveInvoiceReminders();assert.equal(saved.user_id,'owner');assert.equal(saved.recipient,'customer@example.test');assert.equal(saved.enabled,true);
 appState.currentUser={id:'other'};saved=null;await window.saveInvoiceReminders();assert.equal(saved,null);
 failLoad=true;await window.loadInvoiceReminders('invoice');assert.ok(window.document.getElementById('invoice-reminders-status').textContent.includes('Could not load'));assert.equal(window.document.getElementById('invoice-reminders-save').disabled,true);
 console.log('PASS reminder worker authentication, quota denial/error, stale claims, recipient/idempotency, provider rejection, no false acceptance, UI opt-in, owner scope and account-switch guard. All emails mocked.');
})().catch(e=>{console.error(e);process.exit(1)});
