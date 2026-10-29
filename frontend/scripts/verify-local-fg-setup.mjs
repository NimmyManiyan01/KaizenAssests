import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const backup = path.resolve('../backend/business-service/backups/fg-safe-clone-202610290741304887b0');
const fixture = JSON.parse(await readFile(path.join(backup, 'local-fg-verification.json'), 'utf8'));
assert.ok(fixture.fg_id && fixture.sections?.length === 8);
const status = await (await fetch('http://localhost:8000/api/local/fg-clone-status')).json();
assert.equal(status.database, 'kaizenassests_test_fg_clone_202610290741304887b0');
const pages = await (await fetch('http://127.0.0.1:18097/json/list')).json();
const page = pages.find(p => p.type === 'page' && !p.url.startsWith('chrome:'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
const keepAlive = setInterval(()=>{},1000);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let seq = 0;
const pending = new Map(), errors = [], api = [], passed = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p?.reject(new Error(JSON.stringify(m.error))) : p?.resolve(m.result); }
  else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  else if (m.method === 'Network.responseReceived' && m.params.response.url.includes(':8000/api/v1/assembly/')) api.push({url:m.params.response.url,status:m.params.response.status});
};
function send(method, params={}) { return new Promise((resolve,reject) => { const id=++seq; pending.set(id,{resolve,reject}); ws.send(JSON.stringify({id,method,params})); setTimeout(()=>{if(pending.has(id)){pending.delete(id);reject(new Error('CDP timeout '+method));}},120000).unref(); }); }
async function evaluate(expression) { const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true}); if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; }
async function wait(expression) { const end=Date.now()+120000; while(Date.now()<end){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,250));} throw new Error('UI timeout '+expression); }
function note(s){passed.push(s);console.log('PASS '+s);}
const output=path.resolve('scratch/fg-local-setup-browser');
await mkdir(output,{recursive:true});
try {
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('auth_token','local_dev_mock_token');localStorage.setItem('user_info',${JSON.stringify(JSON.stringify({token:'local_dev_mock_token',username:'Local Setup Verification',roles:['ASSEMBLY']}))});`});
  await send('Page.navigate',{url:'http://localhost:8080/assembly/finished-goods'});
  await wait(`document.body.innerText.includes(${JSON.stringify(fixture.product_name)})`);
  assert.equal(await evaluate(`document.body.innerText.includes('FG section workflow requires database migrations')`),false);
  assert.equal(await evaluate(`document.body.innerText.includes('FG Loading')`),true);
  await wait(`document.body.innerText.includes('No arrived FG pickup vehicles.')`);
  assert.ok(api.some(r=>r.url.endsWith('/fg-loading')&&r.status===200));
  assert.ok(api.some(r=>r.url.includes('/finished-goods?')&&r.status===200));
  note('Actual localhost:8080 Assembly page uses clone backend; FG Loading HTTP 200; migration error absent');
  await evaluate(`window.fgSetup={button(t,scope=document){const b=[...scope.querySelectorAll('button')].find(b=>b.textContent.trim()===t);if(!b)throw Error('Missing button '+t);b.click()},fill(s,v){const e=document.querySelector(s);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))}};true`);
  await evaluate(`fgSetup.button('View Details',[...document.querySelectorAll('tr')].find(r=>r.innerText.includes(${JSON.stringify(fixture.product_name)})))`);
  await wait(`document.querySelector('[role="dialog"]')!==null`);
  await evaluate(`fgSetup.button('Scan FG QR',[...document.querySelectorAll('tr')].find(r=>r.innerText.includes(${JSON.stringify(fixture.batch_number)})))`);
  await wait(`document.querySelector('#fg-traceability-qr')!==null`);
  await evaluate(`fgSetup.fill('#fg-traceability-qr',${JSON.stringify(fixture.qr_code)})`);
  await evaluate(`fgSetup.button('Verify QR')`);
  await wait(`document.querySelector('#section-verify')!==null`);
  const ids=await evaluate(`[...document.querySelectorAll('[role="dialog"] img[alt^="QR FG-"]')].map(i=>i.alt.slice(3))`);
  assert.deepEqual(ids,fixture.sections.map(s=>s.sub_id));
  note('New QC-approved Main FG QR verifies and displays all eight correct Sub-ID QR labels');
  await wait(`[...document.querySelectorAll('[role="dialog"] img[alt^="QR FG-"]')].every(i=>i.complete&&i.naturalWidth>0)`);
  assert.equal(errors.length,0,errors.join('\n'));
  note('All eight Sub-ID QR images load; no browser JavaScript exceptions');
  const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await writeFile(path.join(output,'assembly-eight-sections.png'),Buffer.from(screenshot.data,'base64'));
} catch(e) { console.error(e.stack); process.exitCode=1; errors.push(e.message); }
finally {
  await writeFile(path.join(output,'verification.json'),JSON.stringify({database:status.database,passed,errors,api},null,2));
  await writeFile(path.join(output,'page.txt'),await evaluate('document.body.innerText').catch(()=>''));
  ws.close();
  clearInterval(keepAlive);
}
