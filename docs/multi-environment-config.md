# Multi-environment configuration

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> config code on this page looks unfamiliar.

Real projects usually test against more than one URL: a dev system, a QA/test system, maybe a
staging or production smoke-test environment. Hardcoding one URL into your Page Objects means
editing source code every time you switch. This page shows the pattern this repo's own example
suite uses to avoid that.

## The pattern: `baseURL` + an env var

Playwright has a built-in concept of a **base URL** (`use.baseURL` in `playwright.config.ts`).
Once set, any relative URL passed to `page.goto()` resolves against it. Combine that with reading
the base URL from an environment variable, and switching environments becomes a config change,
not a code change:

```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

loadEnv({ quiet: true }); // reads a local .env file, if one exists

const DEFAULT_URL = 'https://your-app.example.com/';

export default defineConfig({
  use: {
    baseURL: process.env.BASE_URL ?? DEFAULT_URL,
    // ...
  },
  // ...
});
```

Then, in a Page Object, navigate with a relative URL instead of a hardcoded one:

```ts
export class HomePage extends Ui5Page {
  async open() {
    await this.goto(''); // resolves against the configured baseURL
  }
}
```

**Why an empty string, not `'/'`:** if your `baseURL` includes a path (e.g.
`https://host/some/app/index.html`, as this repo's own example app's URL does - not just
`https://host/`), `goto('/')` resolves to the **domain root**, discarding that path entirely
(that's how URL resolution works: a leading `/` always means "absolute path from the domain").
`goto('')` resolves to the `baseURL` exactly as configured, unchanged. If your app genuinely is
served from a domain root, `goto('/')` works too - but `goto('')` is correct either way, so it's
the safer default to reach for.

## Setting the environment

Copy [`.env.example`](../.env.example) to `.env` (already gitignored - never commit real
environment URLs, and especially never commit credentials) and set your own value:

```bash
cp .env.example .env
```

```dotenv
# .env
BASE_URL=https://your-qa-system.example.com/sap/bc/ui5_ui5/path/to/your/app/index.html
```

Or set it inline for a single run, without a `.env` file at all:

```bash
BASE_URL=https://your-qa-system.example.com/... npx playwright test
```

## Multiple named environments

For more than one environment, define several variables and pick one at run time instead of a
single `BASE_URL`:

```ts
// playwright.config.ts
const ENVIRONMENTS = {
  dev: 'https://dev.example.com/',
  qa: 'https://qa.example.com/',
  prod: 'https://example.com/',
} as const;

const env = (process.env.TEST_ENV as keyof typeof ENVIRONMENTS) ?? 'dev';

export default defineConfig({
  use: {
    baseURL: ENVIRONMENTS[env],
  },
});
```

```bash
TEST_ENV=qa npx playwright test
```

This repo's own [`playwright.config.ts`](../playwright.config.ts) uses the single-`BASE_URL`
version, since its example suite only ever targets one app; reach for the named-environments
version once you have more than one real target.

## This repo's own example suite

[`playwright.config.ts`](../playwright.config.ts) defaults `baseURL` to the public SAPUI5 demo
app the examples are built around, so `npm test` keeps working with zero configuration. Setting
`BASE_URL` yourself overrides it - useful if you want to see whether the example tests' _patterns_
(not their specific assertions, which are written for the demo app's data) still work against a
UI5 app of your own.
