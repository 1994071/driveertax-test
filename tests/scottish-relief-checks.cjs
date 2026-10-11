const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
const source=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).find(x=>x.includes('let appState'));
const ctx=vm.createContext({window:{addEventListener:()=>{},supabase:{createClient:()=>({})}},document:{addEventListener:()=>{}},console,Date,setTimeout});
vm.runInContext(source,ctx);
const run=s=>vm.runInContext(s,ctx);
let checks=0;
const near=(a,b)=>{assert.ok(Math.abs(a-b)<0.00001,`${a} != ${b}`);checks++;};
function estimate(income,residence='Scotland',extra={}){
 run('appState.taxProfile='+JSON.stringify({tax_residence:residence,...extra}));
 return run('calculateTaxEstimate('+income+')');
}
for(const [income,relief] of [[16000,0],[29000,0],[35000,10],[60000,220],[80000,250],[150000,280],[101000,475]]){
 const plain=estimate(income);
 near(plain.incomeTax-estimate(income,'Scotland',{pension_contributions:800}).incomeTax,relief);
 near(plain.incomeTax-estimate(income,'Scotland',{gift_aid:800}).incomeTax,relief);
 near(plain.incomeTax-estimate(income,'Scotland',{pension_contributions:400,gift_aid:400}).incomeTax,relief);
}
near(estimate(60000).incomeTax-estimate(60000,'Scotland',{pension_contributions:16000}).incomeTax,3630.98);
for(const region of ['England','Wales','Northern Ireland']){
 for(const [income,relief] of [[30000,0],[60000,200],[150000,250]]){
  near(estimate(income,region).incomeTax-estimate(income,region,{pension_contributions:800}).incomeTax,relief);
 }
}
for(const extension of [0,1000]){
 for(const [boundary,rateBefore,rateAfter] of [[3967,.19,.20],[16956+extension,.20,.21],[31092+extension,.21,.42],[62430+extension,.42,.45],[125140+extension,.45,.48]]){
  const band=x=>run(`calculateBandTax(${x},'Scotland',${extension})`);
  near(band(boundary)-band(boundary-1),rateBefore);
  near(band(boundary+1)-band(boundary),rateAfter);
 }
 for(const region of ['England','Wales','Northern Ireland']){
  const band=x=>run(`calculateBandTax(${x},'${region}',${extension})`);
  for(const [boundary,before,after] of [[37700+extension,.20,.40],[125140+extension,.40,.45]]){
   near(band(boundary)-band(boundary-1),before);
   near(band(boundary+1)-band(boundary),after);
  }
 }
}
near(estimate(100000).allowance,12570);
near(estimate(100001).allowance,12569.5);
near(estimate(125140).allowance,0);
near(estimate(101000,'Scotland',{pension_contributions:800}).allowance,12570);
near(estimate(126140,'Scotland',{pension_contributions:800}).allowance,0);
for(const income of [44662,44662.01]){
 const p={pension_contributions:800};
 const normal=estimate(income,'Scotland',p);
 near(normal.incomeTax-estimate(income,'Scotland',{...p,marriage_allowance:'receiving'}).incomeTax,income===44662?252:0);
}
for(const plan of ['1','2','4','5']){
 const p={student_loan_plan:plan,postgraduate_loan:true};
 const plain=estimate(60000,'Scotland',p),relieved=estimate(60000,'Scotland',{...p,pension_contributions:800,gift_aid:800});
 for(const field of ['class4','studentLoan','postgraduate']) near(relieved[field],plain[field]);
}
near(estimate(30000).incomeTax,3451.07);
near(estimate(35000).incomeTax,4501.07);
assert.match(html,/id="taxp-pension-contrib" aria-describedby="taxp-relief-help"/);
assert.match(html,/id="taxp-gift-aid" aria-describedby="taxp-relief-help"/);
console.log('PASS: '+checks+' tax checks: Scottish and other UK bands, pension/Gift Aid relief, personal allowance taper, marriage credit, loans and National Insurance.');
