const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript'),{webcrypto}=require('node:crypto'),webpush=require('web-push'),{parseHTML}=require('linkedom');
(async()=>{
 const pair=webpush.generateVAPIDKeys(),devicePair=webpush.generateVAPIDKeys(),token='a'.repeat(64),digest=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex');
 const sub={endpoint:'https://fcm.googleapis.com/fcm/send/test-fixture',keys:{p256dh:devicePair.publicKey,auth:Buffer.alloc(16,1).toString('base64url')}};
 let handler,user=true,allowed=true,quotaError=false,claim=true,status=201,calls=0,updates=[],device={endpoint_hash:'hash',user_id:'owner',subscription:sub,binding:'12345678-1234-4234-8234-123456789abc',enabled:true,sound:true};
 class Query{
  constructor(table){this.table=table;this.filters={};}select(){return this}eq(k,v){this.filters[k]=v;return this}update(data){this.updateData=data;return this}upsert(data){device={...device,...data};return this}then(resolve,reject){if(this.updateData){updates.push({table:this.table,data:this.updateData,filters:this.filters});if(this.table==='owner_push_devices')Object.assign(device,this.updateData);}return Promise.resolve({data:this.table==='owner_push_devices'?[device]:null,error:null}).then(resolve,reject)}
  async single(){return this.table==='invoice_reminder_worker'?{data:{token_hash:digest}}:{data:{public_key:pair.publicKey,private_key:pair.privateKey}}}
  async maybeSingle(){return {data:device&&device.user_id===this.filters.user_id&&(!('enabled' in this.filters)||device.enabled===this.filters.enabled)?device:null}}
 }
 const db={from:t=>new Query(t),auth:{getUser:async()=>({data:{user:user?{id:'owner'}:null},error:null})},rpc:async(name,args)=>{
  if(name==='consume_paid_api_request')return {data:allowed,error:quotaError?'fail':null};
  if(name==='list_owner_invoice_push'||name==='list_owner_bookkeeping_push')return {data:[{endpoint_hash:'hash',user_id:'owner'}]};
  if(name==='claim_owner_invoice_push'||name==='claim_owner_bookkeeping_push')return {data:claim?{...device,due:2,overdue:3,day:'2026-10-24'}:null};throw Error(name);
 }};
 const raw=fs.readFileSync(__dirname+'/../supabase/functions/owner-invoice-push/index.ts','utf8').replace(/^import .*;\s*$/gm,'');const compiled=ts.transpileModule(raw,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});assert.equal(compiled.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
 const ctx={Request,Response,URL,Uint8Array,TextEncoder,crypto:webcrypto,Date,Set,AbortSignal,atob,console,webpush,createClient:()=>db,Deno:{env:{get:()=> 'test-only'},serve:fn=>handler=fn},fetch:async(url,args)=>{calls++;assert.equal(args.redirect,'error');assert.ok(!Object.keys(args.headers).some(k=>k.toLowerCase()==='topic'),'Do not send optional Topic headers that Apple can reject');assert.equal(url,sub.endpoint);assert.ok(!Buffer.from(args.body).toString().includes('daily invoice'));assert.ok(args.headers.Authorization||args.headers.authorization);return new Response('',{status});}};vm.createContext(ctx);vm.runInContext(compiled.outputText,ctx);
 const req=(body,auth='user-jwt',origin='https://earnavik.com')=>handler(new Request('https://example.test',{method:'POST',headers:{Authorization:'Bearer '+auth,Origin:origin},body:JSON.stringify(body)}));
 assert.equal((await req({action:'test',endpoint:sub.endpoint},'user-jwt','https://attacker.test')).status,403);assert.equal(calls,0);
 user=false;assert.equal((await req({action:'status'})).status,401);user=true;
 const publicStatus=await(await req({action:'status',endpoint:sub.endpoint})).json();assert.equal(publicStatus.publicKey,pair.publicKey);assert.ok(!JSON.stringify(publicStatus).includes(pair.privateKey));
 assert.equal((await req({action:'run_daily'})).status,401);assert.equal(calls,0);
 assert.equal((await req({action:'subscribe',subscription:{...sub,endpoint:'https://127.0.0.1/private'},sound:true,binding:device.binding})).status,400);
 const savedSubscription=await req({action:'subscribe',subscription:sub,sound:true,binding:device.binding,user_id:'attacker'});assert.equal(savedSubscription.status,200);assert.equal(device.user_id,'owner');
 allowed=false;assert.equal((await req({action:'test',endpoint:sub.endpoint})).status,429);assert.equal(calls,0);allowed=true;quotaError=true;await req({action:'test',endpoint:sub.endpoint});assert.equal(calls,0);quotaError=false;
 device.enabled=false;assert.equal((await req({action:'test',endpoint:sub.endpoint})).status,400);assert.equal(calls,0);device.enabled=true;
 assert.equal((await req({action:'test',endpoint:sub.endpoint})).status,200);assert.equal(calls,1);
 status=410;assert.equal((await req({action:'test',endpoint:sub.endpoint})).status,502);assert.equal(device.enabled,false);device.enabled=true;status=201;
 await req({action:'run_daily'},token);assert.equal(calls,3);assert.equal(updates.at(-1).data.status,'accepted');
 claim=false;await req({action:'run_daily'},token);assert.equal(calls,3);
 status=400;const rejected=await req({action:'test',endpoint:sub.endpoint});assert.equal(rejected.status,502);assert.ok((await rejected.json()).error.includes('HTTP 400'));
 status=200;assert.equal((await req({action:'test',endpoint:sub.endpoint})).status,200);

 // Daily bookkeeping is separately authenticated, claimed and recorded.
 const beforeDaily=calls;claim=true;status=201;
 assert.equal((await req({action:'run_bookkeeping'})).status,401);assert.equal(calls,beforeDaily);
 assert.equal((await req({action:'subscribe',subscription:sub,sound:true,binding:device.binding,bookkeepingEnabled:true,bookkeepingTime:'25:00'})).status,400);
 assert.equal((await req({action:'subscribe',subscription:sub,sound:true,binding:device.binding,bookkeepingEnabled:'yes',bookkeepingTime:'20:00'})).status,400);
 assert.equal((await req({action:'subscribe',subscription:sub,sound:true,binding:device.binding,bookkeepingEnabled:true,bookkeepingTime:'20:10'})).status,200);
 assert.equal(device.bookkeeping_enabled,true);assert.equal(device.bookkeeping_time,'20:10');
 assert.equal((await req({action:'subscribe',subscription:sub,sound:true,binding:device.binding})).status,200);assert.equal(device.bookkeeping_enabled,true,'Old clients preserve opt-in');
 const dailyStatus=await(await req({action:'status',endpoint:sub.endpoint})).json();assert.equal(dailyStatus.bookkeepingEnabled,true);assert.equal(dailyStatus.bookkeepingTime,'20:10');
 await req({action:'run_bookkeeping'},token);assert.equal(calls,beforeDaily+1);assert.equal(updates.at(-1).table,'owner_bookkeeping_push_deliveries');assert.equal(updates.at(-1).data.status,'accepted');
 claim=false;await req({action:'run_bookkeeping'},token);assert.equal(calls,beforeDaily+1);
 assert.equal((await req({action:'subscribe',subscription:sub,sound:true,binding:device.binding,bookkeepingEnabled:false,bookkeepingTime:'20:10'})).status,200);assert.equal(device.bookkeeping_enabled,false);
 // Service worker: generic fallback protects old-account payloads, and click destinations are fixed.
 const handlers={},notifications=[],messages=[];let saved={user_id:'owner',binding:device.binding},focused=false;
 const tab={url:'https://earnavik.com/',get focused(){return focused},visibilityState:'visible',postMessage:m=>messages.push(m),focus:async()=>{}};
 const scope={location:{origin:'https://earnavik.com'},addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:async()=>{},registration:{showNotification:async(title,options)=>notifications.push({title,options})},clients:{claim:async()=>{},matchAll:async()=>[tab],openWindow:async url=>messages.push(url)}};
 vm.runInNewContext(fs.readFileSync(__dirname+'/../owner-push-sw.js','utf8'),{self:scope,caches:{open:async()=>({match:async()=>saved?new Response(JSON.stringify(saved)):null,put:async(_,r)=>{saved=await r.json()},delete:async()=>{saved=null}})},URL,Response});
 async function push(payload){let pending;handlers.push({data:{json:()=>payload},waitUntil:p=>pending=p});await pending;}
 await push({user_id:'other',binding:device.binding,title:'Private account summary',body:'SECRET COUNTS',sound:true});assert.equal(notifications.at(-1).title,'Earnavik reminder');assert.ok(!notifications.at(-1).options.body.includes('SECRET'));assert.equal(notifications.at(-1).options.silent,true);
 focused=true;await push({user_id:'owner',binding:device.binding,title:'Invoice summary',body:'2 due',sound:true});assert.equal(notifications.at(-1).options.silent,false,'Open app must not force native notifications silent');assert.equal(notifications.at(-1).options.renotify,true);assert.equal(messages.length,0,'Do not rely on a separate browser-audio message');
 focused=false;await push({user_id:'owner',binding:device.binding,title:'Invoice summary',body:'2 due',sound:true});assert.equal(notifications.at(-1).options.silent,false,'Background sound enabled');
 focused=false;await push({user_id:'owner',binding:device.binding,title:'Invoice summary',body:'2 due',sound:false});assert.equal(notifications.at(-1).options.silent,true);
 let clickPending;handlers.notificationclick({notification:{close(){},data:{url:'https://attacker.test'}},waitUntil:p=>clickPending=p});await clickPending;assert.equal(messages.at(-1).type,'OPEN_INVOICES');

 await push({user_id:'owner',binding:device.binding,kind:'bookkeeping',title:'Keep your books up to date',body:'Add income and expenses',sound:true});assert.equal(notifications.at(-1).options.tag,'earnavik-bookkeeping-daily');assert.equal(notifications.at(-1).options.data.kind,'bookkeeping');
 handlers.notificationclick({notification:{close(){},data:{kind:'bookkeeping'}},waitUntil:p=>clickPending=p});await clickPending;assert.equal(messages.at(-1).type,'OPEN_BOOKKEEPING');
 // Browser setup: no prompts until the enable gesture; save is bound to the signed-in user.
 const {window}=parseHTML(fs.readFileSync(__dirname+'/../index.html','utf8'));const appState={currentUser:{id:'owner'}};let permissionCalls=0,enabled=false,bindingValue=null,unsubscribed=false,log=[],bookkeepingEnabled=false,bookkeepingTime='20:00',lastSubscribe;
 const subscription={endpoint:sub.endpoint,toJSON:()=>sub,unsubscribe:async()=>{unsubscribed=true;return true}};
 const reg={active:{postMessage:(_,ports)=>ports[0].postMessage({ok:true})},pushManager:{getSubscription:async()=>subscription,subscribe:async()=>subscription}};
 window.isSecureContext=true;window.PushManager={};window.Notification={};window.matchMedia=()=>({matches:false});
 class Channel{constructor(){this.port1={};this.port2={postMessage:data=>this.port1.onmessage?.({data})}}}
 const ui={window,document:window.document,location:{href:'https://earnavik.com/',origin:'https://earnavik.com'},history:{replaceState(){}},URL,Uint8Array,atob,crypto:webcrypto,setTimeout,clearTimeout,MessageChannel:Channel,appState,Notification:{permission:'default',requestPermission(){permissionCalls++;log.push('permission');return Promise.resolve('granted')}},navigator:{userAgent:'Desktop',serviceWorker:{register:async()=>reg,ready:Promise.resolve(reg),getRegistration:async()=>reg,addEventListener(){} }},supabaseClient:{functions:{invoke:async(_,request)=>{const b=request.body;log.push(b.action);if(b.action==='status')return {data:{publicKey:pair.publicKey,enabled,sound:true,binding:bindingValue,bookkeepingEnabled,bookkeepingTime}};if(b.action==='subscribe'){enabled=true;bindingValue=b.binding;lastSubscribe=b;bookkeepingEnabled=b.bookkeepingEnabled;bookkeepingTime=b.bookkeepingTime;return {data:{ok:true}};}if(b.action==='disable'){enabled=false;return {data:{ok:true}};}if(b.action==='test')return {data:{accepted:true}};}}}};
 vm.createContext(ui);vm.runInContext(fs.readFileSync(__dirname+'/../owner-push.js','utf8'),ui);await window.loadOwnerPushSettings();assert.equal(permissionCalls,0);assert.equal(window.document.getElementById('owner-push-test').disabled,true);
 log=[];await window.enableOwnerPush();assert.equal(permissionCalls,1);assert.equal(log[0],'permission');assert.equal(enabled,true);assert.equal(window.document.getElementById('owner-push-test').disabled,false);

 window.document.getElementById('owner-push-bookkeeping').checked=true;window.document.getElementById('owner-push-bookkeeping-time').value='21:30';
 await window.enableOwnerPush();assert.equal(lastSubscribe.bookkeepingEnabled,true);assert.equal(lastSubscribe.bookkeepingTime,'21:30');assert.equal(window.document.getElementById('owner-push-bookkeeping').checked,true);
 const promptCount=permissionCalls;window.document.getElementById('owner-push-bookkeeping-time').value='21:33';await window.enableOwnerPush();assert.equal(permissionCalls,promptCount);window.document.getElementById('owner-push-bookkeeping-time').value='21:30';
 await window.testOwnerPush();assert.ok(window.document.getElementById('owner-push-status').textContent.includes('accepted'));
 await window.disableOwnerPush();assert.equal(enabled,false);assert.equal(unsubscribed,true);
 // iPhone browser tabs must explain Home Screen installation without asking permission.
 ui.navigator.userAgent='iPhone';ui.navigator.standalone=false;await window.loadOwnerPushSettings();assert.ok(window.document.getElementById('owner-push-status').textContent.includes('Add to Home Screen'));assert.equal(window.document.getElementById('owner-push-enable').disabled,true);assert.equal(permissionCalls,2);

 // A bookkeeping notification waits for account data, then opens today's entry.
 ui.location.href='https://earnavik.com/?open=bookkeeping';let entryDate=null,openedTab=null;
 ui.driverToday=()=> '2026-10-28';ui.startDailyEntry=date=>entryDate=date;ui.switchTab=tab=>openedTab=tab;ui.closeAccountModal=()=>{};
 const gate=window.document.getElementById('account-data-gate');gate.classList.remove('hidden');
 vm.runInContext(fs.readFileSync(__dirname+'/../owner-push.js','utf8'),ui);window.openOwnerNotificationInvoices();assert.equal(entryDate,null);
 gate.classList.add('hidden');window.openOwnerNotificationInvoices();assert.equal(entryDate,'2026-10-28');assert.equal(openedTab,'dashboard');
 ui.location.href='https://earnavik.com/';
 // A synchronous browser startup failure must not prevent setup handlers from being exported.
 ui.navigator.userAgent='Desktop';ui.navigator.serviceWorker.getRegistration=()=>{throw Error('Browser startup unavailable')};
 vm.runInContext(fs.readFileSync(__dirname+'/../owner-push.js','utf8'),ui);assert.equal(typeof window.loadOwnerPushSettings,'function');assert.ok(window.document.getElementById('owner-push-status').textContent.includes('Check notification setup'));
 console.log('PASS owner push: authenticated owner-only test, private key non-disclosure, SSRF restrictions, quotas, encrypted VAPID payload, expired subscription handling, cron auth/claims, cross-account SW privacy, sound preference, fixed click target, gesture-only permission, enable/test/off UI. Network mocked.');
})().catch(e=>{console.error(e);process.exit(1)});
