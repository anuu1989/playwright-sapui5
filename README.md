# playwright-sapui5

An intelligent [Playwright](https://playwright.dev) test automation framework and library for
**SAPUI5 / Fiori** applications, in TypeScript.

Testing a SAPUI5 app with plain Playwright is painful: SAPUI5 generates its own DOM element ids
(`__button4-container-cart---welcomeView--promotedRow-0`, anyone?), re-renders parts of the page
asynchronously as data binds and routes change, and shows/hides busy indicators that plain
`page.click()` doesn't know to wait for. This framework closes that gap:

- **UI5-aware locators** - find controls the way SAPUI5 itself does: by control id, control
  type + properties, OData binding path, or visible text - not by guessing at generated DOM ids
  or brittle CSS selectors.
- **Self-healing locators** - chain a primary locator with fallback strategies. If the primary
  one doesn't match, the next one is tried automatically, and a warning is logged so you know
  your primary locator needs attention.
- **Automatic waiting** - every action waits for the SAPUI5 busy indicator to clear, for
  in-flight network requests to settle, and for the control tree to stop changing, _before_
  interacting - not just for the DOM element to exist.
- **Page Object base class** (`Ui5Page`) with a tiny, consistent API.
- **A Page Object generator CLI** that inspects a running SAPUI5 app and writes a starter Page
  Object class from its live control tree.
- **A test-suite generator CLI** (`pw-sapui5 generate-tests`) that loads your app, works out what
  it is - routes, control mix, measured startup - and writes a runnable starter suite for it.
- **A project scaffolding CLI** (`pw-sapui5 init`) that sets up a whole runnable project - config,
  example test, editor setup - in one command.
- **Custom `expect` matchers** (`toHaveUi5Property`, `toHaveUi5Text`, `toBeUi5Busy`) that read a
  control's own live property values through the bridge, not just its rendered DOM text.
- **`Ui5Table`** and **`Ui5Dialog`** - higher-level helpers for the two things every real Fiori
  test suite ends up hand-rolling: row/cell access on tables and lists, and reliably opening,
  interacting with, and closing dialogs.
- **Cross-iframe support** - locators, auto-wait, and the bridge all work against a Playwright
  `Frame`, not just the top-level `Page`, so apps embedded in an iframe (the way Fiori Launchpad
  loads a tile) are just as testable as a standalone app. `findUi5Frame()` locates the right one.
- **`Ui5SmartFilterBar`** and **`Ui5SmartTable`** - set filter values and search on a Fiori
  Elements SmartFilterBar without hand-matching each dynamically-generated field's widget type,
  and read a SmartTable's true row count even when it's backed by a virtualized grid table.
- **`Ui5GridTable`** - row/cell/header access and true row counts for `sap.ui.table.Table`, the
  separate virtualized "grid" table control `Ui5Table` doesn't cover, including scrolling to a
  specific row on demand via the control's own API.
- **`Ui5ValueHelpDialog`** - opens a value help ("F4 help") dialog via its undocumented trigger
  icon convention and selects a result row, whether the dialog's result list turns out to be a
  `sap.m.Table`/`List` or a virtualized `sap.ui.table.Table`.
- **`Ui5I18n` and `Ui5Model`** - assert against the app's own translated texts and its real model
  data, instead of hardcoded English strings and formatted, localized display text.
- **`Ui5MessageToast` and `Ui5Messages`** - race-free assertions on toasts (recorded as the app
  raises them, so they survive their own ~3s auto-hide) and on SAPUI5's central message model.
- **`Ui5Select` and `Ui5DatePicker`** - pick from a dropdown whose options aren't in the DOM until
  it opens (and whose clickable entries carry no keys), and set dates without hardcoding a
  locale's display format or tripping over the ISO-string timezone shift.
- **`Ui5VariantManagement` and `Ui5FlexibleColumnLayout`** - read and switch a list report's saved
  variants, and read the Fiori multi-column shell's real layout state (which the DOM can't tell
  you, since all three columns always exist in the markup).
- **`Ui5ObjectPage`, `Ui5IconTabBar` and `Ui5SplitApp`** - read a Fiori Elements Object Page's real
  sections and jump to one directly, read and switch a tab strip's keys/badge counts (works
  against both `sap.m.IconTabBar` and the bare `sap.m.IconTabHeader` a real Object Page renders),
  and read the classic master/detail shell's mode and current pages - see
  [docs/object-page.md](docs/object-page.md), [docs/icon-tab-bar.md](docs/icon-tab-bar.md),
  [docs/split-app.md](docs/split-app.md).
