const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
async function load(name){
 const raw=fs.readFileSync(__dirname+'/../supabase/functions/'+name+'/index.ts','utf8').replace(/^import .*;\s*$/gm,'');
 const compiled=ts.transpileModule(raw,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});assert.equal((compiled.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
 let handler,allowed=true,user=true,quotaFail=false,calls=0,quotas=0;
 const ctx={Request,Response,fetch:async()=>{calls++;return new Response(JSON.stringify(name==='scan-receipt'?{output_text:JSON.stringify({merchant:'Test',date:'2026-10-19',amount:10,vat:null,category:'Other',confidence:.9})}:{id:'test-only'}),{status:200,headers:{'Content-Type':'application/json'}});},AbortSignal,console:{error(){},info(){}},Uint8Array,atob,btoa,Date,Deno:{env:{get:()=> 'test-not-a-real-key'},serve:fn=>handler=fn},createClient:()=>({auth:{getUser:async()=>user?{data:name==='scan-receipt'?{user:{id:'owner'}}:{user:{id:'owner'}},error:null}:{data:{user:null},error:Error('invalid')}},rpc:async()=>{quotas++;return quotaFail?{error:Error('unavailable')}:{data:allowed,error:null}}})};
 vm.createContext(ctx);vm.runInContext(compiled.outputText,ctx);
 return {request:body=>handler(new Request('https://example.test',{method:'POST',headers:{Authorization:'Bearer test'},body:JSON.stringify(body)})),setAllowed:v=>allowed=v,setUser:v=>user=v,setQuotaFail:v=>quotaFail=v,calls:()=>calls,quotas:()=>quotas};
}
(async()=>{
 const scan=await load('scan-receipt'),body={path:'owner/file.jpg',mode:'summary',image:'data:image/jpeg;base64,/9j/AA==',categories:['Other']};
 scan.setUser(false);assert.equal((await scan.request(body)).status,401);assert.equal(scan.calls(),0);
 scan.setUser(true);assert.equal((await scan.request({...body,path:'another/file.jpg'})).status,400);assert.equal(scan.quotas(),0);
 assert.equal((await scan.request({...body,path:'owner/../another.jpg'})).status,400);
 scan.setAllowed(false);assert.equal((await scan.request(body)).status,429);assert.equal(scan.calls(),0);
 scan.setAllowed(true);scan.setQuotaFail(true);assert.equal((await scan.request(body)).status,503);assert.equal(scan.calls(),0);
 scan.setQuotaFail(false);assert.equal((await scan.request(body)).status,200);assert.equal(scan.calls(),1);
 const email=await load('email-tax-report'),report={to:'test@example.test',attachments:[{filename:'test.pdf',content:'dGVzdA=='}]};
 email.setUser(false);assert.equal((await email.request(report)).status,401);assert.equal(email.calls(),0);
 email.setUser(true);email.setAllowed(false);assert.equal((await email.request(report)).status,429);assert.equal(email.calls(),0);
 email.setAllowed(true);email.setQuotaFail(true);assert.equal((await email.request(report)).status,503);assert.equal(email.calls(),0);
 email.setQuotaFail(false);assert.equal((await email.request(report)).status,200);assert.equal(email.calls(),1);
 console.log('PASS: both Edge Functions transpile; unauthenticated and rate-limited calls never reach paid APIs; quota errors fail closed; scanner rejects another owner and traversal; valid requests still work. Providers fully mocked.');
})().catch(e=>{console.error(e);process.exit(1)});
