# E2E Notes
- Login flow: force "Local" tab (Keycloak).
- Use APP_ENTRY=https://staging-zt.lab.linksafe.vn to obtain state/PKCE automatically.
- Playwright 1.56: avoid expect.setDefaultTimeout; use test.setTimeout or per-step timeouts.