- **`Ui5Performance` and `Ui5Navigation`** - measure how long the app takes to actually become
  usable (not just to `load`), and jump straight to a route instead of clicking through to it.
- **Automatic failure diagnostics** - every failing test gets the SAPUI5 control tree attached to
  its report: what was actually rendered, of what type, with what text. No opt-in required.
- **Direct Jira integration** - a reporter that posts run summaries to the Jira issues your tests
  reference, and can file a bug per failure with the UI5 control tree attached. Straight to Jira's
  REST API: no Xray, no Zephyr, no plugin in between - see [docs/jira.md](docs/jira.md).
- **`pw-sapui5 doctor`** - a zero-code smoke check: does the app bootstrap, render controls, settle
  within budget, and report no message-model errors? One CLI command, a pass/fail exit code, no
  test file - see [docs/doctor.md](docs/doctor.md).
- **Locator health reporting** - aggregates self-heals across a whole CI run into "these locators
  need fixing", instead of a live console warning you only see if you're watching - see
  [docs/locator-health.md](docs/locator-health.md).
- **`$metadata`-validated OData mocking** - check a mock's shape against a real service's own
  published schema before mocking, catching a typo'd or renamed property at test-setup time
  instead of as a confusing binding failure inside the app - see
  [docs/odata-metadata.md](docs/odata-metadata.md).
- **Four real, free demo-app walkthroughs** - a complete Fiori Elements List Report + Object Page,
  classic master-detail navigation, `sap.m.PlanningCalendar`, and a different app shell
  (`sap.tnt.ToolPage`) - see [docs/demo-apps.md](docs/demo-apps.md).
- Documented, real-example-backed recipes for **accessibility testing**, **visual regression
  testing**, **multi-environment configuration**, **authentication**, and **OData mocking** - see
  the docs table below.

It's a plain npm library - install it in any Playwright project (or several) and import what you
need; nothing about it is tied to this repository's example app.

## Quick start

```bash
mkdir my-tests && cd my-tests && npm init -y
npm install --save-dev playwright-sapui5 @playwright/test dotenv typescript @types/node
npx pw-sapui5 init --base-url https://your-app.example.com/
npx playwright install chromium
npx playwright test
```

That scaffolds a whole ready-to-run project - see [docs/init.md](docs/init.md).

**New to this framework?** Start with **[docs/getting-started.md](docs/getting-started.md)** -
it assumes no prior Playwright or SAPUI5 knowledge and walks through everything step by step.

**New to TypeScript itself?** That's fine too - **[docs/typescript-for-beginners.md](docs/typescript-for-beginners.md)**
explains every piece of TypeScript syntax used anywhere in this project (types, `async`/`await`,
classes, generics, all of it) in plain language, with examples pulled from this codebase. Read it
first if words like "interface," "generic," or "async function" are unfamiliar.

## Quick example

```ts
import { test, expect } from 'playwright-sapui5';
import { CartPage } from './pages/CartPage';

test('adds a product to the cart', async ({ page }) => {
  const cart = new CartPage(page);
  await cart.open(); // navigates + waits for the app to finish booting

  await cart.selectCategory('Laptops'); // auto-waits, then clicks
  await expect(await cart.product('Astro Laptop 1516').resolve()).toBeVisible();
});
```

```ts
// pages/CartPage.ts
import type { Page } from '@playwright/test';
import { Ui5Page } from 'playwright-sapui5';

export class CartPage extends Ui5Page {
  async open() {
    await this.goto('https://your-app.example.com/');
  }

  category(name: string) {
    return this.text(name, { controlType: 'sap.m.StandardListItem' });
  }

  product(name: string) {
    return this.text(name, { controlType: 'sap.m.ObjectListItem' });
  }

  async selectCategory(name: string) {
    await this.category(name).click();
  }
}
```

## Documentation

