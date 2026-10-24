(()=>{
 const el=id=>document.getElementById(id);let registration=null,publicKey=null,binding=null,loadedOwner=null,busy=false,generation=0,pendingOpen=new URL(location.href).searchParams.get('open')==='invoices';
 const supported=()=>!!(window.isSecureContext&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window);
 const isIPhoneTab=()=>/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const standalone=()=>window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
 function note(message){el('owner-push-status').textContent=message;}
 async function call(action,extra={}){const {data,error}=await supabaseClient.functions.invoke('owner-invoice-push',{body:{action,...extra}});if(error){let message='Notification service unavailable. Please retry.';try{const detail=await error.context?.json();if(detail?.error)message=detail.error;}catch(_){}throw Error(message);}if(data?.error)throw Error(data.error);return data;}
 function keyBytes(key){const raw=atob(key.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(raw,c=>c.charCodeAt(0));}
 async function bindDevice(user_id,deviceBinding){
  if(!registration?.active)return;
  await new Promise((resolve,reject)=>{const channel=new MessageChannel(),timer=setTimeout(()=>reject(Error('Device setup timed out. Refresh and retry.')),5000);channel.port1.onmessage=()=>{clearTimeout(timer);resolve();};registration.active.postMessage({type:'PUSH_BINDING',user_id,binding:deviceBinding},[channel.port2]);});
 }
 async function loadOwnerPushSettings(){
  const owner=appState.currentUser?.id,token=++generation;loadedOwner=null;publicKey=null;binding=null;
  el('owner-push-enable').disabled=true;el('owner-push-test').disabled=true;el('owner-push-off').disabled=true;
  if(!owner){note('Sign in to enable notifications.');return;}
  if(!supported()||(isIPhoneTab()&&!standalone())){note(isIPhoneTab()?'On iPhone/iPad: open Earnavik in Safari, tap Share → Add to Home Screen, then open it from that icon to enable notifications.':'This browser does not support notifications. You can still check invoice statuses in the app.');return;}
  if(Notification.permission==='denied'){note('Notifications are blocked. Allow Earnavik notifications in your browser or phone settings, then reopen this screen.');el('owner-push-off').disabled=false;return;}
  note('Checking this device…');
  try{
   registration=await navigator.serviceWorker.register('/owner-push-sw.js',{scope:'/'});await navigator.serviceWorker.ready;
   const sub=await registration.pushManager.getSubscription(),data=await call('status',{endpoint:sub?.endpoint||''});
   if(token!==generation||owner!==appState.currentUser?.id)return;
   publicKey=data.publicKey;binding=data.binding;loadedOwner=owner;el('owner-push-sound').checked=data.sound;
   el('owner-push-enable').textContent=data.enabled?'Save notification settings':'Enable notifications';el('owner-push-enable').disabled=false;
   el('owner-push-test').disabled=!data.enabled;el('owner-push-off').disabled=!data.enabled;
   if(data.enabled&&binding)await bindDevice(owner,binding);else await bindDevice(null,null);
   if(token!==generation||owner!==appState.currentUser?.id)return;
   note(data.enabled?'Daily invoice notifications are on for this device. Send a test to check notification and sound settings.':'Notifications are off on this device. Tap Enable notifications to allow them.');
  }catch(e){if(token===generation&&owner===appState.currentUser?.id)note(e.message);}
 }
 async function enableOwnerPush(){
  if(busy||loadedOwner!==appState.currentUser?.id||!publicKey||!registration)return;
  const owner=loadedOwner,sound=el('owner-push-sound').checked;busy=true;el('owner-push-enable').disabled=true;
  // Request permission synchronously from this button gesture, before any network await.
  let sub=null;
  try{
   const permission=Notification.requestPermission();
   if(await permission!=='granted')throw Error('Notifications were not allowed. You can enable them later in device settings.');
   if(owner!==appState.currentUser?.id)return;
   sub=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(publicKey)});
   if(owner!==appState.currentUser?.id){await sub.unsubscribe();return;}
   const nextBinding=crypto.randomUUID();await call('subscribe',{subscription:sub.toJSON(),sound,binding:nextBinding});
   if(owner!==appState.currentUser?.id){await sub.unsubscribe();return;}
   binding=nextBinding;await bindDevice(owner,binding);await loadOwnerPushSettings();
  }catch(e){if(owner===appState.currentUser?.id)note(e.message+' Notification setup is not confirmed.');}
  finally{busy=false;if(owner===appState.currentUser?.id)el('owner-push-enable').disabled=false;}
 }
 async function disableOwnerPush(){
  if(busy)return;const owner=appState.currentUser?.id;if(!owner)return;busy=true;
  try{
   registration=registration||await navigator.serviceWorker.getRegistration('/');const sub=await registration?.pushManager.getSubscription();
   await bindDevice(null,null);binding=null;
   if(sub){await call('disable',{endpoint:sub.endpoint});await sub.unsubscribe();}
   if(owner===appState.currentUser?.id)await loadOwnerPushSettings();
  }catch(_){if(owner===appState.currentUser?.id)note('Turn-off could not be confirmed. Block notifications in device settings to stop them immediately, then retry.');}
  finally{busy=false;}
 }
 async function testOwnerPush(){
  if(busy||loadedOwner!==appState.currentUser?.id)return;const owner=loadedOwner;busy=true;el('owner-push-test').disabled=true;

  try{const sub=await registration?.pushManager.getSubscription();if(!sub)throw Error('Enable this device first.');const result=await call('test',{endpoint:sub.endpoint});if(owner===appState.currentUser?.id)note(result.accepted?'Test accepted by the push service. Look for the notification; sound depends on phone/browser settings.':'Test was not accepted.');}
  catch(e){if(owner===appState.currentUser?.id)note(e.message);}
  finally{busy=false;if(owner===appState.currentUser?.id)el('owner-push-test').disabled=false;}
 }
 function openOwnerNotificationInvoices(){
  if(!pendingOpen||!appState.currentUser||!document.getElementById('account-data-gate')?.classList.contains('hidden'))return;
  pendingOpen=false;appState.homeCalendarOpened=true;closeAccountModal();openInvoices();const url=new URL(location.href);url.searchParams.delete('open');history.replaceState(null,'',url.pathname+url.search+url.hash);
 }
 async function resetOwnerPushDevice(disableRemote=false){
  const token=++generation,owner=appState.currentUser?.id;binding=null;publicKey=null;loadedOwner=null;
  if(!supported())return;
  try{registration=registration||await navigator.serviceWorker.getRegistration('/');if(token!==generation)return;await bindDevice(null,null);const sub=await registration?.pushManager.getSubscription();if(token!==generation)return;if(sub){if(disableRemote&&owner===appState.currentUser?.id){try{await call('disable',{endpoint:sub.endpoint});}catch(_){}}await sub.unsubscribe();}}catch(_){}
 }
 Object.assign(window,{loadOwnerPushSettings,enableOwnerPush,disableOwnerPush,testOwnerPush,openOwnerNotificationInvoices,resetOwnerPushDevice});
 try{
 if(supported())navigator.serviceWorker.getRegistration('/').then(async reg=>{if(generation===0&&reg){registration=reg;await bindDevice(null,null);}}).catch(()=>{});
 if(supported())navigator.serviceWorker.addEventListener('message',event=>{
  if(event.source?.scriptURL!==new URL('/owner-push-sw.js',location.origin).href)return;
  if(event.data?.type==='OPEN_INVOICES'){pendingOpen=true;openOwnerNotificationInvoices();}
 });
 }catch(_){note("Notification setup could not start. Use Check notification setup to retry.");}
})();
