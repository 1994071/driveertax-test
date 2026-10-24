import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.2";

// A scope-limited Vault token authenticates cron. User JWTs and public keys cannot run this worker.
Deno.serve(async (req: Request) => {
 const reply=(status: number,body: Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
 if(req.method!=='POST')return reply(405,{error:'Method not allowed'});
 const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
 if(!/^[a-f0-9]{64}$/.test(token))return reply(401,{error:'Unauthorized'});
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))).map(v=>v.toString(16).padStart(2,'0')).join('');
 const {data:config,error:configError}=await db.from('invoice_reminder_worker').select('token_hash').eq('id',true).single();
 if(configError||!config||config.token_hash!==digest)return reply(401,{error:'Unauthorized'});
 const key=Deno.env.get('RESEND_API_KEY'),from=Deno.env.get('REPORT_FROM_EMAIL');
 if(!key||!from)return reply(503,{error:'Reminder email is not configured'});
 const {data:jobs,error}=await db.rpc('list_due_invoice_reminders');
 if(error)return reply(503,{error:'Reminder queue unavailable'});
 let accepted=0,failed=0,skipped=0;
 // Keep a batch within the Edge Function wall-clock budget and provider concurrency modest.
 async function sendJob(job: {invoice_id:string;user_id:string;stage:string}){
   const {data:allowed,error:quotaError}=await db.rpc('consume_paid_api_request',{p_user_id:job.user_id,p_service:'report_email'});
   if(quotaError||allowed!==true){skipped++;return;}
   const {data:invoice,error:claimError}=await db.rpc('claim_invoice_reminder',{p_invoice_id:job.invoice_id,p_stage:job.stage});
   if(claimError||!invoice){skipped++;return;}
   let providerId=null,message=null;
   try{
    const due=new Date(invoice.due_date+'T12:00:00Z').toLocaleDateString('en-GB',{timeZone:'Europe/London'});
    const total=new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(Number(invoice.total));
    const response=await fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','Idempotency-Key':'invoice-reminder/'+invoice.invoice_id+'/'+invoice.stage},body:JSON.stringify({from,to:[invoice.recipient],subject:(invoice.stage==='due'?'Payment due: ':'Payment reminder: ')+invoice.invoice_number+' — '+invoice.seller_name,text:'Hello,\n\nThis is a friendly reminder from '+invoice.seller_name+' about invoice '+invoice.invoice_number+'.\nAmount: '+total+'\nDue date: '+due+'\n\n'+(invoice.stage==='due'?'Payment is due today.':'Our records show this invoice is seven days overdue.')+' If you have already paid, please disregard this reminder and contact the business so they can update their records.\n\nPayment details:\n'+invoice.payment_details+'\n\nThis is an automatic invoice reminder sent by Earnavik on behalf of the business. Contact the business directly with any questions.'})});
    const result=await response.json().catch(()=>({}));
    if(response.ok&&typeof result.id==='string'&&result.id)providerId=result.id;
    else message='Email provider did not accept this reminder (HTTP '+response.status+').';
   }catch(_){message='Sending could not be confirmed. Check email delivery before sending a manual follow-up.';}
   const {error:saveError}=await db.rpc('finish_invoice_reminder',{p_invoice_id:job.invoice_id,p_stage:job.stage,p_provider_id:providerId,p_error:message});
   if(saveError)console.error('Invoice reminder result could not be recorded');
   if(providerId)accepted++;else failed++;
 }
 for(const job of (jobs||[])){await sendJob(job);await new Promise(resolve=>setTimeout(resolve,600));}
 return reply(200,{accepted,failed,skipped});
});
