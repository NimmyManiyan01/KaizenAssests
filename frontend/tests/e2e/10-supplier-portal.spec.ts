import { test, expect } from '@playwright/test';

async function loginAsStaff(page: any) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.getByPlaceholder('Enter username').fill('admin');
  await page.getByPlaceholder('Enter password').fill('admin123');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url: URL) => !url.pathname.includes('/login'), { timeout: 15000 });
}

test.describe('Module 10: Supplier Portal & ASN Collaboration', () => {

  test('TC-SUP-001: Supplier Dashboard renders shipment notices & stats', async ({ page }) => {
    await loginAsStaff(page);
    await page.goto('/supplier-dashboard');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/.*\/supplier-dashboard/);
    const heading = page.getByRole('heading', { name: /supplier dashboard/i });
    await expect(heading.first()).toBeVisible({ timeout: 10000 });
  });

  test('TC-SUP-002: Supplier Materials directory renders material master list', async ({ page }) => {
    await loginAsStaff(page);
    await page.goto('/supplier-materials');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/.*\/supplier-materials/);
    const title = page.getByText(/materials|material master/i);
    await expect(title.first()).toBeVisible({ timeout: 10000 });
  });

  test('TC-SUP-003: Supplier ASNs route redirects cleanly to /supplier/asns/new', async ({ page }) => {
    await loginAsStaff(page);
    await page.goto('/supplier/asns');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/.*\/supplier\/asns\/new/);
  });

  test('TC-SUP-004: Supplier ASN creation view renders shipment notice workflow', async ({ page }) => {
    await loginAsStaff(page);
    await page.goto('/supplier/asns/new');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/.*\/supplier\/asns\/new/);
    const title = page.getByText(/shipment notices|advance shipment/i);
    await expect(title.first()).toBeVisible({ timeout: 10000 });
  });

  test('TC-SUP-005: Supplier Dispatch requests screen renders pickup history', async ({ page }) => {
    await loginAsStaff(page);
    await page.goto('/supplier/dispatch');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/.*\/supplier\/dispatch/);
    const title = page.getByText(/finished goods pickup|dispatch/i);
    await expect(title.first()).toBeVisible({ timeout: 10000 });
  });
});

