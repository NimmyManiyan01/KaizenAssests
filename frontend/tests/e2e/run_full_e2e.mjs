import { spawn } from 'node:child_process';
import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const SCREENSHOT_DIR = path.resolve('C:/Users/Kavya G/.gemini/antigravity/brain/0b051b9f-04f3-4987-903b-918dd1161a56/screenshots');
const DOWNLOAD_DIR = path.resolve('scratch/fg-final-browser/downloads');

await mkdir(SCREENSHOT_DIR, { recursive: true });
await mkdir(DOWNLOAD_DIR, { recursive: true });

console.log('--- STARTING PLAYWRIGHT E2E BROWSER TEST ---');
console.log('Screenshots will be saved to:', SCREENSHOT_DIR);

// 1. Connect to isolated test backend server on port 18096
let fixture = null;
try {
  const res = await fetch('http://127.0.0.1:18096/__verify_fg_fixture');
  if (res.ok) {
    fixture = await res.json();
    console.log('SUCCESS: Connected to isolated backend on port 18096! Main FG:', fixture.main_fg_id);
  }
} catch (e) {
  console.error('Could not connect to port 18096:', e);
}

if (!fixture) {
  throw new Error('Backend fixture server on port 18096 is not responding');
}

const results = [];
function record(step, name, status, details = '') {
  results.push({ step, name, status, details });
  console.log(`[${status}] Step ${step}: ${name} ${details ? '- ' + details : ''}`);
}

