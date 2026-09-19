# API reference

> New to TypeScript? This page is dense with type signatures. See
> [docs/typescript-for-beginners.md](typescript-for-beginners.md) - especially
> [generics](typescript-for-beginners.md#generics-the-t-in-arrayt) (the `<...>` in `Promise<T>`)
> and [optional parameters](typescript-for-beginners.md#functions-parameters-optional-parameters-return-types)
> (the `?` after a name) - to read these signatures comfortably.

Everything below is exported from the package root: `import { ... } from 'playwright-sapui5'`.

## `test`, `expect`

Drop-in replacement for `@playwright/test`'s `test`/`expect`. Same API; the `page` fixture
opportunistically calls `waitForUi5()` after each full page load, and `expect` additionally has
three custom UI5 matchers - see [docs/getting-started.md](getting-started.md#3-your-first-test)
and [Custom matchers](#custom-expect-matchers) below.

## `ui5(page): object`

Fluent entry point into `Ui5Locator`, for use outside a Page Object.

```ts
ui5(page).id(value, options?)
ui5(page).controlType(type, properties?)
ui5(page).bindingPath(path, controlType?)
ui5(page).text(value, options?)
ui5(page).css(selector)
ui5(page).role(role, name?)
```

Each returns a `Ui5Locator`. See [docs/locators.md](locators.md).

## `Ui5Locator`

A chainable, self-healing locator. Built via `ui5(page).<strategy>(...)` or the protected
`Ui5Page` helpers - there's no public constructor.

**Chaining:**

- `.fallback(criteria: Ui5LocatorCriteria): this` - add a fallback strategy
- `.as(label: string): this` - name the locator for warnings/errors

**Resolution:**

- `.resolve(options?: { timeout?: number }): Promise<Locator>` - resolve to a plain Playwright
  `Locator`

**Actions** (each takes `{ timeout?, autoWaitUi5? }` plus the matching Playwright `Locator`
method's own options):

- `.click(options?): Promise<void>`
- `.fill(value: string, options?): Promise<void>`
- `.check(options?): Promise<void>`
- `.uncheck(options?): Promise<void>`
- `.hover(options?): Promise<void>`
- `.getText(options?): Promise<string>`
- `.isVisible(options?): Promise<boolean>`
- `.isEnabled(options?): Promise<boolean>`
- `.count(options?: { timeout? }): Promise<number>`
- `.waitFor(options?): Promise<void>`

Full guide: [docs/locators.md](locators.md).

## `Ui5Page`

Abstract base class for Page Objects.

```ts
abstract class Ui5Page {
  constructor(protected readonly page: Page);

  protected id(value: string, options?: { exact?: boolean }): Ui5Locator;
  protected controlType(type: string, properties?: Record<string, unknown>): Ui5Locator;
  protected bindingPath(path: string, controlType?: string): Ui5Locator;
  protected text(value: string, options?: { controlType?: string; exact?: boolean }): Ui5Locator;
  protected css(selector: string): Ui5Locator;

  async goto(url: string, options?: WaitForUi5Options): Promise<void>;
  async waitForUi5Ready(options?: WaitForUi5Options): Promise<void>;
}
```

Full guide: [docs/page-objects.md](page-objects.md).

## `waitForUi5(page, options?): Promise<void>`

Waits until the app has no busy indicator, no pending requests, and a stable control tree.
`options: { timeout?: number }` (default 15000ms). See [docs/auto-wait.md](auto-wait.md).

## `waitForUi5Core(page, options?): Promise<void>`

Waits until the SAPUI5 runtime has bootstrapped (`sap.ui.getCore()` exists), then best-effort
waits for `networkidle`. `options: { timeout?: number }` (default 30000ms). See
[docs/auto-wait.md](auto-wait.md).

## `Ui5Bridge`

Low-level, static access point to the in-browser bridge. Most consumers won't need this directly

- `Ui5Locator`/`Ui5Page`/`waitForUi5` already use it - but it's available for advanced cases
  (custom wait conditions, tooling).

```ts
class Ui5Bridge {
  static async ensure(page: Page): Promise<void>;
  static async isCoreReady(page: Page): Promise<boolean>;
  static async isBusy(page: Page): Promise<boolean>;
  static async findControlsById(
    page: Page,
    idSuffix: string,
    exact?: boolean,
  ): Promise<Ui5ControlInfo[]>;
  static async findControlsByType(
    page: Page,
    controlType: string,
    properties?: Record<string, unknown>,
  ): Promise<Ui5ControlInfo[]>;
  static async findControlsByBindingPath(
    page: Page,
    path: string,
    controlType?: string,
  ): Promise<Ui5ControlInfo[]>;
  static async findControlsByText(
    page: Page,
    text: string,
    controlType?: string,
    exact?: boolean,
  ): Promise<Ui5ControlInfo[]>;
  static async dumpControlTree(page: Page): Promise<Ui5ControlDump[]>;

  // Advanced: exact-id lookups and scoped searches - back the custom matchers, Ui5Table, and
  // Ui5Dialog. See docs/architecture.md.
  static async getControlProperty(
    page: Page,
    id: string,
    propertyName: string,
  ): Promise<Ui5PropertyResult>;
  static async getControlText(page: Page, id: string): Promise<Ui5TextResult>;
  static async findDescendantControlsByType(
    page: Page,
    containerId: string,
    type: string,
  ): Promise<Ui5ControlInfo[]>;
  static async getAggregation(
    page: Page,
    containerId: string,
    aggregationName: string,
  ): Promise<Ui5ControlInfo[]>;
  static async findOpenPopups(page: Page): Promise<Ui5ControlInfo[]>;
}
```

`Ui5Bridge.ensure(page)` must be called **before** `page.goto()` to see a navigation's bootstrap
network activity - see [docs/auto-wait.md](auto-wait.md#the-ordering-gotcha-bridge-installation-vs-navigation).

## `SelfHealingResolver`

```ts
class SelfHealingResolver {
  static onHeal(listener: (event: HealEvent) => void): () => void; // returns an unsubscribe fn
  static async resolve(
    page: Page,
    strategies: Ui5LocatorCriteria[],
    options?: { timeout?: number; label?: string },
  ): Promise<Locator>;
}
```

`Ui5Locator` uses this internally; call `.onHeal(...)` directly if you want to observe every heal
across your whole suite (e.g. to log them centrally). See
[docs/locators.md](locators.md#self-healing-fallback-strategies).

## `generatePageObjectSource(dump, className): string`

Turns a `Ui5ControlDump[]` (from `Ui5Bridge.dumpControlTree`) into the source of a `Ui5Page`
subclass. Used internally by the `pw-sapui5 generate` CLI - exposed in case you want to build your
own tooling around it. See [docs/generator.md](generator.md).

## Custom `expect` matchers

Available on the `expect` this package exports (not on `@playwright/test`'s own). Each accepts a
`Ui5Locator` or a plain Playwright `Locator`, auto-retries like Playwright's own built-in
matchers, and supports `.not`.

```ts
expect(target: Ui5Locator | Locator).toHaveUi5Property(
  propertyName: string,
  expected: unknown,
  options?: { timeout?: number },
): Promise<void>;

expect(target: Ui5Locator | Locator).toHaveUi5Text(
  expected: string,
  options?: { timeout?: number },
): Promise<void>;

expect(target: Ui5Locator | Locator).toBeUi5Busy(options?: { timeout?: number }): Promise<void>;
```

See [docs/expect-matchers.md](expect-matchers.md).

## `Ui5Table`

```ts
class Ui5Table {
  static async from(
    tableLocator: Ui5Locator,
    options?: { rowControlType?: string; timeout?: number },
  ): Promise<Ui5Table>;

  async rowCount(): Promise<number>;
  async row(index: number): Promise<Locator>;
  async rowContaining(text: string): Promise<Locator>;
  async cellText(rowIndex: number, cellIndex: number): Promise<string>; // sap.m.Table only
  async columnHeaders(): Promise<string[]>; // sap.m.Table only
}
```

See [docs/ui5-table.md](ui5-table.md).

## `Ui5Dialog`

```ts
class Ui5Dialog {
  static async open(page: Page, options?: { timeout?: number }): Promise<Ui5Dialog>;

  async title(): Promise<string>;
  async button(text: string): Promise<Locator>;
  async clickButton(text: string, options?: Parameters<Locator['click']>[0]): Promise<void>;
  async waitForClose(options?: { timeout?: number }): Promise<void>;
}
```

See [docs/ui5-dialog.md](ui5-dialog.md).

## OData mocking

```ts
function mockODataCollection(
  page: Page,
  urlPattern: string | RegExp,
  data: Record<string, unknown>[],
  options?: { version?: 'v2' | 'v4'; status?: number },
): Promise<void>;

function mockODataEntity(
  page: Page,
  urlPattern: string | RegExp,
  data: Record<string, unknown>,
  options?: { version?: 'v2' | 'v4'; status?: number },
): Promise<void>;

function mockODataError(
  page: Page,
  urlPattern: string | RegExp,
  options?: { version?: 'v2' | 'v4'; status?: number; code?: string; message?: string },
): Promise<void>;
```

See [docs/odata-mocking.md](odata-mocking.md).

## Types

```ts
interface Ui5ControlInfo {
  id: string;
  type: string;
}

interface Ui5ControlDump {
  id: string;
  type: string;
  properties: Record<string, string>;
  parentId?: string;
}

type Ui5LocatorCriteria =
  | { by: 'id'; value: string; exact?: boolean }
  | { by: 'controlType'; controlType: string; properties?: Record<string, unknown> }
  | { by: 'bindingPath'; path: string; controlType?: string }
  | { by: 'text'; text: string; controlType?: string; exact?: boolean }
  | { by: 'css'; selector: string }
  | { by: 'role'; role: string; name?: string };

interface WaitForUi5Options {
  timeout?: number;
}

interface HealEvent {
  label?: string;
  strategyIndex: number;
  strategy: Ui5LocatorCriteria;
  attempt: number;
}

type HealListener = (event: HealEvent) => void;

interface Ui5PropertyResult {
  found: boolean;
  hasProperty: boolean;
  value: unknown;
}

interface Ui5TextResult {
  found: boolean;
  value: string | undefined;
}

type ODataVersion = 'v2' | 'v4';

interface MockODataCollectionOptions {
  version?: ODataVersion;
  status?: number;
}

interface MockODataErrorOptions {
  version?: ODataVersion;
  status?: number;
  code?: string;
  message?: string;
}
```

## CLI: `pw-sapui5 generate`

See [docs/generator.md](generator.md) for full usage.

```bash
npx pw-sapui5 generate --url <url> [--output <path>] [--class-name <name>] [--headed] [--timeout <ms>]
```

## CLI: `pw-sapui5 init`

See [docs/init.md](init.md) for full usage.

```bash
npx pw-sapui5 init [--dir <path>] [--base-url <url>] [--force]
```
