import { test, expect, Page } from '@playwright/test';

/**
 * Phase 1.1 end-to-end coverage.
 *
 * Prerequisites: a running backend (proxy /login, /auth/register, /tasks),
 * and `npm run dev`/`npm start` on :3000. Uses throwaway accounts; the
 * account-deletion spec cleans up the account it creates.
 */

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';

function randomUsername() {
  return `e2e_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

async function register(page: Page, username: string) {
  await page.goto(`${BASE}/login?mode=register`);
  await page.fill('input[placeholder="Enter username"]', username);
  await page.fill('input[placeholder="you@example.com"]', `${username}@example.com`);
  await page.fill('input[placeholder="Enter password"]', 'password123');
  await page.click('button:has-text("Create Account")');
  await page.waitForURL('**/dashboard', { timeout: 15_000 });
}

test('register from unified shell runs a task with human-stage badges', async ({ page }) => {
  const username = randomUsername();
  await register(page, username);

  await page.click('button:has-text("+ New Task")');
  await page.fill('textarea[placeholder^="Describe what you want"]', 'Analyse current crypto market sentiment');
  await page.click('button:has-text("Deploy Agent")');

  // The task card should never show raw internal statuses like "pending".
  await expect(page.locator('text=pending')).toHaveCount(0);

  // Created task surfaces with an active stage label.
  await expect(page.locator('text=Preparing').first()).toBeVisible({ timeout: 15_000 });
});

test('wallet discovery honours EIP-6963 and surfaces rejection clearly', async ({ page }) => {
  await page.addInitScript(() => {
    const announce = {
      info: {
        uuid: 'f08aa3c9-6e4f-4e6d-9c4a-7f6e8b1a2c3d',
        name: 'TestWallet',
        icon: '',
        rdns: 'io.testwallet',
      },
      provider: {
        request: async ({ method }: { method: string }) => {
          if (method === 'eth_requestAccounts') {
            const error: any = new Error('User rejected the request.');
            error.code = 4001;
            throw error;
          }
          if (method === 'eth_chainId') return '0x1';
          return null;
        },
      },
    };
    const originalDispatch = window.dispatchEvent.bind(window);
    window.dispatchEvent = (event: Event) => {
      if (event.type === 'eip6963:requestProvider') {
        window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: announce }));
      }
      return originalDispatch(event);
    };
  });

  await page.goto(`${BASE}/login`);
  await page.click('button:has-text("Connect Wallet")');
  await expect(page.locator('text=TestWallet')).toBeVisible();
  await page.click('button:has-text("TestWallet")');

  await expect(page.locator('text=rejected')).toBeVisible({ timeout: 10_000 });
});

test('mobile viewport shows install fallback when no wallet announces', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/login`);
  await page.click('button:has-text("Connect Wallet")');
  await expect(page.locator('text=No installed browser wallet was detected')).toBeVisible();
  await expect(page.locator('a:has-text("Install →")').first()).toBeVisible();
});

test('account deletion redirects to the unified login shell', async ({ page }) => {
  const username = randomUsername();
  await register(page, username);

  await page.goto(`${BASE}/settings`);
  await page.click('button:has-text("Maintenance")');
  await page.on('dialog', (dialog) => dialog.accept());
  await page.click('button:has-text("Delete my account")');

  await page.waitForURL('**/login', { timeout: 15_000 });
  await expect(page.locator('text=Sign In')).toBeVisible();

  // The deleted account cannot sign in again.
  await page.fill('input[placeholder="Enter username"]', username);
  await page.fill('input[placeholder="Enter password"]', 'password123');
  await page.click('button:has-text("Sign In")');
  await expect(page.locator('text=invalid credentials')).toBeVisible();
});