# Examples

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) first -
> the example files linked below are ordinary TypeScript, explained there.

Every file in [`examples/tests/`](../examples/tests/) is a real, passing test run against SAP's
own public Shopping Cart SAPUI5 demo app (see [Getting started](getting-started.md#7-run-the-examples-in-this-repository)
for how to run them yourself). Each one focuses on a different automation topic - read this page
to find the one closest to what you're trying to do, then open the file.

| File                                                                     | Topic                                           | What it shows                                                                                                                                                                       |
| ------------------------------------------------------------------------ | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`cart.spec.ts`](../examples/tests/cart.spec.ts)                         | The basics                                      | Navigating with `Ui5Page.goto()`, asserting visibility, clicking, and catching a plain (non-UI5) toast notification with Playwright's own `getByText`.                              |
| [`search.spec.ts`](../examples/tests/search.spec.ts)                     | Filling a form control                          | `.fill()` on a `sap.m.SearchField`, and why the framework has to look past the control's root element to find the actual `<input>`.                                                 |
| [`product-detail.spec.ts`](../examples/tests/product-detail.spec.ts)     | Multi-step navigation & Page Object composition | `CartPage.selectCategory()` returning a `CategoryPage`, which in turn returns a `ProductDetailPage` - modeling app navigation as typed, chainable steps. Also a "back button" test. |
| [`data-driven.spec.ts`](../examples/tests/data-driven.spec.ts)           | Data-driven tests                               | Generating one `test(...)` per entry in a plain array, instead of copy-pasting near-identical tests.                                                                                |
| [`self-healing.spec.ts`](../examples/tests/self-healing.spec.ts)         | Self-healing locators                           | A deliberately broken primary locator recovering via `.fallback()`, observed with `SelfHealingResolver.onHeal()` - plus what happens when _every_ strategy fails.                   |
| [`network-mocking.spec.ts`](../examples/tests/network-mocking.spec.ts)   | Network mocking                                 | Using Playwright's own `page.route()` to replace a real backend response with fixed test data - a plain Playwright feature, shown working alongside UI5-aware locators.             |
| [`state-inspection.spec.ts`](../examples/tests/state-inspection.spec.ts) | Reading state without acting                    | `.isVisible()`, `.isEnabled()`, `.count()` - and mixing a Page Object with the standalone `ui5(page)` helper in the same test.                                                      |

## The Page Objects behind them

| File                                                             | Represents                                                                                     |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [`CartPage.ts`](../examples/pages/CartPage.ts)                   | The app's landing screen: search, the category list, the welcome pane's "add to cart" buttons. |
| [`CategoryPage.ts`](../examples/pages/CategoryPage.ts)           | The product list shown after selecting a category.                                             |
| [`ProductDetailPage.ts`](../examples/pages/ProductDetailPage.ts) | The product detail pane shown alongside the category list once a product is selected.          |

Read them alongside [docs/page-objects.md](page-objects.md) - they're a complete, real example of
the patterns that guide describes (getters vs. methods, parameterized locators, composing Page
Objects).

## Two real gotchas these examples ran into (and fixed)

Both are documented in full in [docs/troubleshooting.md](troubleshooting.md), because they're the
kind of thing you're likely to hit yourself against a real app, not just this demo:

- **Raw SAPUI5-generated ids aren't stable across sessions** - `CartPage.product()` locates
  products by text, not id, because of this. See
  [docs/troubleshooting.md#unstable-generated-ids](troubleshooting.md#unstable-generated-ids).
- **`id()`'s suffix matching can find a hidden previous page**, because SAPUI5's `NavContainer`
  keeps it in the DOM after a transition instead of removing it. `CategoryPage.title` and
  `.backButton` use a longer, more specific suffix to avoid this. See
  [docs/troubleshooting.md](troubleshooting.md#an-id-locator-matches-two-elements-instead-of-one-and-playwright-refuses-to-act).

## Want to try the generator against this same app?

```bash
npm run build
npx pw-sapui5 generate --url https://ui5.sap.com/test-resources/sap/m/demokit/cart/webapp/index.html --output /tmp/GeneratedCartPage.ts --class-name GeneratedCartPage
```

Compare its output to the hand-written `CartPage.ts` - it's a good way to see exactly what the
generator does (and doesn't do) for you. See [docs/generator.md](generator.md).
