import { expect, test, type Page } from '@playwright/test';
import type { AuthUser } from '../src/auth/ports';
import { setE2eUser } from './helpers/auth';
import { expectNoHorizontalOverflow } from './helpers/layoutAssertions';

const userA: AuthUser = {
  uid: 'e2e-user-a',
  displayName: 'E2E 旅人 A',
  email: 'a@example.test',
  photoURL: null,
};

const userB: AuthUser = {
  uid: 'e2e-user-b',
  displayName: 'E2E 旅人 B',
  email: 'b@example.test',
  photoURL: null,
};

async function clearBrowserData(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    sessionStorage.clear();
    const databases = await indexedDB.databases();
    await Promise.all(databases.flatMap(({ name }) => name ? [new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error(`Database ${name} is blocked`));
    })] : []));
  });
  await setE2eUser(page, null);
}

test.beforeEach(async ({ page }) => {
  await clearBrowserData(page);
});

test('keeps each signed-in account in its own local repository', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Studio is desktop-only.');

  await setE2eUser(page, userA);
  await page.goto('/studio/journeys/new');
  await page.getByLabel('旅程標題').fill('A 的東京旅程');
  await page.getByLabel('國家').fill('日本');
  await page.getByLabel('開始日期').fill('2026-01-01');
  await page.getByLabel('結束日期').fill('2026-01-03');
  await page.getByRole('button', { name: '建立旅程' }).click();
  await expect(page).toHaveURL(/\/studio\/journeys\//);

  await setE2eUser(page, userB);
  await page.goto('/studio');
  const accountMenu = page.locator('.account-menu');
  await expect(accountMenu).toBeVisible();
  await accountMenu.locator('summary').click();
  await expect(accountMenu.getByText('E2E 旅人 B', { exact: true })).toBeVisible();
  await expect(page.getByText('這裡還沒有草稿旅程。', { exact: true })).toBeVisible();
  await expect(page.getByText('A 的東京旅程', { exact: true })).toHaveCount(0);

  await setE2eUser(page, userA);
  await page.goto('/studio');
  await expect(accountMenu).toBeVisible();
  await accountMenu.locator('summary').click();
  await expect(accountMenu.getByText('E2E 旅人 A', { exact: true })).toBeVisible();
  await expect(page.getByText('A 的東京旅程', { exact: true })).toBeVisible();
});

test('recovers from a corrupted E2E session without leaving a blank app', async ({ page }) => {
  await page.evaluate(() => {
    sessionStorage.setItem('sound-passport-e2e-auth', '{not-json');
  });
  await page.reload();
  await page.goto('/studio');

  await expect(page.getByRole('heading', { name: '登入以整理私人旅程' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('sound-passport-e2e-auth'))).toBeNull();
});

test('requires sign-in before opening private studio routes', async ({ page }) => {
  await setE2eUser(page, null);
  await page.goto('/studio');
  await expect(page.getByRole('heading', { name: '登入以整理私人旅程' })).toBeVisible();
});

test('shows the signed-in private empty state and keeps demo routes available', async ({ page }) => {
  await setE2eUser(page, userA);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '還沒有私人旅程' })).toBeVisible();

  await page.goto('/demo');
  await expect(page.getByRole('button', { name: '日本，2 趟旅程' })).toBeVisible();
});

test('keeps the mobile account menu and demo route within the viewport', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Mobile-only account and layout proof.');
  expect(page.viewportSize()).toEqual({ width: 390, height: 844 });

  await setE2eUser(page, userA);
  await page.goto('/');
  const accountMenu = page.locator('.account-menu');
  await expect(accountMenu).toBeVisible();
  await accountMenu.locator('summary').click();
  await expect(accountMenu.getByText('E2E 旅人 A', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto('/demo');
  await expect(page.getByRole('button', { name: '日本，2 趟旅程' })).toBeVisible();
  const widths = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    documentElement: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(widths.body).toBeLessThanOrEqual(widths.viewport);
  expect(widths.documentElement).toBeLessThanOrEqual(widths.viewport);
  await expectNoHorizontalOverflow(page);
});
