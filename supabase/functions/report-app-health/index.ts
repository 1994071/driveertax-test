import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const codes=new Set(['runtime_error','unhandled_rejection','cloud_load_failed','receipt_scan_failed','invoice_email_failed','slow_scan']);
const reply=(status:number,body:object)=>new Response(JSON.stringify(body),{status,headers:cors});
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return reply(405,{error:'Method not allowed'});
 try{
  const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
  if(!token)return reply(401,{error:'Sign in required'});
  const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!);
  const {data,error}=await client.auth.getUser(token);
  if(error||!data.user)return reply(401,{error:'Sign in required'});
  // Bound bytes before parsing; do not accept messages, stack traces or financial payloads.
  const reader=req.body?.getReader();if(!reader)return reply(400,{error:'Invalid event'});
  const parts:Uint8Array[]=[];let size=0;
  for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>512){await reader.cancel();return reply(413,{error:'Event too large'});}parts.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}
  const body=JSON.parse(new TextDecoder().decode(bytes));
  if(!body||Object.keys(body).length!==1||!codes.has(body.code))return reply(400,{error:'Invalid event'});
  const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const quota=await admin.rpc('consume_api_request',{p_user_id:data.user.id,p_service:'app_health'});
  if(quota.error)return reply(503,{error:'Unavailable'});
  if(!quota.data)return reply(429,{error:'Try later'});
  const saved=await admin.rpc('record_app_health',{p_user_id:data.user.id,p_code:body.code});
  if(saved.error)return reply(503,{error:'Unavailable'});
  // Optional operator alert: fixed text, no account identity or customer content.
  // Configure APP_ALERT_EMAIL to a mailbox controlled by the operator before enabling.
  const to=Deno.env.get('APP_ALERT_EMAIL'),key=Deno.env.get('RESEND_API_KEY'),from=Deno.env.get('REPORT_FROM_EMAIL');
  if(saved.data===1&&to&&key&&from){
   const claim=await admin.rpc('claim_app_health_alert',{p_code:body.code});
   if(claim.error||!claim.data)return reply(200,{ok:true});
   try{const sent=await fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(5000),headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({from,to:[to],subject:'Earnavik app health: '+body.code,text:'The app recorded '+body.code+'. Review the private app health counters and deployment logs. No customer content is included.'})});if(!sent.ok)console.error('Operator alert delivery failed',sent.status);}catch{console.error('Operator alert delivery unavailable');}
  }
  return reply(200,{ok:true});
 }catch{return reply(400,{error:'Invalid event'});}
});
