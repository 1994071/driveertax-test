import {PDFDocument} from 'npm:pdf-lib@1.17.1';
import {getDocumentProxy} from 'npm:unpdf@1.9.1';
import {MAX_PDF_PAGES} from './validation.ts';
// Most bank statements use standard PDF; some have permissions encryption but
// open without a password. PDF.js actually decrypts those with the empty password.
// Never treat ignoreEncryption as decryption or send an unreadable file to AI.
export async function inspectPdf(bytes:Uint8Array):Promise<{pages:number,text?:string}>{
 try{const pdf=await PDFDocument.load(bytes,{ignoreEncryption:false,updateMetadata:false});return {pages:pdf.getPageCount()};}
 catch(error){
  if((error as Error)?.name!=='EncryptedPDFError'&&!/encrypted/i.test((error as Error)?.message||''))throw Error('The PDF could not be opened. Download a fresh statement or use a bank CSV.');
 }
 let pdf;
 try{pdf=await getDocumentProxy(bytes.slice(),{password:'',verbosity:0,isEvalSupported:false,useSystemFonts:false});}
 catch(error){if((error as Error)?.name==='PasswordException')throw Error('This PDF needs an opening password. Export an unlocked copy from your bank or use CSV.');throw Error('The encrypted PDF could not be opened. Export an unlocked copy or use a bank CSV.');}
 try{
  if(pdf.numPages>MAX_PDF_PAGES)return {pages:pdf.numPages};
  const pages=[];let size=0;
  for(let n=1;n<=pdf.numPages;n++){
   const page=await pdf.getPage(n),content=await page.getTextContent();
   const items=content.items.filter((x:any)=>typeof x.str==='string'&&x.str.trim()).map((x:any)=>({text:x.str,x:Math.round(x.transform[4]),y:Math.round(x.transform[5])}));
   const encoded=JSON.stringify({page:n,items});size+=encoded.length;
   if(size>300000)throw Error('The complete PDF has too much text. Use a shorter statement or CSV.');
   if(items.reduce((sum:number,x:any)=>sum+x.text.length,0)<40)throw Error('Some encrypted PDF pages cannot be read as text. Export an unlocked copy or use CSV.');
   pages.push(encoded);
  }
  return {pages:pdf.numPages,text:pages.join('\n')};
 }finally{await pdf.loadingTask.destroy();}
}
