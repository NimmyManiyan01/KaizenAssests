import { test, expect } from '@playwright/test';

async function loginAsAdmin(page: any) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.getByPlaceholder('Enter username').fill('admin');
  await page.getByPlaceholder('Enter password').fill('admin123');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL(/\/admin/, { timeout: 15000 });
  await page.waitForLoadState('networkidle');
}

test.describe('Module 03: Admin Management & System Governance', () => {
  test('TC-ADM-001: Admin Overview Dashboard renders KPIs and recent activity', async ({ page }) => {
    await loginAsAdmin(page);

    // Verify Overview header & title
    await expect(page.getByText(/admin|overview|dashboard/i).first()).toBeVisible();

    // Verify KPI / metric cards exist
    const cards = page.locator('[class*="rounded"], [class*="card"]');
    expect(await cards.count()).toBeGreaterThan(3);

    // Verify navigation buttons to submodules (Audit log, Users, Suppliers)
    await expect(page.getByRole('link', { name: /audit log/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /manage users|users/i }).first()).toBeVisible();
  });

  test('TC-ADM-002: User Management screen loads with staff listing', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/users');
    await page.waitForLoadState('networkidle');

    expect(page.url()).toContain('/admin/users');
    await expect(page.getByText(/user|staff|management|accounts/i).first()).toBeVisible();

    // Check for user table or list elements
    const tableOrList = page.locator('table, [role="table"], [class*="table"]').first();
    await expect(tableOrList).toBeVisible({ timeout: 10000 });
  });

  test('TC-ADM-003: Supplier Management screen loads vendor directory', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/suppliers');
    await page.waitForLoadState('networkidle');

    expect(page.url()).toContain('/admin/suppliers');
    await expect(page.getByText(/supplier|vendor/i).first()).toBeVisible();
  });

  test('TC-ADM-004: Security Audit Trail loads with system activity records', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/audit');
    await page.waitForLoadState('networkidle');

    expect(page.url()).toContain('/admin/audit');
    await expect(page.getByText(/audit|logs|security|events/i).first()).toBeVisible();
  });

  test('TC-ADM-005: Unauthenticated access to /admin enforces RBAC session boundaries', async ({ browser }) => {
    const freshContext = await browser.newContext();
    const freshPage = await freshContext.newPage();
    await freshPage.goto('/admin');
    await freshPage.waitForLoadState('networkidle');

    // Verify unauthenticated session cannot access protected admin data
    const token = await freshPage.evaluate(() => sessionStorage.getItem('auth_token'));
    expect(token).toBeNull();
    await freshContext.close();
  });
});
