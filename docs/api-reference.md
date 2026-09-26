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

## `ui5(target): object`

Fluent entry point into `Ui5Locator`, for use outside a Page Object. `target` is a `Ui5Target`
(`Page | Frame`) - pass a `Frame` (e.g. from `findUi5Frame()`) to build locators scoped to one
specific iframe. See [docs/cross-frame.md](cross-frame.md).

```ts
ui5(target).id(value, options?)
ui5(target).controlType(type, properties?)
ui5(target).bindingPath(path, controlType?)
ui5(target).text(value, options?)
ui5(target).css(selector)
ui5(target).role(role, name?)
```

Each returns a `Ui5Locator`. See [docs/locators.md](locators.md).

## `Ui5Locator`

A chainable, self-healing locator. Built via `ui5(target).<strategy>(...)` or the protected
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

## `waitForUi5(target, options?): Promise<void>`

Waits until the app has no busy indicator, no pending requests, and a stable control tree.
`target` is a `Ui5Target` (`Page | Frame`). `options: { timeout?: number }` (default 15000ms). See
[docs/auto-wait.md](auto-wait.md).

## `waitForUi5Core(target, options?): Promise<void>`

Waits until the SAPUI5 runtime has bootstrapped (`sap.ui.getCore()` exists), then best-effort
waits for `networkidle`. `target` is a `Ui5Target` (`Page | Frame`). `options: { timeout?:
number }` (default 30000ms). See [docs/auto-wait.md](auto-wait.md).

## `findUi5Frame(page, options?): Promise<Frame>`

