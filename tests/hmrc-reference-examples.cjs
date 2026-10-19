// Reference arithmetic checked 19 October 2026 for ordinary 2026/27 trading profit.
// https://www.gov.uk/income-tax-rates
// https://www.gov.uk/self-employed-national-insurance-rates
// https://www.gov.uk/scottish-income-tax/how-it-works
// No savings/dividends, reliefs, loans, losses or NI annual-maximum adjustment.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
const source=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).find(x=>x.includes('let appState'));
const ctx=vm.createContext({window:{addEventListener(){},supabase:{createClient:()=>({})}},document:{addEventListener(){}},console,Date,setTimeout});vm.runInContext(source,ctx);
const run=s=>vm.runInContext(s,ctx),near=(a,b)=>assert.ok(Math.abs(a-b)<.001,`${a} != ${b}`);
function calc(profit,paye=0,residence='England'){return run(`calculateCombinedTaxEstimate(${profit},2026,${JSON.stringify({paye_income:paye,tax_residence:residence})})`);}
const basic=calc(30000);near(basic.incomeTax,3486);near(basic.class4,1045.8);
const combined=calc(20000,16000),baseline=calc(0,16000);near(combined.incomeTax,4686);near(baseline.incomeTax,686);near(combined.incomeTax-baseline.incomeTax,4000);near(combined.class4,445.8);
// Scottish starter band £3,967, then £12,989 at basic rate, then intermediate.
near(calc(30000,0,'Scotland').incomeTax,3967*.19+12989*.20+474*.21);
near(calc(12570).incomeTax,0);near(calc(12570).class4,0);
near(calc(50270).class4,(50270-12570)*.06);
near(calc(50271).class4,(50270-12570)*.06+.02);
console.log('PASS: 2026/27 HMRC rate-based reference arithmetic: standard allowance, PAYE plus trading profit, Scottish bands and Class 4 thresholds. Not a full HMRC tax-return reconciliation.');
