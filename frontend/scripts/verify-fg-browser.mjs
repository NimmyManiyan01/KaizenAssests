import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve('scratch/fg-final-browser', String(Date.now()));
console.log('Browser evidence '+root);
await mkdir(root, {recursive:true});
const pages = await (await fetch('http://127.0.0.1:18097/json/list')).json();
const page = pages.find(p => p.type === 'page' && !p.url.startsWith('chrome:'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
let id=0; const pending=new Map(); const errors=[]; const passed=[];
ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(new Error(JSON.stringify(m.error))):p?.resolve(m.result)} else if(m.method==='Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text)};
function send(method,params={}) {return new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});ws.send(JSON.stringify({id:key,method,params}));setTimeout(()=>{if(pending.has(key)){pending.delete(key);reject(new Error(`CDP timeout ${method}`))}},45000).unref()})}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value}
async function wait(expression,timeout=45000){const started=Date.now();while(Date.now()-started<timeout){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,300))}throw new Error(`UI timeout: ${expression}`)}
const helpers=`window.fgVerify = {
  button(text,scope=document){const b=[...scope.querySelectorAll('button')].find(b=>b.textContent.trim()===text);if(!b)throw Error('Missing button '+text); b.click()},
  fill(selector,value){const e=document.querySelector(selector);if(!e)throw Error('Missing input '+selector);const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))}
};`;
async function open(route,role){await send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('auth_token','local_dev_mock_token');localStorage.setItem('user_info',${JSON.stringify(JSON.stringify({token:'local_dev_mock_token',username:fixture.supplier,roles:[role]}))});`});await send('Page.navigate',{url:`http://127.0.0.1:18095${route}`});await wait(`document.readyState==='complete' && document.querySelector('button')!==null`,90000);await evaluate(helpers);await wait(`document.querySelector('button') && Object.keys(document.querySelector('button')).some(k=>k.startsWith('__reactProps$'))`,90000)}
async function note(s){passed.push(s);console.log('PASS '+s)}
const fixture=await(await fetch('http://127.0.0.1:18096/__verify_fg_fixture')).json();
await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
await send('Network.setBlockedURLs',{urls:['http://localhost:8000/*','http://127.0.0.1:8000/*']});
await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:root,eventsEnabled:true});
try {
  if(process.argv[2]==='inspect') {
    await open(process.argv[3]||'/assembly/finished-goods',process.argv[4]||'ASSEMBLY');
    await new Promise(r=>setTimeout(r,3000));
    console.log(await evaluate(`document.body.innerText`));
  } else if(process.argv[2]==='snapshot') {
    console.log(await evaluate(`document.body.innerText`));
    console.log(await evaluate(`[...document.querySelectorAll('button')].filter(e=>e.textContent.includes('Create Dispatch')).map(e=>({text:e.textContent,disabled:e.disabled}))`));
    console.log(await evaluate(`[...document.querySelectorAll('input,select')].map(e=>({id:e.id,value:e.value,valid:e.validity.valid,reactValue:e[Object.keys(e).find(k=>k.startsWith('__reactProps$'))]?.value}))`));
  } else if(process.argv[2]==='flow') {
    const read=async endpoint=>(await fetch('http://127.0.0.1:18096'+endpoint,{headers:{'X-User-Roles':'ADMIN'}})).json();
    for(let index=0;index<2;index++) {
      const vehicle=`KA02AH${6781+index}`;
      const chosen=index===0?fixture.sections.slice(0,3):fixture.sections.slice(3);
      if(index===1) {
        await open('/supplier/dispatch','SUPPLIER');
        await wait(`document.body.innerText.includes('dispatches.')`);
        await evaluate(`fgVerify.button('Create Dispatch')`);
        await wait(`document.querySelector('select[id^="finished-good-"] option[value]:not([value=""])')!==null`);
        const value=await evaluate(`[...document.querySelector('select[id^="finished-good-"]').options].find(o=>o.value).value`);
        await evaluate(`fgVerify.fill('select[id^="finished-good-"]',${JSON.stringify(value)})`);
        await wait(`document.body.innerText.includes('Remaining sections: 5')`);
        await evaluate(`fgVerify.fill('input[id^="vehicle-number-"]',${JSON.stringify(vehicle)});fgVerify.fill('input[id^="driver-name-"]','Browser Driver');fgVerify.fill('input[id^="driver-contact-"]','9876543210');fgVerify.fill('#pickup-date',${JSON.stringify(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()))})`);
        await wait(`document.querySelector('[role="dialog"] button[type="submit"]')?.disabled===false`);
        await evaluate(`fgVerify.button('Create Dispatch',document.querySelector('[role="dialog"]'))`);
        await wait(`document.querySelector('[role="dialog"]')===null`);
        await note('Second supplier vehicle registration shows five remaining sections');
      }
      const requests=await read('/api/v1/assembly/supplier/finished-goods-dispatch-requests');
      const request=requests.find(r=>r.fg_id===fixture.fg_id&&r.vehicle_number===vehicle);
      assert.ok(request,'Supplier registration persisted');
      let pass=request.gate_pass_number;
      if(!pass) {
      await open('/gate/finished-goods-pickup','GATE_SECURITY');
      await wait(`document.body.innerText.includes(${JSON.stringify(request.request_number)})`);
      await evaluate(`fgVerify.button('FG Entry')`);
      await wait(`document.querySelector('#pickup-request')!==null`);
      await evaluate(`fgVerify.fill('#pickup-request',${JSON.stringify(request.request_number)})`);
      await evaluate(`document.querySelector('#pickup-request').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
      await wait(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Generate Pickup Gate Pass')?.disabled===false`);
      assert.equal(await evaluate(`document.querySelector('#pickup-driver').value`),'Browser Driver');
      await evaluate(`fgVerify.button('Generate Pickup Gate Pass')`);
      await wait(`document.body.innerText.includes('Pickup gate pass generated:')`);
      const withEntry=(await read('/api/v1/assembly/supplier/finished-goods-dispatch-requests')).find(r=>r.id===request.id);
      pass=withEntry.gate_pass_number;assert.ok(pass);
      await note(`Gate Entry verifies vehicle/driver and creates Gate Pass for vehicle ${index+1}`);
      }
      await open('/assembly/finished-goods','ASSEMBLY');
      await wait(`document.querySelector(${JSON.stringify('#load-'+pass)})!==null`);
      await evaluate(`window.__visit=document.querySelector(${JSON.stringify('#load-'+pass)}).closest('.border.p-3');true`);
      assert.equal(await evaluate(`__visit.querySelectorAll('input[type="checkbox"]').length`),8);
      for(const section of chosen) await evaluate(`[...__visit.querySelectorAll('label')].find(l=>l.textContent.includes(${JSON.stringify(section.sub_id)})).querySelector('input').click()`);
      await evaluate(`const e=__visit.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(chosen.map(s=>s.qr_identity).join('\n'))});e.dispatchEvent(new Event('input',{bubbles:true}))`);
      await evaluate(`fgVerify.button('Confirm loading and ready for Gate Exit',__visit)`);
      await wait(`document.querySelector(${JSON.stringify('#load-'+pass)}).closest('.border.p-3').innerText.includes('READY_FOR_GATE_EXIT')`);
      const loaded=await read('/api/v1/assembly/finished-goods/'+fixture.fg_id);
      assert.equal(loaded.dispatched_sections,index===0?0:3);
      assert.equal(await evaluate(`[...document.querySelector(${JSON.stringify('#load-'+pass)}).closest('.border.p-3').querySelectorAll('button')].find(b=>b.textContent.trim()==='Confirm loading and ready for Gate Exit').disabled`),true);
      await note(`Assembly selects and verifies ${chosen.length} sections; loading does not dispatch; repeat loading disabled`);
      await open('/gate/finished-goods-pickup','GATE_SECURITY');
      await wait(`document.body.innerText.includes(${JSON.stringify(request.request_number)})`);
      await evaluate(`fgVerify.button('Exit Vehicle')`);
      await wait(`document.querySelector('#fg-exit-pass')!==null`);
      await evaluate(`fgVerify.fill('#fg-exit-pass',${JSON.stringify(pass)})`);
      await evaluate(`fgVerify.button('Verify',document.querySelector('[role="dialog"]'))`);
      await wait(`document.querySelector('#exit-section-scan')!==null`);
      for(const section of chosen) {
        await evaluate(`fgVerify.fill('#exit-section-scan',${JSON.stringify(section.qr_identity)})`);
        await evaluate(`fgVerify.button('Verify section',document.querySelector('[role="dialog"]'))`);
        await wait(`document.querySelector('#exit-section-scan').value===''`);
      }
      await evaluate(`document.querySelector('[role="dialog"] input[type="checkbox"]').click()`);
      await wait(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Confirm Exit')?.disabled===false`);
      await evaluate(`fgVerify.button('Confirm Exit')`);
      await wait(`document.querySelector('[role="dialog"]')===null`);
      const exited=await read('/api/v1/assembly/finished-goods/'+fixture.fg_id);
      assert.equal(exited.dispatched_sections,index===0?3:8);
      assert.equal(exited.dispatch_status,index===0?'PARTIALLY_DISPATCHED':'FULLY_DISPATCHED');
      assert.equal(exited.qr_code,fixture.qr_code);
      await note(`Gate Exit via actual UI: ${exited.dispatch_status} (${exited.dispatched_sections}/8), original Main FG QR preserved`);
    }
  } else {
    if(process.argv[2]!=='supplier') {
    await open('/assembly/finished-goods','ASSEMBLY');
    await wait(`document.body.innerText.includes(${JSON.stringify(fixture.product_name)})`);
    await evaluate(`fgVerify.button('View Details',[...document.querySelectorAll('tr')].find(r=>r.innerText.includes(${JSON.stringify(fixture.product_name)})))`);
    await wait(`document.querySelector('[role="dialog"]')!==null`);
    await evaluate(`fgVerify.button('Scan FG QR',[...document.querySelectorAll('tr')].find(r=>r.innerText.includes(${JSON.stringify(fixture.batch_number)})))`);
    await wait(`document.querySelector('#fg-traceability-qr')!==null`);
    await evaluate(`fgVerify.fill('#fg-traceability-qr',${JSON.stringify(fixture.qr_code)})`);
    await evaluate(`fgVerify.button('Verify QR')`);
    await wait(`document.querySelector('#section-verify')!==null`);
    const expected=fixture.sections.map(s=>s.sub_id);
    const labels=await evaluate(`[...document.querySelectorAll('[role="dialog"] img[alt^="QR FG-"]')].map(i=>i.alt.slice(3))`);
    assert.deepEqual(labels,expected);await note('Main FG QR opens all eight Sub-IDs');
    await wait(`[...document.querySelectorAll('[role="dialog"] a[download]')].filter(a=>a.download.endsWith('.png')&&a.href.startsWith('data:image/png')).length===8`);
    const downloads=await evaluate(`[...document.querySelectorAll('[role="dialog"] a[download]')].filter(a=>a.download.endsWith('.png')).map(a=>({name:a.download,href:a.href}))`);
    assert.equal(downloads.length,8);
    for(let i=0;i<downloads.length;i++) {
      await evaluate(`[...document.querySelectorAll('[role="dialog"] a[download]')][${i}].click()`);
      const file=path.join(root,downloads[i].name);
      for(let retry=0;;retry++){try{await access(file);break}catch(e){if(retry>150)throw e;await new Promise(r=>setTimeout(r,100))}}
    }
    await note('All eight QR images viewed and downloaded as PNG files');
    for(let i=0;i<8;i++) {
      const doc=await send('DOM.getDocument');const input=await send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'[role="dialog"] input[type="file"]'});
      await send('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[path.join(root,downloads[i].name)]});
      await wait(`document.querySelector('#section-verify').value===${JSON.stringify(fixture.sections[i].qr_identity)}`);
      await evaluate(`fgVerify.button('Verify',document.querySelector('#section-verify').closest('section'))`);
    }
    await note('All eight downloaded PNGs upload, decode, and verify through the actual UI');
    // Capture popup contents and print invocation without opening a physical printer dialog.
    await evaluate(`window.__fgPrints=[];window.__originalOpen=window.open;window.open=function(...args){const w=window.__originalOpen.apply(window,args);if(w){w.print=()=>window.__fgPrints.push({text:w.document.body.innerText,src:w.document.querySelector('img')?.src})}return w}`);
    for(let i=0;i<8;i++) await evaluate(`[...document.querySelectorAll('[role="dialog"] button')].filter(b=>b.textContent.trim()==='Print')[${i}].click()`);
    await wait(`window.__fgPrints.length===8`);
    const prints=await evaluate('window.__fgPrints');
    assert.deepEqual(prints.map(p=>p.text.trim()),expected);
    assert.ok(prints.every(p=>p.src.startsWith('data:image/png')));
    await note('All eight print actions prepare the correct popup label and invoke print');
    }
    await open('/supplier/dispatch','SUPPLIER');
    await wait(`document.body.innerText.includes('dispatch.')`);
    await evaluate(`fgVerify.button('Create Dispatch')`);
    await wait(`document.querySelector('select[id^="finished-good-"] option[value]:not([value=""])')!==null`);
    const options=await evaluate(`[...document.querySelector('select[id^="finished-good-"]').options].filter(o=>o.value).map(o=>({text:o.text,value:o.value}))`);
    assert.equal(options.length,1);assert.ok(options[0].text.includes(fixture.main_fg_id));
    await evaluate(`fgVerify.fill('select[id^="finished-good-"]',${JSON.stringify(options[0].value)})`);
    await wait(`document.body.innerText.includes(${JSON.stringify('FG ID: '+fixture.main_fg_id+' - Remaining sections: 8')})`);
    await evaluate(`fgVerify.fill('input[id^="vehicle-number-"]','KA02AH6781');fgVerify.fill('input[id^="driver-name-"]','Browser Driver');fgVerify.fill('input[id^="driver-contact-"]','9876543210');fgVerify.fill('#pickup-date',${JSON.stringify(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()))})`);
    await wait(`document.querySelector('[role="dialog"] button[type="submit"]')?.disabled===false`);
    await evaluate(`fgVerify.button('Create Dispatch',document.querySelector('[role="dialog"]'))`);
    await wait(`document.querySelector('[role="dialog"]')===null`);
    await note('Supplier-scoped FG dropdown, automatic FG ID/count, and vehicle submission');
  }
} catch(e){console.error('FAIL '+e.stack);await writeFile(path.join(root,'failure-dom.txt'),await evaluate('document.body.innerText').catch(()=>''));process.exitCode=1}
finally{await writeFile(path.join(root,'verification.json'),JSON.stringify({passed,errors},null,2));ws.close()}
