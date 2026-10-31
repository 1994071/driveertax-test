/* Daily completion uses fresh owner-scoped server checks, never inferred amounts. */
(()=>{
 const $=id=>document.getElementById(id);let state=null,version=0,busy=false,owner=null,seen=new Set(),audio=null;
 const today=()=>driverToday();
 const key=suffix=>'earnavik-daily-'+appState.currentUser?.id+'-'+suffix;
 function soundOn(){try{return localStorage.getItem(key('sound'))==='true';}catch{return $('daily-completion-sound')?.checked===true;}}
 function prepareDailyCompletionSound(){
  if(!soundOn())return;
  try{const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;if(!audio)audio=new Audio();if(audio.state==='suspended')audio.resume().catch(()=>{});}catch{}
 }
 function chime(){
  try{if(!soundOn()||audio?.state!=='running')return;[660,880,1100].forEach((f,i)=>{const o=audio.createOscillator(),g=audio.createGain(),t=audio.currentTime+i*.12;o.type='sine';o.frequency.value=f;g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.07,t+.02);g.gain.exponentialRampToValueAtTime(.0001,t+.25);o.connect(g);g.connect(audio.destination);o.start(t);o.stop(t+.28);});}catch{}
 }
 function resetDailyBookkeeping(){version++;state=null;owner=null;busy=false;if(audio){audio.close().catch(()=>{});audio=null;}$('daily-bookkeeping-card')?.classList.add('hidden');}
 function isDailyBookkeepingComplete(day){return owner===appState.currentUser?.id&&state?.day===day&&state.complete===true;}
 async function refreshDailyBookkeeping({celebrate=false,day=today()}={}){
  const user=appState.currentUser?.id;if(!user){resetDailyBookkeeping();return;}if(day!==today())return;
  const token=++version,previous=owner===user?state:null;owner=user;
  $('daily-bookkeeping-card').classList.remove('hidden');$('daily-completion-sound').checked=soundOn();
  try{
   const {data,error}=await supabaseClient.rpc('get_bookkeeping_day_status',{p_user_id:user,p_day:day});
   if(token!==version||user!==appState.currentUser?.id||day!==today())return;
   if(error||!data||data.day!==day||typeof data.complete!=='boolean'||typeof data.income_done!=='boolean'||typeof data.expenses_done!=='boolean')throw Error('unconfirmed');
   state=data;
   $('daily-bookkeeping-title').textContent=data.complete?'✔️ Your day is up to date':'Your daily check-in';
   $('daily-income-status').textContent=data.income_done?'✓ Income recorded or confirmed':'○ Income still to check';
   $('daily-expenses-status').textContent=data.expenses_done?'✓ Expenses recorded or confirmed':'○ Expenses still to check';
   $('daily-no-income').hidden=data.income_done;$('daily-no-expenses').hidden=data.expenses_done;
   $('daily-bookkeeping-message').textContent=data.complete?'Well done for keeping track. Small steps build strong habits.':'Add today’s records, or confirm if there was no income or spending. You can add more records later.';
   if(data.complete){
    $('shift-reminder-banner')?.classList.add('hidden');
    const rewardKey='reward-'+day,stamp=user+':'+day;let rewarded=seen.has(stamp);try{rewarded=rewarded||localStorage.getItem(key(rewardKey))==='true';}catch{}
    if(!rewarded&&(celebrate||(previous?.day===day&&previous.complete===false))){seen.add(stamp);try{localStorage.setItem(key(rewardKey),'true');}catch{}showToast('✔️ Well done—your day is up to date!');chime();}
    try{const reg=await navigator.serviceWorker?.getRegistration('/');if(token===version&&user===appState.currentUser?.id){const notifications=await reg?.getNotifications?.({tag:'earnavik-bookkeeping-daily'});notifications?.forEach(n=>n.close());}}catch{}
   }else if(window.checkShiftReminder)checkShiftReminder();
  }catch{
   if(token!==version||user!==appState.currentUser?.id)return;state=null;
   $('daily-bookkeeping-title').textContent='Your daily check-in';$('daily-income-status').textContent='Income status not confirmed';$('daily-expenses-status').textContent='Expenses status not confirmed';
   $('daily-bookkeeping-message').textContent='Could not check your saved day. Tap Retry; no completion has been assumed.';
   $('daily-no-income').hidden=true;$('daily-no-expenses').hidden=true;
  }
 }
 async function confirmDailyNone(kind,day=today()){
  if(busy||!['income','expenses'].includes(kind))return false;const user=appState.currentUser?.id;if(!user)return false;
  if(!window.confirm('Confirm no '+(kind==='income'?'income':'expenses')+' for '+day+'? This does not add a transaction.'))return false;
  prepareDailyCompletionSound();busy=true;
  try{
   const {error}=await supabaseClient.rpc('confirm_my_bookkeeping_none',{p_day:day,p_kind:kind});
   if(user!==appState.currentUser?.id)return false;if(error)throw error;
   await refreshDailyBookkeeping({celebrate:true,day});return true;
  }catch{if(user===appState.currentUser?.id)showToast('Could not save your confirmation. Please retry.');return false;}
  finally{if(user===appState.currentUser?.id)busy=false;}
 }
 async function confirmDailyStepNone(kind){
  const user=appState.currentUser?.id,day=appState.dailyEntryDate;if(!appState.dailyEntryMode||!day)return;
  if(await confirmDailyNone(kind,day)&&user===appState.currentUser?.id&&appState.dailyEntryMode&&appState.dailyEntryDate===day){if(kind==='income')openDailyExpenseStep();else openDailyMileageStep();}
 }
 $('daily-no-income').addEventListener('click',()=>confirmDailyNone('income'));
 $('daily-no-expenses').addEventListener('click',()=>confirmDailyNone('expenses'));
 $('daily-bookkeeping-retry').addEventListener('click',()=>refreshDailyBookkeeping());
 $('daily-completion-sound').addEventListener('change',()=>{try{localStorage.setItem(key('sound'),String($('daily-completion-sound').checked));}catch{}prepareDailyCompletionSound();});
 Object.assign(window,{refreshDailyBookkeeping,resetDailyBookkeeping,isDailyBookkeepingComplete,prepareDailyCompletionSound,confirmDailyStepNone});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&appState.currentUser)refreshDailyBookkeeping();});
 setInterval(()=>{if(!document.hidden&&appState.currentUser&&state?.day!==today())refreshDailyBookkeeping();},60000);
 refreshDailyBookkeeping();
})();
