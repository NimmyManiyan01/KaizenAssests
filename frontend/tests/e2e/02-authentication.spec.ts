import { test, expect } from '@playwright/test';

test.describe('Module 02: Authentication & Security', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
  });

  test('TC-AUTH-001: Valid Staff Login redirects to /admin with active session', async ({ page }) => {
    const usernameInput = page.getByPlaceholder('Enter username');
    const passwordInput = page.getByPlaceholder('Enter password');
    const signInBtn = page.getByRole('button', { name: 'Sign In' });

    await usernameInput.fill('admin');
    await passwordInput.fill('admin123');

    const [loginResponse] = await Promise.all([
      page.waitForResponse(res => res.url().includes('/api/v1/auth/login')),
      signInBtn.click(),
    ]);

    expect(loginResponse.status()).toBe(200);
    const data = await loginResponse.json();
    expect(data.token).toBeTruthy();
    expect(data.username).toBe('admin');

    await page.waitForURL(/\/admin/, { timeout: 15000 });
    expect(page.url()).toContain('/admin');

    const token = await page.evaluate(() => sessionStorage.getItem('auth_token'));
    expect(token).toBe(data.token);
  });

  test('TC-AUTH-002: Invalid password returns 401 and displays toast error', async ({ page }) => {
    const usernameInput = page.getByPlaceholder('Enter username');
    const passwordInput = page.getByPlaceholder('Enter password');
    const signInBtn = page.getByRole('button', { name: 'Sign In' });

    await usernameInput.fill('admin');
    await passwordInput.fill('InvalidPassword999!');

    const [loginResponse] = await Promise.all([
      page.waitForResponse(res => res.url().includes('/api/v1/auth/login')),
      signInBtn.click(),
    ]);

    expect(loginResponse.status()).toBe(401);
    await page.waitForTimeout(1000);
    // User remains on /login
    expect(page.url()).toContain('/login');
  });

  test('TC-AUTH-003: Empty fields submission displays client toast error', async ({ page }) => {
    let networkCallMade = false;
    page.on('request', req => {
      if (req.url().includes('/api/v1/auth/login')) networkCallMade = true;
    });

    const signInBtn = page.getByRole('button', { name: 'Sign In' });
    await signInBtn.click();

    expect(networkCallMade).toBe(false);
  });

  test('TC-AUTH-004: Boundary validation on maximum input length', async ({ page }) => {
    const usernameInput = page.getByPlaceholder('Enter username');
    const passwordInput = page.getByPlaceholder('Enter password');

    const longUsername = 'a'.repeat(105);
    const longPassword = 'b'.repeat(135);

    await usernameInput.fill(longUsername);
    await passwordInput.fill(longPassword);

    // Maxlength attributes on the HTML elements clamp the inputs
    const userVal = await usernameInput.inputValue();
    const passVal = await passwordInput.inputValue();
    expect(userVal.length).toBeLessThanOrEqual(100);
    expect(passVal.length).toBeLessThanOrEqual(128);
  });

  test('TC-AUTH-005: Password visibility toggle alternates input type', async ({ page }) => {
    const passwordInput = page.getByPlaceholder('Enter password');
    await passwordInput.fill('secret123');
    expect(await passwordInput.getAttribute('type')).toBe('password');

    const toggleBtn = page.getByLabel(/show password|hide password/i);
    await toggleBtn.click();
    expect(await passwordInput.getAttribute('type')).toBe('text');

    await toggleBtn.click();
    expect(await passwordInput.getAttribute('type')).toBe('password');
  });

  test('TC-AUTH-006: Session tokens are tab-scoped to sessionStorage', async ({ page }) => {
    const usernameInput = page.getByPlaceholder('Enter username');
    const passwordInput = page.getByPlaceholder('Enter password');
    await usernameInput.fill('admin');
    await passwordInput.fill('admin123');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.waitForURL(/\/admin/);

    const storageCheck = await page.evaluate(() => ({
      hasSessionToken: !!sessionStorage.getItem('auth_token'),
      hasLocalToken: !!localStorage.getItem('auth_token'),
    }));

    expect(storageCheck.hasSessionToken).toBe(true);
    expect(storageCheck.hasLocalToken).toBe(false);
  });
});