| Guide                                                                | What's in it                                                                                                                                  |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [docs/typescript-for-beginners.md](docs/typescript-for-beginners.md) | **Start here if TypeScript itself is new to you** - every bit of syntax you'll meet, explained                                                |
| [docs/getting-started.md](docs/getting-started.md)                   | Install, prerequisites, your first test, running it                                                                                           |
| [docs/how-to.md](docs/how-to.md)                                     | **"How do I…?" cookbook** - every feature indexed by task, one runnable snippet each                                                          |
| [docs/init.md](docs/init.md)                                         | `pw-sapui5 init` - scaffold a whole ready-to-run project in one command                                                                       |
| [docs/core-concepts.md](docs/core-concepts.md)                       | Why SAPUI5 needs a different approach; how the framework works under the hood                                                                 |
| [docs/architecture.md](docs/architecture.md)                         | **Code-level walkthrough**: every source file's job, and step-by-step traces of what actually runs for `goto()`, `.click()`, and self-healing |
| [docs/locators.md](docs/locators.md)                                 | Every locator strategy, the `ui5()` helper, self-healing, fallback chains                                                                     |
| [docs/auto-wait.md](docs/auto-wait.md)                               | How auto-waiting works, tuning timeouts, when it can't help you                                                                               |
| [docs/page-objects.md](docs/page-objects.md)                         | The `Ui5Page` pattern, structuring a real test suite                                                                                          |
| [docs/expect-matchers.md](docs/expect-matchers.md)                   | Custom `expect` matchers that read live UI5 control properties                                                                                |
| [docs/ui5-table.md](docs/ui5-table.md)                               | `Ui5Table` - row/cell access, headers, for `sap.m.Table`/`sap.m.List`                                                                         |
| [docs/ui5-dialog.md](docs/ui5-dialog.md)                             | `Ui5Dialog` - opening, interacting with, and closing dialogs/popovers reliably                                                                |
| [docs/cross-frame.md](docs/cross-frame.md)                           | Testing a SAPUI5 app embedded in an iframe (Fiori Launchpad and similar shells)                                                               |
| [docs/smart-controls.md](docs/smart-controls.md)                     | `Ui5SmartFilterBar`/`Ui5SmartTable` - Fiori Elements' generated filter bar and result table                                                   |
| [docs/ui5-grid-table.md](docs/ui5-grid-table.md)                     | `Ui5GridTable` - row/cell/header access for `sap.ui.table.Table`, the virtualized grid table                                                  |
| [docs/value-help-dialog.md](docs/value-help-dialog.md)               | `Ui5ValueHelpDialog` - opening and selecting from a value help ("F4 help") dialog                                                             |
| [docs/i18n.md](docs/i18n.md)                                         | `Ui5I18n` - assert using the app's own translated texts instead of hardcoded strings                                                          |
| [docs/model-data.md](docs/model-data.md)                             | `Ui5Model` - assert on the app's real model data, not formatted display text                                                                  |
| [docs/performance.md](docs/performance.md)                           | `Ui5Performance` - how long the app takes to become usable, not just to load                                                                  |
| [docs/navigation.md](docs/navigation.md)                             | `Ui5Navigation` - hash routing: jump straight to a route, confirm one happened                                                                |
| [docs/diagnostics.md](docs/diagnostics.md)                           | The control tree attached to every failure - what was actually on the page                                                                    |
| [docs/jira.md](docs/jira.md)                                         | Reporting results straight to Jira - linking tests to issues, filing bugs with the control tree attached                                      |
| [docs/doctor.md](docs/doctor.md)                                     | `pw-sapui5 doctor` - a zero-code CI smoke check: did the app even come up cleanly?                                                            |
| [docs/locator-health.md](docs/locator-health.md)                     | Aggregating self-heals across a run into a "these locators need fixing" report                                                                |
| [docs/variant-management.md](docs/variant-management.md)             | `Ui5VariantManagement` - a list report's saved filter/column configurations                                                                   |
| [docs/flexible-column-layout.md](docs/flexible-column-layout.md)     | `Ui5FlexibleColumnLayout` - the one/two/three-column Fiori shell                                                                              |
| [docs/object-page.md](docs/object-page.md)                           | `Ui5ObjectPage` - sections and navigation for `sap.uxap.ObjectPageLayout`                                                                     |
| [docs/icon-tab-bar.md](docs/icon-tab-bar.md)                         | `Ui5IconTabBar` - tabs, keys and badge counts for `sap.m.IconTabBar`/`IconTabHeader`                                                          |
| [docs/split-app.md](docs/split-app.md)                               | `Ui5SplitApp` - mode and current pages for the classic master/detail shell                                                                    |
| [docs/form-inputs.md](docs/form-inputs.md)                           | `Ui5Select` / `Ui5DatePicker` - dropdowns and dates, without the usual flakiness                                                              |
| [docs/messages.md](docs/messages.md)                                 | `Ui5MessageToast` (race-free toast assertions) and `Ui5Messages` (validation/backend errors)                                                  |
| [docs/demo-apps.md](docs/demo-apps.md)                               | Four real, free demo apps (Fiori Elements, master-detail, PlanningCalendar, a different shell)                                                |
| [docs/examples.md](docs/examples.md)                                 | A guided tour of every example test - search, self-healing, data-driven tests, network mocking, and more                                      |
| [docs/test-generator.md](docs/test-generator.md)                     | `pw-sapui5 generate-tests` - generate a runnable test suite from an app URL                                                                   |
| [docs/generator.md](docs/generator.md)                               | The `pw-sapui5 generate` CLI, options, and its limits                                                                                         |
| [docs/multi-environment-config.md](docs/multi-environment-config.md) | Pointing tests at dev/QA/prod via env vars instead of hardcoded URLs                                                                          |
| [docs/authentication.md](docs/authentication.md)                     | Logging in once and reusing the session across tests                                                                                          |
| [docs/accessibility.md](docs/accessibility.md)                       | Accessibility testing with axe-core                                                                                                           |
| [docs/visual-testing.md](docs/visual-testing.md)                     | Screenshot-based visual regression testing, and its platform gotcha                                                                           |
| [docs/odata-mocking.md](docs/odata-mocking.md)                       | Mocking OData V2/V4 responses with the correct JSON envelope shapes                                                                           |
| [docs/odata-metadata.md](docs/odata-metadata.md)                     | Validating a mock against a real service's `$metadata` - catching a typo'd property before the app does                                       |
| [docs/api-reference.md](docs/api-reference.md)                       | Every exported class, function, and type                                                                                                      |
| [docs/troubleshooting.md](docs/troubleshooting.md)                   | Common errors and how to fix them                                                                                                             |

