const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{parseHTML}=require('linkedom');
const html=fs.readFileSync(__dirname+'/../index.html','utf8'),{window}=parseHTML(html),doc=window.document;
const client={from:()=>({select(){return this},eq:async()=>({data:[],error:null})})};window.supabase={createClient:()=>client};const ctx=vm.createContext({window,document:doc,Date,console,setTimeout:()=>0});const main=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).find(x=>x.includes('let appState'));vm.runInContext(main,ctx);const run=s=>vm.runInContext(s,ctx);let pending=[];ctx.waitRead=()=>new Promise(resolve=>pending.push(resolve));run("setCurrentAccount({id:'a'});fetchAllUserRows=waitRead;renderTaxDueCards=()=>{};renderDashboardYearSummary=()=>{};");
(async()=>{
 const old=run('refreshTaxPayments()'),fresh=run('refreshTaxPayments()');pending[1]({data:[{id:'newer'}]});await fresh;pending[0]({data:[{id:'stale'}]});await old;assert.equal(run('appState.taxPayments[0].id'),'newer');
 const first=pending.length,obsolete=run('refreshTaxPayments()');run("setCurrentAccount({id:'b'});setCurrentAccount({id:'a'});appState.taxPayments=[{id:'current-login'}]");pending[first]({data:[{id:'previous-login'}]});await obsolete;assert.equal(run('appState.taxPayments[0].id'),'current-login');
 console.log('PASS: slow payment refresh cannot replace newer data or a new login session for the same account.');
})().catch(e=>{console.error(e);process.exit(1)});
