/* PDF extraction is a draft: the existing bank-import transaction remains the only save path. */
(()=>{
 const el=id=>document.getElementById(id);let selected=null,owner=null,generation=0,version=0,loading=false,extracted=null;
 function resetBankStatement(clearPicker=true){selected=null;owner=null;generation=0;version++;loading=false;extracted=null;appState.bankFileHash=null;appState.bankPdfChecked=false;appState.bankPdfSource=false;appState.bankDraft=null;appState.bankCsv=null;if(el('bank-file')){el('bank-file').disabled=false;if(clearPicker)el('bank-file').value='';}for(const id of ['bank-review','bank-mapping','bank-pdf-fields'])el(id)?.replaceChildren();}
 function stillCurrent(user,g,token){return appState.currentUser?.id===user&&accountGeneration===g&&version===token;}
 function unlock(){loading=false;if(el('bank-file'))el('bank-file').disabled=false;if(el('bank-pdf-read'))el('bank-pdf-read').disabled=false;}
 async function readBankStatementFile(){
  if(el('bank-import')?.dataset.busy==='true'||loading)return;
  const file=el('bank-file')?.files[0];if(!file)return;
  resetBankStatement(false);owner=appState.currentUser?.id;generation=accountGeneration;const token=version;
  appState.bankFilename=file.name;appState.bankRequestId=crypto.randomUUID();el('bank-message').textContent='';
  try{
   if(!owner)throw Error('Sign in before importing a statement.');
   if(file.size>5*1024*1024)throw Error('Choose a statement no larger than 5 MB.');
   const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
   const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
   const {data:history,error:historyError}=await supabaseClient.rpc('check_bank_statement',{p_sha256:hash,p_filename:file.name});
   if(!stillCurrent(owner,generation,token))return;
   if(historyError)throw Error('Could not check previous imports. Reconnect and choose the file again.');
   appState.bankFileHash=hash;
   const warning=history?.file_seen?'This statement was imported before. Previously saved rows will be skipped, even if you change the account nickname. Review any remaining rows.':history?.name_seen?'A file with this name was imported before. Check the possible duplicates in the transaction list.':'';
   appState.bankFileWarning=warning;el('bank-message').textContent=warning;
   if(/\.pdf$/i.test(file.name)||file.type==='application/pdf'){
    if(!file.size||file.size>5*1024*1024)throw Error('Choose a PDF no larger than 5 MB.');
    if(new TextDecoder().decode(await file.slice(0,5).arrayBuffer())!=='%PDF-')throw Error('This is not a PDF. Renaming a file does not convert it.');
    if(!stillCurrent(owner,generation,token))return;selected=file;appState.bankPdfSource=true;
    el('bank-mapping').innerHTML='<p>PDF selected. Up to 10 pages / 200 transactions. The PDF is sent to OpenAI to extract transactions. Nothing is added to your books until you review and save. Keep your original PDF; this import saves transactions only.</p><button id="bank-pdf-read" type="button" class="'+batchButton+'">Read PDF statement</button><div id="bank-pdf-fields" class="space-y-3"></div>';
    el('bank-pdf-read').onclick=readPdfStatement;if(!history?.file_seen)await readPdfStatement();
   }else{
    if(!/\.csv$/i.test(file.name))throw Error('Choose a bank statement as PDF or CSV.');
    if(!file.size||file.size>2*1024*1024)throw Error('Choose a CSV smaller than 2 MB.');
    const rows=parseStatementCsv(await file.text());if(!stillCurrent(owner,generation,token))return;
    if(rows[0].some(h=>/tax.?year|tax.?reserve|estimated.?tax/i.test(h))&&!rows[0].some(h=>/^(date|transaction date)$/i.test(h.trim())))throw Error('This appears to be a tax summary. Choose a transaction statement downloaded from your bank.');
    appState.bankCsv=rows;renderBankMapping();const col=k=>el('bank-col-'+k).value;if(col('date')!==''&&col('description')!==''&&(col('amount')!==''||(col('debit')!==''&&col('credit')!=='')))prepareBankReview();else el('bank-message').textContent='Check the column selections, then review the transactions.';if(warning)el('bank-message').textContent=warning;
   }
  }catch(e){if(stillCurrent(owner,generation,token)){appState.bankCsv=null;appState.bankDraft=null;el('bank-mapping').replaceChildren();el('bank-message').textContent=e.message;}}
 }
 async function readPdfStatement(){
  if(loading||!selected||owner!==appState.currentUser?.id||generation!==accountGeneration)return;
  const user=owner,g=generation,token=version,file=selected;invalidatePdfReview();loading=true;el('bank-file').disabled=true;el('bank-pdf-read').disabled=true;el('bank-message').textContent='Reading PDF pages… Larger or scanned statements can take longer. Nothing has been saved.';
  try{
   const form=new FormData();form.append('file',file,file.name);
   const {data,error}=await supabaseClient.functions.invoke('parse-bank-statement',{body:form});
   if(!stillCurrent(user,g,token))return;
   if(error){let message='Could not read the PDF. Retry, or use a bank CSV.';try{message=(await error.context.json()).error||message;}catch{}throw Error(message);}
   if(!data?.preview_only||!Array.isArray(data.rows)||!data.rows.length||data.rows.length>200)throw Error('The PDF did not return a complete transaction list. Try CSV.');
   extracted=data;renderPdfFields();reviewPdfTransactions();if(appState.bankDraft)el('bank-message').textContent='Transactions ready. Check every page and tick the business payments below. Nothing has been saved. '+(appState.bankFileWarning||'');
  }catch(e){if(stillCurrent(user,g,token)){extracted=null;el('bank-pdf-fields').replaceChildren();el('bank-message').textContent=e.message;}}
  finally{if(stillCurrent(user,g,token))unlock();}
 }
 function invalidatePdfReview(){appState.bankPdfChecked=false;appState.bankDraft=null;el('bank-review')?.replaceChildren();if(el('bank-pdf-confirm'))el('bank-pdf-confirm').checked=false;}
 function renderPdfFields(){
  const fields=el('bank-pdf-fields');el('bank-pdf-read').hidden=true;fields.innerHTML='<details><summary class="cursor-pointer font-bold py-3">Check / correct extracted dates, amounts and balances</summary><p class="font-bold">'+extracted.rows.length+' transactions · '+extracted.pages+' pages read</p><p>Positive amounts are money in; negative amounts are money out. Balances are checks, not transactions.</p><div class="grid grid-cols-2 gap-2">'+['opening','closing'].map(k=>'<label>'+k[0].toUpperCase()+k.slice(1)+' balance (£)<input id="bank-pdf-'+k+'" inputmode="decimal" value="'+escapeHtml(extracted[k+'_balance']??'')+'" placeholder="Not shown" class="'+batchInput+'"></label>').join('')+'</div><div id="bank-pdf-row-list" class="space-y-2">'+extracted.rows.map((r,i)=>'<div class="rounded-xl border border-slate-700 p-3 space-y-2"><label>Date<input type="date" data-pdf-date="'+i+'" value="'+escapeHtml(r.date)+'" class="'+batchInput+'"></label><label>Description<input data-pdf-description="'+i+'" maxlength="500" value="'+escapeHtml(r.description)+'" class="'+batchInput+'"></label><label>Signed amount (£)<input data-pdf-amount="'+i+'" inputmode="decimal" value="'+escapeHtml(r.amount)+'" class="'+batchInput+'"></label></div>').join('')+'</div><button id="bank-pdf-review" type="button" class="'+batchButton+' w-full">Apply corrections</button></details><p id="bank-pdf-balance" role="status" class="text-amber-200"></p><label class="flex gap-2"><input id="bank-pdf-confirm" type="checkbox">I checked all pages, dates, descriptions, amounts and the transaction count against my statement.</label>';
  fields.querySelectorAll('input:not([type="checkbox"])').forEach(input=>input.addEventListener('input',invalidatePdfReview));el('bank-pdf-review').onclick=reviewPdfTransactions;el('bank-pdf-confirm').onchange=()=>{appState.bankPdfChecked=el('bank-pdf-confirm').checked;};
  updatePdfBalance(extracted.rows.map(r=>Number(r.amount)));
 }
 function updatePdfBalance(amounts){
  const opening=el('bank-pdf-opening').value.trim(),closing=el('bank-pdf-closing').value.trim();
  if(!opening||!closing){el('bank-pdf-balance').textContent='Both balances are not available. Check the full transaction count and totals manually against every page.';return true;}
  const diff=Math.round(statementMoney(opening)*100)+amounts.reduce((s,n)=>s+Math.round(n*100),0)-Math.round(statementMoney(closing)*100);
  el('bank-pdf-balance').textContent=diff?'Balance difference £'+(diff/100).toFixed(2)+'. Correct the rows or balances before continuing.':'Opening balance + transactions matches the closing balance. Still check each row.';return diff===0;
 }
 function reviewPdfTransactions(){
  try{
   if(!extracted||owner!==appState.currentUser?.id||generation!==accountGeneration)throw Error('Choose the statement again for this account.');

   const rows=extracted.rows.map((r,i)=>{const date=statementDate(el('bank-pdf-row-list').querySelector('[data-pdf-date="'+i+'"]').value,'iso'),description=el('bank-pdf-row-list').querySelector('[data-pdf-description="'+i+'"]').value.trim(),amount=statementMoney(el('bank-pdf-row-list').querySelector('[data-pdf-amount="'+i+'"]').value);if(!description||!amount)throw Error('Every row needs a description and a non-zero amount.');return [date,description,amount.toFixed(2)];});
   if(!updatePdfBalance(rows.map(r=>Number(r[2]))))throw Error('The extracted statement does not balance. Check the rows and the opening/closing balances.');
   appState.bankCsv=[['Date','Description','Amount'],...rows];appState.bankPdfChecked=el('bank-pdf-confirm').checked;
   // The original mapper remains hidden for PDF, preserving editable extraction fields.
   const temp=document.createElement('div');temp.id='bank-pdf-columns';temp.className='hidden';temp.innerHTML='<select id="bank-format"><option value="iso">ISO</option></select>'+['date','description','amount','debit','credit'].map((k,i)=>'<select id="bank-col-'+k+'"><option value="'+(i<3?i:'')+'">PDF</option></select>').join('');el('bank-pdf-columns')?.remove();el('bank-mapping').append(temp);
   prepareBankReview();
  }catch(e){appState.bankPdfChecked=false;appState.bankDraft=null;el('bank-review').replaceChildren();el('bank-message').textContent=e.message;}
 }
 // All suggestions remain editable. Supermarkets and unidentified payments stay Other.
 function suggestStatementCategories(){
  for(const r of appState.bankDraft||[]){
   if(r.direction==='in'||r.reason)continue;
   const rules=[[/\b(fuel|petrol|diesel|shell|esso|texaco|bp petrol|bp connect|gulf petrol)\b/i,'Fuel'],[/\b(garage|garages|mot|tyres?|kwik.?fit|halfords autocentre|servicing|vehicle repair)\b/i,'Maintenance'],[/\b(ringgo|paybyphone|parking|toll|dart charge|congestion charge)\b/i,'Parking & Tolls'],[/\b(vodafone|giffgaff|lebara|lycamobile|ee limited|ee ltd|o2|three mobile|phone bill|broadband|internet)\b/i,'Phone & Internet'],[/\b(zego|vehicle insurance|car insurance|hire.reward insurance)\b/i,'Insurance'],[/\b(car wash|valeting)\b/i,'Cleaning'],[/\b(taxi licence|private hire licence|driver badge)\b/i,'Licensing'],[/\b(delivery bag|thermal bag|work equipment)\b/i,'Equipment'],[/\b(uber fee|bolt fee|platform fee|commission)\b/i,'Platform Fees']];
   const found=rules.find(([re])=>re.test(r.description));if(found)r.category=found[1];
  }
 }
 // Match known payment brands only. Unknown merchants retain their full description.
 // Direction, review warnings and category remain part of the group identity.
 function statementMerchant(description){
  const text=String(description).replace(/\s+/g,' ').trim();
  const names=[[/\bshell\b(?!\s*energy)/i,'Shell'],[/\besso\b/i,'Esso'],[/\btexaco\b/i,'Texaco'],[/\bbp\s+(petrol|connect|service|sf|garage)\b/i,'BP'],[/\bvodafone\b/i,'Vodafone'],[/\bgiffgaff\b/i,'giffgaff'],[/\bo2\b/i,'O2'],[/\bringgo\b/i,'RingGo'],[/\bpaybyphone\b/i,'PayByPhone'],[/\bkwik[ -]?fit\b/i,'Kwik Fit'],[/\bdeliveroo\b/i,'Deliveroo'],[/\bjust[ -]?eat\b/i,'Just Eat'],[/\buber[\s*.-]*eats\b/i,'Uber Eats'],[/\buber\b/i,'Uber'],[/\bbolt\b/i,'Bolt'],[/\bzego\b/i,'Zego']];
  return names.find(([pattern])=>pattern.test(text))?.[1]||text;
 }
 function statementIcon(category,direction){
  if(direction==='in')return '💷';const x=String(category).toLowerCase();
  if(/fuel|petrol|diesel/.test(x))return '⛽';if(/maintenance|repair|garage/.test(x))return '🔧';
  if(/phone|internet|mobile/.test(x))return '📱';if(/parking|toll/.test(x))return '🅿️';
  if(/insurance/.test(x))return '🛡️';if(/clean|wash/.test(x))return '🧽';
  if(/licen/.test(x))return '🪪';if(/equipment|tool/.test(x))return '🧰';return '🧾';
 }
 function statementIconHtml(category,direction,review=false){
  const icon=review?'?':statementIcon(category,direction),paths={
   '⛽':'M4 21V4h10v17M3 21h12M6 7h6M6 10h6M14 11h2a2 2 0 0 1 2 2v4a2 2 0 0 0 4 0V8l-3-3M19 8h3',
   '🔧':'M14 6a5 5 0 0 0-6 6L2 18a3 3 0 0 0 4 4l6-6a5 5 0 0 0 6-6l-3 3-4-4 3-3Z',
   '📱':'M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1ZM10 18h4',
   '💷':'M2 5h20v14H2ZM12 8v8M15 9c-1-2-6-1-6 1s6 1 6 3-5 3-6 1',
   '🅿️':'M4 3h16v18H4ZM9 17V7h4a3 3 0 0 1 0 6H9',
   '🛡️':'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6L12 2ZM8 12l3 3 5-6',
   '?':'M9 9a3 3 0 1 1 4 3v3M12 18h.01',
   'default':'M5 2h14v20l-3-2-4 2-4-2-3 2V2ZM8 7h8M8 11h8M8 15h5'};
  return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+(paths[icon]||paths.default)+'"/></svg>';
 }
 function statementGroups(){
  const groups=new Map();
  (appState.bankDraft||[]).forEach((r,i)=>{const merchant=statementMerchant(r.description),section=r.reason||r.kind==='skip'?'review':r.direction==='in'?'income':'expenses',key=JSON.stringify([section,r.direction,merchant.toLowerCase(),r.category]);
   if(!groups.has(key))groups.set(key,{merchant,section,direction:r.direction,category:r.category,items:[]});groups.get(key).items.push({r,i});
  });return [...groups.values()].sort((a,b)=>a.merchant.localeCompare(b.merchant));
 }
 function captureStatementChoices(){for(const [i,r] of (appState.bankDraft||[]).entries()){const box=document.querySelector('[data-bank-approve="'+i+'"]');if(box){r.approved=box.checked;r.kind=document.querySelector('[data-bank-kind="'+i+'"]').value;r.category=document.querySelector('[data-bank-category="'+i+'"]').value;}}}
 function updateStatementSelection(){
  captureStatementChoices();const rows=(appState.bankDraft||[]).filter(r=>r.approved&&r.kind!=='skip');
  const sum=kind=>rows.filter(r=>r.kind===kind).reduce((s,r)=>s+Math.round(r.amount*100),0)/100;
  el('bank-selected-total').textContent=rows.length+' payments selected · Expenses £'+sum('expense').toFixed(2)+' · Income £'+sum('income').toFixed(2);
  document.querySelectorAll('[data-bank-group-toggle]').forEach(box=>{const indices=JSON.parse(box.dataset.bankIndices),eligible=indices.map(i=>appState.bankDraft[i]).filter(r=>!r.reason&&r.kind!=='skip'),count=eligible.filter(r=>r.approved).length;box.checked=eligible.length>0&&count===eligible.length;box.indeterminate=count>0&&count<eligible.length;});
 }
 function renderStatementReview(){
  appState.bankReviewFilter='all';
  el('bank-review').innerHTML='<h3 class="text-lg font-bold">Choose business payments</h3><p>One line per merchant. Tick a group or open it to choose individual payments. Each payment keeps its original date.</p><label class="block">Show<select id="bank-view-filter" class="'+batchInput+'"><option value="all">All payments</option><option value="out">Expenses / paid out</option><option value="in">Income / paid in</option></select></label><p id="bank-selected-total" role="status" class="font-bold text-emerald-200"></p><div id="bank-transaction-list" class="space-y-3"></div><button type="button" id="bank-save" onclick="saveBankImport()" class="'+batchButton+' w-full">Save selected payments</button>';
  el('bank-view-filter').onchange=()=>{captureStatementChoices();appState.bankReviewFilter=el('bank-view-filter').value;renderStatementRows();};renderStatementRows();
 }
 function statementPaymentRow(r,i){return '<div data-statement-row="'+i+'" class="border-t border-slate-700 pt-3 mt-3 space-y-2"><div class="flex gap-2 items-start"><input type="checkbox" data-bank-approve="'+i+'" '+(r.approved?'checked':'')+' aria-label="Select '+escapeHtml(r.description)+' on '+escapeHtml(r.date)+'" class="mt-1 w-5 h-5 shrink-0"><span aria-hidden="true">'+statementIconHtml(r.category,r.direction)+'</span><div class="min-w-0 flex-1"><p class="break-words">'+escapeHtml(r.description)+'</p><p class="text-slate-400">'+escapeHtml(formatUkDate(r.date))+'</p></div><strong class="shrink-0">£'+r.amount.toFixed(2)+'</strong></div>'+(r.reason?'<p class="text-amber-200">'+escapeHtml(r.reason)+'</p>':'')+'<div class="grid grid-cols-2 gap-2"><label>Record as<select data-bank-kind="'+i+'" class="'+batchInput+'"><option value="skip" '+(r.kind==='skip'?'selected':'')+'>Personal / skip</option><option value="income" '+(r.kind==='income'?'selected':'')+'>Business income</option><option value="expense" '+(r.kind==='expense'?'selected':'')+'>Business expense</option></select></label><label>Category<input data-bank-category="'+i+'" maxlength="80" value="'+escapeHtml(r.category)+'" class="'+batchInput+'"></label></div></div>';}
 function renderStatementRows(){
  const groups=statementGroups(),filter=appState.bankReviewFilter;
  el('bank-transaction-list').innerHTML=['expenses','income','review'].map(section=>{
   const subset=groups.map((g,id)=>({g,id})).filter(({g})=>g.section===section),visible=subset.some(({g})=>filter==='all'||g.direction===filter);
   return '<section '+(!visible?'hidden':'')+'><h4 class="font-bold text-slate-300 pt-3 pb-2">'+({expenses:'Expenses',income:'Income',review:'Needs checking / personal'})[section]+'</h4>'+subset.map(({g,id})=>{
    const indices=g.items.map(x=>x.i),eligible=g.items.filter(({r})=>!r.reason&&r.kind!=='skip'),total=g.items.reduce((s,{r})=>s+Math.round(r.amount*100),0)/100;
    return '<div data-merchant-group="'+id+'" '+(filter!=='all'&&g.direction!==filter?'hidden':'')+' class="rounded-xl border border-slate-700 bg-slate-950 p-3"><div class="flex items-start gap-3"><input type="checkbox" data-bank-group-toggle="'+id+'" data-bank-indices=\''+JSON.stringify(indices)+'\' '+(!eligible.length?'disabled':'')+' aria-label="Select '+escapeHtml(g.merchant)+' group" class="mt-1 w-5 h-5 shrink-0"><span aria-hidden="true" class="w-8 h-8 rounded-lg bg-slate-800 text-blue-200 flex items-center justify-center shrink-0">'+statementIconHtml(g.category,g.direction,section==='review')+'</span><div class="min-w-0 flex-1"><p class="font-bold break-words">'+escapeHtml(g.merchant)+'</p><p class="text-slate-400">'+g.items.length+' payment'+(g.items.length===1?'':'s')+' · '+escapeHtml(g.category)+'</p></div><strong class="shrink-0 '+(g.direction==='in'?'text-emerald-300':'text-rose-300')+'">'+(g.direction==='in'?'+':'−')+'£'+total.toFixed(2)+'</strong></div>'+(section==='review'?'<p class="text-amber-200 mt-2">Open and check these payments individually.</p>':'')+'<details class="mt-2"><summary class="cursor-pointer py-2 text-blue-200">View / edit '+g.items.length+' payment'+(g.items.length===1?'':'s')+'</summary>'+g.items.map(({r,i})=>statementPaymentRow(r,i)).join('')+'</details></div>';
   }).join('')+'</section>';
  }).join('');
  el('bank-transaction-list').querySelectorAll('[data-bank-group-toggle]').forEach(box=>box.onchange=()=>{for(const i of JSON.parse(box.dataset.bankIndices)){const r=appState.bankDraft[i];if(r.reason||r.kind==='skip')continue;document.querySelector('[data-bank-approve="'+i+'"]').checked=box.checked;}updateStatementSelection();});
  el('bank-transaction-list').querySelectorAll('[data-bank-approve],[data-bank-kind],[data-bank-category]').forEach(input=>input.onchange=updateStatementSelection);updateStatementSelection();
 }

 Object.assign(window,{resetBankStatement,readBankStatementFile,suggestStatementCategories,renderStatementReview});
})();
