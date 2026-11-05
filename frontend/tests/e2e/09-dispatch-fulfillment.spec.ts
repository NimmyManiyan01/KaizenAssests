import { test, expect } from '@playwright/test';

async function loginAsStaff(page: any) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.getByPlaceholder('Enter username').fill('admin');
  await page.getByPlaceholder('Enter password').fill('admin123');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url: URL) => !url.pathname.includes('/login'), { timeout: 15000 });
}

test.describe('Module 09: Outbound Dispatch & Fulfillment', () => {

  test('TC-DSP-001: Dispatch Orders management renders order directory & filters', async ({ page }) => {
    await loginAsStaff(page);
    await page.goto('/dispatch-orders');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/.*\/dispatch-orders/);
    const title = page.getByRole('heading', { name: /dispatch orders/i });
    await expect(title.first()).toBeVisible({ timeout: 10000 });
  });

  test('TC-DSP-002: Picking & Packing workspace loads scanning interface', async ({ page }) => {
    await loginAsStaff(page);
    await page.goto('/dispatch-picking-packing');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/.*\/dispatch-picking-packing/);
    const title = page.getByText(/picking & packing|picking/i);
    await expect(title.first()).toBeVisible({ timeout: 10000 });
  });

  test('TC-DSP-003: Dispatch Loading Bay screen loads vehicle verification', async ({ page }) => {
    await loginAsStaff(page);
    await page.goto('/dispatch-loading');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/.*\/dispatch-loading/);
    const title = page.getByText(/loading bay|package scanning/i);
    await expect(title.first()).toBeVisible({ timeout: 10000 });
  });

  test('TC-DSP-004: Gate Out screen loads outbound vehicle release', async ({ page }) => {
    await loginAsStaff(page);
    await page.goto('/dispatch-gate-out');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/.*\/dispatch-gate-out/);
    const title = page.getByText(/gate out|release verified/i);
    await expect(title.first()).toBeVisible({ timeout: 10000 });
  });

  test('TC-DSP-005: Dispatch Exceptions screen renders returns and exception resolutions', async ({ page }) => {
    await loginAsStaff(page);
    await page.goto('/dispatch-exceptions');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/.*\/dispatch-exceptions/);
    const title = page.getByText(/dispatch exceptions|returns/i);
    await expect(title.first()).toBeVisible({ timeout: 10000 });
  });
});

