const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{parseHTML}=require('linkedom');
const source=fs.readFileSync('receptionist-workspace.js','utf8');
function fixture({ready=true,holdMic=false}={}){
 const {window}=parseHTML(fs.readFileSync('index.html','utf8')),document=window.document;
 const state={authListener:null,fetches:[],stops:0,closed:0,pcs:[],timers:[],pendingMic:null};
 const appState={currentUser:{id:'tester'}};
 const stream={getTracks:()=>[{stop:()=>state.stops++}],getAudioTracks:()=>[{}]};
 window.RTCPeerConnection=function(){};
 class Peer{
  constructor(){this.channel=document.createElement('div');this.channel.send=()=>{};this.channel.close=()=>{};state.pcs.push(this);}
  addTrack(){}createDataChannel(){return this.channel;}async createOffer(){return {sdp:'v=0\noffer'};}async setLocalDescription(){}async setRemoteDescription(){}close(){state.closed++;}
 }
 const ctx=vm.createContext({window,document,appState,console,AbortController,RTCPeerConnection:Peer,
  navigator:{mediaDevices:{getUserMedia:async()=>{if(holdMic)await new Promise(r=>state.pendingMic=r);return stream;}}},
  supabaseClient:{auth:{getSession:async()=>({data:{session:{access_token:'test'}}}),onAuthStateChange:fn=>{state.authListener=fn;}}},
  fetch:async(url,options)=>{state.fetches.push(options);return {ok:ready,json:async()=>({error:'The voice pilot is not connected yet.'}),text:async()=>'v=0\nanswer'};},
  setTimeout:fn=>{state.timers.push(fn);return state.timers.length;},clearTimeout(){},setInterval:()=>0,clearInterval(){}
 });
 vm.runInContext(source,ctx);
 const dialog=document.getElementById('receptionist-demo'),$=id=>document.getElementById(id);
 $('rc-form').reset=()=>{};for(const el of dialog.querySelectorAll('input,textarea')){el.setCustomValidity=()=>{};el.reportValidity=()=>true;}
 $('rc-audio').pause=()=>{};$('rc-audio').play=async()=>{};
 dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;dialog.dispatchEvent(new window.Event('close'));};
 const button=document.getElementById('open-receptionist-pilot');window.openReceptionistPilot(button);
 Object.defineProperty($('rc-type'),'value',{value:'quote',writable:true});
 return {$,state,appState,dialog,window,submit:()=>{$('rc-form').dispatchEvent(new window.Event('submit',{cancelable:true}));},tick:()=>new Promise(r=>setImmediate(r))};
}
(async()=>{
 let f=fixture();assert.ok(f.dialog.open);assert.equal(f.$('view-tools').children[1].id,'tools-receptionist');assert.equal(f.$('open-receptionist-pilot').textContent,'Open receptionist test →');assert.equal(f.$('rc-output').hidden,true);
 f.$('rc-business').value='<img src=x onerror=alert(1)>';f.$('rc-business').dispatchEvent(new f.window.Event('input'));assert.equal(f.$('rc-greeting').querySelector('img'),null);
 f.$('rc-customer').value='Alex';f.$('rc-request').value='<script>evil()</script>';f.submit();assert.equal(f.$('rc-output').hidden,false);assert.match(f.$('rc-summary').textContent,/Alex/);assert.equal(f.$('rc-summary').querySelector('script'),null);assert.equal(f.state.fetches.length,0);
 f.dialog.close();assert.equal(f.$('rc-summary').children.length,0);assert.equal(f.$('rc-output').hidden,true);
 f=fixture({ready:false});f.$('rc-voice-start').click();await f.tick();assert.equal(f.state.pcs.length,0);assert.match(f.$('rc-voice-status').textContent,/not connected/);assert.equal(f.$('rc-voice-start').disabled,false);
 f=fixture();f.$('rc-voice-start').click();f.$('rc-voice-start').click();await f.tick();assert.equal(f.state.pcs.length,1);assert.equal(f.state.fetches.length,2);
 const channel=f.state.pcs[0].channel;channel.dispatchEvent(new f.window.Event('open'));
 let event=new f.window.Event('message');event.data=JSON.stringify({type:'response.function_call_arguments.done',name:'capture_enquiry',call_id:'abc',arguments:JSON.stringify({customer:'Alex',phone:'07700 900123',request:'Repair',location:'Test town',callback_time:'Afternoon'})});channel.dispatchEvent(event);assert.equal(f.$('rc-voice-draft').hidden,false);assert.match(f.$('rc-voice-fields').textContent,/Afternoon/);
 f.$('rc-voice-stop').click();assert.equal(f.state.stops,1);assert.equal(f.state.closed,1);assert.equal(f.$('rc-voice-stop').hidden,true);
 f.state.authListener('SIGNED_OUT',null);assert.equal(f.dialog.open,false);assert.equal(f.$('rc-voice-fields').children.length,0);
 f=fixture({holdMic:true});f.$('rc-voice-start').click();await f.tick();assert.ok(f.state.pendingMic);f.dialog.close();f.state.pendingMic();await f.tick();assert.equal(f.state.stops,1);assert.equal(f.state.pcs.length,0);
 const {createHandler}=await import('../netlify/functions/receptionist-session.mjs');
 const settings={OPENAI_API_KEY:'server-secret',RECEPTIONIST_VOICE_ENABLED:'true',RECEPTIONIST_PILOT_USER_IDS:'tester'};
 let calls=[],authOK=true,upstreamOK=true,user='tester';
 const handler=createHandler({env:k=>settings[k],fetcher:async(url,options)=>{calls.push({url,options});if(url.includes('supabase'))return {ok:authOK,json:async()=>({id:user})};return {ok:upstreamOK,text:async()=>'v=0\nanswer'};}});
 const req=(method='GET',body,extra={})=>new Request('https://earnavik.com/.netlify/functions/receptionist-session',{method,headers:{Authorization:'Bearer test','Content-Type':'application/json',...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
 let response=await handler(new Request('https://earnavik.com/.netlify/functions/receptionist-session'));assert.equal(response.status,401);
 settings.RECEPTIONIST_VOICE_ENABLED='false';response=await handler(req());assert.equal(response.status,503);assert.equal(calls.length,0);settings.RECEPTIONIST_VOICE_ENABLED='true';
 response=await handler(req('GET',undefined,{Origin:'https://other.example'}));assert.equal(response.status,403);
 authOK=false;response=await handler(req());assert.equal(response.status,401);authOK=true;user='other';response=await handler(req());assert.equal(response.status,403);user='tester';
 response=await handler(req());assert.equal(response.status,200);
 response=await handler(req('POST',{sdp:'bad'}));assert.equal(response.status,400);
 const body={sdp:'v=0\noffer',business:'Test business',services:'Repairs',area:'Test town'};
 response=await handler(req('POST',{...body,business:'x'.repeat(40000)}));assert.equal(response.status,413);
 response=await handler(req('POST',body));assert.equal(response.status,200);assert.equal(await response.text(),'v=0\nanswer');assert.equal(response.headers.get('cache-control'),'no-store');
 const api=calls.at(-1);assert.equal(api.options.headers.Authorization,'Bearer server-secret');const session=JSON.parse(api.options.body.get('session'));assert.equal(session.model,'gpt-realtime-2.1');assert.equal(session.tools[0].name,'capture_enquiry');assert.match(session.instructions,/Do not claim a booking/);
 upstreamOK=false;response=await handler(req('POST',body));assert.equal(response.status,502);assert.ok(!(await response.text()).includes('server-secret'));
 assert.match(fs.readFileSync('_headers','utf8'),/microphone=\(self\)/);
 console.log('PASS: scripted enquiry, safe rendering, pilot/auth gates, request bounds, voice session payload, duplicate start guard, late microphone release, stop/close/account-change cleanup. All services mocked.');
})().catch(error=>{console.error(error);process.exit(1);});
