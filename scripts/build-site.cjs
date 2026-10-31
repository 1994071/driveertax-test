// Only application assets belong in the public deploy.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'dist');
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out);
for(const file of ['index.html','invoice-workspace.js','invoice-reminders.js','owner-push.js','owner-push-sw.js','manifest.webmanifest','bookkeeping-workspace.js','uber-workspace.js','bank-pdf-workspace.js','accountant-cis.js','job-photos.js','job-trade-guidance.js','home-workspace.js','daily-bookkeeping.js','receptionist-workspace.js','home-workspace.css','_headers'])fs.copyFileSync(path.join(root,file),path.join(out,file));
console.log('Built app and security headers.');

fs.cpSync(path.join(root,'icons'),path.join(out,'icons'),{recursive:true});

// Bundle notification setup with the page so a separate script load cannot leave disabled controls without feedback.
const htmlPath=path.join(out,'index.html');
fs.writeFileSync(htmlPath,fs.readFileSync(htmlPath,'utf8').replace('<script src="owner-push.js"></script>','<script data-earnavik-owner-notifications>\n'+fs.readFileSync(path.join(root,'owner-push.js'),'utf8')+'\n</script>'));

// Every local script referenced by the deployed page must exist in this snapshot.
for (const match of fs.readFileSync(htmlPath,'utf8').matchAll(/<script[^>]+src=["']([^"']+)["']/g)) {
 const src=match[1];
 if (/^(https?:)?\/\//.test(src)) continue;
 if (!fs.existsSync(path.join(out,src))) throw new Error('Missing deployed script: '+src);
}
