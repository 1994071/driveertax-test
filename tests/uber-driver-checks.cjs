const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),ts=require('typescript');
const base='supabase/functions/uber-driver/';
function moduleFrom(file,globals={}){const module={exports:{}};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;const ctx={module,exports:module.exports,crypto:globalThis.crypto,atob,btoa,TextEncoder,TextDecoder,Uint8Array,URL,URLSearchParams,Date,Request,Response,AbortSignal,console,...globals};vm.runInNewContext(code,ctx);return module.exports;}
(async()=>{
const h=moduleFrom(base+'helpers.ts'),taxi={profession_roles:[{id:'driving-0',label:'Taxi / Private Hire',category:'driving'}]};
assert.equal(h.taxiProfile(taxi),true);assert.equal(h.taxiProfile({primary_work_type:'Taxi Driver'}),true);
for(const label of ['Food Delivery','Uber Eats','Parcel / Courier','Electrician','Chauffeur','Vehicle / Business Driving'])assert.equal(h.taxiProfile({primary_work_type:label}),false);
assert.equal(h.taxiProfile({profession_roles:[{label:'Electrician'},{label:'Taxi / Private Hire'}]}),true);
const secrets={SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service',UBER_DRIVER_APPROVED:'true',UBER_CLIENT_ID:'client',UBER_CLIENT_SECRET:'secret',UBER_TOKEN_KEY:btoa('a'.repeat(32))};
assert.equal(h.configured(k=>secrets[k]),true);assert.equal(h.configured(k=>k==='UBER_DRIVER_APPROVED'?'false':secrets[k]),false);
assert.equal(h.configured(k=>k==='UBER_TOKEN_KEY'?'invalid':secrets[k]),false);
const key=await h.tokenKey(secrets.UBER_TOKEN_KEY),sealed=await h.sealToken(key,'user-a',{access_token:'private-access'});assert.ok(!sealed.includes('private-access'));assert.equal((await h.openToken(key,'user-a',sealed)).access_token,'private-access');await assert.rejects(h.openToken(key,'user-b',sealed));
assert.equal((await h.stateHash('state')).length,64);
assert.throws(()=>h.validateTokens({access_token:'x',refresh_token:'y',expires_in:100,scope:'partner.accounts'}));
const preview=h.paymentPreview({count:1,payments:[{amount:12.34,payment_id:'one',category:'fare',currency_code:'GBP',driver_id:'secret-id',breakdown:{service_fee:-2}}]});assert.equal(preview.rows[0].amount,12.34);assert.equal(preview.rows[0].driver_id,undefined);
let user='user-a',profile=taxi,tables={},quota=true,providerCalls=[],nextToken='access-1',failProvider=false;
class Query{
 constructor(table){this.table=table;this.filters=[];this.mode='select';this.values=null;this.returnRows=false;}
 select(){this.returnRows=true;return this;}eq(k,v){this.filters.push(r=>r[k]===v);return this;}gt(k,v){this.filters.push(r=>r[k]>v);return this;}or(){return this;}
 maybeSingle(){this.single=true;return this;}upsert(v){this.mode='upsert';this.values=v;return this;}update(v){this.mode='update';this.values=v;return this;}delete(){this.mode='delete';return this;}
 then(resolve){let rows=this.table==='profiles'?[{...profile,id:user}]:(tables[this.table]||[]);let found=rows.filter(r=>this.filters.every(f=>f(r)));
 if(this.mode==='upsert'){const old=rows.find(r=>r.user_id===this.values.user_id);if(old)Object.assign(old,this.values);else rows.push({...this.values});tables[this.table]=rows;found=[this.values];}
 if(this.mode==='update')found.forEach(r=>Object.assign(r,this.values));
 if(this.mode==='delete')tables[this.table]=rows.filter(r=>!found.includes(r));
 return Promise.resolve({data:this.single?(found[0]||null):found.map(r=>({...r})),error:null}).then(resolve);
 }
}
const admin={from:t=>new Query(t),rpc:async()=>({data:quota,error:null})};
const createClient=(_url,key)=>key==='anon'?{auth:{getUser:async jwt=>jwt==='valid'?{data:{user:{id:user}},error:null}:{data:{user:null},error:'bad'}}}:admin;
const fetch=async(url,init)=>{providerCalls.push({url,init});if(failProvider)throw Error('Network');if(url.endsWith('/token'))return Response.json({access_token:nextToken,refresh_token:'refresh',expires_in:3600,scope:h.UBER_SCOPES});if(url.endsWith('/revoke'))return new Response('',{status:200});if(url.endsWith('/me'))return Response.json({driver_id:'driver'});return Response.json({count:1,payments:[{payment_id:'p1',category:'fare',amount:22,currency_code:'GBP',event_time:1800000000}]});};
const handler=moduleFrom(base+'index.ts',{require:name=>name==='./helpers.ts'?h:name.startsWith('npm:')?{createClient}:{},Deno:{env:{get:k=>secrets[k]},serve:()=>{}},fetch}).handleUber;
async function request(body,auth='valid',origin='https://earnavik.com'){return handler(new Request('https://project/functions/v1/uber-driver',{method:'POST',headers:{authorization:auth?'Bearer '+auth:'',origin,'content-type':'application/json'},body:JSON.stringify(body)}));}
assert.equal((await request({action:'status'},'')).status,401);assert.equal((await request({action:'status'},'bad')).status,401);assert.equal((await request({action:'status'},'valid','https://evil.test')).status,403);
secrets.UBER_DRIVER_APPROVED='false';let response=await request({action:'status'});assert.equal((await response.json()).available,false);assert.equal((await request({action:'connect'})).status,409);assert.equal(providerCalls.length,0);secrets.UBER_DRIVER_APPROVED='true';
profile={primary_work_type:'Food Delivery'};assert.equal((await request({action:'connect'})).status,403);profile=taxi;
const started=await (await request({action:'connect'})).json();assert.ok(started.url.startsWith('https://auth.uber.com/oauth/v2/authorize?'));assert.equal(tables.uber_driver_oauth_states[0].state_hash,await h.stateHash(started.state));assert.ok(!JSON.stringify(tables).includes(started.state));
user='user-b';assert.equal((await request({action:'callback',state:started.state,code:'code'})).status,400);user='user-a';
response=await request({action:'callback',state:started.state,code:'code'});assert.equal(response.status,200);assert.equal(tables.uber_driver_connections[0].status,'connected');assert.ok(!JSON.stringify(tables).includes('access-1'));assert.ok(!JSON.stringify(await (await request({action:'status'})).json()).includes('token'));
assert.equal((await request({action:'callback',state:started.state,code:'replay'})).status,400);
response=await request({action:'payments'});const payments=await response.json();assert.equal(response.status,200);assert.equal(payments.preview_only,true);assert.equal(payments.rows[0].amount,22);assert.ok(!tables.income&&!tables.expenses);
// Expiry triggers encrypted refresh, not a browser token response.
tables.uber_driver_connections[0].expires_at='2000-01-01T00:00:00Z';nextToken='refreshed-access';assert.equal((await request({action:'payments'})).status,200);assert.equal(providerCalls.some(c=>String(c.init.body).includes('grant_type=refresh_token')),true);
profile={primary_work_type:'Electrician'};assert.equal((await request({action:'payments'})).status,403);response=await request({action:'disconnect'});assert.equal((await response.json()).revoked,true);assert.equal(tables.uber_driver_connections.length,0);profile=taxi;
const second=await (await request({action:'connect'})).json();await request({action:'disconnect'});assert.equal((await request({action:'callback',state:second.state,code:'late'})).status,400);
const expired=await (await request({action:'connect'})).json();tables.uber_driver_oauth_states[0].expires_at='2000-01-01';assert.equal((await request({action:'callback',state:expired.state,code:'late'})).status,400);
quota=false;assert.equal((await request({action:'status'})).status,429);
// TypeScript must compile without syntax diagnostics; secret tables have no browser grants.
for(const file of ['helpers.ts','index.ts'])assert.equal(ts.transpileModule(fs.readFileSync(base+file,'utf8'),{reportDiagnostics:true}).diagnostics.length,0);
const sql=fs.readFileSync('supabase/schema/uber_driver_connections.sql','utf8');assert.equal((sql.match(/enable row level security/g)||[]).length,3);assert.ok(!/grant[^;]+to authenticated/i.test(sql));
console.log('PASS Uber taxi gating, approval gate, OAuth state ownership/expiry/replay, encrypted tokens, refresh, preview-only payments, disconnect, origin and quota protections. Provider mocked.');
})().catch(e=>{console.error(e);process.exit(1)});
