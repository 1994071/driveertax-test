const fs=require('fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const html=fs.readFileSync(__dirname+'/../index.html','utf8'),main=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).find(x=>x.includes('let appState'));
(async()=>{const browser=await chromium.launch({executablePath:process.env.TEST_CHROMIUM_PATH});try{
const page=await browser.newPage({viewport:{width:390,height:740},isMobile:true,hasTouch:true}),errors=[];
page.on('pageerror',e=>(errors.push(e.message),console.error(e.message)));await page.route('**/*',r=>r.abort());
await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,''));
if(process.env.TEST_TAILWIND_PATH)await page.addScriptTag({content:fs.readFileSync(process.env.TEST_TAILWIND_PATH,'utf8')});
await page.addScriptTag({content:`if(!crypto.randomUUID)crypto.randomUUID=()=> "10000000-1000-4000-8000-100000000000";window.calls=[];window.supabase={createClient:()=>({auth:{resetPasswordForEmail:async(email,options)=>{calls.push({type:'reset',email,options});return {error:null}},signUp:async(args)=>{calls.push({type:'signup',args});return {data:{user:{id:'test'}},error:null}},signInWithPassword:async(args)=>{calls.push({type:'signin',args});return {error:{message:'Test sign-in response'}}}}})};`});
await page.addScriptTag({content:main});
for(const [width,height] of [[390,740],[320,568]]){
await page.setViewportSize({width,height});
for(const mode of ['signin','signup','forgot']){
await page.evaluate(mode=>switchAuthMode(mode),mode);
assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');

if(width===390)assert.ok(await page.evaluate(()=>{const s=document.getElementById('auth-screen');return s.scrollHeight<=s.clientHeight+1;}),`${mode} fits ${width}x${height}`);
}
}
await page.setViewportSize({width:390,height:740});await page.evaluate(()=>switchAuthMode('signin'));
await page.locator('#auth-email').fill('test@example.test');await page.locator('#auth-tab-forgot').click();
assert.equal(await page.locator('#auth-providers').isVisible(),false);
assert.equal(await page.locator('#auth-password').isDisabled(),true);
assert.equal(await page.locator('#auth-email').inputValue(),'test@example.test');
await page.locator('#auth-submit-btn').click();await page.waitForFunction(()=>calls.some(c=>c.type==='reset'));
assert.match(await page.locator('#auth-success').innerText(),/reset email sent/);
await page.locator('#auth-tab-signin').click();await page.locator('#auth-tab-signup').click();
await page.locator('#auth-name').fill('Test Person');await page.locator('#auth-password').fill('example-pass');
assert.equal(await page.locator('#auth-password').getAttribute('autocomplete'),'new-password');
await page.locator('#auth-submit-btn').click();await page.waitForFunction(()=>calls.some(c=>c.type==='signup'));
assert.equal(await page.locator('#auth-heading').innerText(),'Welcome back');
assert.equal(await page.locator('#auth-submit-btn').innerText(),'Sign in');
assert.equal(await page.locator('#auth-password').getAttribute('autocomplete'),'current-password');
await page.locator('#auth-submit-btn').click();await page.waitForFunction(()=>calls.some(c=>c.type==='signin'));
assert.match(await page.locator('#auth-error').innerText(),/Test sign-in response/);
await page.screenshot({path:'/tmp/earnavik-compact-auth.png'});
await page.setViewportSize({width:320,height:400});await page.evaluate(()=>switchAuthMode('signup'));
assert.ok(await page.evaluate(()=>{const s=document.getElementById('auth-screen');return s.scrollHeight>s.clientHeight;}),'short keyboard-height screen allows scrolling');
assert.deepEqual(errors,[]);console.log('PASS compact auth: mobile fit, keyboard scrolling, email retention, reset without password, signup confirmation, signin errors. Providers mocked.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
