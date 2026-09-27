# Getting started

This guide assumes no prior experience with Playwright or SAPUI5 test automation. By the end
you'll have a working test running against a real SAPUI5 app.

> **New to TypeScript itself?** Every code example below is TypeScript, and this guide doesn't
> stop to explain the language syntax (things like `async function`, `interface`, or `import`) -
> only what the framework does. If any of that looks unfamiliar, read
> **[docs/typescript-for-beginners.md](typescript-for-beginners.md)** first - it explains every
> piece of TypeScript syntax used anywhere in this project, in plain language. It's short, and
> written specifically so you can come back here afterward and follow along with zero confusion.

## 1. Prerequisites

- **Node.js 18 or newer.** Check with `node -v`. If you're on an older version, or on a very old
  patch of Node 18/20 (some `X.0.0` releases are missing things modern tooling needs), install a
  current one. The easiest way is [nvm](https://github.com/nvm-sh/nvm):

  ```bash
  nvm install --lts
  nvm use --lts
  ```

- **npm** (comes with Node).
- No prior TypeScript experience is required. If you've never used TypeScript, read
  [docs/typescript-for-beginners.md](typescript-for-beginners.md) first (see the note above) -
  everything below assumes you've either done that or already know the language.

You do **not** need to know anything about SAPUI5 internals. This framework exists so that you
don't have to.

## 2. Install

In an existing (or new) Playwright project:

```bash
npm install --save-dev playwright-sapui5 @playwright/test
npx playwright install chromium
```

`@playwright/test` is a **peer dependency** - you install it yourself, once, in your project.
This lets you control exactly which Playwright version you're on.

If you don't have a project yet, `pw-sapui5 init` scaffolds a whole ready-to-run one for you in
one command - config, example test, editor setup - see [docs/init.md](init.md). The rest of this
guide works the same either way; skip to [step 3](#3-your-first-test) once you have a project.

## 3. Your first test

Create `tests/example.spec.ts`:

```ts
import { test, expect } from 'playwright-sapui5';

test('the SAPUI5 shopping cart demo loads', async ({ page }) => {
  await page.goto('https://ui5.sap.com/test-resources/sap/m/demokit/cart/webapp/index.html');
  await expect(page.getByText('Product Catalog')).toBeVisible();
});
```

A few things to notice already:

- We imported `test` and `expect` from **`playwright-sapui5`**, not `@playwright/test`. They are
  a drop-in replacement - same API, same behaviour - with one small addition: the `page` fixture
  opportunistically waits for the SAPUI5 busy indicator to clear after each full page load. You
  can always import from `@playwright/test` directly instead; nothing else in this framework
  requires the custom `test`/`expect`.
- Everything else (`page.goto`, `expect(...).toBeVisible()`) is exactly the Playwright API you
  may already know.

Run it:

```bash
npx playwright test tests/example.spec.ts
```

You should see 1 passed test. If you don't have a `playwright.config.ts` yet, Playwright will use
sensible defaults; see [Playwright's own docs](https://playwright.dev/docs/test-configuration) if
you want to configure browsers, reporters, etc.

## 4. Using UI5-aware locators

The example above used a plain Playwright locator (`page.getByText(...)`), which works fine for
simple text. But SAPUI5 apps are built from **controls** (`sap.m.Button`, `sap.m.List`,
`sap.m.Input`, ...), and this framework can find them the way SAPUI5 itself does - which is far
more robust than guessing at DOM structure. Rewrite the test:

```ts
import { test, expect } from 'playwright-sapui5';
import { ui5 } from 'playwright-sapui5';

test('the category list is visible', async ({ page }) => {
  await page.goto('https://ui5.sap.com/test-resources/sap/m/demokit/cart/webapp/index.html');

  const categoryList = ui5(page).controlType('sap.m.List');
  await expect(await categoryList.resolve()).toBeVisible();
});
```

`ui5(page)` gives you a small, fluent API for building locators. `.resolve()` turns it into a
plain Playwright `Locator`, so you can use `expect(...)` and the rest of Playwright's assertion
library exactly as normal. See [docs/locators.md](locators.md) for the full list of strategies
(by id, by control type + properties, by OData binding path, by text) and how to find the right
`controlType` string for a control (hint: it's on the SAPUI5 documentation page for that control,
e.g. `sap.m.Button`).

## 5. Structuring tests with a Page Object

As a test suite grows, put locators and page-specific actions in a **Page Object** instead of
inlining them in every test. Extend `Ui5Page`:

```ts
// pages/CartPage.ts
import type { Page } from '@playwright/test';
import { Ui5Page } from 'playwright-sapui5';

export class CartPage extends Ui5Page {
  async open() {
    await this.goto('https://ui5.sap.com/test-resources/sap/m/demokit/cart/webapp/index.html');
  }

  get categoryList() {
    return this.controlType('sap.m.List');
  }

  category(name: string) {
    return this.text(name, { controlType: 'sap.m.StandardListItem' });
  }

  async selectCategory(name: string) {
    await this.category(name).click();
  }
}
```

```ts
// tests/cart.spec.ts
import { test, expect } from 'playwright-sapui5';
import { CartPage } from '../pages/CartPage';

test('selecting a category shows its products', async ({ page }) => {
  const cart = new CartPage(page);
  await cart.open();
  await cart.selectCategory('Laptops');

  await expect(await cart.text('Astro Laptop 1516').resolve()).toBeVisible();
});
```

`this.goto(url)` (inherited from `Ui5Page`) does three things for you: navigates, waits for the
SAPUI5 runtime to finish bootstrapping, and waits for the app to settle (no busy indicator, no
pending requests) before your test continues. See [docs/page-objects.md](page-objects.md) for
more patterns, and [docs/auto-wait.md](auto-wait.md) for exactly what "settle" means.

## 6. Where to go next

- [docs/how-to.md](how-to.md) - **already know what you're trying to do?** Every feature below,
  indexed by task ("How do I read rows from a table?", "How do I mock an OData backend?") with one
  runnable snippet each - skip straight there instead of reading linearly.
- [docs/core-concepts.md](core-concepts.md) - _why_ SAPUI5 apps need this, and how the framework
  talks to the SAPUI5 control tree under the hood. Worth reading once - it makes everything else
  make more sense.
- [docs/architecture.md](architecture.md) - curious what actually happens, file by file, when you
  call `.click()` or `goto()`? This traces it end to end with diagrams, against the real source.
- [docs/locators.md](locators.md) - every locator strategy, plus **self-healing** (fallback
  locators that keep your tests passing when a primary strategy stops matching).
- [docs/test-generator.md](test-generator.md) - point `pw-sapui5 generate-tests` at your app's
  URL and get a runnable starter suite, derived from what the app actually renders.
- [docs/generator.md](generator.md) - point a CLI at your running app and get a starter Page
  Object generated from its actual control tree, instead of writing every locator by hand.
- [docs/expect-matchers.md](expect-matchers.md), [docs/ui5-table.md](ui5-table.md),
  [docs/ui5-dialog.md](ui5-dialog.md) - three more advanced building blocks: assertions that read
  a control's own live property values, table/list row and cell access, and reliable
  dialog/popover interaction.
- [docs/cross-frame.md](cross-frame.md) - testing a SAPUI5 app embedded in an iframe, the way
  Fiori Launchpad (and similar shell apps) load their tiles.
- [docs/smart-controls.md](smart-controls.md) - `Ui5SmartFilterBar`/`Ui5SmartTable`, for
  Fiori Elements apps whose filter bar and result table are generated from OData metadata.
- [docs/ui5-grid-table.md](ui5-grid-table.md) - `Ui5GridTable`, for `sap.ui.table.Table`'s
  virtualized rows (a plain `sap.m.Table` uses [`Ui5Table`](ui5-table.md) instead).
- [docs/value-help-dialog.md](value-help-dialog.md) - `Ui5ValueHelpDialog`, for opening and
  selecting from a value help ("F4 help") dialog.
- [docs/i18n.md](i18n.md) - `Ui5I18n`, for asserting against the app's own translated texts so a
  test keeps passing in every language.
- [docs/model-data.md](model-data.md) - `Ui5Model`, for asserting on the app's real data instead
  of formatted, localized, possibly-truncated display text.
- [docs/performance.md](performance.md) - `Ui5Performance`, for measuring how long the app really
  takes to become usable (the browser's load timings badly understate it).
- [docs/navigation.md](navigation.md) - `Ui5Navigation`, for jumping straight to a route.
- [docs/diagnostics.md](diagnostics.md) - the SAPUI5 control tree, attached to every failing test
  automatically: what was really on the page when the locator gave up.
- [docs/jira.md](jira.md) - report results straight to Jira, and file bugs with that control tree
  attached, so whoever picks one up isn't starting from nothing.
- [docs/doctor.md](doctor.md) - `pw-sapui5 doctor`, a zero-code CI smoke check for "did the app
  even come up cleanly?"
- [docs/locator-health.md](locator-health.md) - aggregating self-heals across a whole run into a
  report of which locators need fixing.
- [docs/variant-management.md](variant-management.md) - `Ui5VariantManagement`, for a list
  report's saved filter/column configurations.
- [docs/flexible-column-layout.md](flexible-column-layout.md) - `Ui5FlexibleColumnLayout`, for
  the multi-column Fiori shell.
- [docs/object-page.md](object-page.md) - `Ui5ObjectPage`, for a Fiori Elements Object Page's
  sections, in either display mode.
- [docs/icon-tab-bar.md](icon-tab-bar.md) - `Ui5IconTabBar`, for a tab strip's keys and badge
  counts.
- [docs/split-app.md](split-app.md) - `Ui5SplitApp`, for the classic master/detail shell.
- [docs/form-inputs.md](form-inputs.md) - `Ui5Select` and `Ui5DatePicker`, for dropdowns whose
  options aren't in the DOM until opened, and dates without locale/timezone traps.
- [docs/messages.md](messages.md) - `Ui5MessageToast` and `Ui5Messages`, for toasts that vanish
  after three seconds and for validation/backend errors.
- [docs/demo-apps.md](demo-apps.md) - this framework used against four real, free, complete SAPUI5
  apps (not isolated single-control samples): a Fiori Elements List Report + Object Page,
  master-detail navigation, `sap.m.PlanningCalendar`, and a different app shell.
- [docs/examples.md](examples.md) - a guided tour of every example test in this repo: form
  filling, multi-step navigation, data-driven tests, network mocking, and more.
- [docs/troubleshooting.md](troubleshooting.md) - if something doesn't work, check here first.

## 7. Run the examples in this repository

If you cloned this repository itself (rather than just installing the npm package), you can run
its example suite directly - no setup beyond Node and an internet connection. The easiest way is
the included setup script, which also switches to a working Node version automatically (via
`nvm`, if you have it) - see [step 1](#1-prerequisites) above for why that matters:

```bash
./setup.sh
```

Or run the same steps by hand:

```bash
npm install
npx playwright install chromium
npm test
```

This runs all 27 files in [`examples/tests/`](../examples/tests/) against real, live public
SAPUI5 demo apps - covering basic navigation, form filling, multi-step Page Object flows,
data-driven tests, self-healing locators, network mocking, state inspection, accessibility, visual
regression, custom UI5 matchers, tables, dialogs, OData mocking, testing an app embedded in an
iframe, SmartFilterBar/SmartTable, grid tables, value help dialogs, and four real demo apps (Fiori
Elements, master-detail, PlanningCalendar, a different app shell - see
[docs/demo-apps.md](demo-apps.md)). They're real, passing tests, not pseudocode; see
[docs/examples.md](examples.md) for a guided tour of which file covers what, and read
[`examples/pages/CartPage.ts`](../examples/pages/CartPage.ts)
alongside this guide for the Page Object they're built on.