## CLI reference

Everything the `pw-sapui5` command can do. All three subcommands are also documented in depth:
[`init`](docs/init.md), [`generate`](docs/generator.md), [`generate-tests`](docs/test-generator.md),
[`doctor`](docs/doctor.md).

```bash
npx pw-sapui5 --help            # list the subcommands
npx pw-sapui5 <command> --help  # options for one of them
npx pw-sapui5 --version
```

Installed as a dependency the binary is on your path, so `npx pw-sapui5 ...` works from the
project root. Running it from a clone of this repo instead, use `node dist/generator/cli.js ...`
after `npm run build`.

### `pw-sapui5 init`

Scaffolds a ready-to-run project: `playwright.config.ts`, `tsconfig.json`, an example Page Object
and spec, `.env.example`, VS Code settings, and `.gitignore` entries.

| Option                 | Default                         | What it does                                                                                               |
| ---------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `-d, --dir <path>`     | `.`                             | Directory to scaffold into. Created if missing.                                                            |
| `-b, --base-url <url>` | `https://your-app.example.com/` | Baked into `playwright.config.ts` as the `baseURL`, so tests can use relative paths.                       |
| `-f, --force`          | `false`                         | Overwrite files that already exist. Without it, existing files are left untouched and reported as skipped. |

```bash
# A whole new project in one command
mkdir my-tests && cd my-tests && npm init -y
npm install --save-dev playwright-sapui5 @playwright/test dotenv typescript @types/node
npx pw-sapui5 init --base-url https://your-app.example.com/
npx playwright install chromium
npx playwright test

# Scaffold into a subdirectory instead of the current one
npx pw-sapui5 init --dir e2e --base-url https://your-app.example.com/

# Re-scaffold, replacing files you have already edited (destructive - commit first)
npx pw-sapui5 init --force
```

### `pw-sapui5 generate`

Inspects a **running** app and writes a starter Page Object from its live control tree - a getter
per control it found, with each control's real text/title/value in a comment above it.

