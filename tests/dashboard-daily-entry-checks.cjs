const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{parseHTML}=require('linkedom');
const html=fs.readFileSync(__dirname+'/../index.html','utf8'),{window}=parseHTML(html);let saved=[];
window.supabase={createClient:()=>({from:table=>({insert:async rows=>{saved.push({table,rows});return {error:null}}})})};
const ctx=vm.createContext({window,document:window.document,console,Date,setTimeout:()=>0});
const script=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).find(x=>x.includes('let appState'));vm.runInContext(script,ctx);const run=s=>vm.runInContext(s,ctx);
run("appState.currentUser={id:'driver'};showCalendarDay=()=>{};showToast=()=>{};fetchUserData=async()=>{}");
window.document.getElementById('income-form').reset=()=>{};
(async()=>{
 const button=window.document.getElementById('dash-add-income');assert.ok(button.textContent.includes('💷'));run(button.getAttribute('onclick'));
 assert.equal(run('appState.dailyEntryMode'),true);assert.equal(run('appState.dailyEntryDate'),run('driverToday()'));
 assert.equal(window.document.getElementById('income-skip-btn').style.display,'block');
 window.document.getElementById('income-amount').value='100';await run('handleSaveIncome({preventDefault(){}})');
 assert.equal(saved.length,1);assert.equal(saved[0].table,'income');assert.equal(saved[0].rows[0].earned_on,run('driverToday()'));
 assert.equal(window.document.getElementById('expense-modal').classList.contains('hidden'),false);assert.equal(window.document.getElementById('expense-date').value,run('driverToday()'));
 run('skipDailyExpense()');assert.equal(window.document.getElementById('mileage-modal').classList.contains('hidden'),false);assert.equal(window.document.getElementById('mileage-date').value,run('driverToday()'));
 run('skipDailyMileage()');assert.equal(run('appState.dailyEntryMode'),false);assert.equal(saved.length,1);
 const dashboard=window.document.getElementById('view-dashboard');for(const emoji of ['💷','🧾','📸','🗓️','🎯','✅','📅'])assert.ok(dashboard.textContent.includes(emoji));
 console.log('PASS: Dashboard starts Calendar daily-entry flow; saved income advances to expenses, skips advance to mileage/finish, and dates stay consistent.');
})().catch(e=>{console.error(e);process.exit(1)});
