# Examples

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) first -
> the example files linked below are ordinary TypeScript, explained there.

Every file in [`examples/tests/`](../examples/tests/) is a real, passing test (see
[Getting started](getting-started.md#7-run-the-examples-in-this-repository) for how to run them
yourself). Most run against SAP's own public Shopping Cart SAPUI5 demo app; a few (marked below)
run against official sample apps from the SAPUI5 SDK itself, used specifically because they
contain controls the Shopping Cart demo has none of - a real `sap.m.Table`, a real dialog, a real
SmartFilterBar/SmartTable pair with actual mock data behind it. One (`cross-frame.spec.ts`) embeds
the same Shopping Cart demo inside a minimal iframe shell it builds itself, since there's no
public, stable Fiori Launchpad demo to point a test at directly. Four more target complete, real
demo apps rather than single-control samples - see
[Four real demo apps, not just single-control samples](#four-real-demo-apps-not-just-single-control-samples)
below. Each file focuses on a different automation topic - read this page to find the one closest
to what you're trying to do, then open the file.

| File                                                                                         | Topic                                           | What it shows                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`cart.spec.ts`](../examples/tests/cart.spec.ts)                                             | The basics                                      | Navigating with `Ui5Page.goto()`, asserting visibility, clicking, and catching a plain (non-UI5) toast notification with Playwright's own `getByText`.                                                                                                    |
| [`search.spec.ts`](../examples/tests/search.spec.ts)                                         | Filling a form control                          | `.fill()` on a `sap.m.SearchField`, and why the framework has to look past the control's root element to find the actual `<input>`.                                                                                                                       |
| [`product-detail.spec.ts`](../examples/tests/product-detail.spec.ts)                         | Multi-step navigation & Page Object composition | `CartPage.selectCategory()` returning a `CategoryPage`, which in turn returns a `ProductDetailPage` - modeling app navigation as typed, chainable steps. Also a "back button" test.                                                                       |
| [`data-driven.spec.ts`](../examples/tests/data-driven.spec.ts)                               | Data-driven tests                               | Generating one `test(...)` per entry in a plain array, instead of copy-pasting near-identical tests.                                                                                                                                                      |
| [`self-healing.spec.ts`](../examples/tests/self-healing.spec.ts)                             | Self-healing locators                           | A deliberately broken primary locator recovering via `.fallback()`, observed with `SelfHealingResolver.onHeal()` - plus what happens when _every_ strategy fails.                                                                                         |
| [`network-mocking.spec.ts`](../examples/tests/network-mocking.spec.ts)                       | Network mocking                                 | Using Playwright's own `page.route()` to replace a real backend response with fixed test data - a plain Playwright feature, shown working alongside UI5-aware locators.                                                                                   |
| [`state-inspection.spec.ts`](../examples/tests/state-inspection.spec.ts)                     | Reading state without acting                    | `.isVisible()`, `.isEnabled()`, `.count()` - and mixing a Page Object with the standalone `ui5(page)` helper in the same test.                                                                                                                            |
| [`accessibility.spec.ts`](../examples/tests/accessibility.spec.ts)                           | Accessibility testing                           | `@axe-core/playwright` combined with UI5-aware navigation, and a realistic "baseline regression" assertion pattern for an app with pre-existing debt. See [docs/accessibility.md](accessibility.md).                                                      |
| [`visual.spec.ts`](../examples/tests/visual.spec.ts)                                         | Visual regression testing                       | Screenshot comparison scoped to one stable element, and why it skips itself outside macOS. See [docs/visual-testing.md](visual-testing.md).                                                                                                               |
| [`visual-mask.spec.ts`](../examples/tests/visual-mask.spec.ts)                               | Automatic visual-diff masking                   | `maskDynamicUi5Content` against a real SAPUI5 runtime - a date/time-bound control is masked, a plain-bound one and a literal date-shaped string are not. See [docs/visual-testing.md#masking-dynamic-content](visual-testing.md#masking-dynamic-content). |
| [`matchers.spec.ts`](../examples/tests/matchers.spec.ts)                                     | Custom UI5 `expect` matchers                    | `toHaveUi5Property`, `toHaveUi5Text`, `toBeUi5Busy` - asserting on a control's own live property values, not just its rendered DOM text. See [docs/expect-matchers.md](expect-matchers.md).                                                               |
| [`table.spec.ts`](../examples/tests/table.spec.ts) _(SDK sample)_                            | `Ui5Table`                                      | Row count, column headers, cell text, and finding a row by its content, against a real `sap.m.Table`. See [docs/ui5-table.md](ui5-table.md).                                                                                                              |
| [`dialog.spec.ts`](../examples/tests/dialog.spec.ts) _(SDK sample)_                          | `Ui5Dialog`                                     | Waiting for a real `sap.m.ViewSettingsDialog` to open, finding its buttons unambiguously, and waiting for it to close. See [docs/ui5-dialog.md](ui5-dialog.md).                                                                                           |
| [`odata-mocking.spec.ts`](../examples/tests/odata-mocking.spec.ts)                           | OData mocking                                   | `mockODataCollection`/`mockODataEntity`/`mockODataError` - correct V2/V4 JSON envelope shapes, verified directly against a real `fetch()` call. See [docs/odata-mocking.md](odata-mocking.md).                                                            |
| [`odata-client.spec.ts`](../examples/tests/odata-client.spec.ts)                             | `Ui5ODataClient`                                | The CSRF handshake, `create`/`update`/`delete`/`read`, and a genuine 403 rejection - against a real local HTTP server, since `page.route()` can't intercept these calls. See [docs/odata-client.md](odata-client.md).                                     |
| [`odata-seeder.spec.ts`](../examples/tests/odata-seeder.spec.ts)                             | `Ui5ODataSeeder`                                | Auto-derived key predicates (with quote-escaping), LIFO cleanup order, the non-`Edm.String`-key rejection, and failed-delete reporting - plus real `<Key>` parsing against Northwind V2/TripPin V4. See [docs/odata-seeder.md](odata-seeder.md).          |
| [`content-density.spec.ts`](../examples/tests/content-density.spec.ts)                       | `Ui5ContentDensity`                             | `get`/`set`/`toggle` against a real app, with a genuinely measured row-height difference between densities, plus the real `null`-on-no-class case against the Shopping Cart demo. See [docs/content-density.md](content-density.md).                      |
| [`export.spec.ts`](../examples/tests/export.spec.ts)                                         | `Ui5Export`                                     | The download race, byte-reading, the ZIP-signature check, and the iframe case - against a real local server - plus what was and wasn't provable against a live `sap.fe` app's own export button. See [docs/export.md](export.md).                         |
| [`flaky-tests.spec.ts`](../examples/tests/flaky-tests.spec.ts)                               | Flaky test detection                            | `updateFlakyHistory`/`findQuarantineCandidates` - history capping, a test absent from a run keeping its prior history, and the threshold-and-minimum-runs guard. See [docs/flaky-tests.md](flaky-tests.md).                                               |
| [`odata-metadata.spec.ts`](../examples/tests/odata-metadata.spec.ts)                         | `$metadata` validation                          | Catching a typo'd property against two real, live OData services (Northwind V2, TripPin V4) - and confirming known serialization quirks (a quoted `Edm.Decimal`) aren't false-flagged. See [docs/odata-metadata.md](odata-metadata.md).                   |
| [`cross-frame.spec.ts`](../examples/tests/cross-frame.spec.ts)                               | Fiori Launchpad-style iframes                   | `findUi5Frame()` locating a SAPUI5 app embedded in an iframe, then locators/waits acting on that `Frame` exactly like a `Page`. See [docs/cross-frame.md](cross-frame.md).                                                                                |
| [`smart-controls.spec.ts`](../examples/tests/smart-controls.spec.ts) _(SDK sample)_          | `Ui5SmartFilterBar`/`Ui5SmartTable`             | Setting a token-based filter value in the right shape, searching, and reading a SmartTable's true row count against a real, virtualized `sap.ui.table.Table`. See [docs/smart-controls.md](smart-controls.md).                                            |
| [`mdc-table.spec.ts`](../examples/tests/mdc-table.spec.ts) _(SDK app)_                       | `Ui5MdcTable` (Fiori Elements for OData V4)     | Row count/column headers against a real, live `sap.fe` app inside an iframe, then filtering it via the real UI field + Go button (the bulk filter-conditions API didn't work). See [docs/mdc-table.md](mdc-table.md).                                     |
| [`grid-table.spec.ts`](../examples/tests/grid-table.spec.ts) _(SDK sample)_                  | `Ui5GridTable`                                  | True row count vs. what's rendered, column headers, and `scrollToRow()` bringing an off-screen row into range, against a real 123-row `sap.ui.table.Table`. See [docs/ui5-grid-table.md](ui5-grid-table.md).                                              |
| [`value-help-dialog.spec.ts`](../examples/tests/value-help-dialog.spec.ts) _(SDK samples)_   | `Ui5ValueHelpDialog`                            | Opening a value help dialog via its `-vhi` trigger icon and selecting a row, against both a plain `sap.m.Table`-backed `SelectDialog` and a `sap.ui.table.Table`-backed `ValueHelpDialog`. See [docs/value-help-dialog.md](value-help-dialog.md).         |
| [`i18n-and-model.spec.ts`](../examples/tests/i18n-and-model.spec.ts)                         | `Ui5I18n` / `Ui5Model`                          | Asserting via the app's own i18n keys (locale-proof) and reading the full entity behind a row instead of its rendered text. See [docs/i18n.md](i18n.md), [docs/model-data.md](model-data.md).                                                             |
| [`messages.spec.ts`](../examples/tests/messages.spec.ts)                                     | Toasts & messages                               | A MessageToast still assertable after it vanished from the DOM, and SAPUI5's central message model. See [docs/messages.md](messages.md).                                                                                                                  |
| [`form-inputs.spec.ts`](../examples/tests/form-inputs.spec.ts) _(SDK samples)_               | `Ui5Select` / `Ui5DatePicker`                   | Picking from Select/ComboBox/MultiComboBox (options that aren't in the DOM until opened), and setting dates without the locale/timezone traps. See [docs/form-inputs.md](form-inputs.md).                                                                 |
| [`flexible-column-layout.spec.ts`](../examples/tests/flexible-column-layout.spec.ts)         | `Ui5FlexibleColumnLayout`                       | Reading the Fiori multi-column shell's real layout state and per-column pages - neither of which the DOM can tell you. See [docs/flexible-column-layout.md](flexible-column-layout.md).                                                                   |
| [`performance-and-navigation.spec.ts`](../examples/tests/performance-and-navigation.spec.ts) | `Ui5Performance` / `Ui5Navigation`              | Timing how long the app takes to become usable vs. merely load, and navigating straight to a route. See [docs/performance.md](performance.md), [docs/navigation.md](navigation.md).                                                                       |
| [`jira.spec.ts`](../examples/tests/jira.spec.ts) _(no browser)_                              | Jira issue linking                              | Which issue keys a test references - annotation, tag, title path - and the project-key allowlist that stops `UTF-8` being read as one. See [docs/jira.md](jira.md).                                                                                       |
| [`health.spec.ts`](../examples/tests/health.spec.ts) _(no browser)_                          | Locator health aggregation                      | Grouping self-heal events by locator across tests: sort order, distinct-fallback counting, and an unlabeled locator not getting dropped. See [docs/locator-health.md](locator-health.md).                                                                 |
| [`api-catalog.spec.ts`](../examples/tests/api-catalog.spec.ts)                               | API catalog generation                          | Grouping/rendering logic, `$batch` parsing against two genuinely real multipart formats, and `startApiCapture` against the real live Cart demo. See [docs/api-catalog.md](api-catalog.md).                                                                |
| [`split-app.spec.ts`](../examples/tests/split-app.spec.ts) _(SDK sample)_                    | `Ui5SplitApp`                                   | Reading the classic master/detail shell's mode and current master/detail pages against the SDK's own official sample. See [docs/split-app.md](split-app.md).                                                                                              |

## The Page Objects behind them

| File                                                             | Represents                                                                                     |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [`CartPage.ts`](../examples/pages/CartPage.ts)                   | The app's landing screen: search, the category list, the welcome pane's "add to cart" buttons. |
| [`CategoryPage.ts`](../examples/pages/CategoryPage.ts)           | The product list shown after selecting a category.                                             |
| [`ProductDetailPage.ts`](../examples/pages/ProductDetailPage.ts) | The product detail pane shown alongside the category list once a product is selected.          |

Read them alongside [docs/page-objects.md](page-objects.md) - they're a complete, real example of
the patterns that guide describes (getters vs. methods, parameterized locators, composing Page
Objects).

## Four real demo apps, not just single-control samples

The examples above mostly target either the Shopping Cart demo or an isolated, single-control SDK
sample. [docs/demo-apps.md](demo-apps.md) is a separate guided tour of four real, complete, free
SAPUI5 applications instead - a full Fiori Elements List Report + Object Page, classic
master-detail navigation, `sap.m.PlanningCalendar`, and a different app shell
(`sap.tnt.ToolPage`) - each with its own example test, built entirely from the same primitives
covered everywhere else in these docs:

| File                                                                         | App                      | What it shows                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`fiori-elements-app.spec.ts`](../examples/tests/fiori-elements-app.spec.ts) | Manage Products          | A real Fiori Elements List Report + Object Page - `Ui5SmartFilterBar`/`Ui5SmartTable`, `Ui5ObjectPage` (sections, `scrollToSection`), and `Ui5IconTabBar` (a bare `IconTabHeader`, the way this app actually renders it), all against the real thing. |
| [`master-detail.spec.ts`](../examples/tests/master-detail.spec.ts)           | Browse Orders            | Classic master-detail navigation, and the row-type auto-detection timing gotcha below.                                                                                                                                                                |
| [`team-calendar.spec.ts`](../examples/tests/team-calendar.spec.ts)           | Team Calendar            | `sap.m.PlanningCalendar` handled entirely with general-purpose primitives - no dedicated helper needed.                                                                                                                                               |
| [`tool-page-shell.spec.ts`](../examples/tests/tool-page-shell.spec.ts)       | Shop Administration Tool | A `sap.tnt.ToolPage` shell - side navigation (including an expandable group) driving content changes.                                                                                                                                                 |

## Three real gotchas these examples ran into (and fixed)

All three are documented in full in [docs/troubleshooting.md](troubleshooting.md), because they're
the kind of thing you're likely to hit yourself against a real app, not just this demo:

- **Raw SAPUI5-generated ids aren't stable across sessions** - `CartPage.product()` locates
  products by text, not id, because of this. See
  [docs/troubleshooting.md#unstable-generated-ids](troubleshooting.md#unstable-generated-ids).
- **`id()`'s suffix matching can find a hidden previous page**, because SAPUI5's `NavContainer`
  keeps it in the DOM after a transition instead of removing it. `CategoryPage.title` and
  `.backButton` use a longer, more specific suffix to avoid this. See
  [docs/troubleshooting.md](troubleshooting.md#an-id-locator-matches-two-elements-instead-of-one-and-playwright-refuses-to-act).
- **`Ui5Table.from()`'s row-type auto-detection can lock onto the wrong type** if called before a
  list's data has actually loaded - `master-detail.spec.ts` (see [docs/demo-apps.md](demo-apps.md))
  hit this against a real app with delayed mock data. See
  [docs/troubleshooting.md#an-auto-detected-row-type-turns-out-to-be-wrong-immediately-after-navigation](troubleshooting.md#an-auto-detected-row-type-turns-out-to-be-wrong-immediately-after-navigation).

## Want to try the generator against this same app?

```bash
npm run build
npx pw-sapui5 generate --url https://ui5.sap.com/test-resources/sap/m/demokit/cart/webapp/index.html --output /tmp/GeneratedCartPage.ts --class-name GeneratedCartPage
```

Compare its output to the hand-written `CartPage.ts` - it's a good way to see exactly what the
generator does (and doesn't do) for you. See [docs/generator.md](generator.md).
