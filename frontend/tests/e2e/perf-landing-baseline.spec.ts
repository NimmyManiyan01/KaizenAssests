import { test, expect } from '@playwright/test';

test('Measure Landing Page Baseline Performance', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');

  const startTime = Date.now();
  await page.goto('/', { waitUntil: 'load' });
  const loadDuration = Date.now() - startTime;

  // Wait for 3D canvas to mount
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible({ timeout: 25000 });
  console.log(`[Perf] 3D WebGL Canvas mounted and visible after ${loadDuration}ms`);

  // Wait 2 seconds for scene shaders to compile and steady state
  await page.waitForTimeout(2000);

  // Collect CDP Performance Metrics
  const cdpMetrics = await cdp.send('Performance.getMetrics');
  const metricMap: Record<string, number> = {};
  for (const m of cdpMetrics.metrics) {
    metricMap[m.name] = m.value;
  }

  // Collect Web Vitals from browser
  const webVitals = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const paint = performance.getEntriesByType('paint');
    const fcp = paint.find(p => p.name === 'first-contentful-paint')?.startTime || null;

    // Canvas WebGL context attributes
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

  const report = {
    webVitals,
    engineMetrics: {
      jsHeapUsedMB: (metricMap['JSHeapUsedSize'] / (1024 * 1024)).toFixed(2),
      jsHeapTotalMB: (metricMap['JSHeapTotalSize'] / (1024 * 1024)).toFixed(2),
      domNodes: metricMap['Nodes'],
      layoutCount: metricMap['LayoutCount'],
      layoutDurationSec: metricMap['LayoutDuration']?.toFixed(3),
      recalcStyleDurationSec: metricMap['RecalcStyleDuration']?.toFixed(3),
      scriptDurationSec: metricMap['ScriptDuration']?.toFixed(3),
      taskDurationSec: metricMap['TaskDuration']?.toFixed(3),
    },
  };

  console.log('[PERF REPORT BASELINE]:\n' + JSON.stringify(report, null, 2));
  await page.screenshot({ path: 'test-results/screenshots/perf-baseline.png' });
});
