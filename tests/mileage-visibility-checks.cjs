const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
let prefs={mileageEnabled:null},roles=[],finished=0,opened=0;
const ctx={readDashboardPreferences:()=>prefs,incomeServiceRoles:()=>roles,finishDailyEntry:()=>finished++};
vm.createContext(ctx);
vm.runInContext(html.slice(html.indexOf('        function mileageEnabled(){'),html.indexOf('        function setMileageEnabled(')),ctx);
for(const category of ['beauty','trades','cleaning','professional','food','letting']){roles=[{category,label:'Example'}];assert.equal(ctx.mileageEnabled(),false,category);}
roles=[{category:'driving',label:'Taxi / Private Hire'}];assert.equal(ctx.mileageEnabled(),true);
roles=[{category:'education',label:'Driving instructor'}];assert.equal(ctx.mileageEnabled(),true);
roles=[{category:'beauty'},{category:'driving'}];assert.equal(ctx.mileageEnabled(),true);
prefs.mileageEnabled=false;assert.equal(ctx.mileageEnabled(),false);
prefs.mileageEnabled=true;roles=[{category:'trades'}];assert.equal(ctx.mileageEnabled(),true);
vm.runInContext(html.slice(html.indexOf('        function openDailyMileageStep() {'),html.indexOf('        function skipDailyIncome()')),ctx);
prefs.mileageEnabled=false;ctx.openDailyMileageStep();assert.equal(finished,1);
assert.ok(html.includes("mileageEnabled:typeof saved.mileageEnabled==='boolean'?saved.mileageEnabled:null"));
assert.ok(html.includes('drivertax-dashboard-v1:'));
console.log('PASS: profession defaults, mixed roles, explicit on/off preference, account-scoped storage and daily flow skips disabled mileage.');
