const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{parseHTML}=require('linkedom');
const html=fs.readFileSync(__dirname+'/../index.html','utf8'),main=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).find(x=>x.includes('let appState'));
const {window}=parseHTML(html);window.supabase={createClient:()=>({})};
const ctx=vm.createContext({window,document:window.document,console,Date,setTimeout:()=>0,Blob,URL,Option:function(label,value){const option=window.document.createElement('option');option.textContent=label;option.value=value;return option;},confirm:()=>true});
vm.runInContext(main,ctx);vm.runInContext(fs.readFileSync(__dirname+'/../accountant-cis.js','utf8'),ctx);Object.assign(ctx,{...window});
const run=s=>vm.runInContext(s,ctx),near=(a,b)=>assert.ok(Math.abs(a-b)<.00001,`${a} != ${b}`);
for(const [args,expected] of [[[1000,0,0,20],[1000,200,800]],[[1200,200,100,20],[900,180,1020]],[[1000,0,200,30],[800,240,760]],[[1000,0,0,0],[1000,0,1000]]]){const p=run(`cisPreview(...${JSON.stringify(args)})`);assert.deepEqual([p.base,p.deducted,p.net],expected);}
for(const args of [[100,0,101,20],[100,0,0,15],[0,0,0,20],[100,-1,0,20],[100,0,-1,20]])assert.throws(()=>run(`cisPreview(...${JSON.stringify(args)})`));
run(`appState.currentUser={id:'owner'};appState.taxProfile={};appState.transactions=[{id:'a',type:'income',amount:30000,grossAmount:30000,date:'2026-05-01'},{id:'b',type:'income',amount:30000,grossAmount:30000,date:'2026-06-01'}];appState.cisDeductions=[];currentTaxYearBounds=()=>taxYearForDate('2026-10-25');`);
const before=run("getTaxYearSummary('2026-10-25')");
run(`appState.cisDeductions=[{income_id:'a',gross_snapshot:30000,paid_on:'2026-05-01',deducted_amount:6000},{income_id:'b',gross_snapshot:30000,paid_on:'2026-06-01',deducted_amount:6000}];`);
const after=run("getTaxYearSummary('2026-10-25')");near(after.income,before.income);near(after.profit,before.profit);near(after.grossBusinessTax,before.total);near(after.cisDeducted,12000);near(after.total,Math.max(0,before.total-12000));
near(run("getTaxYearSummary('2026-05-01').total"),0);near(run("getEstimatedTaxReserveForRange('2026-06-01','2026-06-01')"),after.total);
near(run("getTaxYearSummary('2026-04-30').cisDeducted"),0);near(run("getTaxYearSummary('2026-04-05',taxYearForDate('2025-04-06')).cisDeducted"),0);
// A stale/deleted/foreign-income snapshot must never reduce a reserve.
run("appState.cisDeductions.push({income_id:'missing',gross_snapshot:1,paid_on:'2026-05-01',deducted_amount:999999});appState.transactions[0].grossAmount=29999;");near(run("cisDeductionsForRange('2026-04-06','2027-04-05')"),6000);
run("appState.transactions[0].grossAmount=30000;driverToday=()=> '2026-06-01';getDashboardPeriodBounds=()=>({start:'2026-06-01',end:'2026-06-01'});");
const dashboard=run("dashboardPeriodSummary('today')");near(dashboard.cis,6000);near(dashboard.profit-dashboard.tax-dashboard.cis,30000-after.total-6000);
run('ensureAccountantCisTools()');assert.equal(window.document.querySelectorAll('#accountant-cis-tools button').length,3);run('ensureAccountantCisTools()');assert.equal(window.document.querySelectorAll('#accountant-cis-tools').length,1);
// Account reset removes client data even if a client report is open.
const modal=window.document.createElement('div');modal.id='accountant-centre';modal.innerHTML='<p>Private client</p>';window.document.body.appendChild(modal);run("setCurrentAccount({id:'other'})");assert.equal(window.document.getElementById('accountant-centre'),null);assert.equal(run('appState.cisDeductions.length'),0);
assert.ok(html.includes('id="tax-cis-deducted"'));
console.log('PASS CIS gross/profit preservation, actual-cost/VAT bases, rates, cumulative credits, tax-year isolation, stale snapshots, take-home withholding and account reset.');
