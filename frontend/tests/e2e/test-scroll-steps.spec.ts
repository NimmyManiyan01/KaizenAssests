import { test, expect } from '@playwright/test';

test('Test Single Scroll Step Time', async ({ page }) => {
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

  await page.goto('/', { waitUntil: 'load' });
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible({ timeout: 25000 });
  await page.waitForTimeout(2000);

  console.log('Testing 3 scrollTo steps...');
  for (const targetY of [500, 1500, 3000]) {
    const t0 = Date.now();
    await page.evaluate((y) => {
      console.log('Scrolling to', y);
      window.scrollTo(0, y);
    }, targetY);
    await page.waitForTimeout(100);
    console.log(`Scroll to ${targetY} took ${Date.now() - t0}ms`);
  }
});

