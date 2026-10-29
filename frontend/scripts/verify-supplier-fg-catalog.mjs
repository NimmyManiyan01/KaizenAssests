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
const output=path.resolve('scratch/fg-supplier-catalog');
await mkdir(output,{recursive:true});

try {
  await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
  const token='supplier-mock-token-4ba750d2-579f-4efb-b6ef-6fe86b68b575-b6151813-3a0b-44de-a168-d4e8d1e95a8d';
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('auth_token',${JSON.stringify(token)});localStorage.setItem('user_info',${JSON.stringify(JSON.stringify({token,username:'supplier',roles:['SUPPLIER']}))});`});
  await send('Page.navigate',{url:'http://localhost:8080/supplier/dispatch'});
  await wait(`document.body.innerText.includes('Dispatch history') && document.querySelector('button') && Object.keys(document.querySelector('button')).some(k=>k.startsWith('__reactProps$'))`);
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Create Dispatch').click()`);
  await wait(`document.querySelector('select[id^="finished-good-"]')?.options.length===7`);
  const options=await evaluate(`[...document.querySelector('select[id^="finished-good-"]').options].filter(o=>o.value).map(o=>({text:o.text,value:o.value,disabled:o.disabled}))`);
  assert.equal(options.length,6);
  assert.equal(options.filter(o=>o.disabled).length,5);
  const ready=options.find(o=>o.text.includes('FG-0003'));assert.ok(ready&&!ready.disabled);
  assert.ok(options.filter(o=>o.disabled).every(o=>o.text.includes('Assembly must create transport sections')));
  await evaluate(`const e=document.querySelector('select[id^="finished-good-"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,${JSON.stringify(ready.value)});e.dispatchEvent(new Event('change',{bubbles:true}))`);
  await wait(`document.body.innerText.includes('FG ID: FG-0003 - Remaining sections: 8')`);
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('PASS Supplier browser dropdown: all 6 FGs visible; 5 historical entries explain missing sections; FG-0003 selectable with 8 remaining sections');
  await writeFile(path.join(output,'verification.json'),JSON.stringify({options,errors,selected:'FG-0003',remaining:8},null,2));
} catch(e){console.error(e.stack);process.exitCode=1;}
finally{await writeFile(path.join(output,'page.txt'),await evaluate('document.body.innerText').catch(()=>''));ws.close();clearInterval(keepAlive);}
