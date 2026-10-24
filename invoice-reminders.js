// Per-invoice consent and read-only delivery history. No reminder is sent from the browser.
(()=>{
 const el=id=>document.getElementById(id);let generation=0,loaded=null,busy=false;
 async function loadInvoiceReminders(id){
  const token=++generation,owner=appState.currentUser?.id;loaded=null;
  const current=()=>token===generation&&owner===appState.currentUser?.id&&id===appState.selectedInvoiceId;
  const invoice=invoiceById(id),eligible=invoice?.status==='unpaid'&&!invoice.archived;
  el('invoice-reminders-enabled').checked=false;el('invoice-reminders-recipient').value='';el('invoice-reminders-history').textContent='';
  for(const key of ['enabled','recipient','save'])el('invoice-reminders-'+key).disabled=true;
  el('invoice-reminders-status').textContent='Loading reminder settings…';
  if(!owner)return;
  try{
   const [settings,history]=await Promise.all([
    supabaseClient.from('invoice_reminder_settings').select('enabled,recipient').eq('invoice_id',id).eq('user_id',owner).maybeSingle(),
    supabaseClient.from('invoice_reminder_deliveries').select('stage,status,attempted_at,error').eq('invoice_id',id).eq('user_id',owner).order('attempted_at',{ascending:true})
   ]);
   if(!current())return;if(settings.error||history.error)throw settings.error||history.error;
   loaded={id,owner};el('invoice-reminders-enabled').checked=!!settings.data?.enabled;
   el('invoice-reminders-recipient').value=settings.data?.recipient||invoice.customer_email||'';
   el('invoice-reminders-enabled').disabled=!eligible;el('invoice-reminders-recipient').disabled=!eligible;
   // Ineligible invoices may still have an old enabled preference; allow turning it off.
   el('invoice-reminders-save').disabled=busy||(!eligible&&!settings.data?.enabled);
   if(!eligible)el('invoice-reminders-enabled').checked=false;
   el('invoice-reminders-status').textContent=!eligible?'Reminders are stopped for paid, cancelled or archived invoices.':settings.data?.enabled?'Reminders enabled. The next eligible date will be checked automatically.':'Reminders are off. Check the recipient and enable them to send automatic emails.';
   el('invoice-reminders-history').textContent=(history.data||[]).map(row=>(row.stage==='due'?'Due-date reminder':'Seven-day overdue reminder')+': '+(row.status==='accepted'?'Accepted for sending (inbox delivery not confirmed)':row.status==='failed'?(row.error||'Sending failed. Check delivery before sending a manual follow-up.'):'Sending attempted; acceptance not confirmed. Check delivery before following up.')).join('\n');
  }catch(_){if(current())el('invoice-reminders-status').textContent='Could not load reminder settings. Reopen this invoice to retry.';}
 }
 async function saveInvoiceReminders(){
  if(busy||!loaded)return;const {id,owner}=loaded,token=generation;
  if(owner!==appState.currentUser?.id||id!==appState.selectedInvoiceId)return;
  const enabled=el('invoice-reminders-enabled').checked,recipient=el('invoice-reminders-recipient').value.trim();
  if(enabled&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)){el('invoice-reminders-status').textContent='Enter a valid reminder recipient email.';return;}
  busy=true;el('invoice-reminders-save').disabled=true;el('invoice-reminders-status').textContent='Saving reminder settings…';
  const current=()=>token===generation&&owner===appState.currentUser?.id&&id===appState.selectedInvoiceId;
  try{
   const {error}=await supabaseClient.from('invoice_reminder_settings').upsert({invoice_id:id,user_id:owner,enabled,recipient,updated_at:new Date().toISOString()},{onConflict:'invoice_id'});
   if(error)throw error;if(!current())return;
   showToast(enabled?'Invoice reminders enabled':'Invoice reminders turned off');await loadInvoiceReminders(id);
  }catch(_){if(current()){el('invoice-reminders-status').textContent='Could not save reminder settings. Your change is not confirmed; reopen the invoice to check before retrying.';}}
  finally{busy=false;if(owner===appState.currentUser?.id&&id===appState.selectedInvoiceId&&loaded)el('invoice-reminders-save').disabled=false;}
 }
 Object.assign(window,{loadInvoiceReminders,saveInvoiceReminders});
})();
