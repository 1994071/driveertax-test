const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/../supabase/functions/email-tax-report/index.ts','utf8').replace(/^import .*;\s*$/gm,'').replace(/: Request/g,'').replace(/: any/g,'').replace(/\)!/g,')');
let handler,calls=0,user=true,providerStatus=200,providerResult={id:"mock-provider-id"};
const env={SUPABASE_URL:'https://example.test',SUPABASE_ANON_KEY:'test'};
vm.runInNewContext(source,{Request,Response,console,Deno:{env:{get:key=>env[key]},serve:fn=>handler=fn},createClient:()=>({auth:{getUser:async()=>({data:{user:user?{id:'test'}:null},error:null})}}),fetch:async()=>{calls++;return new Response(JSON.stringify(providerResult),{status:providerStatus})}});
const req=body=>new Request('https://example.test',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify(body)});
(async()=>{
 let response=await handler(req({action:'status'}));assert.equal((await response.json()).configured,false);assert.equal(calls,0);
 env.RESEND_API_KEY='mock';env.REPORT_FROM_EMAIL='DriverTax <reports@example.test>';
 response=await handler(req({action:'status'}));assert.equal((await response.json()).configured,true);assert.equal(calls,0);
 user=false;response=await handler(req({to:'test@example.test',attachments:[]}));assert.equal(response.status,401);assert.equal(calls,0);user=true;
 response=await handler(req({to:'invalid',attachments:[]}));assert.equal(response.status,400);assert.equal(calls,0);
 response=await handler(req({to:'test@example.test',attachments:[{filename:'report.csv',content:'dGVzdA=='}]}));assert.equal(response.status,200);assert.equal((await response.json()).id,'mock-provider-id');assert.equal(calls,1);
 providerStatus=403;providerResult={message:'Sender domain not verified'};response=await handler(req({to:'test@example.test',attachments:[{filename:'report.csv',content:'dGVzdA=='}]}));assert.equal(response.status,502);assert.equal((await response.json()).error,'Sender domain not verified');
 providerStatus=200;providerResult={};response=await handler(req({to:'test@example.test',attachments:[{filename:'report.csv',content:'dGVzdA=='}]}));assert.equal(response.status,502);
 console.log('PASS: email status without delivery, missing configuration, authenticated access, recipient validation and mocked provider acceptance. No real email sent.');
})().catch(e=>{console.error(e);process.exit(1)});
