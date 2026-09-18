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
- Documented, real-example-backed recipes for **accessibility testing**, **visual regression
  testing**, **multi-environment configuration**, and **authentication** - see the docs table
  below.

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
| [docs/examples.md](docs/examples.md)                                 | A guided tour of every example test - search, self-healing, data-driven tests, network mocking, and more                                      |
| [docs/generator.md](docs/generator.md)                               | The `pw-sapui5 generate` CLI, options, and its limits                                                                                         |
| [docs/multi-environment-config.md](docs/multi-environment-config.md) | Pointing tests at dev/QA/prod via env vars instead of hardcoded URLs                                                                          |
| [docs/authentication.md](docs/authentication.md)                     | Logging in once and reusing the session across tests                                                                                          |
| [docs/accessibility.md](docs/accessibility.md)                       | Accessibility testing with axe-core                                                                                                           |
| [docs/visual-testing.md](docs/visual-testing.md)                     | Screenshot-based visual regression testing, and its platform gotcha                                                                           |
| [docs/api-reference.md](docs/api-reference.md)                       | Every exported class, function, and type                                                                                                      |
| [docs/troubleshooting.md](docs/troubleshooting.md)                   | Common errors and how to fix them                                                                                                             |

## Project layout

```
src/               the library itself (what gets published to npm)
  core/            Ui5Locator, Ui5Page, Ui5Bridge, SelfHealingResolver, waitForUi5, types
  browser/         the script injected into the browser to talk to SAPUI5's control tree
  fixtures/        a Playwright test/expect drop-in with a small auto-wait boost
  generator/       the Page Object generator + its CLI
  index.ts         public exports
examples/          a full, runnable example test suite (against a real public SAPUI5 demo app)
docs/              the documentation listed above
```

## Requirements

- Node.js **18 or newer** (a recent patch release - see
  [docs/troubleshooting.md](docs/troubleshooting.md#old-nodejs-patch-versions) if you hit a
  cryptic `SyntaxError: Cannot use import statement outside a module` when running tests).
- `@playwright/test` as a peer dependency in the project that consumes this library.

## Try the examples in this repo

```bash
npm install
npx playwright install chromium
npm test
```

This runs all 9 files in [`examples/tests/`](examples/tests/) - covering basic navigation, form
filling, multi-step Page Object flows, data-driven tests, self-healing locators, network mocking,
state inspection, accessibility, and visual regression - against SAP's own public Shopping Cart
SAPUI5 demo app, so no setup beyond an internet connection is needed. (The visual regression test
skips itself outside macOS - see [docs/visual-testing.md](docs/visual-testing.md#platform-sensitivity).)
See [docs/examples.md](docs/examples.md) for a guided tour of which file covers what.

## License

MIT - see [LICENSE](LICENSE).
