import { test, expect } from '@playwright/test';

test('Debug Login Flow Live', async ({ page }) => {
  page.on('console', msg => console.log(`[Browser Console ${msg.type()}] ${msg.text()}`));
  page.on('request', req => console.log(`[Browser Request] ${req.method()} ${req.url()}`));
  page.on('response', res => console.log(`[Browser Response] ${res.status()} ${res.url()}`));
  page.on('requestfailed', req => console.log(`[Browser Request Failed] ${req.url()} - ${req.failure()?.errorText}`));

  await page.goto('/login');
  await page.waitForLoadState('networkidle');

  console.log('[Test] Page loaded. Locating inputs...');
  const usernameInput = page.getByPlaceholder('Enter username');
  const passwordInput = page.getByPlaceholder('Enter password');
  const signInButton = page.getByRole('button', { name: 'Sign In' });

  await expect(usernameInput).toBeVisible();
  await expect(passwordInput).toBeVisible();
  await expect(signInButton).toBeVisible();

  console.log('[Test] Typing credentials...');
  await usernameInput.fill('admin');
  await passwordInput.fill('admin123');

  console.log('[Test] Clicking Sign In...');
  await signInButton.click();

  // Wait 10 seconds to observe what happens
  await page.waitForTimeout(10000);

  console.log('[Test] Current URL after 10s:', page.url());
  const toastText = await page.locator('[data-sonner-toast]').allTextContents();
  console.log('[Test] Toast contents:', toastText);
});

