const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');const {parseHTML}=require('linkedom');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');const {window}=parseHTML(html);let calls=[],error=null;
window.supabase={createClient:()=>({rpc:async(name,payload)=>{calls.push({name,payload});return {data:error?null:'summary-id',error}}})};
const ctx=vm.createContext({window,document:window.document,console,Date,setTimeout});
const source=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).find(x=>x.includes('let appState'));vm.runInContext(source,ctx);const run=s=>vm.runInContext(s,ctx);
for(const id of ['period-entry-mode','period-regular-included'])Object.defineProperty(window.document.getElementById(id),'value',{writable:true,value:''});
run("appState.currentUser={id:'driver'};fetchUserData=async()=>{};showCalendarRange=()=>{};showToast=()=>{};appState.calendarRangeStart='2026-10-01';appState.calendarRangeEnd='2026-10-07';");
assert.equal(run("calculatePeriodSummary(5000,3500,'profit').expenses"),1500);assert.equal(run("calculatePeriodSummary(5000,1500,'expenses').profit"),3500);
assert.equal(run("calculatePeriodSummary(100,-50,'profit').expenses"),150);assert.throws(()=>run("calculatePeriodSummary(100,150,'profit')"));
run("appState.recurringExpenses=[{id:'cost',is_active:true,start_date:'2026-10-01',frequency:'yearly',amount:365.2425}];appState.periodEntries=[{id:'p',period_start:'2026-10-01',period_end:'2026-10-07',regular_costs_included:true,income_amount:5000,expense_amount:1500}]");
assert.equal(run("getRecurringCostShare('2026-10-01','2026-10-07').total"),0);assert.equal(run("getRangeActivity('2026-10-01','2026-10-07').income"),5000);
run('appState.periodEntries[0].regular_costs_included=false');assert.equal(run("getRecurringCostShare('2026-10-01','2026-10-07').total"),7);
run("openPeriodEntryModal('p')");assert.equal(window.document.getElementById('period-income').value,'5000');assert.equal(run('appState.editingPeriodId'),'p');
run("appState.periodEntries=[];openPeriodEntryModal();document.getElementById('period-income').value='5000';document.getElementById('period-entry-mode').value='profit';document.getElementById('period-profit').value='3500';document.getElementById('period-regular-included').value='yes';updatePeriodSummaryPreview()");assert.ok(window.document.getElementById('period-summary-preview').textContent.includes('1500.00'));assert.ok(window.document.getElementById('period-summary-preview').textContent.includes('3500.00'));
(async()=>{
 await run('handleSavePeriodEntry({preventDefault(){}})');assert.equal(calls.length,1);assert.equal(calls[0].payload.p_summary.entry_mode,'profit');assert.equal(calls[0].payload.p_summary.regular_costs_included,true);
 run("appState.transactions=[{id:'old',type:'income',date:'2026-10-03',amount:10}];openPeriodEntryModal();document.getElementById('period-income').value='5000';document.getElementById('period-expenses').value='1500';document.getElementById('period-regular-included').value='yes'");await run('handleSavePeriodEntry({preventDefault(){}})');assert.equal(calls.length,1);assert.ok(window.document.getElementById('period-entry-error').textContent.includes('already contain'));
 console.log('PASS: turnover/profit conversion, losses, invalid profit, regular-cost treatment, whole-period totals, edit prefill, live review, save payload and overlap warnings.');
})().catch(e=>{console.error(e);process.exit(1)});
