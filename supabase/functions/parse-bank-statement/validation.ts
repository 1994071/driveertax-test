export const MAX_PDF_BYTES=5*1024*1024,MAX_PDF_PAGES=10,MAX_PDF_ROWS=200;
export function amountPence(value:unknown):number {
 if(typeof value!=='string'||! /^-?(?:0|[1-9]\d{0,9})\.\d{2}$/.test(value))throw Error('Some amounts could not be read reliably. Try a clearer PDF or a CSV statement.');
 const n=Math.round(Number(value)*100);if(!Number.isSafeInteger(n))throw Error('Invalid statement amount.');return n;
}
export function validateExtraction(data:any,today=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).split('/').reverse().join('-')){
 if(data?.document_type!=='bank_statement')throw Error('Choose a bank transaction statement, rather than a tax summary, invoice or receipt.');
 if(data.currency!=='GBP')throw Error('Only single-account GBP bank statements are supported.');
 if(data.complete!==true)throw Error('The complete statement could not be read. Try a clearer PDF, a shorter statement or CSV.');
 if(!Array.isArray(data.transactions)||!data.transactions.length||data.transactions.length>MAX_PDF_ROWS)throw Error('Use a PDF with between 1 and 200 transactions.');
 const rows=data.transactions.map((r:any)=>{
  if(typeof r.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||!Number.isFinite(Date.parse(r.date))||new Date(r.date).toISOString().slice(0,10)!==r.date||r.date>today)throw Error('A transaction date could not be read reliably. Try a clearer PDF or CSV.');
  if(typeof r.description!=='string'||!r.description.trim()||r.description.length>500)throw Error('A transaction description could not be read reliably.');
  const pence=amountPence(r.amount);if(!pence)throw Error('A zero-value transaction needs checking. Try a CSV statement.');
  return {date:r.date,description:r.description.trim(),amount:(pence/100).toFixed(2)};
 });
 const opening=data.opening_balance===null?null:amountPence(data.opening_balance),closing=data.closing_balance===null?null:amountPence(data.closing_balance);
 const difference=opening===null||closing===null?null:opening+rows.reduce((s:number,r:any)=>s+amountPence(r.amount),0)-closing;
 return {rows,opening_balance:opening===null?null:(opening/100).toFixed(2),closing_balance:closing===null?null:(closing/100).toFixed(2),balance_difference:difference===null?null:(difference/100).toFixed(2)};
}
export const extractionSchema={"type":"object","additionalProperties":false,"required":["document_type","currency","complete","opening_balance","closing_balance","transactions"],"properties":{"document_type":{"type":"string","enum":["bank_statement","other"]},"currency":{"type":"string","enum":["GBP","other"]},"complete":{"type":"boolean"},"opening_balance":{"type":["string","null"]},"closing_balance":{"type":["string","null"]},"transactions":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["date","description","amount"],"properties":{"date":{"type":"string"},"description":{"type":"string"},"amount":{"type":"string"}}}}}};
