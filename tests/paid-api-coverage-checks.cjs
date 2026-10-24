// Inventory guard: adding a remote fetch requires an explicit provider/quota review.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const endpoints={'scan-receipt':'receipt_scan','parse-bank-statement':'bank_pdf','email-tax-report':'report_email','invoice-reminders':'report_email','owner-invoice-push':'owner_push','report-app-health':'operator_email'};
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const root=path.join(__dirname,'../supabase/functions');
for(const file of walk(root).filter(f=>/\.[tj]s$/.test(f))){
 const s=fs.readFileSync(file,'utf8');if(!/\bfetch\s*\(/.test(s))continue;
 const endpoint=path.relative(root,file).split(path.sep)[0];
 // Uber already has a separate server-side authenticated quota and OAuth state checks.
 if(endpoint==='uber-driver'){assert.match(s,/consume_uber_request/);continue;}
 assert.ok(endpoints[endpoint],`Unreviewed remote API in ${file}: register a service and add denial tests before merging`);
 assert.match(s,/rpc\(["']consume_paid_api_request["']/);
 assert.ok(s.indexOf('consume_paid_api_request')<s.indexOf('fetch('),`Quota must precede provider in ${file}`);
 assert.ok(s.includes(endpoints[endpoint]));
}
const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261023_paid_api_limits.sql'),'utf8')+fs.readFileSync(path.join(__dirname,'../supabase/schema/owner_invoice_push.sql'),'utf8');
for(const service of Object.values(endpoints))assert.ok(sql.includes("('"+service+"'"));
assert.match(sql,/for update/);assert.match(sql,/security invoker/);assert.match(sql,/revoke all on function[^;]+from public,anon,authenticated/);
console.log('PASS: every existing paid remote endpoint uses the server quota; unreviewed remote endpoints fail inventory checks.');
