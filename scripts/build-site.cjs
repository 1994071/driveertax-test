// Only application assets belong in the public deploy.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'dist');
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out);
for(const file of ['index.html','invoice-workspace.js','invoice-reminders.js','owner-push.js','owner-push-sw.js','manifest.webmanifest','bookkeeping-workspace.js','uber-workspace.js','bank-pdf-workspace.js','_headers'])fs.copyFileSync(path.join(root,file),path.join(out,file));
console.log('Built app and security headers.');

fs.cpSync(path.join(root,'icons'),path.join(out,'icons'),{recursive:true});