| Option                    | Default              | What it does                                                                              |
| ------------------------- | -------------------- | ----------------------------------------------------------------------------------------- |
| `-u, --url <url>`         | _(required)_         | The app to inspect.                                                                       |
| `-o, --output <path>`     | `./GeneratedPage.ts` | Where to write the file.                                                                  |
| `-c, --class-name <name>` | `GeneratedPage`      | Name of the generated class.                                                              |
| `--headed`                | `false`              | Show the browser while it inspects - useful when an app needs a login or is slow to boot. |
| `--timeout <ms>`          | `30000`              | Navigation and ready timeout.                                                             |

```bash
# Simplest form
npx pw-sapui5 generate --url https://your-app.example.com/

# Name the class and choose where it lands
npx pw-sapui5 generate \
  --url https://your-app.example.com/ \
  --output pages/ProductListPage.ts \
  --class-name ProductListPage

# Watch it work, and allow longer for a slow app
npx pw-sapui5 generate --url https://your-app.example.com/ --headed --timeout 60000

# Try it against SAP's own public demo
npx pw-sapui5 generate \
  --url https://ui5.sap.com/test-resources/sap/m/demokit/cart/webapp/index.html \
  --output /tmp/CartPage.ts --class-name CartPage
```

### `pw-sapui5 generate-tests`

Inspects a running app and writes a **runnable test suite** for it - smoke, startup budget, one
test per navigable route, and assertions matched to the controls it found. See
[docs/test-generator.md](docs/test-generator.md) for what it will and won't generate.

| Option                   | Default               | What it does                                                                                                                                                                          |
| ------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-u, --url <url>`        | _(required)_          | The app to analyse.                                                                                                                                                                   |
| `-o, --output <path>`    | `./generated.spec.ts` | Where to write the spec file.                                                                                                                                                         |
| `-t, --title <title>`    | the app's own title   | Name for the generated `test.describe` block.                                                                                                                                         |
| `--import-from <module>` | `playwright-sapui5`   | Module the generated file imports from. Change it when the generated file sits somewhere that resolves the framework differently - e.g. inside this repo, where it's a relative path. |
| `--headed`               | `false`               | Show the browser during analysis.                                                                                                                                                     |
| `--timeout <ms>`         | `30000`               | Navigation and ready timeout.                                                                                                                                                         |

```bash
# Generate and immediately run
npx pw-sapui5 generate-tests --url https://your-app.example.com/ --output tests/app.spec.ts
npx playwright test tests/app.spec.ts

# Give the suite a name of your own
npx pw-sapui5 generate-tests \
  --url https://your-app.example.com/ \
  --output tests/orders.spec.ts \
  --title "Orders - smoke"

# A slow app, watched
npx pw-sapui5 generate-tests --url https://your-app.example.com/ --headed --timeout 90000

# Try it against SAP's own public demos
npx pw-sapui5 generate-tests \
  --url https://ui5.sap.com/test-resources/sap/m/demokit/cart/webapp/index.html \
  --output /tmp/cart.spec.ts
```

It prints what it found before writing, because the analysis is what decides which tests you get:

```
  App:      Shopping Cart
  Controls: 217 rendered
  Routes:   5 navigable, 5 need parameters
  Detected: flexibleColumnLayout, list, searchField
  Startup:  ~2519ms to settle
```

### `pw-sapui5 doctor`

A zero-code smoke check: does the app bootstrap, render controls, settle within budget, and report
no message-model errors? See [docs/doctor.md](docs/doctor.md).

| Option             | Default      | What it does                                                            |
| ------------------ | ------------ | ----------------------------------------------------------------------- |
| `-u, --url <url>`  | _(required)_ | The app to check.                                                       |
| `--timeout <ms>`   | `30000`      | Navigation / ready timeout.                                             |
| `--budget-ms <ms>` | `15000`      | The "startup budget" check fails past this many milliseconds to settle. |
| `--headed`         | `false`      | Show the checking browser.                                              |

```bash
# Exits 0 if the app is healthy, 1 otherwise - drop straight into a CI step
npx pw-sapui5 doctor --url https://your-app.example.com/