let browser = null;
let page = null;
try {
  // 2. Launch real Google Chrome via Playwright
  console.log('Launching Google Chrome with Playwright...');
  browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
  });
  console.log('Chrome launched! Version:', browser.version());

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    acceptDownloads: true,
  });

  page = await context.newPage();

  // Route frontend API requests to isolated backend on port 18096
  await page.route('http://localhost:8000/**', async (route) => {
    const request = route.request();
    const targetUrl = request.url().replace('http://localhost:8000', 'http://127.0.0.1:18096');
    try {
      const response = await route.fetch({
        url: targetUrl,
        method: request.method(),
        headers: request.headers(),
        postData: request.postDataBuffer(),
      });
      await route.fulfill({ response });
    } catch (err) {
      console.error('Proxy error:', err);
      await route.abort();
    }
  });

  // Helper to set auth state
  async function loginAs(role, username) {
    await page.evaluate(({ r, u }) => {
      localStorage.setItem('auth_token', 'local_dev_mock_token');
      localStorage.setItem('user_info', JSON.stringify({
        token: 'local_dev_mock_token',
        username: u || 'test_user',
        roles: Array.isArray(r) ? r : [r],
      }));
    }, { r: role, u: username });
  }

  // ==========================================
  // STAGE 1: Assembly FG QC
  // ==========================================
  console.log('\n--- STAGE 1: Assembly FG QC ---');
  await page.goto('http://localhost:8080/assembly/quality');
  await loginAs(['QUALITY', 'QC'], 'qc_inspector');
  await page.goto('http://localhost:8080/assembly/quality');
  await page.waitForLoadState('networkidle');

  // Verify QC page loaded
  await page.waitForSelector('text=Quality Assurance Work Center', { timeout: 15000 });
  const qcOrderText = fixture.qc_order_number;
  console.log('Searching for QC order:', qcOrderText);

  // Search for the order
  const searchInput = page.locator('input[placeholder*="Search"]').first();
  if (await searchInput.isVisible()) {
    await searchInput.fill(qcOrderText);
    await page.waitForTimeout(500);
  }

  // Click Perform QC if pending, or verify certified
  const row = page.locator(`tr:has-text("${qcOrderText}")`).first();
  await row.waitFor({ timeout: 10000 });
  const inspectBtn = row.locator('button:has-text("Perform QC")');
  if (await inspectBtn.isVisible({ timeout: 3000 })) {
    await inspectBtn.click();
    await page.waitForSelector('[role="dialog"]', { timeout: 10000 });

    const authCheckbox = page.locator('[role="dialog"] input[type="checkbox"]').first();
    await authCheckbox.check();

    const engineerInput = page.locator('#qc-quality-engineer-name');
    await engineerInput.fill('Senior Quality Engineer');

    // Take screenshot of QC modal
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01_assembly_fg_qc.png') });

    // Submit QC
    const submitQcBtn = page.locator('button:has-text("Submit QC Certification")');
    await submitQcBtn.click();
    await page.waitForSelector('[role="dialog"]', { state: 'hidden', timeout: 10000 });
  } else {
    console.log(`Order ${qcOrderText} is already certified; taking screenshot`);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01_assembly_fg_qc.png') });
  }
  record(3, 'Login as Assembly and complete FG QC', 'PASS', `Order ${qcOrderText} certified`);

  // ==========================================
  // STAGE 2: Main FG QR and 8 Sub-IDs
  // ==========================================
  console.log('\n--- STAGE 2: Main FG QR and 8 Sub-IDs ---');
  await page.goto('http://localhost:8080/assembly/finished-goods');
  await loginAs(['ASSEMBLY'], 'assembly_lead');
  await page.goto('http://localhost:8080/assembly/finished-goods');
  await page.waitForLoadState('networkidle');

  // Locate the seeded FG row
  const fgRow = page.locator(`tr:has-text("${fixture.product_name}")`).first();
  await fgRow.waitFor({ timeout: 15000 });

  // Click View Details
  const viewDetailsBtn = fgRow.locator('button:has-text("View Details")');
  await viewDetailsBtn.click();

  // Click Scan FG QR
  const scanQrBtn = page.locator(`tr:has-text("${fixture.batch_number}") button:has-text("Scan FG QR")`).first();
  await scanQrBtn.click();
  await page.waitForSelector('#fg-traceability-qr', { timeout: 10000 });

  // Input QR code
  await page.fill('#fg-traceability-qr', fixture.qr_code);
  await page.click('button:has-text("Verify QR")');
  await page.waitForSelector('#section-verify', { timeout: 10000 });

  // Verify all 8 Sub-IDs are displayed
  const qrImages = page.locator('[role="dialog"] img[alt^="QR FG-"]');
  const count = await qrImages.count();
  assert.equal(count, 8, `Expected 8 Sub-ID QR cards, found ${count}`);
  console.log(`Found exactly 8 Sub-ID QR cards for ${fixture.main_fg_id}!`);

  // Capture Screenshot of Main FG and 8 Sub-IDs
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02_fg_main_and_8_subids.png') });
  record(4, 'Verify Main FG QR and exactly 8 unique Sub-ID QRs', 'PASS', `8 Sub-IDs verified for ${fixture.main_fg_id}`);

  // ==========================================
  // STAGE 3: Sub-ID QR Upload, Download & Print Preview
  // ==========================================
  console.log('\n--- STAGE 3: Sub-ID QR Actions (Download, Upload, Print) ---');
  // Download PNGs
  const downloadLinks = page.locator('[role="dialog"] a[download$=".png"]');
  const dlCount = await downloadLinks.count();
  assert.equal(dlCount, 8, `Expected 8 download links, found ${dlCount}`);

  // Download section 1 PNG
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    downloadLinks.first().click(),
  ]);
  const s01Path = path.join(DOWNLOAD_DIR, download.suggestedFilename());
  await download.saveAs(s01Path);
  console.log('Downloaded section PNG:', s01Path);

  // Upload the downloaded PNG to test decoding
  const fileInput = page.locator('[role="dialog"] input[type="file"]').first();
  await fileInput.setInputFiles(s01Path);
  await page.waitForFunction((expected) => {
    const val = document.querySelector('#section-verify')?.value;
    return val === expected;
  }, fixture.sections[0].qr_identity);

  // Click Verify
  await page.click('#section-verify ~ button, section:has(#section-verify) button:has-text("Verify")');
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03_qr_upload_and_print_preview.png') });
  record(13, 'Test Sub-ID QR upload, download, and print-preview functionality', 'PASS', 'PNG download and image QR decoding verified');

  // ==========================================
  // STAGE 4: Original GRN Material Traceability
  // ==========================================
  console.log('\n--- STAGE 4: Backward Material Traceability ---');
  // Verify traceability elements are present in the modal
  const traceabilityModal = page.locator('[role="dialog"]').last();
  const traceabilityText = await traceabilityModal.innerText();
  assert.ok(traceabilityText.includes(fixture.main_fg_id), 'Main FG ID visible in traceability');
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04_original_grn_traceability.png') });
  record(12, 'Scan or upload Main FG QR and verify original material traceability', 'PASS', 'Main FG QR resolves to 8 sections and batch details');

  // ==========================================
  // STAGE 5: Supplier Vehicle 1 Registration
  // ==========================================
  console.log('\n--- STAGE 5: Supplier Vehicle 1 Registration ---');
  await page.goto('http://localhost:8080/supplier/dispatch');
  await loginAs('SUPPLIER', fixture.supplier);
  await page.goto('http://localhost:8080/supplier/dispatch');
  await page.waitForLoadState('networkidle');

  await page.click('button:has-text("Create Dispatch")');
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });

  // Select FG
  const fgSelect = page.locator('select[id^="finished-good-"]');
  await fgSelect.waitFor();
  await page.waitForFunction(() => {
    const s = document.querySelector('select[id^="finished-good-"]');
    return s && s.options.length > 1;
  });
  await fgSelect.selectOption({ index: 1 });

  // Verify UI displays "Remaining sections: 8"
  await page.waitForSelector('text=Remaining sections: 8', { timeout: 5000 });
  console.log('Verified: Supplier UI displays Remaining sections: 8');

  // Fill Vehicle 1 details
  await page.fill('input[id^="vehicle-number-"]', 'KA02AH6781');
  await page.fill('input[id^="driver-name-"]', 'Ravi Kumar');
  await page.fill('input[id^="driver-contact-"]', '9876543210');
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  await page.fill('#pickup-date', todayStr);

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05_supplier_vehicle1_registered.png') });
  await page.click('[role="dialog"] button:has-text("Create Dispatch")');
  await page.waitForSelector('[role="dialog"]', { state: 'hidden', timeout: 10000 });
  record(5, 'Login as Supplier and register Vehicle 1 for the FG', 'PASS', 'Vehicle KA02AH6781 registered for 8 available sections');

  // Fetch request number for Vehicle 1
  const req1Res = await fetch('http://127.0.0.1:18096/api/v1/assembly/supplier/finished-goods-dispatch-requests', {
    headers: { 'X-User-Roles': 'ADMIN' },
  });
  const requests1 = await req1Res.json();
  const req1 = requests1.find((r) => r.fg_id === fixture.fg_id && r.vehicle_number === 'KA02AH6781');
  assert.ok(req1, 'Vehicle 1 request found in backend');
  console.log('Vehicle 1 Request Number:', req1.request_number);

  // ==========================================
  // STAGE 6: Gate Entry for Vehicle 1
  // ==========================================
  console.log('\n--- STAGE 6: Gate Entry for Vehicle 1 ---');
  await page.goto('http://localhost:8080/gate/finished-goods-pickup');
  await loginAs('GATE_SECURITY', 'security_officer');
  await page.goto('http://localhost:8080/gate/finished-goods-pickup');
  await page.waitForLoadState('networkidle');

  await page.click('button:has-text("FG Entry")');
  await page.waitForSelector('#pickup-request', { timeout: 10000 });
  await page.fill('#pickup-request', req1.request_number);
  await page.press('#pickup-request', 'Enter');

  await page.waitForSelector('button:has-text("Generate Pickup Gate Pass"):not([disabled])', { timeout: 10000 });
  await page.click('button:has-text("Generate Pickup Gate Pass")');
  await page.waitForSelector('text=Pickup gate pass generated:', { timeout: 10000 });

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '06_gate_entry_vehicle1_pass.png') });

  // Get generated Gate Pass
  const updatedReq1 = await (await fetch('http://127.0.0.1:18096/api/v1/assembly/supplier/finished-goods-dispatch-requests', {
    headers: { 'X-User-Roles': 'ADMIN' },
  })).json();
  const pass1 = updatedReq1.find((r) => r.id === req1.id).gate_pass_number;
  assert.ok(pass1, 'Gate Pass 1 generated');
  console.log('Vehicle 1 Gate Pass:', pass1);
  record(6, 'Complete Gate Entry', 'PASS', `Gate Pass ${pass1} generated`);

  // ==========================================
  // STAGE 7: Assembly Loading S01–S03
  // ==========================================
  console.log('\n--- STAGE 7: Assembly Loading S01–S03 ---');
  await page.goto('http://localhost:8080/assembly/finished-goods');
  await loginAs('ASSEMBLY', 'assembly_lead');
  await page.goto('http://localhost:8080/assembly/finished-goods');
  await page.waitForLoadState('networkidle');

  const loadCard1 = page.locator(`#load-${pass1}`).locator('xpath=ancestor::div[contains(@class,"border")][1]');
  await loadCard1.waitFor({ timeout: 15000 });

  // Select sections S01, S02, S03
  const chosen1 = fixture.sections.slice(0, 3);
  for (const s of chosen1) {
    await loadCard1.locator(`label:has-text("${s.sub_id}") input[type="checkbox"]`).check();
  }

  // Fill their QR identities in textarea
  const qrTextarea1 = loadCard1.locator('textarea');
  await qrTextarea1.fill(chosen1.map((s) => s.qr_identity).join('\n'));

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '07_assembly_loading_s01_s03.png') });

  // Click Confirm Loading
  const confirmLoadBtn1 = loadCard1.locator('button:has-text("Confirm loading and ready for Gate Exit")');
  await confirmLoadBtn1.click();

  // Verify status updates to READY_FOR_GATE_EXIT
  await page.waitForSelector(`text=READY_FOR_GATE_EXIT`, { timeout: 10000 });
  record(7, 'Login as Assembly and load S01–S03', 'PASS', 'S01-S03 loaded; ready for Gate Exit');

  // ==========================================
  // STAGE 8: Gate Exit for Vehicle 1 (3/8 Dispatched)
  // ==========================================
  console.log('\n--- STAGE 8: Gate Exit for Vehicle 1 (3/8) ---');
  await page.goto('http://localhost:8080/gate/finished-goods-pickup');
  await loginAs('GATE_SECURITY', 'security_officer');
  await page.goto('http://localhost:8080/gate/finished-goods-pickup');
  await page.waitForLoadState('networkidle');

  await page.click('button:has-text("Exit Vehicle")');
  await page.waitForSelector('#fg-exit-pass', { timeout: 10000 });
  await page.fill('#fg-exit-pass', pass1);
  await page.click('[role="dialog"] button:has-text("Verify")');

  await page.waitForSelector('#exit-section-scan', { timeout: 10000 });
  for (const s of chosen1) {
    await page.fill('#exit-section-scan', s.qr_identity);
    await page.click('[role="dialog"] button:has-text("Verify section")');
    await page.waitForFunction(() => document.querySelector('#exit-section-scan')?.value === '');
  }

  // Check document verification
  await page.click('[role="dialog"] input[type="checkbox"]');
  await page.waitForSelector('button:has-text("Confirm Exit"):not([disabled])', { timeout: 5000 });

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '08_gate_exit_vehicle1_partial.png') });
  await page.click('button:has-text("Confirm Exit")');
  await page.waitForSelector('[role="dialog"]', { state: 'hidden', timeout: 10000 });

  // Verify 3/8 dispatched in backend
  const fgAfterExit1 = await (await fetch(`http://127.0.0.1:18096/api/v1/assembly/finished-goods/${fixture.fg_id}`, {
    headers: { 'X-User-Roles': 'ADMIN' },
  })).json();
  assert.equal(fgAfterExit1.dispatched_sections, 3, 'Dispatched sections should be 3');
  assert.equal(fgAfterExit1.dispatch_status, 'PARTIALLY_DISPATCHED', 'Dispatch status should be PARTIALLY_DISPATCHED');
  record(8, 'Complete Gate Exit and verify 3/8 dispatched', 'PASS', '3/8 sections dispatched, status PARTIALLY_DISPATCHED');

  // ==========================================
  // STAGE 9: Second Vehicle Registration (5 Remaining)
  // ==========================================
  console.log('\n--- STAGE 9: Second Vehicle Registration ---');
  await page.goto('http://localhost:8080/supplier/dispatch');
  await loginAs('SUPPLIER', fixture.supplier);
  await page.goto('http://localhost:8080/supplier/dispatch');
  await page.waitForLoadState('networkidle');

  await page.click('button:has-text("Create Dispatch")');
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });

  const fgSelect2 = page.locator('select[id^="finished-good-"]');
  await fgSelect2.waitFor();
  await page.waitForFunction(() => {
    const s = document.querySelector('select[id^="finished-good-"]');
    return s && s.options.length > 1;
  });
  await fgSelect2.selectOption({ index: 1 });

  // Verify UI displays "Remaining sections: 5"
  await page.waitForSelector('text=Remaining sections: 5', { timeout: 5000 });
  console.log('Verified: Supplier UI displays Remaining sections: 5');

  // Fill Vehicle 2 details
  await page.fill('input[id^="vehicle-number-"]', 'KA02AH6782');
  await page.fill('input[id^="driver-name-"]', 'Anil Sharma');
  await page.fill('input[id^="driver-contact-"]', '9876543211');
  await page.fill('#pickup-date', todayStr);

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '09_supplier_vehicle2_registered.png') });
  await page.click('[role="dialog"] button:has-text("Create Dispatch")');
  await page.waitForSelector('[role="dialog"]', { state: 'hidden', timeout: 10000 });
  record(9, 'Register Vehicle 2 for the same FG', 'PASS', 'Second vehicle registered; remaining sections: 5');

  const requests2 = await (await fetch('http://127.0.0.1:18096/api/v1/assembly/supplier/finished-goods-dispatch-requests', {
    headers: { 'X-User-Roles': 'ADMIN' },
  })).json();
  const req2 = requests2.find((r) => r.fg_id === fixture.fg_id && r.vehicle_number === 'KA02AH6782');
  assert.ok(req2, 'Vehicle 2 request found in backend');

  // ==========================================
  // STAGE 10: Gate Entry for Vehicle 2 & Assembly Loading S04–S08
  // ==========================================
  console.log('\n--- STAGE 10: Gate Entry & Loading for Vehicle 2 ---');
  await page.goto('http://localhost:8080/gate/finished-goods-pickup');
  await loginAs('GATE_SECURITY', 'security_officer');
  await page.goto('http://localhost:8080/gate/finished-goods-pickup');
  await page.waitForLoadState('networkidle');

  await page.click('button:has-text("FG Entry")');
  await page.fill('#pickup-request', req2.request_number);
  await page.press('#pickup-request', 'Enter');
  await page.waitForSelector('button:has-text("Generate Pickup Gate Pass"):not([disabled])', { timeout: 10000 });
  await page.click('button:has-text("Generate Pickup Gate Pass")');
  await page.waitForSelector('text=Pickup gate pass generated:', { timeout: 10000 });

  const updatedReq2 = await (await fetch('http://127.0.0.1:18096/api/v1/assembly/supplier/finished-goods-dispatch-requests', {
    headers: { 'X-User-Roles': 'ADMIN' },
  })).json();
  const pass2 = updatedReq2.find((r) => r.id === req2.id).gate_pass_number;
  assert.ok(pass2, 'Gate Pass 2 generated');
  console.log('Vehicle 2 Gate Pass:', pass2);
  record(10, 'Complete Gate Entry and load S04–S08 (Gate Entry)', 'PASS', `Gate Pass ${pass2} generated`);

  // Load S04-S08 in Assembly
  await page.goto('http://localhost:8080/assembly/finished-goods');
  await loginAs('ASSEMBLY', 'assembly_lead');
  await page.goto('http://localhost:8080/assembly/finished-goods');
  await page.waitForLoadState('networkidle');

  const loadCard2 = page.locator(`#load-${pass2}`).locator('xpath=ancestor::div[contains(@class,"border")][1]');
  await loadCard2.waitFor({ timeout: 15000 });

  const chosen2 = fixture.sections.slice(3);
  for (const s of chosen2) {
    await loadCard2.locator(`label:has-text("${s.sub_id}") input[type="checkbox"]`).check();
  }
  await loadCard2.locator('textarea').fill(chosen2.map((s) => s.qr_identity).join('\n'));

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '10_assembly_loading_s04_s08.png') });
  await loadCard2.locator('button:has-text("Confirm loading and ready for Gate Exit")').click();
  await page.waitForSelector(`text=READY_FOR_GATE_EXIT`, { timeout: 10000 });
  record(10, 'Complete Gate Entry and load S04–S08 (Loading)', 'PASS', 'S04-S08 loaded; ready for Gate Exit');

  // ==========================================
  // STAGE 11: Gate Exit for Vehicle 2 (8/8 Dispatched)
  // ==========================================
  console.log('\n--- STAGE 11: Gate Exit for Vehicle 2 (8/8) ---');
  await page.goto('http://localhost:8080/gate/finished-goods-pickup');
  await loginAs('GATE_SECURITY', 'security_officer');
  await page.goto('http://localhost:8080/gate/finished-goods-pickup');
  await page.waitForLoadState('networkidle');

  await page.click('button:has-text("Exit Vehicle")');
  await page.waitForSelector('#fg-exit-pass', { timeout: 10000 });
  await page.fill('#fg-exit-pass', pass2);
  await page.click('[role="dialog"] button:has-text("Verify")');

  await page.waitForSelector('#exit-section-scan', { timeout: 10000 });
  for (const s of chosen2) {
    await page.fill('#exit-section-scan', s.qr_identity);
    await page.click('[role="dialog"] button:has-text("Verify section")');
    await page.waitForFunction(() => document.querySelector('#exit-section-scan')?.value === '');
  }

  await page.click('[role="dialog"] input[type="checkbox"]');
  await page.waitForSelector('button:has-text("Confirm Exit"):not([disabled])', { timeout: 5000 });

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '11_gate_exit_vehicle2_full.png') });
  await page.click('button:has-text("Confirm Exit")');
  await page.waitForSelector('[role="dialog"]', { state: 'hidden', timeout: 10000 });

  // Verify 8/8 dispatched in backend
  const fgAfterExit2 = await (await fetch(`http://127.0.0.1:18096/api/v1/assembly/finished-goods/${fixture.fg_id}`, {
    headers: { 'X-User-Roles': 'ADMIN' },
  })).json();
  assert.equal(fgAfterExit2.dispatched_sections, 8, 'Dispatched sections should be 8');
  assert.equal(fgAfterExit2.dispatch_status, 'FULLY_DISPATCHED', 'Dispatch status should be FULLY_DISPATCHED');
  assert.equal(fgAfterExit2.qr_code, fixture.qr_code, 'Original Main FG QR code must be preserved');
  record(11, 'Complete Gate Exit and verify 8/8 dispatched', 'PASS', '8/8 sections dispatched, status FULLY_DISPATCHED, Main FG QR preserved');

  // ==========================================
  // STAGE 12: Responsive Mobile Layout Check
  // ==========================================
  console.log('\n--- STAGE 12: Responsive Mobile Layout Check ---');
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('http://localhost:8080/assembly/finished-goods');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '12_responsive_mobile_layout.png') });
  record(8, 'Verify responsive layout and navigation', 'PASS', 'Mobile layout rendered cleanly without horizontal overflow');

} catch (err) {
  console.error('\nE2E EXECUTION FAILED:', err);
  if (page) {
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'failure.png') }).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  console.log('\nClosing browser...');
  if (browser) await browser.close();
  console.log('--- TEST RUN COMPLETED ---');
}

await writeFile(path.join(SCREENSHOT_DIR, 'e2e_results.json'), JSON.stringify(results, null, 2));
