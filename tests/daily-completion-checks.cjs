const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{parseHTML}=require('linkedom');
function fixture(){
 const {window}=parseHTML(fs.readFileSync('index.html','utf8')),document=window.document;
 let day='2026-10-31',status={day,income_done:false,expenses_done:false,complete:false},error=false,confirmation=true,hold=null;
 const storage=new Map(),toasts=[],calls=[],tones=[];let checks=0,closedNotifications=0;
 const appState={currentUser:{id:'owner'}};
 class Audio{constructor(){this.state='running';this.currentTime=0;this.destination={};}resume(){return Promise.resolve();}close(){return Promise.resolve();}createOscillator(){return {frequency:{},connect(){},start(){tones.push('tone')},stop(){}};}createGain(){return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){}};}}
 window.AudioContext=Audio;window.confirm=()=>confirmation;
 const context=vm.createContext({window,document,appState,console,setInterval:()=>0,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},navigator:{serviceWorker:{getRegistration:async()=>({getNotifications:async()=>[{close(){closedNotifications++;}}]})}},driverToday:()=>day,showToast:m=>toasts.push(m),checkShiftReminder(){checks++},openDailyExpenseStep(){calls.push('expense-step')},openDailyMileageStep(){calls.push('mileage-step')},supabaseClient:{rpc:async(name,args)=>{calls.push({name,args});if(hold)await hold;if(error)return {error:Error('offline')};if(name==='confirm_my_bookkeeping_none'){if(args.p_kind==='income')status.income_done=true;else status.expenses_done=true;status.complete=status.income_done&&status.expenses_done;}return {data:{...status}};}}});
 vm.runInContext(fs.readFileSync('daily-bookkeeping.js','utf8'),context);
 return {window,document,appState,storage,toasts,calls,tones,setStatus:s=>{status={...status,...s}},setError:v=>error=v,setConfirm:v=>confirmation=v,setDay:d=>{day=d;status.day=d},setHold:p=>hold=p,tick:()=>new Promise(r=>setImmediate(r)),closed:()=>closedNotifications};
}
(async()=>{
 let f=fixture();await f.tick();assert.equal(f.window.isDailyBookkeepingComplete('2026-10-31'),false);
 const sound=f.document.getElementById('daily-completion-sound');sound.checked=true;sound.dispatchEvent(new f.window.Event('change'));
 f.setStatus({income_done:true,expenses_done:true,complete:true});await f.window.refreshDailyBookkeeping({celebrate:true});assert.equal(f.window.isDailyBookkeepingComplete('2026-10-31'),true);assert.match(f.document.getElementById('daily-bookkeeping-title').textContent,/✔/);assert.equal(f.toasts.length,1);assert.equal(f.tones.length,3);assert.ok(f.closed()>0);
 await f.window.refreshDailyBookkeeping({celebrate:true});assert.equal(f.toasts.length,1);assert.equal(f.tones.length,3,'No repeated reward sound');
 f.setStatus({income_done:false,complete:false});await f.window.refreshDailyBookkeeping();assert.equal(f.window.isDailyBookkeepingComplete('2026-10-31'),false,'Deleting a record reopens the day');
 f=fixture();f.setStatus({income_done:true,expenses_done:true,complete:true});await f.tick();assert.equal(f.toasts.length,0,'Existing completion on login is quiet');
 f=fixture();await f.tick();f.document.getElementById('daily-no-income').click();await f.tick();assert.ok(f.calls.some(c=>c.name==='confirm_my_bookkeeping_none'&&c.args.p_kind==='income'));assert.equal(f.window.isDailyBookkeepingComplete('2026-10-31'),false);f.document.getElementById('daily-no-expenses').click();await f.tick();assert.equal(f.window.isDailyBookkeepingComplete('2026-10-31'),true);assert.equal(f.tones.length,0,'Sound is opt-in');
 f=fixture();await f.tick();f.setConfirm(false);f.document.getElementById('daily-no-income').click();await f.tick();assert.ok(!f.calls.some(c=>c.name==='confirm_my_bookkeeping_none'));
 f.setConfirm(true);f.setError(true);f.document.getElementById('daily-no-income').click();await f.tick();assert.match(f.toasts.at(-1),/Could not save/);assert.equal(f.window.isDailyBookkeepingComplete('2026-10-31'),false);
 await f.window.refreshDailyBookkeeping({celebrate:true});assert.match(f.document.getElementById('daily-bookkeeping-message').textContent,/Could not check/);
 f=fixture();await f.tick();let release;f.setHold(new Promise(r=>release=r));const pending=f.window.refreshDailyBookkeeping({celebrate:true});f.appState.currentUser={id:'other'};f.window.resetDailyBookkeeping();release();await pending;assert.equal(f.toasts.length,0);assert.ok(f.document.getElementById('daily-bookkeeping-card').classList.contains('hidden'));
 f=fixture();await f.tick();f.setDay('2026-11-01');assert.equal(f.window.isDailyBookkeepingComplete('2026-10-31'),false);await f.window.refreshDailyBookkeeping({day:'2026-10-31',celebrate:true});assert.equal(f.toasts.length,0,'Past day cannot complete today');
 const sql=fs.readFileSync('supabase/schema/daily_bookkeeping_completion.sql','utf8');assert.match(sql,/enable row level security/);assert.match(sql,/with check \(\(select auth.uid\(\)\)=user_id\)/);assert.match(sql,/no_income=daily_bookkeeping_checks.no_income or excluded.no_income/);
 console.log('PASS daily completion: fresh verified state, partial/no activity, cancel/failure, duplicate reward, sound opt-in, deleted records, past day, account switch, owner RLS and atomic confirmations. No live pushes or financial records created.');
})().catch(error=>{console.error(error);process.exit(1)});
