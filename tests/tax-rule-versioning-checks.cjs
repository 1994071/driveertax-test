const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
const source=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).find(x=>x.includes('let appState'));
const ctx=vm.createContext({window:{addEventListener(){},supabase:{createClient:()=>({})}},document:{addEventListener(){}},console,Date,setTimeout});
vm.runInContext(source,ctx);const run=s=>vm.runInContext(s,ctx),near=(a,b)=>assert.ok(Math.abs(a-b)<.00001,`${a} != ${b}`);
const estimate=(income,year,profile={})=>run(`calculateCombinedTaxEstimate(${income},${year},${JSON.stringify(profile)})`);

// Published 2025/26 and 2026/27 thresholds: below / at / above each annual threshold.
for(const [year,thresholds] of [[2025,{'1':26065,'2':28470,'4':32745}],[2026,{'1':26900,'2':29385,'4':33795,'5':25000}]]){
 for(const [plan,threshold] of Object.entries(thresholds)){
  for(const offset of [-1,0,1])near(estimate(threshold+offset,year,{student_loan_plan:plan}).studentLoan,Math.max(0,offset)*.09);
 }
 for(const offset of [-1,0,1])near(estimate(21000+offset,year,{postgraduate_loan:true}).postgraduate,Math.max(0,offset)*.06);
 near(estimate(40000,year,{student_loan_plan:'1',postgraduate_loan:true}).postgraduate,1140);
}
near(estimate(30000,2026).incomeTax,3486);
near(estimate(30000,2026,{tax_residence:'Scotland'}).incomeTax,3451.07);
near(estimate(30000,2025,{tax_residence:'Scotland'}).incomeTax,3482.82);
near(estimate(30000,2026,{blind_person_allowance:true}).incomeTax,2836);
near(estimate(30000,2025,{blind_person_allowance:true}).incomeTax,2860);
near(estimate(30000,2026,{marriage_allowance:'receiving'}).incomeTax,3234);
near(estimate(30000,2026,{marriage_allowance:'transferring'}).allowance,11310);
near(estimate(100001,2026).allowance,12569.5);
near(estimate(125140,2026).allowance,0);
near(estimate(20000,2026,{paye_income:16000,tax_deducted_elsewhere:686}).total,4686+445.8-686);
near(run('calculateTaxEstimate(20000,2026,{paye_income:16000}).incomeTax'),4000);

// Future announcements cannot silently use current-year bands, loans or reliefs.
for(const year of [2024,2027,2028]){
 assert.throws(()=>estimate(30000,year),/Tax estimate unavailable/);
 assert.throws(()=>run(`calculateBandTax(30000,'England',0,${year})`),/Tax estimate unavailable/);
}
assert.equal(run("taxRangeSupported('2027-04-06','2027-04-07')"),false);
assert.equal(run("taxRangeSupported('2026-04-06','2027-04-05')"),true);
assert.equal(run("taxRangeSupported('2027-04-05','2027-04-06')"),false);
assert.equal(run("TAX_YEAR_RULES[2027].status"),'pending-legislation');
assert.equal(run('TAX_YEAR_RULES[2027].tradingAllowance'),3000);
assert.equal(run('TAX_YEAR_RULES[2027].propertyAllowance'),1000);
assert.equal(run('TAX_YEAR_RULES[2027].blindAllowance'),3370);
assert.deepEqual(Array.from(run('TAX_YEAR_RULES[2027].savingsRates')),[.24,.44,.49]);
assert.equal(run('TAX_YEAR_RULES[2027].pensionTaxAllowance.roundingReviewRequired'),true);
assert.equal(run("TAX_YEAR_RULES[2027].studentThresholds['4']"),null);
run("TAX_YEAR_RULES[2027].status='supported';TAX_YEAR_RULES[2026].studentThresholds['1']=28005");
assert.equal(run('TAX_YEAR_RULES[2027].status'),'pending-legislation');
near(estimate(30000,2026,{student_loan_plan:'1'}).studentLoan,279);

// Exercise the real dialog, including close/reopen, without database/network writes.
const {parseHTML}=require('linkedom'),{window}=parseHTML(html);
window.supabase={createClient:()=>({})};
const dom=vm.createContext({window,document:window.document,console,Date,setTimeout});
vm.runInContext(source,dom);vm.runInContext('openTaxRuleUpdates()',dom);
const dialog=window.document.getElementById('tax-rule-updates'),body=dialog.innerHTML;
assert.equal(dialog.getAttribute('role'),'dialog');
assert.equal(dialog.classList.contains('hidden'),false);
assert.match(body,/Pending legislation/);assert.match(body,/not used in your current estimates/);
assert.match(body,/£3,000/);assert.match(body,/24% \/ 44% \/ 49%/);
assert.match(body,/Scotland and Wales/);assert.match(body,/alternative to actual expenses/);
assert.equal((body.match(/rel="noopener noreferrer"/g)||[]).length,4);
dialog.querySelector('[data-close]').click();assert.equal(dialog.classList.contains('hidden'),true);
vm.runInContext('openTaxRuleUpdates()',dom);
assert.equal(dialog.classList.contains('hidden'),false);
assert.equal(window.document.querySelectorAll('#tax-rule-updates').length,1);
console.log('PASS: dated current-year arithmetic, loan and allowance boundaries, combined PAYE, immutable pending rules, unsupported-year rejection and upcoming-change notice.');
