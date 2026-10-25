const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{parseHTML}=require('linkedom');
(async()=>{
 const html=fs.readFileSync(__dirname+'/../index.html','utf8'),main=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).find(x=>x.includes('let appState'));
 const {window}=parseHTML(html),doc=window.document;window.HTMLElement.prototype.focus=()=>{};
 const calls=[],blobs=[];let fail=false,pending=null,readCount=0,mode='owner',downloaded=0;
 const grant={id:'grant',user_id:'client',owner_name:'<img src=x onerror=alert(1)>',accountant_email:'accountant@example.invalid',accepted_at:'2026-10-01',invitation_expires_at:'2099-01-01',access_expires_at:'2099-01-01',is_owner:false};
 const api={from:()=>{const q={select:()=>q,eq:()=>q,order:()=>q,limit:async()=>({data:[],error:null})};return q;},rpc:async(name,args)=>{calls.push({name,args});if(pending)return pending;
  if(fail)return {error:{message:'Accountant access expired or was revoked'}};
  if(args.p_action==='list')return {data:mode==='owner'?[]:[grant]};
  if(args.p_action==='read'){readCount++;return {data:{rows:[{source:'=HYPERLINK("bad")',notes:'<img src=x onerror=alert(1)>',amount:120}],has_more:false}};}
  return {data:{id:'grant',ok:true}};
 }};
 window.supabase={createClient:()=>api};
 const ctx=vm.createContext({window,document:doc,console,Date,Blob,URL:{createObjectURL:b=>{blobs.push(b);return 'blob:test';},revokeObjectURL:()=>{}},setTimeout:()=>0,confirm:()=>true});
 vm.runInContext(main,ctx);vm.runInContext(fs.readFileSync(__dirname+'/../accountant-cis.js','utf8'),ctx);Object.assign(ctx,{...window});const run=s=>vm.runInContext(s,ctx);
 run("appState.currentUser={id:'owner'}");await window.openAccountantCentre();assert.equal(doc.getElementById('accountant-message').textContent,'');
 doc.getElementById('accountant-email').value=' Accountant@Example.Invalid ';doc.getElementById('accountant-consent').checked=true;
 await doc.getElementById('accountant-invite-form').onsubmit({preventDefault(){}});
 assert.equal(calls.find(c=>c.args.p_action==='invite').args.p_data.email,'accountant@example.invalid');assert.ok(doc.getElementById('accountant-message').textContent.includes('No email was sent'));
 // Shared client records stay separate from the accountant's own app ledger.
 mode='accountant';run("setCurrentAccount({id:'accountant'})");await window.openAccountantCentre();
 assert.equal(doc.querySelectorAll('#accountant-grants img').length,0);await doc.querySelector('#accountant-grants button').onclick();
 const dataset=doc.getElementById('accountant-dataset');Object.defineProperty(dataset,'value',{value:'income',writable:true});
 await doc.getElementById('accountant-load').onclick();assert.equal(run('appState.currentUser.id'),'accountant');assert.equal(run('appState.transactions.length'),0);
 assert.equal(doc.querySelectorAll('#accountant-records img').length,0);assert.ok(doc.getElementById('accountant-records').textContent.includes('<img'));
 doc.createElement('a').constructor.prototype.click=()=>downloaded++;
 await doc.getElementById('accountant-export').onclick();assert.equal(downloaded,1);assert.equal(readCount,2);assert.ok((await blobs[0].text()).includes("'=HYPERLINK"));
 // A revoked invitation cannot export a previously loaded page.
 fail=true;await doc.getElementById('accountant-export').onclick();assert.equal(downloaded,1);assert.equal(doc.getElementById('accountant-records').textContent,'');assert.ok(doc.getElementById('accountant-client').classList.contains('hidden'));
 fail=false;await window.openAccountantCentre();let release;pending=new Promise(resolve=>release=resolve);
 const loading=window.openAccountantCentre();run("setCurrentAccount({id:'other'})");release({data:[grant]});await loading;
 assert.equal(doc.getElementById('accountant-centre'),null);assert.equal(run('appState.currentUser.id'),'other');
 console.log('PASS accountant UI: exact invitation email/consent, honest no-email status, client/account isolation, safe record rendering, CSV formula protection, fresh export authorisation and stale-response rejection.');
})().catch(e=>{console.error(e);process.exitCode=1;});
