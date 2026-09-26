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
| [docs/form-inputs.md](docs/form-inputs.md)                           | `Ui5Select` / `Ui5DatePicker` - dropdowns and dates, without the usual flakiness                                                              |
| [docs/messages.md](docs/messages.md)                                 | `Ui5MessageToast` (race-free toast assertions) and `Ui5Messages` (validation/backend errors)                                                  |
| [docs/demo-apps.md](docs/demo-apps.md)                               | Four real, free demo apps (Fiori Elements, master-detail, PlanningCalendar, a different shell)                                                |
| [docs/examples.md](docs/examples.md)                                 | A guided tour of every example test - search, self-healing, data-driven tests, network mocking, and more                                      |
| [docs/generator.md](docs/generator.md)                               | The `pw-sapui5 generate` CLI, options, and its limits                                                                                         |
| [docs/multi-environment-config.md](docs/multi-environment-config.md) | Pointing tests at dev/QA/prod via env vars instead of hardcoded URLs                                                                          |
| [docs/authentication.md](docs/authentication.md)                     | Logging in once and reusing the session across tests                                                                                          |
| [docs/accessibility.md](docs/accessibility.md)                       | Accessibility testing with axe-core                                                                                                           |
| [docs/visual-testing.md](docs/visual-testing.md)                     | Screenshot-based visual regression testing, and its platform gotcha                                                                           |
| [docs/odata-mocking.md](docs/odata-mocking.md)                       | Mocking OData V2/V4 responses with the correct JSON envelope shapes                                                                           |
| [docs/api-reference.md](docs/api-reference.md)                       | Every exported class, function, and type                                                                                                      |
| [docs/troubleshooting.md](docs/troubleshooting.md)                   | Common errors and how to fix them                                                                                                             |

## Project layout

```
src/               the library itself (what gets published to npm)
  core/            Ui5Locator, Ui5Page, Ui5Bridge, SelfHealingResolver, Ui5Table, Ui5Dialog,
                   Ui5SmartFilterBar, Ui5SmartTable, Ui5GridTable, Ui5ValueHelpDialog, matchers,
                   odataMock, waitForUi5, findUi5Frame, types
  browser/         the script injected into the browser to talk to SAPUI5's control tree
  fixtures/        a Playwright test/expect drop-in with a small auto-wait boost + custom matchers
  generator/       the Page Object generator + its CLI
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

This runs all 24 files in [`examples/tests/`](examples/tests/) - covering basic navigation, form
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
