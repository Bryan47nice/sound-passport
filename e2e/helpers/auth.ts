import type { Page } from '@playwright/test';
import type { AuthUser } from '../../src/auth/ports';

export const defaultE2eUser: AuthUser = {
  uid: 'e2e-user-a',
  displayName: 'E2E 旅人 A',
  email: 'a@example.test',
  photoURL: null,
};

export async function setE2eUser(page: Page, user: AuthUser | null) {
  await page.waitForFunction(() => Boolean(window.__SOUND_PASSPORT_E2E_AUTH__));
  await page.evaluate((nextUser) => {
    window.__SOUND_PASSPORT_E2E_AUTH__?.setUser(nextUser);
  }, user);
}
