// Push only: no financial pages, API responses or receipts are cached.
const bindingCache='earnavik-push-binding-v1',bindingUrl=new URL('/__earnavik_push_binding__',self.location.origin).href;
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('message',event=>{
 if(event.data?.type!=='PUSH_BINDING')return;
 if(!event.source?.url||new URL(event.source.url).origin!==self.location.origin)return;
 event.waitUntil((async()=>{const cache=await caches.open(bindingCache);if(event.data.user_id&&event.data.binding)await cache.put(bindingUrl,new Response(JSON.stringify({user_id:event.data.user_id,binding:event.data.binding})));else await cache.delete(bindingUrl);event.ports?.[0]?.postMessage({ok:true});})());
});
self.addEventListener('push',event=>event.waitUntil((async()=>{
 let payload={};try{payload=event.data?.json()||{};}catch(_){}
 let binding=null;try{const saved=await(await caches.open(bindingCache)).match(bindingUrl);if(saved)binding=await saved.json();}catch(_){}
 const kind=payload.kind==='bookkeeping'?'bookkeeping':'invoices';
 const matched=!!binding&&binding.user_id===payload.user_id&&binding.binding===payload.binding;
 await self.registration.showNotification(matched?String(payload.title||'Earnavik invoice reminder'):'Earnavik reminder',{
  body:matched?String(payload.body||'Open Earnavik to review your invoices.'):'Sign in to Earnavik to review your notifications.',
  icon:'/icons/earnavik-192.png',badge:'/icons/earnavik-192.png',tag:payload.test?'earnavik-'+kind+'-test':'earnavik-'+kind+'-daily',
  silent:!matched||payload.sound===false,data:{kind:matched?kind:'invoices'},renotify:matched&&payload.sound!==false
 });
})()));
self.addEventListener('notificationclick',event=>{
 event.notification.close();event.waitUntil((async()=>{const kind=event.notification.data?.kind==='bookkeeping'?'bookkeeping':'invoices';const target=new URL('/?open='+kind,self.location.origin).href;const tabs=await self.clients.matchAll({type:'window',includeUncontrolled:true});for(const tab of tabs){if(new URL(tab.url).origin===self.location.origin){await tab.focus();tab.postMessage({type:kind==='bookkeeping'?'OPEN_BOOKKEEPING':'OPEN_INVOICES'});return;}}await self.clients.openWindow(target);})());
});
