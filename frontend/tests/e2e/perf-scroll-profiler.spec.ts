import { test, expect } from '@playwright/test';

test('Profile Landing Page Smooth Scrolling & Jank', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/', { waitUntil: 'load' });

  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible({ timeout: 25000 });
  await page.waitForTimeout(2000);

  // Run scroll profiling in-browser
  const result = await page.evaluate(async () => {
    const deltas: number[] = [];
    let lastTime = performance.now();
    let isTracking = true;

    function frameLoop(now: number) {
      if (isTracking) {
        deltas.push(now - lastTime);
      }
      lastTime = now;
      requestAnimationFrame(frameLoop);
    }
    const rafId = requestAnimationFrame(frameLoop);

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const startTime = performance.now();

    // 1. Progressive continuous scroll
    for (let y = 0; y <= 6000; y += 200) {
      window.scrollTo(0, y);
      await sleep(20);
    }

    // 2. Fast sweep down
    for (let y = 6000; y <= 7800; y += 450) {
      window.scrollTo(0, y);
      await sleep(15);
    }

    // 3. Reversal sweep up
    for (let y = 7800; y >= 500; y -= 350) {
      window.scrollTo(0, y);
      await sleep(15);
    }

    const scrollTotalTimeMs = performance.now() - startTime;
    isTracking = false;

    // Discard first 2 warmup frames
    const validDeltas = deltas.slice(2);
    const totalTime = validDeltas.reduce((a, b) => a + b, 0);
    const avgDelta = totalTime / validDeltas.length;
    const avgFps = 1000 / avgDelta;
    const maxDelta = Math.max(...validDeltas);
    const p95Delta = validDeltas.slice().sort((a, b) => a - b)[Math.floor(validDeltas.length * 0.95)];
    const longFrames = validDeltas.filter((d) => d > 33.33).length; // frames taking > 33.3ms (< 30 FPS)
    const severeJankFrames = validDeltas.filter((d) => d > 50.0).length; // frames taking > 50ms (< 20 FPS)

    return {
      scrollTotalTimeMs: scrollTotalTimeMs.toFixed(0),
      totalFrames: validDeltas.length,
      avgFps: avgFps.toFixed(1),
      avgFrameTimeMs: avgDelta.toFixed(2),
      p95FrameTimeMs: p95Delta.toFixed(2),
      maxFrameTimeMs: maxDelta.toFixed(2),
      longFramesAbove33ms: longFrames,
      severeJankFramesAbove50ms: severeJankFrames,
      dropRatePercent: ((longFrames / validDeltas.length) * 100).toFixed(1),
    };
  });

  console.log('=== SCROLL PERFORMANCE BASELINE PROFILE ===');
  console.log(JSON.stringify(result, null, 2));
  expect(result).not.toBeNull();
});
