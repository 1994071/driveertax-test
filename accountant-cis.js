/* Read-only accountant workspace and statement-backed subcontractor CIS credits. */
function cisPreview(gross,vat,costs,rate){
    const values=[gross,vat,costs,rate].map(Number);
    if(values.some(v=>!Number.isFinite(v))||values[0]<=0||values[0]>1e9||values[1]<0||values[2]<0||values[1]+values[2]>values[0]||![0,20,30].includes(values[3]))throw Error('Check gross income, VAT, eligible costs and CIS rate.');
    const pennies=values.slice(0,3).map(v=>Math.round(v*100));
    const basePennies=pennies[0]-pennies[1]-pennies[2],base=basePennies/100,deducted=Math.floor((basePennies*values[3]+50)/100)/100;
    return {base,deducted,net:moneyRound(values[0]-deducted)};
}
(() => {
    const el=id=>document.getElementById(id),safe=escapeHtml,money=n=>'£'+Number(n||0).toFixed(2);
    const datasets={income:'Income (gross records)',expenses:'Expenses (gross records)',invoices:'Invoices',cis:'CIS deductions',vat_classifications:'VAT classifications',vat_purchases:'VAT purchase claims',vat_reviews:'VAT reviewed periods',credits:'Invoice credit notes',catchup:'Catch-up summaries',regular_costs:'Regular costs'};
    let serial=0,grants=[],report=null,busy=false;
    function resetAccountantCis(){serial++;grants=[];report=null;busy=false;for(const id of ['accountant-centre','cis-centre'])el(id)?.remove();}
    function context(){return {user:appState.currentUser?.id,generation:accountGeneration,serial};}
    function current(c){return !!c.user&&c.user===appState.currentUser?.id&&c.generation===accountGeneration&&c.serial===serial;}
    async function rpc(action,data,c=context()){
        if(!current(c))throw Error('Account changed. Reopen this screen.');
        const response=await supabaseClient.rpc('accountant_action',{p_action:action,p_data:data});
        if(!current(c))throw Error('Account changed. Reopen this screen.');
        if(response.error)throw response.error;return response.data;
    }
    function friendly(error){return /schema cache|does not exist|could not find|42P01|PGRST202/i.test(error?.message||'')?'This feature is awaiting its database update. Your existing records are unchanged.':error?.message||'Could not complete the request. Try again when connected.';}
    function ensureAccountantCisTools(){
        if(el('accountant-cis-tools'))return;
        const bar=document.createElement('div');bar.id='accountant-cis-tools';bar.className='grid grid-cols-1 sm:grid-cols-3 gap-2';
        for(const [label,fn] of [['👥 Accountant access',openAccountantCentre],['🧾 VAT & returns',openVatCentre],['🏗️ CIS deductions',openCisCentre]]){
            const button=document.createElement('button');button.type='button';button.className=batchButton;button.textContent=label;button.onclick=fn;bar.appendChild(button);
        }
        el('view-tax')?.insertBefore(bar,el('view-tax').children[1]);
    }
    function fieldLabel(key){return ({gross_snapshot:'Gross payment',deducted_amount:'CIS tax deducted',materials_cost:'Eligible costs excluded from CIS',paid_on:'Paid on',earned_on:'Received on',expense_date:'Expense date',tax_treatment:'Income Tax treatment',claim_amount:'VAT reclaim',tax_point:'VAT tax point',vat_on_document:'VAT on document',regular_costs_included:'Regular costs included'})[key]||key.replaceAll('_',' ').replace(/^./,s=>s.toUpperCase());}
    function fieldValue(key,value){
        if(value===null||value===undefined)return '—';
        if(typeof value==='boolean')return value?'Yes':'No';
        if(typeof value==='number'&&/(amount|total|subtotal|snapshot|cost)$/.test(key))return money(value);
        if(Array.isArray(value))return value.map(v=>typeof v==='object'?Object.entries(v).map(([k,x])=>fieldLabel(k)+': '+String(x??'—')).join(' · '):String(v)).join('\n');
        if(typeof value==='object')return Object.entries(value).map(([k,v])=>fieldLabel(k)+': '+String(v??'—')).join('\n');
        return String(value);
    }
    function renderGrants(){
        const host=el('accountant-grants');host.replaceChildren();
        if(!grants.length)host.textContent='No accountant invitations or shared clients yet.';
        for(const g of grants){
            const expired=new Date(g.access_expires_at)<=new Date(),inviteExpired=!g.accepted_at&&new Date(g.invitation_expires_at)<=new Date(),active=!g.revoked_at&&!expired&&!inviteExpired;
            const box=document.createElement('div');box.className='rounded-xl border border-slate-700 p-3 space-y-2';
            const line=document.createElement('p');line.textContent=(g.is_owner?g.accountant_email:g.owner_name)+' · '+(g.revoked_at?'Revoked':expired||inviteExpired?'Expired':g.accepted_at?'Read-only access':'Awaiting acceptance');box.appendChild(line);
            const dates=document.createElement('p');dates.className='text-slate-400';dates.textContent='Access expires '+new Date(g.access_expires_at).toLocaleDateString('en-GB');box.appendChild(dates);
            if(active){const b=document.createElement('button');b.type='button';b.className=batchButton;b.textContent=g.is_owner?'Revoke access':g.accepted_at?'Open client records':'Accept invitation';b.onclick=()=>g.is_owner?changeGrant('revoke',g):g.accepted_at?openClient(g):changeGrant('accept',g);box.appendChild(b);}
            host.appendChild(box);
        }
    }
    async function loadGrants(c=context()){
        const data=await rpc('list',{},c);if(!Array.isArray(data))throw Error('Invitation response was incomplete.');grants=data;renderGrants();
        const {data:events,error}=await supabaseClient.from('accountant_access_events').select('action,details,created_at').eq('user_id',c.user).order('created_at',{ascending:false}).limit(20);
        if(!current(c))return;
        el('accountant-audit').textContent=error?'Recent access history could not load.':(events||[]).map(e=>new Date(e.created_at).toLocaleString('en-GB')+' · '+e.action+(e.details?.dataset?' · '+e.details.dataset:'')).join('\n')||'No access activity yet.';
    }
    async function openAccountantCentre(){
        if(!appState.currentUser)return;serial++;report=null;busy=false;
        const modal=batchModal('accountant-centre','Accountant access',`<p>Give your accountant their own read-only login to income, expenses, invoices, VAT records, CIS deductions, catch-up summaries and regular costs. They can export records, but cannot edit, delete, pay or submit returns.</p><form id="accountant-invite-form" class="space-y-3"><label class="block">Accountant email<input id="accountant-email" type="email" required maxlength="254" autocomplete="email" class="${batchInput}"></label><label class="flex gap-2"><input id="accountant-consent" type="checkbox" required> I authorise this accountant to view and export these business records for 90 days.</label><button id="accountant-invite" class="${batchButton}" type="submit">Create invitation</button></form><p>Acceptance expires after 7 days. No email is sent automatically: ask your accountant to sign into Earnavik with this exact verified email and open Accountant access.</p><p id="accountant-message" role="status" class="text-amber-200"></p><div id="accountant-grants" class="space-y-2"></div><section id="accountant-client" class="hidden space-y-3 border-t border-slate-700 pt-3"><h3 id="accountant-client-name" class="font-bold"></h3><p>Read-only source records. These are not a reconciled tax return. Gross rows, VAT records and overlapping catch-up summaries must not be added together without reconciliation.</p><div class="grid grid-cols-2 gap-2"><label>From<input id="accountant-from" type="date" class="${batchInput}"></label><label>To<input id="accountant-to" type="date" class="${batchInput}"></label></div><label class="block">Records<select id="accountant-dataset" class="${batchInput}">${Object.entries(datasets).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label><button type="button" id="accountant-load" class="${batchButton}">Load records</button><div id="accountant-records" class="space-y-2"></div><div class="flex gap-2"><button id="accountant-prev" type="button" class="${batchButton}">Previous page</button><button id="accountant-next" type="button" class="${batchButton}">Next page</button><button id="accountant-export" type="button" class="${batchButton}">Export this page</button></div><p>Each page contains up to 200 records. Load other pages for larger datasets.</p></section><details><summary class="cursor-pointer">Recent access activity</summary><p id="accountant-audit" class="whitespace-pre-wrap mt-2"></p></details>`);
        el('accountant-client').classList.add('hidden');el('accountant-records').replaceChildren();el('accountant-grants').replaceChildren();el('accountant-audit').textContent='';el('accountant-message').textContent='Loading invitations…';
        el('accountant-invite-form').onsubmit=inviteAccountant;showBatchModal(modal);const c=context();
        try{await loadGrants(c);if(current(c))el('accountant-message').textContent='';}catch(e){if(current(c))el('accountant-message').textContent=friendly(e);}
    }
    async function inviteAccountant(event){
        event.preventDefault();if(busy||!el('accountant-consent').checked)return;busy=true;const c=context(),modal=el('accountant-centre');modal.dataset.busy='true';el('accountant-invite').disabled=true;
        try{await rpc('invite',{email:el('accountant-email').value.trim().toLowerCase()},c);if(!current(c))return;el('accountant-email').value='';el('accountant-consent').checked=false;await loadGrants(c);if(current(c))el('accountant-message').textContent='Invitation created. Ask your accountant to sign in with the invited email. No email was sent.';}
        catch(e){if(current(c))el('accountant-message').textContent=friendly(e);}
        finally{if(current(c)){busy=false;modal.dataset.busy='false';el('accountant-invite').disabled=false;}}
    }
    async function changeGrant(action,g){
        if(busy||action==='revoke'&&!confirm('Revoke this accountant’s access? Copies already downloaded cannot be recalled.'))return;
        busy=true;const c=context();el('accountant-centre').dataset.busy='true';
        try{await rpc(action,{id:g.id},c);report=null;el('accountant-client').classList.add('hidden');el('accountant-records').replaceChildren();await loadGrants(c);if(current(c))el('accountant-message').textContent=action==='accept'?'Invitation accepted. Open client records to review.':'Access revoked.';}
        catch(e){if(current(c))el('accountant-message').textContent=friendly(e);}
        finally{if(current(c)){busy=false;el('accountant-centre').dataset.busy='false';}}
    }
    function openClient(g){
        if(busy)return;report={owner:g.user_id,page:0,rows:[],loaded:false};el('accountant-client').classList.remove('hidden');el('accountant-client-name').textContent=g.owner_name+' · read-only';
        el('accountant-from').value=currentTaxYearBounds().start;el('accountant-to').value=driverToday();el('accountant-records').replaceChildren();
        const invalidate=()=>{report.rows=[];report.loaded=false;report.page=0;el('accountant-records').replaceChildren();el('accountant-export').disabled=true;};
        for(const id of ['accountant-from','accountant-to','accountant-dataset'])el(id).onchange=invalidate;
        el('accountant-load').onclick=()=>readClient(0);el('accountant-prev').onclick=()=>readClient(Math.max(0,report.page-1));el('accountant-next').onclick=()=>readClient(report.page+1);el('accountant-export').onclick=exportClientPage;el('accountant-export').disabled=true;el('accountant-next').disabled=true;el('accountant-prev').disabled=true;
    }
    async function readClient(page){
        if(busy||!report)return;busy=true;const c=context(),selected={owner:report.owner,from:el('accountant-from').value,to:el('accountant-to').value,dataset:el('accountant-dataset').value,page};
        report.rows=[];report.loaded=false;el('accountant-records').replaceChildren();el('accountant-export').disabled=true;el('accountant-centre').dataset.busy='true';
        try{const data=await rpc('read',selected,c);if(!Array.isArray(data?.rows))throw Error('Client records were incomplete.');
            if(!current(c))return;
            if(selected.from!==el('accountant-from').value||selected.to!==el('accountant-to').value||selected.dataset!==el('accountant-dataset').value)return;
            report={...selected,rows:data.rows,loaded:true};el('accountant-records').textContent=data.rows.length?'Page '+(page+1)+' · '+data.rows.length+' records':'No records in this range.';
            for(const row of data.rows){const box=document.createElement('dl');box.className='rounded-xl border border-slate-700 p-3 space-y-2';
                for(const [key,value] of Object.entries(row)){if(key==='id'||key.endsWith('_id'))continue;const field=document.createElement('div'),label=document.createElement('dt'),text=document.createElement('dd');label.className='text-slate-400';label.textContent=fieldLabel(key);text.className='whitespace-pre-wrap break-words';text.textContent=fieldValue(key,value);field.append(label,text);box.appendChild(field);}el('accountant-records').appendChild(box);}
            el('accountant-prev').disabled=page===0;el('accountant-next').disabled=!data.has_more;el('accountant-export').disabled=!data.rows.length;el('accountant-message').textContent='';
        }catch(e){if(current(c)){report=null;el('accountant-client').classList.add('hidden');el('accountant-records').replaceChildren();el('accountant-message').textContent=friendly(e);}}
        finally{if(current(c)){busy=false;el('accountant-centre').dataset.busy='false';}}
    }
    function csvCell(value){let s=value&&typeof value==='object'?JSON.stringify(value):String(value??'');if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
    function downloadCsv(name,rows){const csv=rows.map(r=>r.map(csvCell).join(',')).join('\r\n');const link=document.createElement('a'),url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    async function exportClientPage(){
        if(busy||!report?.loaded)return;
        // Re-authorise on every export. Revoked permissions never serve a cached page.
        const selected={...report},c=context();busy=true;el('accountant-export').disabled=true;
        try{const data=await rpc('read',{owner:selected.owner,from:selected.from,to:selected.to,dataset:selected.dataset,page:selected.page},c);if(!data?.rows?.length)return;
            if(report?.owner!==selected.owner||el('accountant-from').value!==selected.from||el('accountant-to').value!==selected.to||el('accountant-dataset').value!==selected.dataset)return;
            const keys=Object.keys(data.rows[0]);downloadCsv('Earnavik-'+selected.dataset+'-page-'+(selected.page+1)+'.csv',[keys,...data.rows.map(r=>keys.map(k=>r[k]))]);
        }catch(e){if(current(c)){report=null;el('accountant-records').replaceChildren();el('accountant-client').classList.add('hidden');el('accountant-message').textContent=friendly(e);}}
        finally{if(current(c)){busy=false;el('accountant-export').disabled=!report?.loaded;}}
    }
    function cisIncome(){return appState.transactions.find(t=>t.type==='income'&&t.id===el('cis-income')?.value);}
    function updateCisPreview(){
        const income=cisIncome();if(!income){el('cis-preview').textContent='Select the gross income record for this payment.';return;}
        try{const p=cisPreview(income.grossAmount??income.amount,el('cis-vat').value,el('cis-materials').value,el('cis-rate').value);el('cis-preview').textContent='Gross payment '+money(income.grossAmount??income.amount)+' · CIS base '+money(p.base)+' · calculated deduction '+money(p.deducted)+' · expected bank receipt '+money(p.net)+'. Check this matches the contractor statement.';}
        catch(e){el('cis-preview').textContent=e.message;}
    }
    function renderCis(){
        const select=el('cis-income'),prior=select.value;select.replaceChildren(new Option('Choose existing gross income',''));
        const used=new Set((appState.cisDeductions||[]).map(c=>c.income_id));
        for(const t of appState.transactions.filter(t=>t.type==='income'&&!used.has(t.id)&&t.date>='2025-04-06'&&t.date<='2027-04-05'))select.appendChild(new Option(formatUkDate(t.date)+' · '+t.source+' · '+money(t.grossAmount??t.amount),t.id));
        if([...select.options].some(o=>o.value===prior))select.value=prior;
        const bounds=currentTaxYearBounds(),credits=cisDeductionsForRange(bounds.start,driverToday());el('cis-summary').textContent=bounds.label+' · CIS already deducted '+money(credits)+'. Credits reduce estimated tax, not your recorded income or profit.';
        const host=el('cis-list');host.replaceChildren();for(const record of appState.cisDeductions||[]){const box=document.createElement('div');box.className='rounded-xl border border-slate-700 p-3 space-y-2';
            const line=document.createElement('p');line.textContent=formatUkDate(record.paid_on)+' · '+record.contractor+' · deducted '+money(record.deducted_amount)+' · '+record.statement_reference;box.appendChild(line);
            const button=document.createElement('button');button.type='button';button.className=batchButton;button.textContent='Remove deduction';button.onclick=()=>removeCis(record.id);box.appendChild(button);host.appendChild(box);
        }if(!host.children.length)host.textContent='No CIS deductions saved.';updateCisPreview();
    }
    async function openCisCentre(){
        if(!appState.currentUser)return;
        const modal=batchModal('cis-centre','CIS — subcontractor deductions',`<p>Record tax a contractor has already withheld. First record the full gross payment as income, before CIS deduction (including any VAT). If a bank import contains only the net payment, correct that record rather than adding a second income.</p><p>Use a separate dated payment record for each deduction. This records statements; it does not verify subcontractors, issue CIS invoices, apply reverse-charge VAT or file contractor returns.</p><p id="cis-summary" class="font-bold"></p><form id="cis-form" class="space-y-3"><label class="block">Existing gross income<select id="cis-income" required class="${batchInput}"></select></label><label class="block">Contractor name<input id="cis-contractor" required maxlength="160" class="${batchInput}"></label><label class="block">Payment / deduction statement reference<input id="cis-reference" required maxlength="200" class="${batchInput}"></label><label class="block">VAT included in gross payment (£)<input id="cis-vat" type="number" min="0" max="1000000000" step="0.01" value="0" required class="${batchInput}"></label><p>VAT-registered businesses must classify this income in VAT first. The amount must match that classification or its VAT invoice.</p><label class="block">Actual eligible costs excluded from CIS (£)<input id="cis-materials" type="number" min="0" max="1000000000" step="0.01" value="0" required class="${batchInput}"></label><p>Use actual eligible materials and other costs agreed on the statement, not marked-up amounts. Exclude recoverable VAT; include irrecoverable VAT where applicable. Record eligible costs separately as expenses; this field does not create one.</p><label class="block">CIS deduction rate<select id="cis-rate" class="${batchInput}"><option value="20">20% — registered</option><option value="30">30% — unregistered</option><option value="0">0% — gross payment status</option></select></label><p id="cis-preview" role="status"></p><label class="block">Tax actually deducted on statement (£)<input id="cis-actual" type="number" min="0" max="1000000000" step="0.01" required class="${batchInput}"></label><label class="flex gap-2"><input id="cis-confirm" type="checkbox" required> I checked the statement, selected gross income (not the net bank payment), and have not recorded this deduction elsewhere as a payment or expense.</label><button id="cis-save" type="submit" class="${batchButton} w-full">Save CIS deduction</button></form><p id="cis-message" role="status" class="text-amber-200"></p><button id="cis-export" type="button" class="${batchButton}">Export CIS records</button><div id="cis-list" class="space-y-2"></div><a href="https://www.gov.uk/what-you-must-do-as-a-cis-contractor/make-deductions-and-pay-subcontractors" target="_blank" rel="noopener noreferrer" class="underline">HMRC deduction guidance</a>`);
        el('cis-form').onsubmit=saveCis;for(const id of ['cis-income','cis-vat','cis-materials','cis-rate'])el(id).onchange=()=>{if(id==='cis-income'){const t=cisIncome();el('cis-vat').value=Number(t?.vatAmount||0);el('cis-actual').value='';}updateCisPreview();};
        el('cis-export').onclick=()=>{const keys=['paid_on','contractor','statement_reference','gross_snapshot','vat_amount','materials_cost','rate','deducted_amount','income_id'];downloadCsv('Earnavik-CIS-records.csv',[keys,...(appState.cisDeductions||[]).map(c=>keys.map(k=>c[k]))]);};
        renderCis();el('cis-message').textContent=appState.cisLoaded?'':'CIS records have not loaded. Reconnect and refresh before saving.';el('cis-save').disabled=!appState.cisLoaded;showBatchModal(modal);
    }
    async function saveCis(event){
        event.preventDefault();if(busy||!appState.cisLoaded)return;const t=cisIncome();if(!t)return;const c=context();busy=true;el('cis-centre').dataset.busy='true';el('cis-save').disabled=true;
        try{const p=cisPreview(t.grossAmount??t.amount,el('cis-vat').value,el('cis-materials').value,el('cis-rate').value),actual=Number(el('cis-actual').value);
            if(el('cis-actual').value===''||actual!==p.deducted)throw Error('The actual deduction must match the calculation. Check gross income, VAT, eligible costs and the statement.');
            if(!el('cis-confirm').checked)throw Error('Confirm the payment and deduction statement first.');
            const payload={user_id:c.user,income_id:t.id,gross_snapshot:Number(t.grossAmount??t.amount),paid_on:t.date,contractor:el('cis-contractor').value.trim(),statement_reference:el('cis-reference').value.trim(),vat_amount:Number(el('cis-vat').value),materials_cost:Number(el('cis-materials').value),rate:Number(el('cis-rate').value),deducted_amount:actual,evidence_confirmed:true};
            const {error}=await supabaseClient.from('cis_deductions').insert(payload);if(!current(c))return;if(error)throw error;
            if(await fetchUserData(c.user)===false)throw Error('Saved, but refresh was incomplete. Reconnect and refresh before retrying.');if(!current(c))return;
            el('cis-form').reset();renderCis();el('cis-message').textContent='CIS deduction saved against existing gross income. No extra income or expense was created.';
        }catch(e){if(current(c))el('cis-message').textContent=friendly(e);}
        finally{if(current(c)){busy=false;el('cis-centre').dataset.busy='false';el('cis-save').disabled=!appState.cisLoaded;}}
    }
    async function removeCis(id){
        if(busy||!confirm('Remove this CIS deduction? Gross income stays saved; the estimated tax reserve will be recalculated.'))return;
        const c=context();busy=true;el('cis-centre').dataset.busy='true';
        try{const {error}=await supabaseClient.from('cis_deductions').delete().eq('user_id',c.user).eq('id',id);if(!current(c))return;if(error)throw error;
            if(await fetchUserData(c.user)===false)throw Error('Refresh incomplete. Reconnect and refresh.');if(!current(c))return;renderCis();el('cis-message').textContent='Deduction removed; gross income retained.';
        }catch(e){if(current(c))el('cis-message').textContent=friendly(e);}finally{if(current(c)){busy=false;el('cis-centre').dataset.busy='false';}}
    }
    Object.assign(window,{ensureAccountantCisTools,openAccountantCentre,openCisCentre,resetAccountantCis});
})();
