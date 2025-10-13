import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const BASE_URL      = process.env.BASE_URL || '';
const LOGIN_URL     = process.env.LOGIN_URL || '/login';
const USERNAME      = process.env.USERNAME || '';
const PASSWORD      = process.env.PASSWORD || '';
const OUT_ROOT      = process.env.OUT_DIR  || '_artifacts/assets';
const ASSET_PATTERNS = (process.env.ASSET_PATTERNS || '\\.js($|\\?)|\\.map($|\\?)').split(/\s*,\s*/);
const EXTRA_PATHS   = (process.env.EXTRA_PATHS || '/,/home,/dashboard').split(/\s*,\s*/).filter(Boolean);

if (!BASE_URL || !USERNAME || !PASSWORD) {
  console.error('❌ Missing env: BASE_URL, USERNAME, PASSWORD (LOGIN_URL optional)');
  process.exit(1);
}

const pad = n => String(n).padStart(2,'0');
const stamp = (() => {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
})();

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function matchPattern(url, patterns) { return patterns.some(p => new RegExp(p, 'i').test(url)); }
function safeJoinUrl(base, rel) { try { return new URL(rel, base).toString(); } catch { return rel; } }
function buildOutPath(root, urlObj, withQuery = true) {
  const cleanHost = urlObj.host.replace(/[^a-z0-9.\-]/gi, '_');
  let p = urlObj.pathname;
  if (p.endsWith('/')) p += 'index.html';
  let suffix = '';
  if (withQuery && urlObj.searchParams && [...urlObj.searchParams].length > 0) {
    suffix = '__' + urlObj.searchParams.toString().replace(/[^a-z0-9_\-=&]/gi, '_');
  }
  const out = path.join(root, cleanHost, p + suffix);
  ensureDir(path.dirname(out));
  return out;
}
async function saveBuffer(fullUrl, buf, root) {
  const u = new URL(fullUrl);
  const out = buildOutPath(root, u, true);
  fs.writeFileSync(out, buf);
  return out;
}
async function fetchAndSave(context, fullUrl, root) {
  const resp = await context.request.get(fullUrl);
  if (!resp.ok()) return null;
  return await saveBuffer(fullUrl, await resp.body(), root);
}
async function tryDownloadMapFromJS(context, jsUrl, jsText, root) {
  const m = jsText.match(/[#@]\s*sourceMappingURL\s*=\s*(.+)$/m);
  if (m && m[1]) {
    const mapUrl = safeJoinUrl(jsUrl, m[1].trim());
    const saved = await fetchAndSave(context, mapUrl, root);
    if (saved) return saved;
  }
  if (!/\.map($|\?)/i.test(jsUrl)) {
    const guess = jsUrl.split('?')[0] + '.map';
    const saved = await fetchAndSave(context, guess, root);
    if (saved) return saved;
  }
  return null;
}
async function performLogin(page) {
  await page.goto(LOGIN_URL, { waitUntil: 'load' });
  const u = page.locator('[data-testid="login-username"], input[name="username"], #username, input[type="email"]');
  const p = page.locator('[data-testid="login-password"], input[name="password"], #password, input[type="password"]');
  const s = page.locator('[data-testid="login-submit"], #kc-login, button[type="submit"], input[type="submit"], button:has-text("Đăng nhập"), button:has-text("Login")');
  if (await u.count() > 0) await u.first().fill(USERNAME);
  if (await p.count() > 0) await p.first().fill(PASSWORD);
  if (await s.count() > 0) await s.first().click(); else await page.keyboard.press('Enter');
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(()=>{});
}
(async () => {
  const OUT_DIR = path.join(OUT_ROOT, stamp);
  ensureDir(OUT_DIR);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL: BASE_URL,
    recordHar: { path: path.join(OUT_DIR, 'network.har'), mode: 'minimal' },
  });
  const page = await context.newPage();
  const jsBodies = new Map();
  context.on('response', async (resp) => {
    const url = resp.url();
    if (!matchPattern(url, ASSET_PATTERNS)) return;
    try {
      const buf = await resp.body();
      await saveBuffer(url, buf, OUT_DIR);
      if (buf.length <= 15 * 1024 * 1024) {
        const ct = (resp.headers()['content-type'] || '').toLowerCase();
        if (ct.includes('javascript') || url.endsWith('.js') || url.includes('.js?')) {
          jsBodies.set(url, buf.toString('utf-8'));
        }
      }
    } catch {}
  });
  try {
    await performLogin(page);
    for (const p of EXTRA_PATHS) {
      try {
        await page.goto(p, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle', { timeout: 10000 });
      } catch {}
    }
    await fs.promises.writeFile(path.join(OUT_DIR, 'last_page.html'), await page.content());
    for (const [jsUrl, jsText] of jsBodies.entries()) {
      try { await tryDownloadMapFromJS(context, jsUrl, jsText, OUT_DIR); } catch {}
    }
    console.log(`✅ Done. Saved assets to: ${OUT_DIR}`);
  } finally {
    await context.close();
    await browser.close();
  }
})();
