import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { UBER_REDIRECT,UBER_SCOPES,taxiProfile,configured,stateHash,tokenKey,sealToken,openToken,validateTokens,paymentPreview } from './helpers.ts';
const env=(k:string)=>Deno.env.get(k);
const origins=new Set(['https://earnavik.com','https://www.earnavik.com']);
const db=()=>createClient(env('SUPABASE_URL')!,env('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
function checked(result:any){if(result.error)throw Error('Connection storage unavailable. Please retry.');return result.data;}
async function remote(url:string,init:RequestInit){return fetch(url,{...init,signal:AbortSignal.timeout(12000),redirect:'error'});}
async function exchange(fields:Record<string,string>){const response=await remote('https://auth.uber.com/oauth/v2/token',{method:'POST',body:new URLSearchParams({client_id:env('UBER_CLIENT_ID')!,client_secret:env('UBER_CLIENT_SECRET')!,...fields})});if(!response.ok)throw Error('Uber authorisation failed. Please reconnect.');return validateTokens(await response.json());}
async function revoke(token:string){try{const r=await remote('https://auth.uber.com/oauth/revoke',{method:'POST',body:new URLSearchParams({client_id:env('UBER_CLIENT_ID')!,client_secret:env('UBER_CLIENT_SECRET')!,token})});return r.ok;}catch{return false;}}
async function boundedBody(req:Request){const reader=req.body?.getReader();if(!reader)throw Error('Invalid request.');let size=0;const parts=[];for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>8192){await reader.cancel();throw Error('Request too large.');}parts.push(value);}const bytes=new Uint8Array(size);let p=0;for(const a of parts){bytes.set(a,p);p+=a.length;}return JSON.parse(new TextDecoder().decode(bytes));}
export async function handleUber(req:Request){
 const origin=req.headers.get('origin')||'';
 const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
 if(origins.has(origin))headers['Access-Control-Allow-Origin']=origin;
 const reply=(code:number,data:object)=>new Response(JSON.stringify(data),{status:code,headers});
 if(origin&&!origins.has(origin))return reply(403,{error:'Origin not allowed.'});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply(405,{error:'Method not allowed.'});
 try{
  const jwt=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');if(!jwt)return reply(401,{error:'Sign in required.'});
  const auth=createClient(env('SUPABASE_URL')!,env('SUPABASE_ANON_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await auth.auth.getUser(jwt);if(error||!data.user)return reply(401,{error:'Sign in required.'});
  const user=data.user.id,body=await boundedBody(req),admin=db();
  if(!['status','connect','callback','disconnect','payments'].includes(body.action))return reply(400,{error:'Unknown action.'});
  const profile=checked(await admin.from('profiles').select('profession_roles,work_types,primary_work_type').eq('id',user).maybeSingle());
  const eligible=taxiProfile(profile),ready=configured(env);
  if(!eligible&&!['status','disconnect'].includes(body.action))return reply(403,{error:'Uber connections are for saved taxi/private-hire profiles only.'});
  // A per-user rolling request quota prevents accidental loops and provider abuse.
  const quota=await admin.rpc('consume_uber_request',{p_user_id:user});checked(quota);if(!quota.data)return reply(429,{error:'Too many requests. Please try again shortly.'});
  let connection=checked(await admin.from('uber_driver_connections').select('*').eq('user_id',user).maybeSingle());
  if(body.action==='status')return reply(200,{eligible,available:ready,status:connection?.status||'disconnected',connected_at:connection?.connected_at||null});
  if(body.action==='disconnect'){
   // Stop callbacks and refreshes before attempting remote revocation. Never delete books.
   checked(await admin.from('uber_driver_oauth_states').delete().eq('user_id',user));
   checked(await admin.from('uber_driver_connections').delete().eq('user_id',user));
   let revoked=!connection?.token_ciphertext;
   if(connection?.token_ciphertext&&ready){try{const tokens=await openToken(await tokenKey(env('UBER_TOKEN_KEY')!),user,connection.token_ciphertext);revoked=await revoke(tokens.access_token);}catch{revoked=false;}}
   return reply(200,{status:'disconnected',revoked});
  }
  if(!ready)return reply(409,{error:'Uber connection is not available yet. Earnavik needs approved Uber API access before you can connect.',code:'setup_required'});
  const key=await tokenKey(env('UBER_TOKEN_KEY')!);
  if(body.action==='connect'){
   if(connection?.status==='connected')return reply(409,{error:'Disconnect the existing Uber account before connecting another.'});
   const state=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
   const attempt=crypto.randomUUID();
   checked(await admin.from('uber_driver_connections').upsert({user_id:user,attempt_id:attempt,status:'authorizing',token_ciphertext:null,expires_at:null,connected_at:null,lock_id:null,lock_until:null}));
   checked(await admin.from('uber_driver_oauth_states').upsert({user_id:user,state_hash:await stateHash(state),attempt_id:attempt,expires_at:new Date(Date.now()+600000).toISOString()}));
   const url=new URL('https://auth.uber.com/oauth/v2/authorize');url.search=new URLSearchParams({client_id:env('UBER_CLIENT_ID')!,response_type:'code',redirect_uri:UBER_REDIRECT,scope:UBER_SCOPES,state}).toString();
   return reply(200,{url:url.href,state});
  }
  if(body.action==='callback'){
   if(typeof body.state!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(body.state)||typeof body.code!=='string'||body.code.length>4096||!body.code)return reply(400,{error:'Invalid authorisation. Start Connect Uber again.'});
   const states=checked(await admin.from('uber_driver_oauth_states').delete().eq('user_id',user).eq('state_hash',await stateHash(body.state)).gt('expires_at',new Date().toISOString()).select('attempt_id'));
   if(states?.length!==1)return reply(400,{error:'Authorisation expired or already used. Start Connect Uber again.'});
   let tokens:any=null,persisted=false;
   try{
    tokens=await exchange({grant_type:'authorization_code',redirect_uri:UBER_REDIRECT,code:body.code});
    const me=await remote('https://api.uber.com/v1/partners/me',{headers:{Authorization:'Bearer '+tokens.access_token}});if(!me.ok)throw Error('Uber could not verify a driver account. Please reconnect.');
    const rows=checked(await admin.from('uber_driver_connections').update({status:'connected',token_ciphertext:await sealToken(key,user,tokens),expires_at:new Date(Date.now()+tokens.expires_in*1000).toISOString(),connected_at:new Date().toISOString()}).eq('user_id',user).eq('attempt_id',states[0].attempt_id).eq('status','authorizing').select('user_id'));
    if(rows?.length!==1)throw Error('Connection was cancelled. Start again if needed.');persisted=true;
    return reply(200,{status:'connected'});
   }finally{if(tokens&&!persisted)await revoke(tokens.access_token);}
  }
  // Preview only: net payouts are never inserted into income/expenses or VAT records.
  if(!connection?.token_ciphertext||connection.status!=='connected')return reply(409,{error:'Connect your Uber driver account first.'});
  const lock=crypto.randomUUID();
  const locked=checked(await admin.from('uber_driver_connections').update({lock_id:lock,lock_until:new Date(Date.now()+60000).toISOString()}).eq('user_id',user).eq('attempt_id',connection.attempt_id).eq('status','connected').or('lock_until.is.null,lock_until.lt.'+new Date().toISOString()).select('*'));
  if(locked?.length!==1)return reply(409,{error:'Another Uber request is running. Please wait and retry.'});
  try{
   connection=locked[0];let tokens=await openToken(key,user,connection.token_ciphertext);
   if(Date.parse(connection.expires_at)<Date.now()+60000){
    try{tokens=await exchange({grant_type:'refresh_token',refresh_token:tokens.refresh_token});}catch{checked(await admin.from('uber_driver_connections').update({status:'reconnect_required'}).eq('user_id',user).eq('lock_id',lock));return reply(409,{error:'Uber access expired. Disconnect and reconnect.'});}
    const saved=checked(await admin.from('uber_driver_connections').update({token_ciphertext:await sealToken(key,user,tokens),expires_at:new Date(Date.now()+tokens.expires_in*1000).toISOString()}).eq('user_id',user).eq('lock_id',lock).select('user_id'));
    if(saved?.length!==1){await revoke(tokens.access_token);return reply(409,{error:'Connection changed. Please reconnect.'});}
   }
   const now=Math.floor(Date.now()/1000),url=new URL('https://api.uber.com/v1/partners/payments');url.search=new URLSearchParams({from_time:String(now-7*86400),to_time:String(now),limit:'50',offset:'0'}).toString();
   const response=await remote(url.href,{headers:{Authorization:'Bearer '+tokens.access_token}});
   if(!response.ok){if(response.status===401)checked(await admin.from('uber_driver_connections').update({status:'reconnect_required'}).eq('user_id',user).eq('lock_id',lock));return reply(response.status===429?429:502,{error:response.status===429?'Uber is busy. Try again later.':'Uber data could not load. Reconnect if access has expired.'});}
   const preview=paymentPreview(await response.json());
   // A concurrent disconnect invalidates this response before it leaves the server.
   const active=checked(await admin.from('uber_driver_connections').select('user_id').eq('user_id',user).eq('lock_id',lock).maybeSingle());if(!active)return reply(409,{error:'Connection was disconnected.'});
   return reply(200,{...preview,preview_only:true,period_days:7});
  }finally{await admin.from('uber_driver_connections').update({lock_id:null,lock_until:null}).eq('user_id',user).eq('lock_id',lock);}
 }catch(error){return reply(400,{error:error instanceof Error&&/^(Uber|Connection|Invalid|Request|Unexpected)/.test(error.message)?error.message:'Uber connection could not complete. Please try again.'});}
}
Deno.serve(handleUber);
