const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
const refresh=html.slice(html.indexOf('                // Regular-cost refreshes'),html.indexOf('                const displayName=profileRes'));
const finish=html.slice(html.indexOf('        async function finishOnboarding()'),html.indexOf('        function populateIncomeSources()'));
let hidden=false,saved,step;
const btn={};const screen={classList:{contains:()=>hidden,add:()=>{hidden=true;}}};
const state={currentUser:{id:'test'},selectedWorkType:'Hairdresser',selectedProfessions:[{id:'hair',label:'Hairdresser',category:'beauty'}],selectedPlatforms:['Salon'],selectedExpenses:['Salon rent']};
const ctx={appState:state,profileRes:{data:{primary_work_type:'',profession_roles:[],platforms:[],usual_expenses:[]}},profileProfessions:p=>p.profession_roles||[],document:{getElementById:id=>id==='onboarding-screen'?screen:btn},professionProfileFields:()=>({profession_roles:state.selectedProfessions}),showOnboardingStep:n=>{step=n;},showToast:()=>{},fetchUserData:async()=>{},maybeOpenHomeCalendar:()=>{},supabaseClient:{from:()=>({update:fields=>{saved=fields;return {eq:()=>({select:()=>({single:async()=>({data:{id:'test'}})})})};}})}};
vm.createContext(ctx);vm.runInContext(finish,ctx);
(async()=>{
 for(let i=0;i<3;i++)vm.runInContext("{\n"+refresh+"\n}",ctx);
 assert.equal(state.selectedProfessions[0].label,'Hairdresser');assert.deepEqual(state.selectedPlatforms,['Salon']);assert.deepEqual(state.selectedExpenses,['Salon rent']);
 await ctx.finishOnboarding();assert.equal(saved.onboarding_completed,true);assert.equal(saved.profession_roles[0].label,'Hairdresser');assert.equal(hidden,true);assert.equal(state.savingOnboarding,false);
 ctx.profileRes.data={primary_work_type:'Cleaner',profession_roles:[{label:'Cleaner'}],platforms:['Direct'],usual_expenses:['Supplies']};
 vm.runInContext("{\n"+refresh+"\n}",ctx);assert.equal(state.selectedWorkType,'Cleaner');assert.equal(state.selectedProfessions[0].label,'Cleaner');
 hidden=false;state.selectedProfessions=[];saved=null;await ctx.finishOnboarding();assert.equal(step,1);assert.equal(saved,null);assert.equal(hidden,false);
 console.log('PASS: repeated regular-cost refresh preserves setup choices; finish persists profile; normal refresh updates preferences; missing profession returns to step 1.');
})().catch(e=>{console.error(e);process.exit(1);});
