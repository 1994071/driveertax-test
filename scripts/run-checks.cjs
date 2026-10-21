// All provider calls are mocked. This runner never needs production credentials.
const {spawnSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=path.resolve(__dirname,'..');
const checks=['paged-cloud-checks','tax-payment-refresh-checks','privacy-health-checks','privacy-request-checks','reliability-security-checks','edge-security-checks','invoice-checks','invoice-centre-vat-checks','bookkeeping-batch-checks','scottish-relief-checks','expense-tax-checks','tax-history-checks','hmrc-reference-examples','paye-onboarding-checks','onboarding-refresh-checks','trade-income-services-checks','receipt-items-edge-checks','invoice-discount-checks'];
const browserChecks=['receipt-upload-browser','catchup-save-browser','tax-payment-browser','delete-summary-browser','clear-records-browser-checks','invoice-selection-browser','invoice-workspace-browser'];
function execute(file,args=[],env=process.env){const r=spawnSync(process.execPath,[file,...args],{cwd:root,env,stdio:'inherit',timeout:120000});if(r.error)throw r.error;if(r.status!==0)throw new Error(path.basename(file)+' failed');}
try{
 if(process.argv.includes('--browser')){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'earnavik-css-'));
  try{
   fs.writeFileSync(path.join(tmp,'input.css'),'@tailwind base;\n@tailwind components;\n@tailwind utilities;');
   execute(require.resolve('tailwindcss/lib/cli.js'),['-i',path.join(tmp,'input.css'),'-o',path.join(tmp,'app.css'),'--content',path.join(root,'index.html')+','+path.join(root,'invoice-workspace.js'),'--minify']);
   const css=fs.readFileSync(path.join(tmp,'app.css'),'utf8'),loader=path.join(tmp,'styles.js');
   fs.writeFileSync(loader,'document.head.appendChild(Object.assign(document.createElement("style"),{textContent:'+JSON.stringify(css)+'}));');
   for(const test of browserChecks)execute(path.join(root,'tests',test+'.cjs'),[],{...process.env,TEST_TAILWIND_PATH:loader});
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
 }else for(const test of checks)execute(path.join(root,'tests',test+'.cjs'));
 console.log('All '+(process.argv.includes('--browser')?browserChecks.length:checks.length)+' selected suites passed.');
}catch(error){console.error(error.message);process.exitCode=1;}
