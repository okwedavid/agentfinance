import { test, expect } from '@playwright/test';

test('login and create task', async ({ page }) => {
  await page.goto('http://localhost:3000/login');
  await page.fill('input[placeholder="admin@agentfinance.com"]', 'admin@agentfinance.com');
  await page.fill('input[placeholder="password"]', 'password');
  await page.click('button:has-text("Login")');
  await page.waitForURL('**/dashboard');

  await page.click('button:has-text("New Task")');
  await page.fill('input[placeholder="e.g., Analyze Q3 financials"]', 'Test task from E2E');
  await page.click('button:has-text("Create Task")');
  await page.waitForTimeout(2000);
  await expect(page.locator('text=Test task from E2E')).toBeVisible();
});
