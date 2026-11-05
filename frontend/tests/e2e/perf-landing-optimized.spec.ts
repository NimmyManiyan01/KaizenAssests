import { test, expect } from '@playwright/test';

test('Measure Landing Page Performance Audit', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');

  const startTime = Date.now();
  await page.goto('/', { waitUntil: 'load' });
  const loadDuration = Date.now() - startTime;

  // Wait for 3D canvas to mount and render
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible({ timeout: 25000 });

  // Allow WebGL steady-state render frames
  await page.waitForTimeout(2500);

  // Collect CDP Performance Metrics
  const cdpMetrics = await cdp.send('Performance.getMetrics');
  const metricMap: Record<string, number> = {};
  for (const m of cdpMetrics.metrics) {
    metricMap[m.name] = m.value;
  }

  // Collect Browser Web Vitals and WebGL properties
  const vitals = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const paint = performance.getEntriesByType('paint');
    const fcp = paint.find(p => p.name === 'first-contentful-paint')?.startTime || null;

    const canvasEl = document.querySelector('canvas');
    const gl = canvasEl?.getContext('webgl2') || canvasEl?.getContext('webgl');
    let rendererInfo: any = null;
    if (gl) {
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      rendererInfo = {
        renderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'Standard WebGL',
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
        viewport: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      };
    }

    return {
      ttfb: (nav.responseStart - nav.requestStart).toFixed(1),
      domInteractive: (nav.domInteractive - nav.startTime).toFixed(1),
      domContentLoaded: (nav.domContentLoadedEventEnd - nav.startTime).toFixed(1),
      loadComplete: (nav.loadEventEnd - nav.startTime).toFixed(1),
      fcp: fcp ? fcp.toFixed(1) : 'N/A',
      rendererInfo,
    };
  });

  const jsHeapMB = (metricMap['JSHeapUsedSize'] / (1024 * 1024)).toFixed(2);
  const scriptDurationSec = metricMap['ScriptDuration']?.toFixed(3);
  const taskDurationSec = metricMap['TaskDuration']?.toFixed(3);

  console.log('--- THREE.JS LANDING PAGE PERFORMANCE AUDIT ---');
  console.log(`Canvas Mount Time: ${loadDuration}ms`);
  console.log(`TTFB: ${vitals.ttfb} ms`);
  console.log(`First Contentful Paint (FCP): ${vitals.fcp} ms`);
  console.log(`DOMContentLoaded: ${vitals.domContentLoaded} ms`);
  console.log(`Load Complete: ${vitals.loadComplete} ms`);
  console.log(`JS Heap Used: ${jsHeapMB} MB`);
  console.log(`Script Duration: ${scriptDurationSec} s`);
  console.log(`Task Duration: ${taskDurationSec} s`);
  console.log('Renderer Info:', JSON.stringify(vitals.rendererInfo, null, 2));

  expect(metricMap['JSHeapUsedSize']).toBeLessThan(150 * 1024 * 1024); // Under 150MB
  expect(Number(vitals.fcp)).toBeLessThan(5000); // FCP under 5s
});
