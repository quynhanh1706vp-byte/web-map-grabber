import { expect } from '@playwright/test';
export async function ensureLocalTab(page) {
  for (const sel of ["input[name='username']", "input[name='email']"]) {
    if (await page.$(sel)) return;
  }
  for (const tabSel of ["[data-testid='tab-local']", "text=Local"]) {
    const el = await page.$(tabSel);
    if (!el) continue;
    await el.click().catch(()=>{});
    for (const sel of ["input[name='username']", "input[name='email']"]) {
      if (await page.locator(sel).first().isVisible({ timeout: 3000 }).catch(()=>false)) return;
    }
  }
  const tabByRole = page.getByRole('tab', { name: /local/i });
  if (await tabByRole.count()) await tabByRole.first().click().catch(()=>{});
}