Finds the iframe (other than `page`'s main frame) with its own ready SAPUI5 runtime - the pattern
used by Fiori Launchpad and similar shell apps to embed a target app. `options: { timeout?:
number; predicate?: (frame: Frame) => boolean }` (default timeout 30000ms). See
[docs/cross-frame.md](cross-frame.md).

## `Ui5Target`

```ts
type Ui5Target = Page | Frame;
```

Anything the locator/wait/bridge APIs above can target - the top-level `Page`, or one `Frame`
within it. See [docs/cross-frame.md](cross-frame.md).

## `Ui5Bridge`

Low-level, static access point to the in-browser bridge. Most consumers won't need this directly

- `Ui5Locator`/`Ui5Page`/`waitForUi5` already use it - but it's available for advanced cases
  (custom wait conditions, tooling). Every method accepts a `Ui5Target` (`Page | Frame`).

```ts
class Ui5Bridge {
  static async ensure(target: Ui5Target): Promise<void>;
  static async isCoreReady(target: Ui5Target): Promise<boolean>;
  static async isBusy(target: Ui5Target): Promise<boolean>;
  static async findControlsById(
    target: Ui5Target,
    idSuffix: string,
    exact?: boolean,
  ): Promise<Ui5ControlInfo[]>;
  static async findControlsByType(
    target: Ui5Target,
    controlType: string,
    properties?: Record<string, unknown>,
  ): Promise<Ui5ControlInfo[]>;
  static async findControlsByBindingPath(
    target: Ui5Target,
    path: string,
    controlType?: string,
  ): Promise<Ui5ControlInfo[]>;
  static async findControlsByText(
    target: Ui5Target,
    text: string,
    controlType?: string,
    exact?: boolean,
  ): Promise<Ui5ControlInfo[]>;
  static async dumpControlTree(target: Ui5Target): Promise<Ui5ControlDump[]>;

  // Advanced: exact-id lookups and scoped searches - back the custom matchers, Ui5Table, and
  // Ui5Dialog. See docs/architecture.md.
  static async getControlProperty(
    target: Ui5Target,
    id: string,
    propertyName: string,
  ): Promise<Ui5PropertyResult>;
  static async getControlText(target: Ui5Target, id: string): Promise<Ui5TextResult>;
  static async findDescendantControlsByType(
    target: Ui5Target,
    containerId: string,
    type: string,
  ): Promise<Ui5ControlInfo[]>;
  static async getAggregation(
    target: Ui5Target,
    containerId: string,
    aggregationName: string,
  ): Promise<Ui5ControlInfo[]>;
  static async findOpenPopups(target: Ui5Target): Promise<Ui5ControlInfo[]>;

  // Advanced: sap.ui.comp SmartFilterBar/SmartTable - back Ui5SmartFilterBar and Ui5SmartTable.
  static async setSmartFilterBarData(
    target: Ui5Target,
    id: string,
    data: Record<string, unknown>,
  ): Promise<Ui5BridgeActionResult>;
  static async getSmartFilterBarData(target: Ui5Target, id: string): Promise<Ui5FilterDataResult>;
  static async triggerSmartFilterBarSearch(
    target: Ui5Target,
    id: string,
  ): Promise<Ui5BridgeActionResult>;
  static async getSmartTableInfo(target: Ui5Target, id: string): Promise<Ui5SmartTableInfo>;

  // Advanced: sap.ui.table.Table (grid/tree table) - back Ui5GridTable.
  static async getGridTableInfo(target: Ui5Target, id: string): Promise<Ui5GridTableInfo>;
  static async scrollGridTableToRow(
    target: Ui5Target,
    id: string,
    rowIndex: number,
  ): Promise<Ui5BridgeActionResult>;
}
```

`Ui5Bridge.ensure(target)` must be called **before** `page.goto()` (or before an iframe navigates)
to see a navigation's bootstrap network activity - see
[docs/auto-wait.md](auto-wait.md#the-ordering-gotcha-bridge-installation-vs-navigation).

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

See [docs/ui5-dialog.md](ui5-dialog.md). See [`findUi5Frame`](#findui5framepage-options-promiseframe)
above for the cross-frame helper.

## `Ui5SmartFilterBar`

```ts
class Ui5SmartFilterBar {
  static async from(
    filterBarLocator: Ui5Locator,
    options?: { timeout?: number },
  ): Promise<Ui5SmartFilterBar>;

  async setFilterData(data: Record<string, unknown>): Promise<void>;
  async getFilterData(): Promise<Record<string, unknown>>;
  async search(options?: { timeout?: number }): Promise<void>;
}
```

See [docs/smart-controls.md](smart-controls.md).

## `Ui5SmartTable`

```ts
class Ui5SmartTable {
  static async from(
    smartTableLocator: Ui5Locator,
    options?: { timeout?: number },
  ): Promise<Ui5SmartTable>;

  async rowCount(): Promise<number | undefined>;
  async innerTableType(): Promise<string | null>; // 'sap.m.Table' | 'sap.ui.table.Table' | null
  async innerTableLocator(): Promise<Ui5Locator>;
}
```

See [docs/smart-controls.md](smart-controls.md).

## `Ui5GridTable`

```ts
class Ui5GridTable {
  static async from(
    tableLocator: Ui5Locator,
    options?: { timeout?: number },
  ): Promise<Ui5GridTable>;

  async rowCount(): Promise<number | undefined>;
  async firstVisibleRow(): Promise<number>;
  async renderedRowCount(): Promise<number>;
  async scrollToRow(rowIndex: number): Promise<void>;
  async row(index: number): Promise<Locator>;
  async cellText(rowIndex: number, columnIndex: number): Promise<string>;
  async rowContaining(text: string): Promise<Locator>;
  async columnHeaders(): Promise<string[]>;
}
```

See [docs/ui5-grid-table.md](ui5-grid-table.md).

## `Ui5ValueHelpDialog`

```ts
class Ui5ValueHelpDialog {
  static async openFor(
    fieldLocator: Ui5Locator,
    options?: { timeout?: number },
  ): Promise<Ui5ValueHelpDialog>;

  async title(): Promise<string>;
  async selectRow(text: string, options?: Parameters<Locator['click']>[0]): Promise<void>;
  async button(text: string): Promise<Locator>;
  async clickButton(text: string, options?: Parameters<Locator['click']>[0]): Promise<void>;
  async cancel(options?: Parameters<Locator['click']>[0]): Promise<void>;
  async waitForClose(options?: { timeout?: number }): Promise<void>;
}
```

See [docs/value-help-dialog.md](value-help-dialog.md).

## `Ui5I18n`

```ts
class Ui5I18n {
  static async getText(
    target: Ui5Target,
    key: string,
    options?: { args?: (string | number)[]; modelName?: string },
  ): Promise<string>; // throws if the key isn't found
  static async hasText(
    target: Ui5Target,
    key: string,
    options?: { modelName?: string },
  ): Promise<boolean>;
}
```

See [docs/i18n.md](i18n.md).

## `Ui5Model`

```ts
class Ui5Model {
  static async getProperty(
    target: Ui5Target,
    path: string,
    options?: { modelName?: string; control?: Ui5Locator | Locator },
  ): Promise<unknown>;
  static async getBindingContextData(
    target: Ui5Target,
    control: Ui5Locator | Locator,
    options?: { modelName?: string },
  ): Promise<{ hasContext: boolean; path: string | undefined; data: unknown }>;
  static async listModels(target: Ui5Target): Promise<string[]>;
}
```

See [docs/model-data.md](model-data.md).

## `Ui5MessageToast` / `Ui5Messages`

```ts
class Ui5MessageToast {
  static async all(target: Ui5Target): Promise<Ui5MessageToastRecord[]>;
  static async texts(target: Ui5Target): Promise<string[]>;
  static async clear(target: Ui5Target): Promise<void>;
  static async waitForText(
    target: Ui5Target,
    expected: string | RegExp,
    options?: { timeout?: number },
  ): Promise<string>;
}

class Ui5Messages {
  static async all(target: Ui5Target): Promise<Ui5MessageInfo[]>;
  static async errors(target: Ui5Target): Promise<Ui5MessageInfo[]>;
  static async warnings(target: Ui5Target): Promise<Ui5MessageInfo[]>;
  static async waitForMessage(
    target: Ui5Target,
    expected: string | RegExp,
    options?: { timeout?: number; type?: string },
  ): Promise<Ui5MessageInfo>;
  static async clear(target: Ui5Target): Promise<boolean>;
}
```

See [docs/messages.md](messages.md).

## `Ui5Select`

```ts
class Ui5Select {
  static async items(target: Ui5Target, select: Ui5Locator | Locator): Promise<Ui5SelectItem[]>;
  static async selectedKey(
    target: Ui5Target,
    select: Ui5Locator | Locator,
  ): Promise<string | undefined>;
  static async selectedKeys(target: Ui5Target, select: Ui5Locator | Locator): Promise<string[]>;
  static async open(target: Ui5Target, select: Ui5Locator | Locator): Promise<void>;
  static async close(target: Ui5Target, select: Ui5Locator | Locator): Promise<void>;
  static async selectByText(
    target: Ui5Target,
    select: Ui5Locator | Locator,
    text: string,
    options?: { exact?: boolean },
  ): Promise<void>;
  static async selectByKey(
    target: Ui5Target,
    select: Ui5Locator | Locator,
    key: string,
  ): Promise<void>;
}
```

See [docs/form-inputs.md](form-inputs.md).

## `Ui5DatePicker`

```ts
class Ui5DatePicker {
  static async setDate(
    target: Ui5Target,
    datePicker: Ui5Locator | Locator,
    date: Date | string, // a Date, or 'YYYY-MM-DD'
  ): Promise<void>;
  static async getDate(
    target: Ui5Target,
    datePicker: Ui5Locator | Locator,
  ): Promise<{ date: Date | null; displayValue: string }>;
  static async typeDate(datePicker: Ui5Locator | Locator, text: string): Promise<void>;
}
```

See [docs/form-inputs.md](form-inputs.md).

## `Ui5VariantManagement`

```ts
class Ui5VariantManagement {
  static async variants(target: Ui5Target, vm: Ui5Locator | Locator): Promise<Ui5Variant[]>;
  static async currentKey(target: Ui5Target, vm: Ui5Locator | Locator): Promise<string | undefined>;
  static async currentName(
    target: Ui5Target,
    vm: Ui5Locator | Locator,
  ): Promise<string | undefined>;
  static async selectByKey(
    target: Ui5Target,
    vm: Ui5Locator | Locator,
    key: string,
    options?: { timeout?: number },
  ): Promise<void>;
  static async selectByName(
    target: Ui5Target,
    vm: Ui5Locator | Locator,
    name: string,
    options?: { timeout?: number },
  ): Promise<void>;
}
```

See [docs/variant-management.md](variant-management.md).

## `Ui5FlexibleColumnLayout`

The locator argument is optional - an app almost always has exactly one.

```ts
class Ui5FlexibleColumnLayout {
  static async layout(target: Ui5Target, fcl?: Ui5Locator | Locator): Promise<string | undefined>;
  static async visibleColumnCount(target: Ui5Target, fcl?: Ui5Locator | Locator): Promise<number>;
  static async currentPages(
    target: Ui5Target,
    fcl?: Ui5Locator | Locator,
  ): Promise<{ begin?: string; mid?: string; end?: string }>;
  static async setLayout(
    target: Ui5Target,
    layout: string,
    fcl?: Ui5Locator | Locator,
    options?: { timeout?: number },
  ): Promise<void>;
}
```

See [docs/flexible-column-layout.md](flexible-column-layout.md).

## `Ui5Performance`

```ts
class Ui5Performance {
  static async measureBootstrap(
    page: Page,
    url: string,
    options?: { timeout?: number },
  ): Promise<Ui5BootstrapTimings>; // { navigationMs, coreReadyMs, settledMs, metrics }
  static async metrics(target: Ui5Target): Promise<Ui5PerformanceMetrics>;
}
```

See [docs/performance.md](performance.md).

## `Ui5Navigation`

```ts
class Ui5Navigation {
  static async hash(target: Ui5Target): Promise<string>;
  static async navTo(
    target: Ui5Target,
    routeName: string,
    parameters?: Record<string, unknown>,
    options?: { timeout?: number },
  ): Promise<void>;
  static async waitForHash(
    target: Ui5Target,
    expected: string | RegExp,
    options?: { timeout?: number },
  ): Promise<string>;
}
```

See [docs/navigation.md](navigation.md).

## Diagnostics

```ts
function captureControlTree(target: Ui5Target): Promise<{ dump: Ui5ControlDump[]; text: string }>;
function formatControlTree(dump: Ui5ControlDump[], options?: { maxRows?: number }): string;
function summarizeByType(dump: Ui5ControlDump[]): { type: string; count: number }[];
```

Attached to failing tests automatically by this package's `test` fixture - see
[docs/diagnostics.md](diagnostics.md).

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

// The one real Fiori apps actually need - ODataModel v2 defaults to useBatch: true.
function mockODataBatch(
  page: Page,
  urlPattern: string | RegExp,
  parts: MockODataBatchPart[], // matched positionally to the embedded requests
  options?: { version?: 'v2' | 'v4' },
): Promise<void>;

interface MockODataBatchPart {
  data?: unknown; // array = collection, object = single entity
  status?: number;
  raw?: boolean; // skip the OData envelope
}
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

interface Ui5BridgeActionResult {
  found: boolean;
  ok: boolean;
  error?: string;
}

interface Ui5FilterDataResult {
  found: boolean;
  value: Record<string, unknown> | undefined;
}

interface Ui5SmartTableInfo {
  found: boolean;
  innerTable: Ui5ControlInfo | null;
  rowCount: number | undefined;
}

interface Ui5GridTableInfo {
  found: boolean;
  rowCount: number | undefined;
  firstVisibleRow: number | undefined;
  renderedRows: Ui5ControlInfo[];
}

type Ui5Target = Page | Frame;

interface FindUi5FrameOptions {
  timeout?: number;
  predicate?: (frame: Frame) => boolean;
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
