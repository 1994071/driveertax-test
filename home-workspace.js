/* Home presents existing calculated values; detailed workflows retain their IDs and handlers. */
(()=>{
 const $=id=>document.getElementById(id);
 function renderCompactHome(){
  if(!$('home-invoices-summary'))return;
  const unpaid=(appState.invoices||[]).filter(i=>i.status==='unpaid'&&!i.archived),today=driverToday();
  const amount=unpaid.reduce((sum,i)=>sum+Number(i.total||0),0),overdue=unpaid.filter(i=>i.due_date<today).length;
  $('home-invoices-summary').textContent=unpaid.length?unpaid.length+' unpaid · £'+amount.toFixed(2):'No unpaid invoices';
  $('home-invoices-alert').textContent=overdue?overdue+' overdue':'';
  const t=getTaxYearSummary();$('home-tax-year-title').textContent='Tax year '+t.label;$('home-tax-preview').textContent='Est. reserve £'+Number(t.total||0).toFixed(2);
  const tab=appState.activeTab==='scan'?'tools':appState.activeTab||'dashboard';
  for(const b of document.querySelectorAll('#earnavik-shell > nav .nav-btn')){if(b.id==='nav-'+tab)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}
 }
 Object.assign(window,{renderCompactHome});
 renderCompactHome();
})();
