// Playwright v1.56-compatible (ESM)

import { test, expect } from '@playwright/test';

// ==== ENV ====
const ENV = {
  BASE_URL: process.env.BASE_URL || 'https://staging.lab.linksafe.vn',
  LOGIN_URL:
    process.env.LOGIN_URL ||
    'https://staging.lab.linksafe.vn/realms/itim/protocol/openid-connect/auth',
  LOGIN_TAB: (process.env.LOGIN_TAB || 'Local').toLowerCase(),
  TEST_EMAIL_VALID: process.env.TEST_EMAIL_VALID || 'admin@lancsnet.com',
  TEST_PASSWORD: process.env.TEST_PASSWORD || '', // OPTIONAL — set in env if allowed
};

// ==== Helpers ====

// Ensure "Local" tab is active on Keycloak login
async function ensureLocalTab(page) {
  const emailCands = ["input[name='username']", "input[name='email']"];
  for (const sel of emailCands) {
    if (await page.$(sel)) return;
  }
  const localTabCands = ["[data-testid='tab-local']", "text=Local"];
  for (const tabSel of localTabCands) {
    const el = await page.$(tabSel);
    if (!el) continue;
    await el.click().catch(() => {});
    for (const sel of emailCands) {
      if (await page.locator(sel).first().isVisible({ timeout: 3000 }).catch(() => false)) return;
    }
  }
  const tabByRole = page.getByRole('tab', { name: /local/i });
  if (await tabByRole.count()) {
    await tabByRole.first().click().catch(() => {});
  }
}

// Robust login that avoids waitForNavigation('load')
async function loginLocal(page) {
  if (page.url().startsWith(ENV.BASE_URL)) return;

  await page.goto(ENV.LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });

  if (ENV.LOGIN_TAB === 'local') {
    await ensureLocalTab(page);
  }

  const emailSel = ["input[name='username']", "input[name='email']"];
  for (const sel of emailSel) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible().catch(() => false)) {
      if (ENV.TEST_EMAIL_VALID) await loc.fill(ENV.TEST_EMAIL_VALID);
      break;
    }
  }

  if (ENV.TEST_PASSWORD) {
    const passSel = ["input[name='password']"];
    for (const sel of passSel) {
      const loc = page.locator(sel).first();
      if (await loc.isVisible().catch(() => false)) {
        await loc.fill(ENV.TEST_PASSWORD);
        break;
      }
    }
  }

  const clickLogin = async () => {
    const byRole = page.getByRole('button', { name: /Đăng nhập|Login|Sign in/i });
    if (await byRole.count()) {
      await byRole.first().click().catch(() => {});
      return;
    }
    await page.click("button[type='submit'], input[type='submit']").catch(() => {});
  };

  const targetUrl = new RegExp(
    `^(?:${ENV.BASE_URL.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}|https?://staging-zt\\.lab\\.linksafe\\.vn)`,
    'i'
  );
  const appAnchor = page.locator(
    "[data-testid='nav-dashboard'], [data-testid='nav-assets'], #dashboard, .breadcrumb"
  );

  const waiters = [
    page.waitForURL(targetUrl, { timeout: 90_000 }).catch(() => {}),
    appAnchor.first().waitFor({ state: 'visible', timeout: 90_000 }).catch(() => {}),
    page.waitForLoadState('networkidle', { timeout: 90_000 }).catch(() => {}),
  ];

  await Promise.allSettled([clickLogin(), ...waiters]);

  if (/\/realms\/itim\/protocol\/openid-connect\/auth/i.test(page.url())) {
    await ensureLocalTab(page);
    await Promise.allSettled([clickLogin(), page.waitForLoadState('networkidle', { timeout: 20_000 })]);

    if (/\/realms\/itim\/protocol\/openid-connect\/auth/i.test(page.url())) {
      const kcErr = page.locator('#kc-error-message, .pf-c-alert__title').first();
      if (await kcErr.isVisible().catch(() => false)) {
        console.warn('[Keycloak] Error banner:', await kcErr.innerText());
      }
      throw new Error('Login stuck on Keycloak: make sure Local tab is active and credentials are valid.');
    }
  }
}

async function clickSafe(page, selector) {
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: 'visible', timeout: 30_000 });
  await loc.click();
}

test.setTimeout(120_000);

// [MAP] ITIM-NAV-001 Global Navigation to core modules
test('[MAP] ITIM-NAV-001 Global Navigation to core modules', async ({ page }) => {
  await loginLocal(page);

  await page.goto(`${ENV.BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  await clickSafe(page, "[data-testid='nav-dashboard']");
  await expect(page).toHaveURL(/\/dashboard/i);

  await clickSafe(page, "[data-testid='nav-assets']");
  await expect(page).toHaveURL(/\/assets/i);

  await clickSafe(page, "[data-testid='nav-packages']");
  await expect(page).toHaveURL(/\/packages/i);
});

// [MAP] ITIM-AS-NEW-001 Create minimal Asset
test('[MAP] ITIM-AS-NEW-001 Create minimal Asset', async ({ page }) => {
  await loginLocal(page);

  const AS_NAME_MIN = `auto-asset-${Date.now()}`;
  await page.goto(`${ENV.BASE_URL}/assets`, { waitUntil: 'domcontentloaded' });
  await clickSafe(page, "[data-testid='btn-new-asset']");
  await page.locator("form[name='asset'] input[name='name']").fill(AS_NAME_MIN);
  await clickSafe(page, "[data-testid='btn-save-asset']");
  await expect(page.locator('.toast-success').first()).toBeVisible();
});

// [MAP] ITIM-AS-SRCH-ADV-001 Assets advanced filter returns exact rows
test('[MAP] ITIM-AS-SRCH-ADV-001 Assets advanced filter returns exact rows', async ({ page }) => {
  await loginLocal(page);

  const FILTER_NAME = 'auto-asset';
  await page.goto(`${ENV.BASE_URL}/assets`, { waitUntil: 'domcontentloaded' });
  await clickSafe(page, "[data-testid='btn-advanced-filter']");
  await page.locator("input[name='name-contains']").fill(FILTER_NAME);
  await clickSafe(page, "[data-testid='btn-apply-filter']");
  await expect(page.locator("table[data-testid='asset-table']").first()).toBeVisible();
  await expect(page.locator("table[data-testid='asset-table']")).toContainText(FILTER_NAME);
});
