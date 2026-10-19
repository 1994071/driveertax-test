const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
const code=html.slice(html.indexOf('        function toggleOnboardingEmployment()'),html.indexOf('        const tradeIncomeServices'));
const elements={};const el=id=>elements[id]||(elements[id]={value:'',textContent:'',hidden:true,classList:{add(){},remove(){},toggle(){}},focus(){}});
let taxWrites=[],profileWrites=[],failTax=false,failProfile=false,openCount=0,refreshes=0,dbTax={user_id:'owner',paye_income:9000,tax_residence:'Scotland',tax_deducted_elsewhere:500,gift_aid:100};
const state={currentUser:{id:'owner'},selectedProfessions:[{label:'Electrician'}],selectedPlatforms:['Customers'],selectedExpenses:['Tools'],transactions:[],taxProfile:{...dbTax}};
const ctx={appState:state,document:{getElementById:el},showOnboardingStep(){},showToast(){},professionProfileFields:()=>({profession_roles:state.selectedProfessions}),fetchUserData:async()=>{refreshes++},maybeOpenHomeCalendar(){},openTaxProfileModal(){openCount++},supabaseClient:{from:table=>({upsert:(fields,options)=>({select:()=>({single:async()=>{assert.equal(table,'tax_profiles');assert.equal(fields.user_id,'owner');assert.equal(options.onConflict,'user_id');if(failTax)return {error:{message:'offline'}};taxWrites.push(fields);dbTax={...dbTax,...fields};return {data:{...dbTax}};}})}),update:fields=>({eq:(key,uid)=>({select:()=>({single:async()=>{assert.equal(table,'profiles');assert.equal(key,'id');assert.equal(uid,'owner');if(failProfile)return {error:{message:'offline'}};profileWrites.push(fields);return {data:{id:uid}};}})})})})}};
vm.createContext(ctx);vm.runInContext(code,ctx);
(async()=>{
 el('onboarding-paye-choice').value='yes';el('onboarding-paye-pay').value='';ctx.toggleOnboardingEmployment();assert.equal(el('onboarding-paye-pay').value,9000);
 for(const raw of ['', '-1','NaN','Infinity','100000001']){el('onboarding-paye-pay').value=raw;await ctx.finishOnboarding();assert.equal(profileWrites.length,0);assert.equal(taxWrites.length,0);}
 el('onboarding-paye-pay').value='16000';failTax=true;await ctx.finishOnboarding();assert.equal(profileWrites.length,0);assert.equal(state.savingOnboarding,false);assert.equal(el('onboarding-paye-pay').value,'16000');
 failTax=false;failProfile=true;await ctx.finishOnboarding();assert.equal(openCount,0);assert.equal(dbTax.paye_income,16000);
 failProfile=false;await ctx.finishOnboarding();assert.equal(openCount,1);assert.equal(profileWrites.length,1);assert.equal(refreshes,1);assert.equal(dbTax.tax_residence,'Scotland');assert.equal(dbTax.tax_deducted_elsewhere,500);assert.equal(dbTax.gift_aid,100);assert.equal(state.transactions.length,0);assert.equal(state.taxProfile.paye_income,16000);
 const writes=taxWrites.length;for(const value of ['no','later']){el('onboarding-paye-choice').value=value;el('onboarding-paye-pay').value='999';await ctx.finishOnboarding();assert.equal(taxWrites.length,writes);assert.equal(openCount,1);assert.equal(dbTax.paye_income,16000);}
 state.savingOnboarding=true;await ctx.finishOnboarding();assert.equal(taxWrites.length,writes);
 console.log('PASS: PAYE amount validation, failure retention/retry, owner-scoped partial save, preservation of existing tax details, salary excluded from turnover, review routing, no/later non-destructive and repeated-submit guard.');
})().catch(e=>{console.error(e);process.exit(1)});
