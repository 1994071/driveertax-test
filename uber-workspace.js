/* Taxi/private-hire Uber connection. Provider tokens never enter browser storage. */
function uberTaxiProfile(profile){
 const roles=profileProfessions(profile||{});
 return roles.some(r=>['taxi private hire','taxi driver','private hire driver','taxi','private hire','uber driver'].includes(normaliseProfession(r.label)));
}
(()=>{
 const el=id=>document.getElementById(id),pendingKey='earnavik-uber-oauth';
 let owner=null,version=0,busy=false,available=false,pending=window.__earnavikUberCallback||null;
 delete window.__earnavikUberCallback;
 function resetUberWorkspace(){owner=null;version++;busy=false;available=false;el('uber-driver-card')?.classList.add('hidden');el('uber-driver-preview')?.replaceChildren();if(el('uber-driver-consent'))el('uber-driver-consent').checked=false;}
 function same(user,token){return appState.currentUser?.id===user&&version===token;}
 async function call(action,extra={}){
  const {data,error}=await supabaseClient.functions.invoke('uber-driver',{body:{action,...extra}});
  if(error){let message='Uber connection could not load. Check your connection and retry.';try{const body=await error.context.json();if(typeof body?.error==='string')message=body.error;}catch{}throw Error(message);}
  if(data?.error)throw Error(data.error);if(!data)throw Error('No Uber response. Please retry.');return data;
 }
 function setBusy(value){busy=value;for(const id of ['uber-driver-connect','uber-driver-refresh','uber-driver-disconnect','uber-driver-status-check'])if(el(id))el(id).disabled=value||(id==='uber-driver-connect'&&!available);}
 function paint(data){
  available=!!data.available;
  const eligible=uberTaxiProfile(appState.profile),hasConnection=data.status!=='disconnected';
  // Former taxi users retain disconnect controls; no new connection or data reads.
  el('uber-driver-card').classList.toggle('hidden',!eligible&&!hasConnection);
  el('uber-driver-connect').classList.toggle('hidden',!eligible||data.status==='connected');
  el('uber-driver-connect').disabled=!data.available;
  el('uber-driver-consent-label').classList.toggle('hidden',!eligible||!data.available||data.status==='connected');
  el('uber-driver-refresh').classList.toggle('hidden',!eligible||data.status!=='connected');
  el('uber-driver-disconnect').classList.toggle('hidden',!hasConnection);
  el('uber-driver-status').textContent=data.status==='connected'?'Uber account connected. Earnings preview is separate from your books.':data.status==='reconnect_required'?'Uber needs authorisation again. Disconnect, then reconnect.':!data.available?'Not available yet — waiting for Earnavik’s approved Uber access.':data.status==='authorizing'?'Authorisation is unfinished. You can start again.':'Not connected.';
 }
 async function loadUberConnection(){
  if(busy)return;
  const user=appState.currentUser?.id;if(!user)return;
  if(owner!==user){resetUberWorkspace();owner=user;}const token=version;
  const eligible=uberTaxiProfile(appState.profile);el('uber-driver-card').classList.toggle('hidden',!eligible);
  el('uber-driver-connect').disabled=true;el('uber-driver-status').textContent='Checking Uber connection…';
  try{const data=await call('status');if(!same(user,token))return;paint(data);if(pending){const callback=pending;pending=null;await completeUber(callback,user,token);}}
  catch(e){if(same(user,token))el('uber-driver-status').textContent=e.message;}
 }
 async function completeUber(callback,user,token){
  setBusy(true);openAccountModal();
  let stored;try{stored=JSON.parse(sessionStorage.getItem(pendingKey)||'null');}catch{}
  if(!stored||stored.user!==user||stored.state!==callback.state||Date.now()-stored.created>600000){el('uber-driver-status').textContent='This Uber sign-in does not match this account or has expired. Start Connect Uber again.';setBusy(false);return;}
  sessionStorage.removeItem(pendingKey);
  if(callback.error){el('uber-driver-status').textContent='Uber authorisation was cancelled. Your books are unchanged.';setBusy(false);return;}
  setBusy(true);try{await call('callback',{code:callback.code,state:callback.state});if(!same(user,token))return;paint({available:true,status:'connected'});el('uber-driver-status').textContent='Uber connected. You can preview recent payments; nothing has been added to your books.';}catch(e){if(same(user,token))el('uber-driver-status').textContent=e.message;}finally{if(same(user,token)){setBusy(false);}}
 }
 async function connectUber(){
  if(busy||!uberTaxiProfile(appState.profile))return;
  if(!el('uber-driver-consent').checked){el('uber-driver-status').textContent='Tick the permission box before connecting.';return;}
  const user=appState.currentUser?.id,token=version;setBusy(true);
  try{const data=await call('connect');if(!same(user,token))return;const url=new URL(data.url);if(url.origin!=='https://auth.uber.com'||url.pathname!=='/oauth/v2/authorize'||url.searchParams.get('state')!==data.state||url.searchParams.get('redirect_uri')!=='https://earnavik.com/?uber_callback=1')throw Error('Uber sign-in link could not be verified.');sessionStorage.setItem(pendingKey,JSON.stringify({user,state:data.state,created:Date.now()}));location.assign(url.href);}catch(e){if(same(user,token))el('uber-driver-status').textContent=e.message;}finally{if(same(user,token))setBusy(false);}
 }
 async function disconnectUber(){
  if(busy||!confirm('Disconnect Uber? Your existing income and expenses will stay unchanged.'))return;
  const user=appState.currentUser?.id,token=version;setBusy(true);
  try{const data=await call('disconnect');if(!same(user,token))return;sessionStorage.removeItem(pendingKey);el('uber-driver-preview').replaceChildren();el('uber-driver-consent').checked=false;paint({available,status:'disconnected'});if(same(user,token))el('uber-driver-status').textContent=data.revoked?'Uber disconnected. Your books are unchanged.':'Disconnected in Earnavik. Uber revocation could not be confirmed; remove Earnavik under Connected apps in your Uber account too.';}catch(e){if(same(user,token))el('uber-driver-status').textContent=e.message;}finally{if(same(user,token))setBusy(false);}
 }
 async function previewUberPayments(){
  if(busy||!uberTaxiProfile(appState.profile))return;
  const user=appState.currentUser?.id,token=version;setBusy(true);el('uber-driver-preview').replaceChildren();el('uber-driver-status').textContent='Loading recent Uber payments…';
  try{const data=await call('payments');if(!same(user,token))return;
   const box=el('uber-driver-preview'),note=document.createElement('p');note.textContent='Last 7 days · showing '+data.rows.length+' of '+data.count+' payment entries. Net payouts are not automatically business turnover. This preview does not update income, tax or VAT.';box.append(note);
   if(!data.rows.length){const empty=document.createElement('p');empty.textContent='Uber returned no payments. Drivers paid through a fleet manager may receive no payment data here.';box.append(empty);}
   for(const row of data.rows){const item=document.createElement('div');item.className='border-t border-slate-700 py-2';const date=row.event_time?new Date(row.event_time*1000).toLocaleDateString('en-GB',{timeZone:'Europe/London'}):'Date unavailable';item.textContent=date+' · '+row.category+' · '+(row.amount===null?'Amount unavailable':row.currency+' '+row.amount.toFixed(2));box.append(item);}
   el('uber-driver-status').textContent='Uber payments loaded for review. Nothing saved to your books.';
  }catch(e){if(same(user,token))el('uber-driver-status').textContent=e.message;}finally{if(same(user,token))setBusy(false);}
 }
 window.__earnavikUberCallbackReady=()=>{if(pending)loadUberConnection();};
 Object.assign(window,{resetUberWorkspace,loadUberConnection,connectUber,disconnectUber,previewUberPayments});
})();
