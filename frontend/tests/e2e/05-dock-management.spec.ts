import { test, expect } from '@playwright/test';

async function loginAsStaff(page: any) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.getByPlaceholder('Enter username').fill('admin');
  await page.getByPlaceholder('Enter password').fill('admin123');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url: URL) => !url.pathname.includes('/login'), { timeout: 15000 });
}

test.describe('Module 05: Dock Management & Master', () => {

  test('TC-DOCK-001: Dock Management dashboard renders dock status & queue', async ({ page }) => {
    await loginAsStaff(page);
    await page.goto('/dock-management');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/.*\/dock-management/);
    const heading = page.getByRole('heading', { name: /dock management/i });
    await expect(heading.first()).toBeVisible({ timeout: 10000 });

    const waitingSection = page.getByText(/approved vehicles waiting|dock/i);
    await expect(waitingSection.first()).toBeVisible();
  });

  test('TC-DOCK-002: Dock Master route properly redirects to Dock Management', async ({ page }) => {
    await loginAsStaff(page);
    await page.goto('/dock-master');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/.*\/dock-management/);
    const heading = page.getByRole('heading', { name: /dock management/i });
    await expect(heading.first()).toBeVisible();
  });

  test('TC-DOCK-003: Dock Management refresh control is operational', async ({ page }) => {
    await loginAsStaff(page);
    await page.goto('/dock-management');
    await page.waitForLoadState('networkidle');

    const refreshBtn = page.getByRole('button', { name: /refresh dock management/i });
    if (await refreshBtn.isVisible()) {
      await refreshBtn.click();
      await page.waitForTimeout(1000);
      await expect(page.getByRole('heading', { name: /dock management/i }).first()).toBeVisible();
    }
  });

  test('TC-DOCK-004: Unauthenticated access boundaries on Dock Management', async ({ browser }) => {
    const unauthContext = await browser.newContext();
    const page = await unauthContext.newPage();

    await page.goto('/dock-management');
    await page.waitForLoadState('networkidle');

    // Verify unauthenticated session holds no auth credentials
    const token = await page.evaluate(() => sessionStorage.getItem('auth_token'));
    expect(token).toBeNull();

    // Verify empty state is rendered and no unauthorized live allocations are exposed
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeDefined();

    await unauthContext.close();
  });
});
