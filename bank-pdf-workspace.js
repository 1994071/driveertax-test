/* PDF extraction is a draft: the existing bank-import transaction remains the only save path. */
(()=>{
 const el=id=>document.getElementById(id);let selected=null,owner=null,generation=0,version=0,loading=false,extracted=null;
 function resetBankStatement(clearPicker=true){selected=null;owner=null;generation=0;version++;loading=false;extracted=null;appState.bankPdfChecked=false;appState.bankPdfSource=false;appState.bankDraft=null;appState.bankCsv=null;if(el('bank-file')){el('bank-file').disabled=false;if(clearPicker)el('bank-file').value='';}for(const id of ['bank-review','bank-mapping','bank-pdf-fields'])el(id)?.replaceChildren();}
 function stillCurrent(user,g,token){return appState.currentUser?.id===user&&accountGeneration===g&&version===token;}
 function unlock(){loading=false;if(el('bank-file'))el('bank-file').disabled=false;if(el('bank-pdf-read'))el('bank-pdf-read').disabled=false;}
 async function readBankStatementFile(){
  if(el('bank-import')?.dataset.busy==='true'||loading)return;
  const file=el('bank-file')?.files[0];if(!file)return;
  resetBankStatement(false);owner=appState.currentUser?.id;generation=accountGeneration;const token=version;
  appState.bankFilename=file.name;appState.bankRequestId=crypto.randomUUID();el('bank-message').textContent='';
  try{
   if(!owner)throw Error('Sign in before importing a statement.');
   if(/\.pdf$/i.test(file.name)||file.type==='application/pdf'){
    if(!file.size||file.size>5*1024*1024)throw Error('Choose a PDF no larger than 5 MB.');
    if(new TextDecoder().decode(await file.slice(0,5).arrayBuffer())!=='%PDF-')throw Error('This is not a PDF. Renaming a file does not convert it.');
    if(!stillCurrent(owner,generation,token))return;selected=file;appState.bankPdfSource=true;
    el('bank-mapping').innerHTML='<p>PDF selected. Up to 10 pages / 200 transactions. The PDF is sent to OpenAI to extract transactions. Nothing is added to your books until you review and save. Keep your original PDF; this import saves transactions only.</p><button id="bank-pdf-read" type="button" class="'+batchButton+'">Read PDF statement</button><div id="bank-pdf-fields" class="space-y-3"></div>';
    el('bank-pdf-read').onclick=readPdfStatement;
   }else{
    if(!/\.csv$/i.test(file.name))throw Error('Choose a bank statement as PDF or CSV.');
    if(!file.size||file.size>2*1024*1024)throw Error('Choose a CSV smaller than 2 MB.');
    const rows=parseStatementCsv(await file.text());if(!stillCurrent(owner,generation,token))return;
    if(rows[0].some(h=>/tax.?year|tax.?reserve|estimated.?tax/i.test(h))&&!rows[0].some(h=>/^(date|transaction date)$/i.test(h.trim())))throw Error('This appears to be a tax summary. Choose a transaction statement downloaded from your bank.');
    appState.bankCsv=rows;renderBankMapping();el('bank-message').textContent='Check the column selections, then review the transactions.';
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
   extracted=data;renderPdfFields();el('bank-message').textContent='Check all extracted rows against every page of your statement. Correct any mistakes below before continuing.';
  }catch(e){if(stillCurrent(user,g,token)){extracted=null;el('bank-pdf-fields').replaceChildren();el('bank-message').textContent=e.message;}}
  finally{if(stillCurrent(user,g,token))unlock();}
 }
 function invalidatePdfReview(){appState.bankPdfChecked=false;appState.bankDraft=null;el('bank-review')?.replaceChildren();if(el('bank-pdf-confirm'))el('bank-pdf-confirm').checked=false;}
 function renderPdfFields(){
  const fields=el('bank-pdf-fields');fields.innerHTML='<p class="font-bold">'+extracted.rows.length+' transactions · '+extracted.pages+' pages read</p><p>Positive amounts are money in; negative amounts are money out. Balances are checks, not transactions.</p><div class="grid grid-cols-2 gap-2">'+['opening','closing'].map(k=>'<label>'+k[0].toUpperCase()+k.slice(1)+' balance (£)<input id="bank-pdf-'+k+'" inputmode="decimal" value="'+escapeHtml(extracted[k+'_balance']??'')+'" placeholder="Not shown" class="'+batchInput+'"></label>').join('')+'</div><div id="bank-pdf-row-list" class="space-y-2">'+extracted.rows.map((r,i)=>'<div class="rounded-xl border border-slate-700 p-3 space-y-2"><label>Date<input type="date" data-pdf-date="'+i+'" value="'+escapeHtml(r.date)+'" class="'+batchInput+'"></label><label>Description<input data-pdf-description="'+i+'" maxlength="500" value="'+escapeHtml(r.description)+'" class="'+batchInput+'"></label><label>Signed amount (£)<input data-pdf-amount="'+i+'" inputmode="decimal" value="'+escapeHtml(r.amount)+'" class="'+batchInput+'"></label></div>').join('')+'</div><p id="bank-pdf-balance" role="status" class="text-amber-200"></p><label class="flex gap-2"><input id="bank-pdf-confirm" type="checkbox">I checked all pages, dates, descriptions, amounts and the transaction count against my statement.</label><button id="bank-pdf-review" type="button" class="'+batchButton+' w-full">Check and review transactions</button>';
  fields.querySelectorAll('input:not([type="checkbox"])').forEach(input=>input.addEventListener('input',invalidatePdfReview));el('bank-pdf-review').onclick=reviewPdfTransactions;
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
   if(!el('bank-pdf-confirm').checked)throw Error('Check the statement and tick the confirmation first.');
   const rows=extracted.rows.map((r,i)=>{const date=statementDate(el('bank-pdf-row-list').querySelector('[data-pdf-date="'+i+'"]').value,'iso'),description=el('bank-pdf-row-list').querySelector('[data-pdf-description="'+i+'"]').value.trim(),amount=statementMoney(el('bank-pdf-row-list').querySelector('[data-pdf-amount="'+i+'"]').value);if(!description||!amount)throw Error('Every row needs a description and a non-zero amount.');return [date,description,amount.toFixed(2)];});
   if(!updatePdfBalance(rows.map(r=>Number(r[2]))))throw Error('The extracted statement does not balance. Check the rows and the opening/closing balances.');
   appState.bankCsv=[['Date','Description','Amount'],...rows];appState.bankPdfChecked=true;
   // The original mapper remains hidden for PDF, preserving editable extraction fields.
   const temp=document.createElement('div');temp.id='bank-pdf-columns';temp.className='hidden';temp.innerHTML='<select id="bank-format"><option value="iso">ISO</option></select>'+['date','description','amount','debit','credit'].map((k,i)=>'<select id="bank-col-'+k+'"><option value="'+(i<3?i:'')+'">PDF</option></select>').join('');el('bank-pdf-columns')?.remove();el('bank-mapping').append(temp);
   prepareBankReview();
  }catch(e){appState.bankPdfChecked=false;appState.bankDraft=null;el('bank-review').replaceChildren();el('bank-message').textContent=e.message;}
 }
 Object.assign(window,{resetBankStatement,readBankStatementFile});
})();
