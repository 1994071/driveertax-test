const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
const source=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).find(x=>x.includes('let appState'));
class TestDate extends Date{constructor(...args){super(...(args.length?args:['2026-10-08T12:00:00']));}}
const ctx=vm.createContext({Date:TestDate,window:{addEventListener:()=>{},supabase:{createClient:()=>({})}},document:{addEventListener:()=>{},getElementById:()=>null},console,setTimeout});vm.runInContext(source,ctx);
const run=s=>vm.runInContext(s,ctx);
for(const [date,start,end] of [['2026-10-08','2026-10-05','2026-10-11'],['2026-10-05','2026-10-05','2026-10-11'],['2026-10-11','2026-10-05','2026-10-11'],['2026-10-01','2026-09-28','2026-10-04'],['2027-01-01','2026-12-28','2027-01-03']]){
 const week=run(`getWeekBounds(parseIsoDate('${date}'))`);assert.equal(week.start,start);assert.equal(week.end,end);
}
run("renderCalendar=()=>{};showCalendarRange=()=>{};selectCalendarPreset('week')");assert.equal(run('appState.calendarRangeStart'),'2026-10-05');assert.equal(run('appState.calendarRangeEnd'),'2026-10-11');
assert.equal(run("getDashboardPeriodBounds('week').start"),'2026-10-05');assert.equal(run("getDashboardPeriodBounds('week').end"),'2026-10-08');
const nav=html.match(/<nav\b[^>]*>[\s\S]*?<\/nav>/)[0];assert.equal((nav.match(/class="nav-btn/g)||[]).length,4);assert.ok(!nav.includes('nav-records'));assert.ok(html.includes('Back to Dashboard'));assert.ok(html.includes('View All'));
console.log('PASS: Calendar full week and Dashboard week-to-date, Monday/Sunday boundaries, cross-month/year weeks and four-item navigation.');
