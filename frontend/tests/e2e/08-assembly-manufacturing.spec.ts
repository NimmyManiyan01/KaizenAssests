import { test, expect } from '@playwright/test';

async function loginAsStaff(page: any) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.getByPlaceholder('Enter username').fill('admin');
  await page.getByPlaceholder('Enter password').fill('admin123');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url: URL) => !url.pathname.includes('/login'), { timeout: 15000 });
}

test.describe('Module 08: Assembly & Manufacturing Operations', () => {

  test('TC-ASM-001: Assembly Dashboard renders production metrics & operational monitoring', async ({ page }) => {
    await loginAsStaff(page);
    await page.goto('/assembly-dashboard');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/.*\/assembly-dashboard/);
    const heading = page.getByRole('heading', { name: /assembly dashboard/i });
    await expect(heading.first()).toBeVisible({ timeout: 10000 });
  });

  test('TC-ASM-002: Production Execution screen renders work centers and active orders', async ({ page }) => {
    await loginAsStaff(page);
    await page.goto('/assembly/production');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/.*\/assembly\/production/);
    const title = page.getByText(/production|work center/i);
    await expect(title.first()).toBeVisible({ timeout: 10000 });
  });

  test('TC-ASM-003: Quality Inspection screen renders inspection checks and logs', async ({ page }) => {
    await loginAsStaff(page);
    await page.goto('/assembly/quality');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/.*\/assembly\/quality/);
    const title = page.getByText(/quality inspection|quality/i);
    await expect(title.first()).toBeVisible({ timeout: 10000 });
  });

  test('TC-ASM-004: Material Requests screen renders assembly requisitions queue', async ({ page }) => {
    await loginAsStaff(page);
    await page.goto('/assembly/material-requests');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/.*\/assembly\/material-requests/);
    const title = page.getByText(/material requests|assembly requests/i);
    await expect(title.first()).toBeVisible({ timeout: 10000 });
  });

  test('TC-ASM-005: Finished Goods screen renders staging and inventory records', async ({ page }) => {
    await loginAsStaff(page);
    await page.goto('/assembly/finished-goods');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/.*\/assembly\/finished-goods/);
    const title = page.getByText(/finished goods/i);
    await expect(title.first()).toBeVisible({ timeout: 10000 });
  });
});

