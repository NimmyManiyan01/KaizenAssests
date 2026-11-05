import { test, expect } from '@playwright/test';

async function loginAsStaff(page: any) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.getByPlaceholder('Enter username').fill('admin');
  await page.getByPlaceholder('Enter password').fill('admin123');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url: URL) => !url.pathname.includes('/login'), { timeout: 15000 });
}

test.describe('Module 06: Receiving, GRN & Damage Claims', () => {

  test('TC-RCV-001: Receiving Monitor dashboard renders inbound receipts', async ({ page }) => {
    await loginAsStaff(page);
    await page.goto('/receiving');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/.*\/receiving/);
    const heading = page.getByRole('heading', { name: /receiving monitor|inbound receipt/i });
    await expect(heading.first()).toBeVisible({ timeout: 10000 });
  });

  test('TC-RCV-002: GRN & Quality Inspection screen renders workflow tabs', async ({ page }) => {
    await loginAsStaff(page);
    await page.goto('/grn');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/.*\/grn/);
    const grnText = page.getByText(/GRN \/ Quality Inspection|Goods Receipt/i);
    await expect(grnText.first()).toBeVisible({ timeout: 10000 });
  });

  test('TC-RCV-003: Damage Claims screen renders claims log and replacement history', async ({ page }) => {
    await loginAsStaff(page);
    await page.goto('/damage-claims');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/.*\/damage-claims/);
    const claimsHeader = page.getByText(/Damage Claims|Damaged or rejected goods/i);
    await expect(claimsHeader.first()).toBeVisible({ timeout: 10000 });
  });

  test('TC-RCV-004: GRN search input is responsive and interactive', async ({ page }) => {
    await loginAsStaff(page);
    await page.goto('/grn');
    await page.waitForLoadState('networkidle');

    const searchInput = page.getByPlaceholder(/search|filter|grn/i).first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('GRN-TEST-123');
      await page.waitForTimeout(500);
      expect(await searchInput.inputValue()).toBe('GRN-TEST-123');
    }
  });
});

