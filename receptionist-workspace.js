/* Receptionist pilot: scripted preview plus authenticated WebRTC voice test. No bookkeeping writes. */
(()=>{
 const style=document.createElement('style');
 style.textContent=`
 #receptionist-demo{box-sizing:border-box;width:min(740px,calc(100% - 24px));max-height:90dvh;padding:0;border:1px solid #475569;border-radius:24px;background:#0f172a;color:#f8fafc;overflow:auto;font:15px/1.5 system-ui,sans-serif}
 #receptionist-demo::backdrop{background:rgba(2,6,23,.8)}
 #receptionist-demo *{box-sizing:border-box}#receptionist-demo .rc-wrap{padding:24px}
 #receptionist-demo header{display:flex;gap:12px;align-items:flex-start;justify-content:space-between}
 #receptionist-demo h2{font-size:26px;margin:8px 0}#receptionist-demo h3{font-size:18px;margin:0 0 12px}
 #receptionist-demo p{margin:8px 0}#receptionist-demo .rc-muted{color:#cbd5e1;font-size:13px}
 #receptionist-demo .rc-badge{display:inline-block;background:#312e81;color:#e0e7ff;border-radius:20px;padding:4px 10px;font-size:12px;font-weight:700}
 #receptionist-demo .rc-note{border:1px solid #475569;background:#1e293b;padding:14px;border-radius:14px;margin:18px 0}
 #receptionist-demo .rc-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
 #receptionist-demo label{display:block;font-size:13px;font-weight:600;margin-bottom:12px}
 #receptionist-demo input,#receptionist-demo textarea,#receptionist-demo select{display:block;width:100%;margin-top:6px;background:#020617;color:#fff;border:1px solid #64748b;border-radius:10px;padding:11px;font:inherit}
 #receptionist-demo textarea{resize:vertical;min-height:90px}#receptionist-demo button{font:inherit;cursor:pointer;border-radius:12px;padding:10px 14px;border:1px solid #64748b;background:#1e293b;color:#fff}
 #receptionist-demo button:focus-visible,#receptionist-demo input:focus-visible,#receptionist-demo textarea:focus-visible,#receptionist-demo select:focus-visible{outline:3px solid #a5b4fc;outline-offset:3px}
 #receptionist-demo .rc-primary{background:#4f46e5;border-color:#818cf8;font-weight:700;width:100%}
 #receptionist-demo section{margin-top:22px}#receptionist-demo .rc-message{padding:12px;border-radius:12px;background:#1e293b;margin-top:8px;white-space:pre-wrap;overflow-wrap:anywhere}
 #receptionist-demo .rc-message strong{display:block;font-size:12px;color:#a5b4fc;margin-bottom:4px}
 #receptionist-demo .rc-result{border:1px solid #6366f1;border-radius:16px;padding:16px;margin-top:16px;overflow-wrap:anywhere}
 #receptionist-demo dl{display:grid;grid-template-columns:100px 1fr;gap:8px;margin:0}#receptionist-demo dt{color:#cbd5e1}#receptionist-demo dd{margin:0;white-space:pre-wrap}
 #receptionist-demo [hidden]{display:none!important}@media(max-width:540px){#receptionist-demo .rc-grid{grid-template-columns:1fr}#receptionist-demo .rc-wrap{padding:18px}#receptionist-demo h2{font-size:23px}}
 `;
 document.head.appendChild(style);
 const dialog=document.createElement('dialog');dialog.id='receptionist-demo';dialog.setAttribute('aria-labelledby','rc-title');
 dialog.innerHTML=`<div class="rc-wrap"><header><div><span class="rc-badge">Earnavik Labs · Pilot</span><h2 id="rc-title">Your business receptionist</h2><p class="rc-muted">Explore how an enquiry could become a clear callback task.</p></div><button type="button" id="rc-close" aria-label="Close receptionist demo">Close</button></header>
 <div class="rc-note"><strong>Demo only — no live calls</strong><p class="rc-muted">The sample below is scripted. The separate AI voice test connects only for invited testers when configured. No phone line is connected. Nothing is booked or saved to your account. Closing clears the demo.</p></div>
 <form id="rc-form"><section aria-labelledby="rc-setup-title"><h3 id="rc-setup-title">1. Tell us about your business</h3><div class="rc-grid"><label>Business name<input id="rc-business" maxlength="100" required value="Oak & Co Services"></label><label>Services you offer<input id="rc-services" maxlength="200" required value="Repairs, installations and maintenance"></label></div><label>Area you cover<input id="rc-area" maxlength="120" required value="Your local area"></label><div class="rc-message"><strong>Opening greeting</strong><p id="rc-greeting"></p></div></section>
 <section class="rc-note" aria-labelledby="rc-voice-title"><h3 id="rc-voice-title">Talk to your AI receptionist</h3><p class="rc-muted">Private browser test. Your microphone audio and business details go to OpenAI while connected. Use fictional enquiries. Drafts stay on this screen and clear when you close it.</p><button type="button" id="rc-voice-start" class="rc-primary">Start AI voice test</button><button type="button" id="rc-voice-stop" hidden>End voice test</button><audio id="rc-audio" autoplay controls hidden></audio><p id="rc-voice-status" role="status">Voice service connection required. No customer phone line is connected.</p><div id="rc-voice-draft" class="rc-result" hidden><h3>AI enquiry draft · Review details</h3><p class="rc-muted">Not saved or sent. Check names and numbers with the caller.</p><dl id="rc-voice-fields"></dl></div></section><section aria-labelledby="rc-test-title"><h3 id="rc-test-title">Or try a scripted sample</h3><div class="rc-grid"><label>Customer name<input id="rc-customer" maxlength="100" required value="Alex Example"></label><label>Callback number<input id="rc-phone" type="tel" maxlength="40" required value="07700 900123"></label></div><label>Type of enquiry<select id="rc-type"><option value="quote">New quote request</option><option value="existing">Existing job question</option><option value="message">Leave a message</option></select></label><label>What does the caller need?<textarea id="rc-request" maxlength="1000" required>I would like a quote for a small repair next week. Please call me back in the afternoon.</textarea></label><button class="rc-primary" type="submit">Run sample enquiry →</button></section></form>
 <section id="rc-output" hidden aria-labelledby="rc-output-title"><h3 id="rc-output-title" tabindex="-1">Sample enquiry summary</h3><p class="rc-muted">Sample conversation generated from the details above.</p><div id="rc-transcript"></div><div class="rc-result"><span class="rc-badge">Callback needed · Sample</span><h3 style="margin-top:12px">Ready for your review</h3><dl id="rc-summary"></dl></div><p class="rc-muted">No appointment is confirmed. A connected version would check availability and ask for your booking rules.</p><p id="rc-count" role="status"></p></section>
 <section class="rc-note"><h3>Next: connect real calls</h3><p class="rc-muted">A live version needs a phone number or forwarding, a voice service, secure call records and your business rules. Pricing and a free trial have not been set.</p></section></div>`;
 document.body.appendChild(dialog);
 const $=id=>dialog.querySelector('#'+id);let count=0,opener=null,voice=null,openedOwner=null;
 const value=id=>$(id).value.trim();
 function greeting(){ $('rc-greeting').textContent='Hello, you’ve reached '+(value('rc-business')||'your business')+'. We help with '+(value('rc-services')||'your services')+' in '+(value('rc-area')||'your area')+'. How can I help today?'; }
 function reset(){ $('rc-form').reset();count=0;$('rc-output').hidden=true;$('rc-transcript').replaceChildren();$('rc-summary').replaceChildren();$('rc-count').textContent='';greeting(); }
 for(const id of ['rc-business','rc-services','rc-area'])$(id).addEventListener('input',greeting);
 $('rc-close').addEventListener('click',()=>dialog.close());
 dialog.addEventListener('close',()=>{stopVoice('Voice test ended.');$('rc-voice-draft').hidden=true;$('rc-voice-fields').replaceChildren();reset();if(opener?.isConnected)opener.focus();});
 $('rc-form').addEventListener('submit',event=>{
  event.preventDefault();
  const required=['rc-business','rc-services','rc-area','rc-customer','rc-phone','rc-request'];
  for(const id of required){$(id).setCustomValidity(value(id)?'':'Please enter a value.');if(!$(id).reportValidity())return;}
  greeting();
  const type=value('rc-type'),kind=type==='quote'?'Quote request':type==='existing'?'Existing job question':'Message';
  const request=value('rc-request'),name=value('rc-customer'),phone=value('rc-phone');
  $('rc-transcript').replaceChildren();
  for(const [speaker,message] of [['Receptionist',$('rc-greeting').textContent],['Caller',request],['Receptionist','I’ll pass this to the business. May I take your name and callback number?'],['Caller',name+' — '+phone],['Receptionist','Thank you, '+name+'. I’ve captured your request for review. The business will need to confirm availability and any prices.']]){
   const bubble=document.createElement('div'),label=document.createElement('strong'),body=document.createElement('span');bubble.className='rc-message';label.textContent=speaker;body.textContent=message;bubble.append(label,body);$('rc-transcript').appendChild(bubble);
  }
  $('rc-summary').replaceChildren();
  for(const [key,text] of [['Customer',name],['Callback',phone],['Enquiry',kind],['Request',request],['Next step',type==='quote'?'Call back to check the job details, location and quote.':type==='existing'?'Find the existing job and call the customer back.':'Review the message and call the customer back.']]){
   const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=text;$('rc-summary').append(dt,dd);
  }
  count++;$('rc-count').textContent=count+' sample '+(count===1?'enquiry':'enquiries')+' tried. Only the latest is shown; nothing has been saved.';
  $('rc-output').hidden=false;$('rc-output-title').focus();
 });
 for(const field of dialog.querySelectorAll('input,textarea'))field.addEventListener('input',()=>field.setCustomValidity(''));

 function stopVoice(message){
  const attempt=voice;voice=null;
  if(attempt){attempt.controller.abort();clearTimeout(attempt.timer);clearTimeout(attempt.setupTimer);clearInterval(attempt.ownerTimer);attempt.stream?.getTracks().forEach(t=>t.stop());attempt.channel?.close();attempt.pc?.close();}
  $('rc-audio').pause();$('rc-audio').srcObject=null;$('rc-audio').hidden=true;
  $('rc-voice-start').disabled=false;$('rc-voice-start').hidden=false;$('rc-voice-stop').hidden=true;
  if(message)$('rc-voice-status').textContent=message;
 }
 $('rc-voice-stop').addEventListener('click',()=>stopVoice('Voice test ended. Your draft remains below until you close this screen.'));
 window.addEventListener('pagehide',()=>stopVoice());
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&voice)stopVoice('Voice test ended when you left the app.');});
 async function startVoice(){
  if(voice)return;
  if(!window.RTCPeerConnection||!navigator.mediaDevices?.getUserMedia){$('rc-voice-status').textContent='This browser does not support the voice test. Try a current browser over HTTPS.';return;}
  for(const id of ['rc-business','rc-services','rc-area']){if(!value(id)){$(id).focus();$('rc-voice-status').textContent='Complete your business details first.';return;}}
  const attempt={controller:new AbortController(),owner:appState.currentUser?.id};voice=attempt;
  $('rc-voice-draft').hidden=true;$('rc-voice-fields').replaceChildren();
  $('rc-voice-start').disabled=true;$('rc-voice-stop').hidden=false;$('rc-voice-status').textContent='Checking the voice connection…';
  const current=()=>voice===attempt&&dialog.open&&appState.currentUser?.id===attempt.owner;
  attempt.setupTimer=setTimeout(()=>{if(voice===attempt)stopVoice('Connection timed out. Please try again.');},35000);
  attempt.ownerTimer=setInterval(()=>{if(voice===attempt&&appState.currentUser?.id!==attempt.owner){stopVoice('Voice test ended because the signed-in account changed.');$('rc-voice-draft').hidden=true;$('rc-voice-fields').replaceChildren();}},500);
  try{
   const {data,error}=await supabaseClient.auth.getSession();if(!current())return;
   if(error||!data.session?.access_token)throw Error('Sign in to try the voice pilot.');
   const headers={Authorization:'Bearer '+data.session.access_token};
   const endpoint='/.netlify/functions/receptionist-session';
   let response=await fetch(endpoint,{headers,signal:attempt.controller.signal});if(!current())return;
   if(!response.ok){const data=await response.json().catch(()=>({}));throw Error(data.error||'The voice pilot is not connected yet.');}
   $('rc-voice-status').textContent='Allow microphone access to begin the AI test.';
   const stream=await navigator.mediaDevices.getUserMedia({audio:true});
   if(!current()){stream.getTracks().forEach(t=>t.stop());return;}attempt.stream=stream;
   const pc=new RTCPeerConnection();attempt.pc=pc;
   const audio=$('rc-audio');audio.hidden=false;
   pc.ontrack=event=>{if(current()){audio.srcObject=event.streams[0];audio.play().catch(()=>{if(current())$('rc-voice-status').textContent='Tap Play on the audio control to hear the receptionist.';});}};
   for(const track of stream.getAudioTracks())pc.addTrack(track,stream);
   pc.onconnectionstatechange=()=>{if(current()&&['failed','closed','disconnected'].includes(pc.connectionState))stopVoice('Voice connection ended. You can try again.');};
   const channel=pc.createDataChannel('oai-events');attempt.channel=channel;
   channel.addEventListener('open',()=>{
    if(!current())return;clearTimeout(attempt.setupTimer);
    $('rc-voice-start').hidden=true;$('rc-voice-status').textContent='AI voice test connected. Speak naturally. Ends automatically after 3 minutes.';
    channel.send(JSON.stringify({type:'response.create',response:{instructions:'Introduce yourself as the business AI receptionist and ask how you can help. Explain this is a test and no appointments can be confirmed.'}}));
    attempt.timer=setTimeout(()=>{if(current())stopVoice('The 3-minute browser test ended. Your draft remains below.');},180000);
   });
   channel.addEventListener('message',event=>{
    if(!current())return;let message;try{message=JSON.parse(event.data);}catch{return;}
    if(message.type==='error'){stopVoice('The AI voice session encountered an error. Please try again.');return;}
    if(message.type!=='response.function_call_arguments.done'||message.name!=='capture_enquiry')return;
    let fields;try{fields=JSON.parse(message.arguments);}catch{return;}
    const keys=['customer','phone','request','location','callback_time'];
    if(!fields||keys.some(k=>typeof fields[k]!=='string'||fields[k].length>2000))return;
    $('rc-voice-fields').replaceChildren();
    const labels={customer:'Customer',phone:'Callback',request:'Enquiry',location:'Location',callback_time:'Best time'};
    for(const key of keys){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=labels[key];dd.textContent=fields[key];$('rc-voice-fields').append(dt,dd);}
    $('rc-voice-draft').hidden=false;
    channel.send(JSON.stringify({type:'conversation.item.create',item:{type:'function_call_output',call_id:message.call_id,output:JSON.stringify({status:'draft_shown_only',saved:false,sent:false,booked:false})}}));
    channel.send(JSON.stringify({type:'response.create'}));
   });
   const offer=await pc.createOffer();if(!current())return;await pc.setLocalDescription(offer);if(!current())return;
   response=await fetch(endpoint,{method:'POST',headers:{...headers,'Content-Type':'application/json'},signal:attempt.controller.signal,body:JSON.stringify({sdp:offer.sdp,business:value('rc-business'),services:value('rc-services'),area:value('rc-area')})});
   if(!current())return;
   if(!response.ok){const data=await response.json().catch(()=>({}));throw Error(data.error||'Could not connect the AI voice service.');}
   const sdp=await response.text();if(!current())return;await pc.setRemoteDescription({type:'answer',sdp});
  }catch(error){if(voice===attempt)stopVoice(error.name==='NotAllowedError'?'Microphone access was declined. You can allow it and try again.':error.message||'Could not start the voice test.');}
 }
 $('rc-voice-start').addEventListener('click',startVoice);
 window.openReceptionistPilot=button=>{opener=button;openedOwner=appState.currentUser?.id;reset();if(!dialog.open)dialog.showModal();};
 supabaseClient.auth.onAuthStateChange((_event,session)=>{if(dialog.open&&session?.user?.id!==openedOwner)dialog.close();});
 greeting();
})();
