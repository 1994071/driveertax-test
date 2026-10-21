// Only application assets belong in the public deploy.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'dist');
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out);
for(const file of ['index.html','invoice-workspace.js','_headers'])fs.copyFileSync(path.join(root,file),path.join(out,file));
console.log('Built app and security headers.');
