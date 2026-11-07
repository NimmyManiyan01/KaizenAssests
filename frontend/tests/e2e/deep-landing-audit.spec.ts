import { test, expect } from '@playwright/test';

test.describe('Deep Landing Page Performance Audit', () => {
  test('Initial Loading & Blank Screen Lifecycle Audit', async ({ page }) => {
    const consoleLogs: string[] = [];
    const webglMessages: string[] = [];
    page.on('console', msg => {
      const text = msg.text();
      consoleLogs.push(text);
      if (text.includes('WebGL') || text.includes('THREE') || text.includes('stall')) {
        webglMessages.push(text);
      }
    });

    console.log('Navigating to production landing page...');
    const navStart = Date.now();
    const response = await page.goto('https://kaizen-wms-frontend.graybeach-6b6c99c3.centralindia.azurecontainerapps.io', {
      waitUntil: 'commit',
    });

    const commitTime = Date.now() - navStart;
    console.log(`Commit received in ${commitTime}ms. Status: ${response?.status()}`);

    // Capture visual state at key intervals
    await page.waitForTimeout(100);
    const content100ms = await page.evaluate(() => {
      const main = document.querySelector('main');
      const canvas = document.querySelector('canvas');
      const spinner = document.querySelector('.animate-spin');
      return {
        hasCanvas: !!canvas,
        hasSpinner: !!spinner,
        bodyText: document.body.innerText.slice(0, 100),
      };
    });
    console.log('State at 100ms:', JSON.stringify(content100ms));

    // Wait for DOMContentLoaded
    await page.waitForLoadState('domcontentloaded');
    const dclTime = Date.now() - navStart;
    console.log(`DOMContentLoaded at ${dclTime}ms`);

    // Wait for canvas to appear in DOM
    const canvas = page.locator('canvas').first();
    await canvas.waitFor({ state: 'attached', timeout: 30000 });
    const canvasAttachedTime = Date.now() - navStart;
    console.log(`Canvas attached to DOM at ${canvasAttachedTime}ms`);

    // Wait for canvas to be visible
    await canvas.waitFor({ state: 'visible', timeout: 30000 });
    const canvasVisibleTime = Date.now() - navStart;
    console.log(`Canvas visible at ${canvasVisibleTime}ms`);

    // Measure Paint & Web Vitals
    const performanceTiming = await page.evaluate(() => {
      const navEntries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
      const paintEntries = performance.getEntriesByType('paint');
      const fcp = paintEntries.find(p => p.name === 'first-contentful-paint')?.startTime || 0;
      const fp = paintEntries.find(p => p.name === 'first-paint')?.startTime || 0;
      const nav = navEntries[0];
      return {
        ttfb: nav ? nav.responseStart - nav.requestStart : 0,
        domInteractive: nav ? nav.domInteractive : 0,
        domComplete: nav ? nav.domComplete : 0,
        loadEventEnd: nav ? nav.loadEventEnd : 0,
        firstPaint: fp,
        firstContentfulPaint: fcp,
      };
    });
    console.log('Performance Metrics:', JSON.stringify(performanceTiming, null, 2));
    console.log('WebGL & Graphics Console Logs:', JSON.stringify(webglMessages, null, 2));
  });

  test('Fast Scrolling & Camera Lag / Sticking Reproduction', async ({ page }) => {
    await page.goto('https://kaizen-wms-frontend.graybeach-6b6c99c3.centralindia.azurecontainerapps.io', {
      waitUntil: 'load',
    });
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 25000 });
    await page.waitForTimeout(2500); // Allow initial cinematic intro to settle

    console.log('--- Commencing Fast Scroll Test ---');

    // Profile fast downward swipe / scroll
    const scrollResult = await page.evaluate(async () => {
      const samples: Array<{ t: number; scrollY: number; targetY: number }> = [];
      const startTime = performance.now();

      // Simulate fast user scroll wheel / swipe (e.g. 5 fast flick pulses of 800px each)
      const targets = [800, 1600, 2400, 3200, 4000];

      for (const target of targets) {
        window.scrollTo(0, target);
        // User scrolls very fast, only 50ms between pulses
        await new Promise(r => setTimeout(r, 60));
        samples.push({
          t: performance.now() - startTime,
          scrollY: window.scrollY,
          targetY: target,
        });
      }

      // Record settling phase: how long until scroll settling stops
      const settleStart = performance.now();
      await new Promise(r => setTimeout(r, 1000));
      const settleEnd = performance.now();

      return {
        totalDuration: performance.now() - startTime,
        samples,
        finalScrollY: window.scrollY,
      };
    });

    console.log('Fast Scroll Profile Results:', JSON.stringify(scrollResult, null, 2));

    // Test reverse scroll immediately after fast forward scroll
    console.log('--- Testing Reverse Flick Scroll ---');
    const reverseResult = await page.evaluate(async () => {
      const startTime = performance.now();
      window.scrollTo(0, 500);
      await new Promise(r => setTimeout(r, 300));
      window.scrollTo(0, 0);
      await new Promise(r => setTimeout(r, 500));
      return {
        duration: performance.now() - startTime,
        finalScrollY: window.scrollY,
      };
    });
    console.log('Reverse Scroll Results:', JSON.stringify(reverseResult, null, 2));
  });
});
