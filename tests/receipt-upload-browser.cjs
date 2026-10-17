const fs = require('fs');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const main = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x => x[1]).find(x => x.includes('let appState'));
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.TEST_CHROMIUM_PATH });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', r => r.abort());
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ''));
    await page.addStyleTag({ content: '.hidden{display:none!important}' });
    if (process.env.TEST_TAILWIND_PATH) await page.addScriptTag({ content: fs.readFileSync(process.env.TEST_TAILWIND_PATH, 'utf8') });
    await page.addScriptTag({ content: `
      crypto.randomUUID=()=> '00000000-0000-4000-8000-000000000001';
      window.uploads=[];window.saves=[];window.failUpload=false;window.failScan=false;window.failSave=false;window.exactMatch=false;
      window.supabase={createClient:()=>({
        from:table=>{const q={select:()=>q,eq:()=>q,limit:async()=>({data:exactMatch?[{id:'existing'}]:[]}),then:resolve=>Promise.resolve({data:[]}).then(resolve)};return q;},
        storage:{from:()=>({upload:async(path,file)=>{uploads.push({path,type:file.type});return failUpload?{error:{message:'Offline'}}:{error:null};}})},
        functions:{invoke:async()=>failScan?{error:{message:'Scanner unavailable'}}:{data:{data:{merchant:'Shop',date:'2026-10-17',amount:20,vat:null,category:'Other',confidence:.9,items:[]}}}},
        rpc:async(name,args)=>{saves.push(args);return failSave?{error:{message:'Offline'}}:{data:'expense-id'};}
      })};
    ` });
    await page.addScriptTag({ content: main });
    await page.evaluate(() => {
      appState.currentUser = { id: 'owner' }; appState.profile = {}; appState.transactions = [];
      showToast = text => window.toast = text; fetchUserData = async () => {}; switchTab = () => {};
      receiptFileHash = async () => 'test-image-hash';
    });
    assert.equal(await page.locator('#receipt-file-input').getAttribute('capture'), 'environment');
    assert.equal(await page.locator('#receipt-gallery-input').getAttribute('capture'), null);
    const choose = (name, mimeType, buffer = Buffer.from('image')) => page.locator('#receipt-gallery-input').setInputFiles({ name, mimeType, buffer });
    await choose('receipt.heic', 'image/heic');
    assert.match(await page.evaluate(() => toast), /convert.*HEIC/);
    assert.equal(await page.evaluate(() => uploads.length), 0);
    await choose('empty.jpg', 'image/jpeg', Buffer.alloc(0));
    assert.match(await page.evaluate(() => toast), /empty/);
    await choose('big.jpg', 'image/jpeg', Buffer.alloc(10 * 1024 * 1024 + 1));
    assert.match(await page.evaluate(() => toast), /10 MB/);
    assert.equal(await page.evaluate(() => uploads.length), 0);
    await page.evaluate(() => failUpload = true);
    await choose('receipt.png', 'image/png');
    await page.waitForFunction(() => !appState.receiptScanning);
    assert.match(await page.locator('#receipt-scan-status').textContent(), /retry/);
    assert.equal(await page.locator('#receipt-gallery-input').inputValue(), '');
    await page.evaluate(() => { failUpload = false; failScan = true; exactMatch = true; });
    await choose('receipt.png', 'image/png');
    await page.waitForFunction(() => !appState.receiptScanning);
    assert.match(await page.locator('#receipt-scan-status').textContent(), /enter or correct/);
    assert.equal(await page.locator('#receipt-review-card').isVisible(), false); // scanner tab is still hidden
    assert.equal(await page.locator('#receipt-review-card').evaluate(el => el.classList.contains('hidden')), false);
    assert.equal(await page.locator('#receipt-duplicate-warning').evaluate(el => el.classList.contains('hidden')), false);
    await page.evaluate(() => { failScan = false; cancelReceiptReview(); document.getElementById('view-scan').classList.remove('hidden'); });
    await choose('receipt.weird', 'image/jpeg');
    await page.waitForFunction(() => !appState.receiptScanning);
    assert.match(await page.evaluate(() => uploads.at(-1).path), /\.jpg$/);
    assert.equal(await page.locator('#receipt-amount').inputValue(), '20.00');
    await page.evaluate(() => confirmReceiptExpense());
    assert.equal(await page.evaluate(() => saves.length), 0);
    await page.evaluate(() => failSave = true);
    await page.evaluate(() => savePossibleDuplicateReceipt());
    await page.waitForFunction(() => !appState.receiptSaving);
    assert.match(await page.locator('#receipt-validation-msg').textContent(), /retry/);
    assert.equal(await page.locator('#receipt-amount').inputValue(), '20.00');
    await page.evaluate(() => failSave = false);
    await page.evaluate(() => savePossibleDuplicateReceipt());
    await page.waitForFunction(() => !appState.receiptSaving);
    assert.equal(await page.evaluate(() => saves.at(-1).p_receipt.duplicate_override), true);
    assert.equal(await page.evaluate(() => toast), 'Receipt confirmed and expense saved');
    assert.deepEqual(errors, []);
    console.log('PASS: separate camera/gallery inputs, unsupported/empty/oversize rejection before upload, retry selection, AI fallback, duplicate override and failed-save retention. Mocked services; no live AI calls or financial writes.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
