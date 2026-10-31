import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.2";
import webpush from "npm:web-push@3.6.7";
const origins=new Set(['https://earnavik.com','https://www.earnavik.com']);
const sha=async(value: string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(v=>v.toString(16).padStart(2,'0')).join('');
function validSubscription(sub: any){
 try{
  const url=new URL(sub?.endpoint);if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||sub.endpoint.length>2048)return false;
  const h=url.hostname;if(!(h==='fcm.googleapis.com'||h==='updates.push.services.mozilla.com'||h.endsWith('.push.services.mozilla.com')||h.endsWith('.push.apple.com')||h.endsWith('.notify.windows.com')))return false;
  const bytes=(value: string)=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  if(!/^[A-Za-z0-9_-]{86,88}$/.test(sub.keys?.p256dh)||!/^[-A-Za-z0-9_]{22}$/.test(sub.keys?.auth))return false;
  const key=bytes(sub.keys.p256dh);return key.length===65&&key[0]===4&&bytes(sub.keys.auth).length===16;
 }catch(_){return false;}
}
Deno.serve(async(req: Request)=>{
 const origin=req.headers.get('Origin')||'';
 const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':origins.has(origin)?origin:'https://earnavik.com','Vary':'Origin','Access-Control-Allow-Headers':'authorization,apikey,x-client-info,content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
 const reply=(status: number,data: any)=>new Response(JSON.stringify(data),{status,headers});
 if(origin&&!origins.has(origin))return reply(403,{error:'Origin not allowed'});
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return reply(405,{error:'Method not allowed'});
 try{
  const raw=await req.text();if(raw.length>6000)return reply(413,{error:'Request too large'});const body=JSON.parse(raw);
  const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');if(!token)return reply(401,{error:'Sign in to manage notifications'});
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let owner=null;
  if(body.action==='run_daily'||body.action==='run_bookkeeping'){
   if(!/^[a-f0-9]{64}$/.test(token))return reply(401,{error:'Unauthorized'});
   const {data:worker,error}=await db.from('invoice_reminder_worker').select('token_hash').eq('id',true).single();
   if(error||worker?.token_hash!==await sha(token))return reply(401,{error:'Unauthorized'});
  }else{
   const {data,error}=await db.auth.getUser(token);if(error||!data.user)return reply(401,{error:'Sign in to manage notifications'});owner=data.user.id;
  }
  const {data:config,error:configError}=await db.from('owner_push_config').select('public_key,private_key').eq('id',true).single();
  if(configError||!config)return reply(503,{error:'Notifications are not configured'});
  if(body.action==='status'){
   let device=null;if(typeof body.endpoint==='string'&&body.endpoint.length<=2048){const result=await db.from('owner_push_devices').select('enabled,sound,binding,bookkeeping_enabled,bookkeeping_time').eq('endpoint_hash',await sha(body.endpoint)).eq('user_id',owner).maybeSingle();if(result.error)throw result.error;device=result.data;}
   return reply(200,{publicKey:config.public_key,enabled:!!device?.enabled,sound:device?.sound??true,binding:device?.binding||null,bookkeepingEnabled:device?.bookkeeping_enabled??false,bookkeepingTime:String(device?.bookkeeping_time||'20:00').slice(0,5)});
  }
  if(body.action==='disable'){
   if(typeof body.endpoint!=='string'||body.endpoint.length>2048)return reply(400,{error:'Device subscription missing'});
   const {error}=await db.from('owner_push_devices').update({enabled:false,updated_at:new Date().toISOString()}).eq('endpoint_hash',await sha(body.endpoint)).eq('user_id',owner);if(error)throw error;return reply(200,{ok:true});
  }
  if(body.action==='subscribe'){
   if(!validSubscription(body.subscription)||typeof body.sound!=='boolean'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.binding||''))return reply(400,{error:'Invalid device subscription'});
   if((body.bookkeepingEnabled!==undefined&&typeof body.bookkeepingEnabled!=='boolean')||(body.bookkeepingTime!==undefined&&(typeof body.bookkeepingTime!=='string'||!/^([01][0-9]|2[0-3]):[0-5]0$/.test(body.bookkeepingTime))))return reply(400,{error:'Choose a UK reminder time in 10-minute steps'});
   const hash=await sha(body.subscription.endpoint);
   const {data:devices,error}=await db.from('owner_push_devices').select('endpoint_hash').eq('user_id',owner).eq('enabled',true);if(error)throw error;
   if(devices.length>=5&&!devices.some((d: any)=>d.endpoint_hash===hash))return reply(400,{error:'Turn off a device before enabling more than five devices'});
   const quota=await db.rpc('consume_paid_api_request',{p_user_id:owner,p_service:'owner_push'});if(quota.error||quota.data!==true)return reply(429,{error:'Notification limit reached. Try later.'});
   const sub={endpoint:body.subscription.endpoint,keys:{p256dh:body.subscription.keys.p256dh,auth:body.subscription.keys.auth}};
   const result=await db.from('owner_push_devices').upsert({endpoint_hash:hash,user_id:owner,subscription:sub,binding:body.binding,sound:body.sound,enabled:true,...(body.bookkeepingEnabled!==undefined?{bookkeeping_enabled:body.bookkeepingEnabled}:{}),...(body.bookkeepingTime!==undefined?{bookkeeping_time:body.bookkeepingTime}:{}),updated_at:new Date().toISOString()},{onConflict:'endpoint_hash'});if(result.error)throw result.error;
   return reply(200,{ok:true});
  }
  async function send(device: any,payload: any){
   // The library prepares encrypted VAPID data; native fetch enforces timeout and no redirects.
   if(!validSubscription(device.subscription))return {accepted:false,status:400,reason:'InvalidSubscription'};
   const details=webpush.generateRequestDetails(device.subscription,JSON.stringify(payload),{vapidDetails:{subject:'https://earnavik.com',publicKey:config.public_key,privateKey:config.private_key},TTL:3600,urgency:'normal'});
   const response=await fetch(details.endpoint,{method:'POST',headers:details.headers,body:new Uint8Array(details.body),redirect:'error',signal:AbortSignal.timeout(10000)});
   if(response.status===404||response.status===410)await db.from('owner_push_devices').update({enabled:false}).eq('endpoint_hash',await sha(device.subscription.endpoint)).eq('user_id',device.user_id);
   let reason='';try{const body=await response.json();if(/^[A-Za-z0-9_-]{1,80}$/.test(body?.reason||''))reason=body.reason;}catch(_){}
   const accepted=response.status>=200&&response.status<300;
   if(!accepted)console.error('Owner push rejected',response.status,reason||'Unspecified');
   return {accepted,status:response.status,reason};
  }
  if(body.action==='test'){
   if(typeof body.endpoint!=='string'||body.endpoint.length>2048)return reply(400,{error:'Enable this device first'});
   const {data:device,error}=await db.from('owner_push_devices').select('*').eq('endpoint_hash',await sha(body.endpoint)).eq('user_id',owner).eq('enabled',true).maybeSingle();if(error||!device)return reply(400,{error:'Enable notifications on this device first'});
   const quota=await db.rpc('consume_paid_api_request',{p_user_id:owner,p_service:'owner_push'});if(quota.error||quota.data!==true)return reply(429,{error:'Notification limit reached. Try later.'});
   const delivery=await send(device,{test:true,user_id:owner,binding:device.binding,sound:device.sound,kind:body.kind==='bookkeeping'?'bookkeeping':'invoices',title:body.kind==='bookkeeping'?'Keep your books up to date':'Earnavik test notification',body:body.kind==='bookkeeping'?'Finished for today? Add your income and expenses to keep your figures up to date.':'Notifications are ready. Tap to open your invoices.'});
   return reply(delivery.accepted?200:502,delivery.accepted?{ok:true,accepted:true}:{error:'Push service rejected this notification (HTTP '+delivery.status+(delivery.reason?' · '+delivery.reason:'')+'). Please report this message.'});
  }
  if(body.action!=='run_daily'&&body.action!=='run_bookkeeping')return reply(400,{error:'Unknown notification action'});
  const bookkeeping=body.action==='run_bookkeeping';
  const {data:jobs,error}=await db.rpc(bookkeeping?'list_owner_bookkeeping_push':'list_owner_invoice_push');if(error)throw error;let accepted=0,failed=0;
  for(const job of jobs||[]){
   const quota=await db.rpc('consume_paid_api_request',{p_user_id:job.user_id,p_service:'owner_push'});if(quota.error||quota.data!==true)continue;
   const {data:device,error:claimError}=await db.rpc(bookkeeping?'claim_owner_bookkeeping_push':'claim_owner_invoice_push',{p_hash:job.endpoint_hash,p_user_id:job.user_id});if(claimError||!device)continue;
   if(bookkeeping){const fresh=await db.rpc('get_bookkeeping_day_status',{p_user_id:job.user_id,p_day:device.day});if(fresh.error||fresh.data?.complete!==false)continue;}
   let ok=false;try{ok=(await send(device,{test:false,day:device.day,user_id:device.user_id,binding:device.binding,sound:device.sound,kind:bookkeeping?'bookkeeping':'invoices',title:bookkeeping?'Keep your books up to date':'Your daily invoice reminder',body:bookkeeping?'Finished for today? Add your income and expenses to keep your figures up to date.':Number(device.due)+' due today · '+Number(device.overdue)+' overdue. Tap to review your invoices.'})).accepted;}catch(_){}
   const result=await db.from(bookkeeping?'owner_bookkeeping_push_deliveries':'owner_push_deliveries').update({status:ok?'accepted':'failed'}).eq('endpoint_hash',job.endpoint_hash).eq('user_id',job.user_id).eq('day',device.day);if(result.error)console.error('Owner push result could not be recorded');
   if(ok)accepted++;else failed++;
  }
  return reply(200,{accepted,failed});
 }catch(_){return reply(503,{error:'Notification request could not be confirmed. Please retry later.'});}
});
