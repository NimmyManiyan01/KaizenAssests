import { test, expect } from '@playwright/test';

test.describe('Phase 0: Reconnaissance & Infrastructure Verification', () => {
  test('0.1 Verify Landing Page and 3D Shell', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    const startTime = Date.now();
    const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
    const loadTime = Date.now() - startTime;

    expect(response?.status()).toBe(200);
    console.log(`[Recon] Landing page loaded in ${loadTime}ms with HTTP ${response?.status()}`);

    // Verify Title & Brand
    await expect(page).toHaveTitle(/Kaizen/i);
    const brandElement = page.getByText('KaizenAssests').first();
    await expect(brandElement).toBeVisible({ timeout: 15000 });

    // Verify Sign In CTA
    const signInButton = page.getByRole('button', { name: /Sign In/i });
    await expect(signInButton).toBeVisible();

    // Check Canvas or 3D container presence
    const canvasElement = page.locator('canvas');
    const hasCanvas = await canvasElement.count();
    console.log(`[Recon] 3D WebGL Canvas count on landing page: ${hasCanvas}`);

    await page.screenshot({ path: 'test-results/screenshots/00-landing-page.png', fullPage: true });
  });

  test('0.2 Verify Login Page and Form Structure', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/login/);

    // Verify Form Fields
    const usernameInput = page.getByPlaceholder('Enter username');
    await expect(usernameInput).toBeVisible();

    const passwordInput = page.getByPlaceholder('Enter password');
    await expect(passwordInput).toBeVisible();

    const submitBtn = page.getByRole('button', { name: 'Sign In' });
    await expect(submitBtn).toBeVisible();

    await page.screenshot({ path: 'test-results/screenshots/00-login-page.png' });
  });

  test('0.3 Execute Live Authentication & Post-Login Redirection', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    // Fill credentials
    const usernameInput = page.getByPlaceholder('Enter username');
    const passwordInput = page.getByPlaceholder('Enter password');
    const submitBtn = page.getByRole('button', { name: 'Sign In' });

    await usernameInput.fill('admin');
    await passwordInput.fill('admin123');

    // Monitor network API response
    const [loginResponse] = await Promise.all([
      page.waitForResponse(res => res.url().includes('/api/v1/auth/login') || res.url().includes('/auth/login')),
      submitBtn.click(),
    ]);

    console.log(`[Recon] Auth API response status: ${loginResponse.status()}`);
    expect(loginResponse.status()).toBe(200);

    const loginData = await loginResponse.json();
    console.log(`[Recon] Auth Success! User: ${loginData.user?.username || loginData.username}, Roles: ${JSON.stringify(loginData.user?.roles || loginData.roles)}`);

    // Verify post-login redirection to /admin
    await page.waitForURL(/\/admin/, { timeout: 15000 });
    console.log(`[Recon] Successfully redirected to: ${page.url()}`);
    expect(page.url()).toContain('/admin');

    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'test-results/screenshots/00-admin-dashboard.png' });

    // Inspect Session Tokens
    const sessionToken = await page.evaluate(() => sessionStorage.getItem('auth_token'));
    expect(sessionToken).toBeTruthy();
    console.log(`[Recon] Active session JWT confirmed in sessionStorage (length: ${sessionToken?.length})`);
  });

  test('0.4 Map Admin Application Navigation & Modules', async ({ page }) => {
    // Log in first
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await page.getByPlaceholder('Enter username').fill('admin');
    await page.getByPlaceholder('Enter password').fill('admin123');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.waitForURL(/\/admin/, { timeout: 15000 });
    await page.waitForLoadState('networkidle');

    // Discover all accessible navigation links in the dashboard/sidebar
    const links = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href], button[data-route], nav a'));
      return anchors.map(a => ({
        text: (a.textContent || '').trim().replace(/\s+/g, ' '),
        href: a.getAttribute('href') || a.getAttribute('data-route') || '',
      })).filter(item => item.href.length > 0 && !item.href.startsWith('#') && !item.href.startsWith('mailto:'));
    });

    console.log(`[Recon] Discovered ${links.length} interactive navigation links in Admin Shell:`);
    const uniqueLinks = Array.from(new Set(links.map(l => `${l.text} -> ${l.href}`)));
    uniqueLinks.forEach(l => console.log(`   * ${l}`));
  });
});
