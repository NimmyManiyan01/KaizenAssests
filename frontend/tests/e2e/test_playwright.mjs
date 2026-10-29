import { chromium } from '@playwright/test';

async function test() {
  try {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    console.log('SUCCESS: Chrome launched with Playwright version', browser.version());
    const page = await browser.newPage();
    await page.goto('http://localhost:8080');
    console.log('SUCCESS: Page title is:', await page.title());
    await browser.close();
  } catch (err) {
    console.error('ERROR launching Chrome:', err);
    process.exit(1);
  }
}

test();