# A slower environment, with a matching budget
npx pw-sapui5 doctor --url https://your-app.example.com/ --timeout 60000 --budget-ms 20000
```

### Notes that apply to both generators

- **The app must be reachable and already running.** Both commands drive a real browser to a real
  URL; neither starts a server for you.
- **Apps behind a login** need `--headed` so you can sign in while the browser is open, or a
  pre-authenticated storage state - see [docs/authentication.md](docs/authentication.md).
- **Output is a starting point, not a finished artifact.** Both files are meant to be edited and
  committed; regenerating overwrites them.

## Reporting to Jira

Results can go **straight to Jira's REST API** - no Xray, no Zephyr, no plugin in between. Set the
credentials in the environment and add the reporter:

```bash
export JIRA_BASE_URL="https://your-org.atlassian.net"
export JIRA_EMAIL="you@your-company.com"
export JIRA_API_TOKEN="your-api-token"
export JIRA_PROJECT_KEYS="ABC"        # your real project keys - strongly recommended
```

```ts
// playwright.config.ts
reporter: [['list'], ['playwright-sapui5/reporter/jira']],
```

Then reference an issue from a test, in whichever way your team already does - an annotation, a
tag, or anywhere in the title path:

```ts
test('checkout completes', { annotation: { type: 'jira', description: 'ABC-123' } }, async () => {
  /* ... */
});
```

After the run, each referenced issue gets a summary comment. Turn on `createIssueOnFailure` and
each failure also files a bug with the **UI5 control tree attached**, which is usually enough for
whoever picks it up to tell a real regression from a stale locator.

Jira Cloud and Server/DC are both handled (they differ in REST path, auth scheme _and_ comment
body format). `dryRun: true` shows you exactly what would be posted without sending anything -
worth doing once before pointing this at a Jira your team reads. Full details, including why
`JIRA_PROJECT_KEYS` matters (`UTF-8` is shaped exactly like a Jira key), are in
[docs/jira.md](docs/jira.md).

## Project layout

```
src/               the library itself (what gets published to npm)
  core/            Ui5Locator, Ui5Page, Ui5Bridge, SelfHealingResolver, Ui5Table, Ui5Dialog,
                   Ui5SmartFilterBar, Ui5SmartTable, Ui5GridTable, Ui5ValueHelpDialog, matchers,
                   odataMock, waitForUi5, findUi5Frame, types
  browser/         the script injected into the browser to talk to SAPUI5's control tree
  fixtures/        a Playwright test/expect drop-in with a small auto-wait boost + custom matchers
  generator/       the Page Object generator, the test-suite generator + their CLI
  integrations/    the direct Jira REST client, issue-key extraction, and the Jira reporter
  index.ts         public exports
examples/          a full, runnable example test suite (against real public SAPUI5 demo apps)
docs/              the documentation listed above
```

## Requirements

- Node.js **18 or newer** (a recent patch release - see
  [docs/troubleshooting.md](docs/troubleshooting.md#old-nodejs-patch-versions) if you hit a
  cryptic `SyntaxError: Cannot use import statement outside a module` when running tests).
- `@playwright/test` as a peer dependency in the project that consumes this library.

## Try the examples in this repo

```bash
./setup.sh
```

One command: checks your Node version (switching via `nvm` automatically if it's too old and
`nvm` is installed - see [docs/troubleshooting.md](docs/troubleshooting.md#old-nodejs-patch-versions)
for why this matters), installs dependencies, installs Playwright's Chromium browser, builds,
lints, and type-checks the library, then runs the example suite. `npm run setup` works too. Skip
straight to a specific piece with `./setup.sh --skip-checks` or `./setup.sh --skip-tests` - see
`./setup.sh --help`.

Prefer to run the steps yourself, or don't have bash (Windows outside WSL/Git Bash)? Same result,
by hand:

```bash
npm install
npx playwright install chromium
npm test
```

This runs all 27 files in [`examples/tests/`](examples/tests/) - covering basic navigation, form
filling, multi-step Page Object flows, data-driven tests, self-healing locators, network mocking,
state inspection, accessibility, visual regression, custom UI5 matchers, tables, dialogs, OData
mocking, testing an app embedded in an iframe, SmartFilterBar/SmartTable, grid tables, value help
dialogs, and four real demo apps (Fiori Elements, master-detail, PlanningCalendar, a different app
shell) - against real, live public SAPUI5 demo apps, so no setup beyond an internet connection is
needed.
(The visual regression test skips itself outside macOS - see
[docs/visual-testing.md](docs/visual-testing.md#platform-sensitivity).) See
[docs/examples.md](docs/examples.md) for a guided tour of which file covers what.

## License

MIT - see [LICENSE](LICENSE).
