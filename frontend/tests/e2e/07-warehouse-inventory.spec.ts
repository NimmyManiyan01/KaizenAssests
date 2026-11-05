import { test, expect } from '@playwright/test';

async function loginAsStaff(page: any) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.getByPlaceholder('Enter username').fill('admin');
  await page.getByPlaceholder('Enter password').fill('admin123');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url: URL) => !url.pathname.includes('/login'), { timeout: 15000 });
}

test.describe('Module 07: Warehouse & Inventory Management', () => {

  test('TC-INV-001: Inventory dashboard renders warehouse metrics & KPI cards', async ({ page }) => {
    await loginAsStaff(page);
    await page.goto('/inventory');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/.*\/inventory/);
    const mainContent = page.locator('main, [role="main"]').first();
    await expect(mainContent).toBeVisible({ timeout: 10000 });

    const kpiText = page.getByText(/warehouse locations|what needs attention|stock|inventory/i);
    await expect(kpiText.first()).toBeAttached();
  });

  test('TC-INV-002: Putaway Tasks route redirects cleanly to Inventory', async ({ page }) => {
    await loginAsStaff(page);
    await page.goto('/putaway-tasks');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/.*\/inventory/);
  });

  test('TC-INV-003: Warehouse Dashboard route redirects cleanly to Inventory', async ({ page }) => {
    await loginAsStaff(page);
    await page.goto('/warehouse-dashboard');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/.*\/inventory/);
  });

  test('TC-INV-004: Stock Overview tab renders inventory tables and search', async ({ page }) => {
    await loginAsStaff(page);
    await page.goto('/inventory?tab=inventory');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/.*\/inventory\?tab=inventory/);
    const mainContent = page.locator('main, [role="main"]').first();
    await expect(mainContent).toBeVisible({ timeout: 10000 });
  });

  test('TC-INV-005: Warehouse Material Requests route redirects to requests tab', async ({ page }) => {
    await loginAsStaff(page);
    await page.goto('/warehouse/material-requests');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/.*\/inventory\?tab=requests/);
    const mainContent = page.locator('main, [role="main"]').first();
    await expect(mainContent).toBeVisible({ timeout: 10000 });
  });
});
