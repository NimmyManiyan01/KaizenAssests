import { test, expect } from '@playwright/test';

test.describe('Module 01: Landing Page & Three.js Canvas Experience', () => {
  test('TC-LAND-001: Root URL loads successfully with brand and navigation', async ({ page }) => {
    const res = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(res?.status()).toBe(200);

    // Verify brand title and text
    await expect(page).toHaveTitle(/Kaizen/i);
    const brand = page.getByText('KaizenAssests').first();
    await expect(brand).toBeVisible();

    // Verify Sign In CTA
    const signInBtn = page.getByRole('button', { name: /Sign In/i });
    await expect(signInBtn).toBeVisible();
  });

  test('TC-LAND-002: Three.js WebGL canvas mounts and renders', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });

    // Wait for the lazy-loaded 3D canvas
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 25000 });

    // Validate canvas dimensions
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(300);
    expect(box!.height).toBeGreaterThan(200);
  });

  test('TC-LAND-003: Sign In button transitions to /login', async ({ page }) => {
    await page.goto('/');
    const signInBtn = page.getByRole('button', { name: /Sign In/i });
    await signInBtn.click();
    await page.waitForURL(/\/login/, { timeout: 15000 });
    expect(page.url()).toContain('/login');
  });

  test('TC-LAND-004: Direct access to root is public without auth redirects', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    await page.waitForTimeout(1500);
    // Ensure we are still on root '/' and not redirected to '/login'
    expect(new URL(page.url()).pathname).toBe('/');
  });
});

