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
  const rules=[
   [/\b(shell(?!\s+energy)|esso|texaco|gulf|applegreen|jet petrol|mfg|motor fuel group|bp (petrol|connect|service|garage)|petrol|diesel|fuel|pay at pump|pfs)\b/i,'Fuel'],
   [/\b(kwik[ -]?fit|halfords autocentre|ats euromaster|national tyres|euro car parts|tyres?|garage|mechanic|vehicle service|car service|mot test|brakes?|vehicle repair|oil change)\b/i,'Vehicle maintenance'],
   [/\b(ringgo|paybyphone|justpark|ncp|apcoa|parking|toll|dart charge|dartford|congestion charge|clean air zone|ulez)\b/i,'Parking & tolls'],
   [/\b(vodafone|giffgaff|lebara|lycamobile|ee limited|ee ltd|o2 mobile|three mobile|phone bill|broadband|internet|virgin media|bt broadband)\b/i,'Phone & internet'],
   [/\b(zego|vehicle insurance|car insurance|hire.reward insurance|public liability insurance|business insurance)\b/i,'Insurance'],
   [/\b(car wash|valeting|cleaning supply|cleaning chemicals|janitorial)\b/i,'Cleaning & supplies'],
   [/\b(taxi licence|private hire licence|driver badge|operator licence)\b/i,'Licensing'],
   [/\b(toolstation|screwfix|wickes|builders merchant|building materials|trade materials)\b/i,'Materials & tools'],
   [/\b(delivery bag|thermal bag|work equipment|equipment hire)\b/i,'Equipment'],
   [/\b(uber fee|bolt fee|platform fee|marketplace fee|commission|stripe fee|paypal fee)\b/i,'Platform & processing fees'],
   [/\b(royal mail|parcel force|parcelforce|evri|dpd|postage|shipping labels|packaging)\b/i,'Postage & packaging'],
   [/\b(advertising|google ads|meta ads|facebook ads|marketing)\b/i,'Marketing'],
   [/\b(accountant|accountancy|bookkeeping|xero|quickbooks)\b/i,'Accounting & software'],
   [/\b(chair rental|salon rent|workspace rent|commercial rent|office rent)\b/i,'Rent & workspace']
  ];
  for(const r of appState.bankDraft||[]){
   if(r.direction==='in'||r.reason)continue;
   const description=String(r.description||'');
   const found=rules.find(([re])=>re.test(description));
   if(found)r.category=found[1];
   // A supermarket, bank transfer, restaurant or ambiguous generic merchant is not automatically a business expense.
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
 function statementBrandAvatar(description,category,direction){
  const text=String(description||'');
  const brands=[
   [/\buber[\s*.-]*eats\b/i,'Uber Eats','ubereats.com'],
   [/\buber\b/i,'Uber','uber.com'],
   [/\bvodafone\b/i,'Vodafone','vodafone.co.uk'],
   [/\bshell\b(?!\s*energy)/i,'Shell','shell.com'],
   [/\bbp\s*(connect|petrol|service|garage)?\b/i,'BP','bp.com'],
   [/\besso\b/i,'Esso','esso.co.uk'],
   [/\btexaco\b/i,'Texaco','texaco.co.uk'],
   [/\bbolt\b/i,'Bolt','bolt.eu'],
   [/\bdeliveroo\b/i,'Deliveroo','deliveroo.co.uk'],
   [/\bjust[ -]?eat\b/i,'Just Eat','just-eat.co.uk'],
   [/\bfreenow\b|\bfree now\b/i,'FREENOW','free-now.com'],
   [/\b(three mobile|three uk)\b/i,'Three','three.co.uk'],
   [/\b(o2 mobile|o2 uk)\b/i,'O2','o2.co.uk'],
   [/\bgiffgaff\b/i,'giffgaff','giffgaff.com'],
   [/\blebara\b/i,'Lebara','lebara.co.uk'],
   [/\btesco\b/i,'Tesco','tesco.com'],
   [/\bsainsburys?\b/i,"Sainsbury's",'sainsburys.co.uk'],
   [/\bmorrisons\b/i,'Morrisons','morrisons.com'],
   [/\bhalford(s)?\b/i,'Halfords','halfords.com'],
   [/\bkwik[ -]?fit\b/i,'Kwik Fit','kwik-fit.com'],
   [/\bringgo\b/i,'RingGo','ringgo.co.uk'],
   [/\bamazon\b/i,'Amazon','amazon.co.uk'],
   [/\bpaypal\b/i,'PayPal','paypal.com'],
   [/\bstripe\b/i,'Stripe','stripe.com'],
   [/\bzego\b/i,'Zego','zego.com']
  ];
  const brand=brands.find(([re])=>re.test(text));
  const fallback='<span class="w-10 h-10 shrink-0 rounded-xl bg-slate-800 text-blue-200 flex items-center justify-center">'+statementIconHtml(category,direction)+'</span>';
  if(!brand)return fallback;
  const title=escapeHtml(brand[1]),domain=brand[2];
  // Only known, allowlisted domains; if the external favicon fails, show the category icon.
  return '<span class="w-10 h-10 shrink-0 rounded-xl bg-white flex items-center justify-center overflow-hidden border border-slate-700" title="'+title+'"><img loading="lazy" decoding="async" referrerpolicy="no-referrer" src="https://www.google.com/s2/favicons?domain='+domain+'&amp;sz=64" alt="'+title+' logo" class="w-8 h-8 object-contain" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'"><span class="hidden w-full h-full items-center justify-center bg-slate-800 text-blue-200">'+statementIconHtml(category,direction)+'</span></span>';
 }
 function statementIncomePayer(description){
  const raw=String(description||'').replace(/\s+/g,' ').trim();
  const known=[[/\buber[\s*.-]*eats\b/i,'Uber Eats'],[/\buber\b/i,'Uber'],[/\bbolt\b/i,'Bolt'],[/\bdeliveroo\b/i,'Deliveroo'],[/\bjust[ -]?eat\b/i,'Just Eat'],[/\bfreenow\b|\bfree now\b/i,'FREENOW'],[/\bamazon\b/i,'Amazon'],[/\bstripe\b/i,'Stripe'],[/\bpaypal\b/i,'PayPal'],[/\bsumup\b/i,'SumUp'],[/\bsquareup\b|\bsquare payments\b/i,'Square'],[/\betsy\b/i,'Etsy'],[/\bebay\b/i,'eBay'],[/\bshopify\b/i,'Shopify']];
  const match=known.find(([pattern])=>pattern.test(raw));
  if(match)return match[1];
  // Strip generic bank posting prefixes/suffixes only; keep distinct unknown payers separate.
  const cleaned=raw.replace(/^(?:faster payments?|fps|bacs|bank transfer|credit from|payment from|received from|cr)\s*[:\-]?\s*/i,'').replace(/\s+(?:ref(?:erence)?|payment id|transaction id)\s*[:#]?\s*[a-z0-9-]+$/i,'').trim();
  return (cleaned||raw||'Unknown payer').slice(0,100);
 }
 function statementGroups(){
  const groups=new Map();
  (appState.bankDraft||[]).forEach((r,i)=>{
   const section=r.reason||r.kind==='skip'?'review':r.direction==='in'?'income':'expenses';
   const category=section==='review'?'Needs review':r.direction==='in'?statementIncomePayer(r.description):(r.category||'Other');
   const key=JSON.stringify([section,r.direction,category.toLowerCase()]);
   if(!groups.has(key))groups.set(key,{merchant:category,section,direction:r.direction,category,items:[]});
   groups.get(key).items.push({r,i});
  });
  const weight={expenses:0,income:1,review:2};
  return [...groups.values()].sort((a,b)=>weight[a.section]-weight[b.section]||b.items.reduce((s,x)=>s+Math.round(x.r.amount*100),0)-a.items.reduce((s,x)=>s+Math.round(x.r.amount*100),0));
 }
 function captureStatementChoices(){for(const [i,r] of (appState.bankDraft||[]).entries()){const box=document.querySelector('[data-bank-approve="'+i+'"]');if(box){r.approved=box.checked;r.kind=document.querySelector('[data-bank-kind="'+i+'"]').value;r.category=document.querySelector('[data-bank-category="'+i+'"]').value;}}}
 function updateStatementSelection(){
  captureStatementChoices();const rows=(appState.bankDraft||[]).filter(r=>r.approved&&r.kind!=='skip');
  const sum=kind=>rows.filter(r=>r.kind===kind).reduce((s,r)=>s+Math.round(r.amount*100),0)/100;
  const selected=el('bank-selected-total');
  selected.innerHTML='<div class="grid grid-cols-3 gap-2" aria-label="Selected payment summary"><div class="rounded-xl bg-slate-900 border border-slate-700 p-2"><p class="text-[10px] text-slate-400">Selected</p><p class="text-lg font-extrabold text-white">'+rows.length+'</p></div><div class="rounded-xl bg-rose-500/10 border border-rose-500/25 p-2"><p class="text-[10px] text-rose-200">Expenses</p><p class="text-base font-extrabold text-rose-300">£'+sum('expense').toFixed(2)+'</p></div><div class="rounded-xl bg-emerald-500/10 border border-emerald-500/25 p-2"><p class="text-[10px] text-emerald-200">Income</p><p class="text-base font-extrabold text-emerald-300">£'+sum('income').toFixed(2)+'</p></div></div>';
  const save=el('bank-save');if(save){save.textContent='Save '+rows.length+' selected payment'+(rows.length===1?'':'s');save.disabled=!rows.length;}
  document.querySelectorAll('[data-bank-group-toggle]').forEach(box=>{const indices=JSON.parse(box.dataset.bankIndices),eligible=indices.map(i=>appState.bankDraft[i]).filter(r=>!r.reason&&r.kind!=='skip'),count=eligible.filter(r=>r.approved).length;box.checked=eligible.length>0&&count===eligible.length;box.indeterminate=count>0&&count<eligible.length;});
 }
 function premiumStatementTheme(){
  const modal=el('bank-import');if(!modal)return;
  modal.classList.add('premium-statement');
  if(document.getElementById('premium-statement-style'))return;
  const style=document.createElement('style');style.id='premium-statement-style';
  style.textContent=`
  .premium-statement{color:#172033!important}
  .premium-statement > div,.premium-statement .premium-review{background:#f3f6fa!important;color:#172033!important}
  .premium-statement .premium-review .premium-heading{background:white;border:1px solid #dee6ee;border-radius:22px;padding:18px;color:#172033}
  .premium-statement .premium-review .premium-heading h3{color:#101827!important}
  .premium-statement .premium-review .premium-heading p{color:#64748b!important}
  .premium-statement .premium-review .premium-heading .premium-step{color:#118b7e!important}
  .premium-statement .premium-review .premium-filter{background:#e8edf5;border-radius:20px;padding:5px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px}
  .premium-statement .premium-review .premium-filter button{color:#475569;background:transparent;border:0;border-radius:15px;padding:12px 4px;font-weight:700}
  .premium-statement .premium-review .premium-filter button[aria-pressed=true]{background:white;color:#111827;box-shadow:0 2px 8px #64748b20}
  .premium-statement .premium-review [data-merchant-group]{background:white!important;border:1px solid #d9e2ec!important;border-radius:23px!important;box-shadow:0 3px 10px #1323380c!important;color:#142033!important;padding:17px!important;margin:12px 0}
  .premium-statement .premium-review [data-merchant-group]:has([data-bank-indices]){overflow:hidden}
  .premium-statement .premium-review [data-merchant-group] p,.premium-statement .premium-review [data-merchant-group] strong{color:inherit}
  .premium-statement .premium-review [data-merchant-group] .text-white{color:#111827!important}
  .premium-statement .premium-review [data-merchant-group] .text-slate-400{color:#748296!important}
  .premium-statement .premium-review [data-merchant-group] .text-rose-300{color:#bb244b!important}
  .premium-statement .premium-review [data-merchant-group] .text-emerald-300{color:#07876d!important}
  .premium-statement .premium-review [data-merchant-group] details{border-color:#e2e8f0!important}
  .premium-statement .premium-review [data-merchant-group] summary{color:#0e8c7e!important}
  .premium-statement .premium-review [data-statement-row]{border-color:#e2e8f0!important}
  .premium-statement .premium-review [data-statement-row] input,.premium-statement .premium-review [data-statement-row] select{color:#172033!important;background:#f4f7fb!important;border:1px solid #d6e0e9!important}
  .premium-statement .premium-review [data-statement-row] p{color:#334155!important}
  .premium-statement .premium-review [data-bank-group-toggle],.premium-statement .premium-review [data-bank-approve]{accent-color:#0e9283;width:19px;height:19px}
  .premium-statement .premium-review #bank-selected-total>div>div{background:#fff!important;border:1px solid #e1e7ef!important;border-radius:17px}
  .premium-statement .premium-review #bank-selected-total p{color:#637188!important}
  .premium-statement .premium-review #bank-selected-total .text-white{color:#162033!important}
  .premium-statement .premium-review #bank-transaction-list>section>h4{color:#162033!important;font-size:16px}
  .premium-statement .premium-review .premium-savebar{position:sticky;bottom:0;background:#fff!important;border:1px solid #e2e8f0!important;box-shadow:0 -5px 18px #10233512}
  .premium-statement .premium-review .premium-savebar button{background:#108f80!important;color:white!important;border-radius:16px;font-size:13px}
  .premium-statement .premium-review .premium-savebar p{color:#64748b!important}
  `;
  document.head.appendChild(style);
 }
 function renderStatementReview(){
  premiumStatementTheme();
  appState.bankReviewFilter='all';
  el('bank-review').innerHTML='<div class="premium-review space-y-4"><div class="premium-heading rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-700 p-4 space-y-3"><div class="flex items-center justify-between"><div><p class="text-[10px] uppercase tracking-widest text-emerald-400 font-bold">Step 2 · Review</p><h3 class="text-xl font-black text-white">Your transactions</h3></div><span class="rounded-xl bg-emerald-500/15 px-3 py-2 text-emerald-300 text-xs font-bold">🔒 Private</span></div><p class="text-xs text-slate-300">Review each payment before it reaches your books. We suggest categories, but you decide what is business-related. Payments keep their original dates.</p><div id="bank-selected-total" role="status" aria-live="polite"></div><div class="grid grid-cols-3 gap-2" id="bank-filter-pills" class="premium-filter"><button type="button" data-bank-filter="all" aria-pressed="true" class="rounded-xl border border-emerald-500 bg-emerald-500/15 text-emerald-200 text-xs font-bold p-2">All</button><button type="button" data-bank-filter="out" aria-pressed="false" class="rounded-xl border border-slate-700 bg-slate-900 text-slate-300 text-xs font-bold p-2">Expenses</button><button type="button" data-bank-filter="in" aria-pressed="false" class="rounded-xl border border-slate-700 bg-slate-900 text-slate-300 text-xs font-bold p-2">Income</button></div></div><div class="flex items-center justify-between gap-2"><p class="text-xs text-slate-400">Expenses are grouped by type; income is grouped by payer or platform. Expand to check each payment.</p><span class="text-[10px] text-amber-200">Review suggested tax categories</span></div><div id="bank-transaction-list" class="space-y-3"></div><div class="premium-savebar sticky bottom-0 z-10 rounded-2xl border border-slate-700 bg-slate-900/95 backdrop-blur p-3 space-y-2"><p class="text-[10px] text-slate-400">Unselected and personal transactions are not saved. Duplicate warnings need checking.</p><button type="button" id="bank-save" onclick="saveBankImport()" class="'+batchButton+' w-full">Save verified records</button></div></div>';
  el('bank-filter-pills').querySelectorAll('[data-bank-filter]').forEach(button=>button.onclick=()=>{
    captureStatementChoices();appState.bankReviewFilter=button.dataset.bankFilter;
    el('bank-filter-pills').querySelectorAll('[data-bank-filter]').forEach(b=>{b.setAttribute('aria-pressed',String(b===button));});
    renderStatementRows();
  });
  renderStatementRows();
 }
 function statementPaymentRow(r,i){return '<div data-statement-row="'+i+'" class="border-t border-slate-700 pt-3 mt-3 space-y-2"><div class="flex gap-2 items-start"><input type="checkbox" data-bank-approve="'+i+'" '+(r.approved?'checked':'')+' aria-label="Select '+escapeHtml(r.description)+' on '+escapeHtml(r.date)+'" class="mt-1 w-5 h-5 shrink-0"><span aria-hidden="true">'+statementIconHtml(r.category,r.direction)+'</span><div class="min-w-0 flex-1"><p class="break-words">'+escapeHtml(r.description)+'</p><p class="text-slate-400">'+escapeHtml(formatUkDate(r.date))+'</p></div><strong class="shrink-0">£'+r.amount.toFixed(2)+'</strong></div>'+(r.reason?'<p class="text-amber-200">'+escapeHtml(r.reason)+'</p>':'')+'<div class="grid grid-cols-2 gap-2"><label>Record as<select data-bank-kind="'+i+'" class="'+batchInput+'"><option value="skip" '+(r.kind==='skip'?'selected':'')+'>Personal / skip</option><option value="income" '+(r.kind==='income'?'selected':'')+'>Business income</option><option value="expense" '+(r.kind==='expense'?'selected':'')+'>Business expense</option></select></label><label>Category<input data-bank-category="'+i+'" maxlength="80" value="'+escapeHtml(r.category)+'" class="'+batchInput+'"></label></div></div>';}
 function renderStatementRows(){
  const groups=statementGroups(),filter=appState.bankReviewFilter;
  el('bank-transaction-list').innerHTML=['expenses','income','review'].map(section=>{
   const subset=groups.map((g,id)=>({g,id})).filter(({g})=>g.section===section && (filter==='all'||g.direction===filter));
   if(!subset.length)return '';
   return '<section class="space-y-2"><div class="flex items-center justify-between py-2"><h4 class="font-bold text-white">'+({expenses:'Business expenses',income:'Income by payer',review:'Needs checking / personal'})[section]+'</h4><span class="text-xs text-slate-400">'+subset.length+' groups</span></div>'+subset.map(({g,id})=>{
    const indices=g.items.map(x=>x.i),eligible=g.items.filter(({r})=>!r.reason&&r.kind!=='skip'),total=g.items.reduce((s,{r})=>s+Math.round(r.amount*100),0)/100;
    const merchants=new Set(g.items.map(x=>statementMerchant(x.r.description))).size;
    return '<div data-merchant-group="'+id+'" class="rounded-2xl border border-slate-700/70 bg-slate-900/70 overflow-hidden"><div class="flex items-center gap-3 p-3"><input type="checkbox" data-bank-group-toggle="'+id+'" data-bank-indices=\''+JSON.stringify(indices)+'\' '+(!eligible.length?'disabled':'')+' aria-label="Select '+escapeHtml(g.merchant)+' group" class="w-5 h-5 shrink-0 accent-emerald-500"><span class="w-11 h-11 rounded-2xl bg-slate-800/80 text-emerald-300 flex items-center justify-center shrink-0">'+(new Set(g.items.map(x=>statementMerchant(x.r.description))).size===1?statementBrandAvatar(g.items[0].r.description,g.category,g.direction):statementIconHtml(g.category,g.direction,section==='review'))+'</span><div class="min-w-0 flex-1"><p class="text-sm font-bold text-white break-words">'+escapeHtml(g.merchant)+'</p><p class="text-[11px] text-slate-400 mt-1">'+g.items.length+' payment'+(g.items.length===1?'':'s')+(section==='expenses'?' · '+merchants+' merchants':'')+'</p></div><p class="font-extrabold text-sm tabular-nums '+(g.direction==='in'?'text-emerald-300':'text-rose-300')+'">'+(g.direction==='in'?'+':'−')+'£'+total.toFixed(2)+'</p></div>'+(section==='review'?'<p class="px-4 text-xs text-amber-200">Review these transactions before including them.</p>':'')+'<details class="border-t border-slate-800"><summary class="cursor-pointer select-none px-4 py-3 text-xs font-bold text-blue-200 hover:bg-slate-800/50">View transactions · '+g.items.length+' <span aria-hidden="true">⌄</span></summary><div class="px-4 pb-4">'+g.items.map(({r,i})=>statementPaymentRow(r,i)).join('')+'</div></details></div>';
   }).join('')+'</section>';
  }).join('');
  el('bank-transaction-list').querySelectorAll('[data-bank-group-toggle]').forEach(box=>box.onchange=()=>{for(const i of JSON.parse(box.dataset.bankIndices)){const r=appState.bankDraft[i];if(r.reason||r.kind==='skip')continue;const input=el('bank-transaction-list').querySelector('[data-bank-approve="'+i+'"]');if(input)input.checked=box.checked;}updateStatementSelection();});
  el('bank-transaction-list').querySelectorAll('[data-bank-approve],[data-bank-kind],[data-bank-category]').forEach(input=>input.onchange=updateStatementSelection);updateStatementSelection();
 }

 Object.assign(window,{resetBankStatement,readBankStatementFile,suggestStatementCategories,renderStatementReview});
})();
