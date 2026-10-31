const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{parseHTML}=require('linkedom');
const html=fs.readFileSync(__dirname+'/../index.html','utf8'),source=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).find(x=>x.includes('let appState'));
function fixture(){
 const {window}=parseHTML(html),doc=window.document,state={rows:[],reads:[],writes:[],prompts:[],toasts:[],approve:false,readError:false,writeError:false,refreshError:false,hold:null};
 window.confirm=message=>{state.prompts.push(message);return state.approve;};
 window.supabase={createClient:()=>({from:table=>{
  const query={table,filters:{}};const read={eq:(k,v)=>{query.filters[k]=v;return read;},limit:async n=>{state.reads.push({...query,limit:n});if(state.hold)await state.hold;return {data:state.rows.filter(r=>Object.entries(query.filters).every(([k,v])=>r[k]===v)),error:state.readError?Error('offline'):null};}};
  const update={eq:(k,v)=>{query.filters[k]=v;return update;},select:()=>update,single:async()=>{state.writes.push(query);return {data:{id:'existing'},error:state.writeError?Error('save failed'):null};},then:resolve=>{state.writes.push(query);return Promise.resolve({error:state.writeError?Error('save failed'):null}).then(resolve);}};
  return {select:()=>read,insert:async rows=>{state.writes.push({table,rows});return {error:state.writeError?Error('save failed'):null};},update:values=>{query.values=values;return update;}};
 }})};
 const ctx=vm.createContext({window,document:doc,console:{log(){},error(){}},Date,setTimeout:()=>0});vm.runInContext(source,ctx);ctx.testState=state;
 const run=s=>vm.runInContext(s,ctx);run("appState.currentUser={id:'owner'};appState.editingIncomeId=null;showToast=s=>testState.toasts.push(s);fetchUserData=async()=>{if(testState.refreshError)throw Error('refresh failed')};openDailyExpenseStep=()=>{};resetEditState=()=>{};setDailyEntryButtons=()=>{}");
 doc.getElementById('income-form').reset=()=>{};
 return {state,doc,run,save:()=>run('handleSaveIncome({preventDefault(){}})')};
}
function setup(){
 const f=fixture();f.doc.getElementById('income-source').innerHTML='<option value="Other" selected>Other</option>';f.doc.getElementById('income-amount').value='100';f.doc.getElementById('income-date').value='2026-10-29';f.doc.getElementById('income-notes').value='Test income';return f;
}
(async()=>{
 let f=setup();await f.save();assert.equal(f.state.writes.length,1);assert.equal(f.state.writes[0].rows[0].user_id,'owner');assert.deepEqual(f.state.reads[0].filters,{user_id:'owner',earned_on:'2026-10-29',amount:100});
 f=setup();f.state.rows=[{id:'import',user_id:'owner',source:'Bank import',amount:100,earned_on:'2026-10-29'}];await f.save();assert.equal(f.state.writes.length,0);assert.match(f.state.prompts[0],/Possible duplicate income/);assert.match(f.state.prompts[0],/Bank import/);assert.equal(f.doc.getElementById('income-amount').value,'100');assert.equal(f.doc.getElementById('income-submit-btn').disabled,false);
 f.state.approve=true;await f.save();assert.equal(f.state.writes.length,1);
 f=setup();f.state.rows=[{user_id:'another-owner',amount:100,earned_on:'2026-10-29'},{user_id:'owner',amount:100,earned_on:'2026-10-28'}];await f.save();assert.equal(f.state.prompts.length,0);assert.equal(f.state.writes.length,1);
 f=setup();let release;f.state.hold=new Promise(r=>release=r);let pending=f.save();await f.save();assert.equal(f.state.reads.length,1);release();await pending;assert.equal(f.state.writes.length,1);
 f=setup();f.state.readError=true;await f.save();assert.equal(f.state.writes.length,0);assert.match(f.state.toasts.at(-1),/Could not check/);assert.equal(f.doc.getElementById('income-submit-btn').disabled,false);
 for(const value of ['-1','NaN','Infinity','1.001']){f=setup();f.doc.getElementById('income-amount').value=value;await f.save();assert.equal(f.state.reads.length,0);assert.equal(f.state.writes.length,0);}
 f=setup();f.doc.getElementById('income-date').value='2026-02-30';await f.save();assert.equal(f.state.writes.length,0);
 f=setup();f.run("appState.editingIncomeId='existing'");f.doc.getElementById('income-amount').value='0';await f.save();assert.equal(f.state.reads.length,0);assert.equal(f.state.writes.length,1);assert.deepEqual(f.state.writes[0].filters,{id:'existing',user_id:'owner'});
 f=setup();f.state.refreshError=true;await f.save();assert.equal(f.state.writes.length,1);assert.match(f.state.toasts.at(-1),/Income saved, but/);assert.equal(f.doc.getElementById('income-submit-btn').disabled,false);
 f=setup();f.state.hold=new Promise(r=>release=r);pending=f.save();f.run("appState.currentUser={id:'new-owner'}");release();await pending;assert.equal(f.state.writes.length,0);
 f=setup();f.state.hold=new Promise(r=>release=r);pending=f.save();f.doc.getElementById('income-amount').value='200';release();await pending;assert.equal(f.state.writes.length,0);assert.match(f.state.toasts.at(-1),/details changed/);
 console.log('PASS: owner/date/amount preflight, cancel/override, repeat-submit lock, read failure, input validation, zero edits, saved-versus-refresh failure, stale account and changed-form rejection. All queries mocked.');
})().catch(e=>{console.error(e);process.exitCode=1;});
