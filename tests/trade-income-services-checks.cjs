const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
const groups=JSON.parse(html.match(/const professionGroups = (.*?);/)[1]);
const code=html.slice(html.indexOf('        const tradeIncomeServices ='),html.indexOf('        function expenseCategoryOptions'));
const elements={},writes=[],reads=[];let fail=false;
const el=id=>elements[id]||(elements[id]={value:'',textContent:'',disabled:false,classList:{add(){},remove(){}},focus(){},replaceChildren(...children){this.children=children;}});
const appState={currentUser:{id:'owner'},selectedPlatforms:[],selectedProfessions:[{label:'Hairdresser',category:'beauty'}],transactions:[]};
const ctx={appState,Option:function(label,value){this.text=label;this.value=value;},document:{getElementById:el},profileProfessions:p=>p.profession_roles||[],renderQuickAddButtons(){},showToast(){},supabaseClient:{from:table=>({select:()=>({eq:(key,id)=>({single:async()=>{reads.push({table,key,id});return {data:{platforms:['Existing client']}};}})}),update:fields=>({eq:(key,id)=>({select:()=>({single:async()=>{if(fail)throw Error('offline');writes.push({table,key,id,fields});return {data:{id}};}})})})})}};
vm.createContext(ctx);vm.runInContext(code,ctx);
(async()=>{
 for(const g of groups)for(const r of g.roles){appState.selectedProfessions=[{...r,category:g.id}];const options=ctx.incomeSourceOptions();assert.ok(options.length>1,r.label);assert.ok(!options.includes('undefined'));}
 appState.selectedProfessions=[{label:'Hairdresser',category:'beauty'},{label:'Electrician',category:'trades'}];
 appState.selectedPlatforms=['Haircuts'];appState.transactions=[{type:'income',source:'Legacy service'}];
 const opts=ctx.incomeSourceOptions();assert.ok(opts.includes('Hair colouring'));assert.ok(opts.includes('Electrical installations'));assert.ok(opts.includes('Legacy service'));assert.equal(opts.filter(x=>x==='Haircuts').length,1);
 el('income-source').value='Legacy service';ctx.populateIncomeSources();assert.equal(el('income-source').value,'Legacy service');assert.match(el('income-notes').placeholder,/Haircuts/);assert.doesNotMatch(el('income-notes').placeholder,/Airport/);
 const custom='<b>Wedding package</b>';el('income-custom-name').value=custom;await ctx.saveCustomIncomeSource();assert.equal(writes.length,1);assert.equal(writes[0].id,'owner');assert.ok(writes[0].fields.platforms.includes('Existing client'));assert.ok(writes[0].fields.platforms.includes(custom));assert.equal(el('income-source').value,custom);
 el('income-custom-name').value=custom.toUpperCase();await ctx.saveCustomIncomeSource();assert.equal(writes.length,1);
 fail=true;el('income-custom-name').value='New package';await ctx.saveCustomIncomeSource();assert.equal(el('income-custom-name').value,'New package');assert.match(el('income-custom-message').textContent,/retry/);assert.equal(el('income-custom-save').disabled,false);
 assert.ok(reads.every(r=>r.id==='owner'));appState.selectedPlatforms=[];appState.transactions=[];appState.selectedProfessions=[{label:'Unlisted specialist',category:'other'}];assert.ok(ctx.incomeSourceOptions().includes('Services provided'));
 const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];scripts.forEach(s=>new vm.Script(s[1]));
 console.log('PASS: all 153 roles, multi-trade suggestions, historical selection, safe labels, owner-scoped custom persistence, duplicate prevention, offline retention, custom-trade fallback and script syntax.');
})().catch(e=>{console.error(e);process.exit(1);});
