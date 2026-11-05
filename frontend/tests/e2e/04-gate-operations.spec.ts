import { test, expect } from '@playwright/test';

async function loginAsStaff(page: any) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.getByPlaceholder('Enter username').fill('admin');
  await page.getByPlaceholder('Enter password').fill('admin123');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL(/\/admin/, { timeout: 15000 });
  await page.waitForLoadState('networkidle');
}

test.describe('Module 04: Gate & Yard Logistics', () => {
  test('TC-GATE-001: Gate Dashboard renders truck counters and metrics', async ({ page }) => {
    await loginAsStaff(page);
    await page.goto('/gate-dashboard');
    await page.waitForLoadState('networkidle');

    expect(page.url()).toContain('/gate-dashboard');
    await expect(page.getByText(/gate|truck|security|inbound/i).first()).toBeVisible();

    // Verify counter cards or panels
    const metricWidgets = page.locator('[class*="card"], [class*="rounded"]');
    expect(await metricWidgets.count()).toBeGreaterThan(2);
  });

  test('TC-GATE-002: Live Vehicle Queue renders vehicle status list', async ({ page }) => {
    await loginAsStaff(page);
    await page.goto('/vehicle-queue');
    await page.waitForLoadState('networkidle');

    expect(page.url()).toContain('/vehicle-queue');
    await expect(page.getByText(/queue|vehicle|truck|dock/i).first()).toBeVisible();
  });

  test('TC-GATE-003: Vehicle Exit inspection form renders clearance controls', async ({ page }) => {
    await loginAsStaff(page);
    await page.goto('/vehicle-exit');
    await page.waitForLoadState('networkidle');

    expect(page.url()).toContain('/vehicle-exit');
    await expect(page.getByText(/exit|gate pass|clearance/i).first()).toBeVisible();
  });

  test('TC-GATE-004: Finished Goods Outbound Pickup screen is accessible', async ({ page }) => {
    await loginAsStaff(page);
    await page.goto('/gate/finished-goods-pickup');
    await page.waitForLoadState('networkidle');

    expect(page.url()).toContain('/gate/finished-goods-pickup');
    await expect(page.getByText(/finished goods|pickup|dispatch/i).first()).toBeVisible();
  });
});

