# Authentication

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> code on this page looks unfamiliar.

Almost every real SAP Fiori/SAPUI5 app sits behind a login screen. This page is a recipe for
handling that without logging in again at the start of every single test.

**A note on this page specifically**: unlike the rest of this documentation, the pattern here
isn't demonstrated by a runnable file in `examples/tests/` - this repo's example app (SAP's public
Shopping Cart demo) has no login, so there's nothing real to verify it against. Everything below
is the standard, [officially documented](https://playwright.dev/docs/auth) Playwright approach,
adapted with SAPUI5-specific notes; you'll need to fill in your own app's actual login form
locators.

## The problem

Logging in through the UI (typing a username, a password, clicking "Log On") is slow, and doing
it in every single test multiplies that cost by your entire suite. The fix: log in **once**,
save the browser's authenticated session state, and have every other test start from that saved
state instead of a fresh, logged-out browser.

## The pattern: log in once, reuse `storageState`

Playwright can save a browser context's cookies and local storage to a file
(`page.context().storageState()`), and load that same file into a fresh context for another test
(`use: { storageState: 'auth.json' }`). Three pieces:

### 1. A setup project that logs in and saves state

```ts
// auth.setup.ts
import { test as setup } from 'playwright-sapui5';
import { Ui5Bridge } from 'playwright-sapui5';

const authFile = 'playwright/.auth/user.json';

setup('authenticate', async ({ page }) => {
  // Install the bridge before navigating so auto-wait can see the login page's own bootstrap -
  // see docs/auto-wait.md#the-ordering-gotcha-bridge-installation-vs-navigation.
  await Ui5Bridge.ensure(page);
  await page.goto('https://your-app.example.com/');

  // Adapt to your app's actual login form. Many SAPUI5/Fiori apps use plain sap.m.Input /
  // sap.m.Button controls for a form-based login screen - if yours does:
  await page.locator('#username-input-inner').fill(process.env.TEST_USERNAME ?? '');
  await page.locator('#password-input-inner').fill(process.env.TEST_PASSWORD ?? '');
  await page.getByRole('button', { name: 'Log On' }).click();

  // Wait for something only a logged-in session shows, to be sure login actually succeeded
  // before saving state - not just that the click happened.
  await page.getByText('Welcome').waitFor();

  await page.context().storageState({ path: authFile });
});
```

Never hardcode real credentials in this file - read them from environment variables (see
[docs/multi-environment-config.md](multi-environment-config.md) for the same `.env` pattern used
for base URLs) and keep them out of version control.

### 2. Point your other tests at the saved state

```ts
// playwright.config.ts
export default defineConfig({
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/user.json' },
      dependencies: ['setup'],
    },
  ],
});
```

The `dependencies: ['setup']` line makes Playwright always run the login step first, automatically

- you don't call it manually from each test.

### 3. Every other test just starts logged in

```ts
import { test, expect } from 'playwright-sapui5';
import { HomePage } from '../pages/HomePage';

test('a logged-in user sees their dashboard', async ({ page }) => {
  const home = new HomePage(page);
  await home.open(); // no login step here - the session is already authenticated
  await expect(await home.welcomeMessage.resolve()).toBeVisible();
});
```

## SAPUI5-specific notes

- **Wait for the app shell, not just the login form to disappear.** After a successful login,
  SAP Fiori Launchpad (or your app's own shell) typically bootstraps its own SAPUI5 runtime -
  wait for something concrete from the _post-login_ app (a specific tile, a welcome message, a
  known control) rather than just "the login form is gone," which can be true for a moment before
  the real content has rendered.
- **SAML/redirect-based login** (common for enterprise SSO) involves the browser navigating away
  from your app entirely to an identity provider and back. The pattern is the same
  (`page.goto()` your app, interact with whatever form the IdP shows, wait to land back on your
  app), but expect more `page.waitForURL(...)` calls tracking the redirect chain.
- **Basic Auth** (less common, but simple when present) doesn't need any of this - pass
  credentials directly via
  [`httpCredentials`](https://playwright.dev/docs/api/class-browser#browser-new-context-option-http-credentials)
  in your Playwright config instead.

## Keep `playwright/.auth/` out of version control

The saved state file contains live session cookies/tokens - treat it like a credential. Add it to
`.gitignore`:

```gitignore
playwright/.auth/
```

Each CI run (and each developer) regenerates it via the `setup` project; it never needs to be
committed.
