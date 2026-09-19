import type { Page } from '@playwright/test';
import { bridgeScript } from '../browser/bridgeScript';
import type { Ui5ControlDump, Ui5ControlInfo, Ui5PropertyResult, Ui5TextResult } from './types';

// One shared `WeakMap` tracking every `Page` this class has started (or finished) installing the
// bridge onto, keyed to the in-flight/completed installation `Promise` itself - not just a
// boolean flag. That distinction matters: `ensure()` is called defensively from many places
// (`Ui5Locator`, `waitForUi5`, `Ui5Page.goto()`, this framework's own `page.on('load')` fixture
// listener, ...), often without waiting for one caller's `ensure()` to finish before another
// starts. A plain `WeakSet<Page>` flag set *before* the actual (asynchronous) injection completes
// would let a second, concurrent caller see "already handled" and skip straight to using the
// bridge - before it necessarily exists yet. Storing the `Promise` instead means every concurrent
// caller awaits the exact same in-flight work, so none of them can race ahead of it.
//
// `WeakMap` (rather than a plain `Map`) is used for the same reason `WeakSet` was chosen before:
// it holds *weak* references, so it won't keep a closed/garbage-collected `Page` object alive
// forever the way a normal `Map` would (a real memory leak risk across a long test run with many
// pages).
const bridgeInstallations = new WeakMap<object, Promise<void>>();

async function installBridge(page: Page): Promise<void> {
  // `page.addInitScript(fn)` tells Playwright: "run `fn` inside the browser, before any of the
  // page's own scripts, on every future navigation this `Page` makes." It does NOT run
  // immediately and does NOT affect a document that's already loaded - which is exactly why the
  // very next line exists.
  await page.addInitScript(bridgeScript);
  // addInitScript only affects future navigations; inject into the current document too.
  await page.evaluate(bridgeScript).catch(() => {
    /* page may not have a document yet (e.g. about:blank restrictions) - safe to ignore */
  });
}

/**
 * Node-side access point to the in-browser UI5 bridge. Handles injecting the bridge script
 * exactly once per `Page`, and exposes typed methods that call into it.
 *
 * Most consumers should use `Ui5Locator` / `Ui5Page` instead of this class directly - it's
 * exposed for advanced use cases (e.g. the Page Object generator, or custom wait conditions).
 *
 * Every method here follows the exact same three-line shape: `ensure()` the bridge is installed,
 * then `page.evaluate(...)` to call one specific function on `window.__pwSapUi5__` and bring its
 * return value back to Node. See `src/browser/bridgeScript.ts` for what each of those bridge
 * functions actually does, and docs/architecture.md for the full Node ↔ browser picture.
 */
export class Ui5Bridge {
  /** Ensures the bridge is present on `page`, for both the current document and future
   * navigations. Safe to call repeatedly, and safe to call concurrently from multiple places at
   * once (see the comment on `bridgeInstallations` above) - every caller, whenever they call it,
   * only resolves once the *same* underlying installation has actually finished. */
  static async ensure(page: Page): Promise<void> {
    let installation = bridgeInstallations.get(page);
    if (!installation) {
      // Call `installBridge(page)` and store its `Promise` *synchronously*, in the same tick -
      // before this function's own next `await` - so that if another call to `ensure()` for the
      // same `page` happens before this installation finishes, it's guaranteed to find this
      // `Promise` already in the map (rather than finding nothing and starting a second,
      // redundant installation, or - the actual bug this replaced - finding a "done" flag that
      // was set too early and returning before the real work was complete).
      installation = installBridge(page);
      bridgeInstallations.set(page, installation);
    }
    await installation;
  }

  static async isCoreReady(page: Page): Promise<boolean> {
    await this.ensure(page);
    // `(window as any).__pwSapUi5__?.isCoreReady() ?? false` - two pieces worth calling out for
    // beginners: `?.` ("optional chaining") means "if `__pwSapUi5__` is undefined, stop here and
    // produce `undefined` instead of throwing"; `?? false` ("nullish coalescing") then converts
    // that possible `undefined` into a real `boolean`, so this function's declared return type
    // (`Promise<boolean>`) is always honestly met - see docs/typescript-for-beginners.md.
    return page.evaluate(() => (window as any).__pwSapUi5__?.isCoreReady() ?? false);
  }

  static async isBusy(page: Page): Promise<boolean> {
    await this.ensure(page);
    return page.evaluate(() => (window as any).__pwSapUi5__?.isBusy() ?? false);
  }

  static async findControlsById(
    page: Page,
    idSuffix: string,
    exact = false,
  ): Promise<Ui5ControlInfo[]> {
    await this.ensure(page);
    // `page.evaluate(fn, arg)` - same shape as `page.waitForFunction` in
    // `SelfHealingResolver.ts`, just without the "keep retrying" behavior: it runs `fn` once,
    // inside the browser, with `arg` passed in as plain data, and returns whatever `fn` returns.
    // The destructured `{ idSuffix, exact }` parameter here is the *browser-side* copy of the
    // Node-side `idSuffix`/`exact` values above - two separate variables with the same names,
    // living on two separate sides of the Node/browser boundary.
    return page.evaluate(
      ({ idSuffix, exact }) => (window as any).__pwSapUi5__.findControlsById(idSuffix, exact),
      { idSuffix, exact },
    );
  }

  static async findControlsByType(
    page: Page,
    controlType: string,
    properties?: Record<string, unknown>,
  ): Promise<Ui5ControlInfo[]> {
    await this.ensure(page);
    return page.evaluate(
      ({ controlType, properties }) =>
        (window as any).__pwSapUi5__.findControlsByType(controlType, properties),
      { controlType, properties },
    );
  }

  static async findControlsByBindingPath(
    page: Page,
    path: string,
    controlType?: string,
  ): Promise<Ui5ControlInfo[]> {
    await this.ensure(page);
    return page.evaluate(
      ({ path, controlType }) =>
        (window as any).__pwSapUi5__.findControlsByBindingPath(path, controlType),
      { path, controlType },
    );
  }

  static async findControlsByText(
    page: Page,
    text: string,
    controlType?: string,
    exact = false,
  ): Promise<Ui5ControlInfo[]> {
    await this.ensure(page);
    return page.evaluate(
      ({ text, controlType, exact }) =>
        (window as any).__pwSapUi5__.findControlsByText(text, controlType, exact),
      { text, controlType, exact },
    );
  }

  /** Used by the Page Object generator (`pw-sapui5 generate`) - see `src/generator/cli.ts`. */
  static async dumpControlTree(page: Page): Promise<Ui5ControlDump[]> {
    await this.ensure(page);
    return page.evaluate(() => (window as any).__pwSapUi5__.dumpControlTree());
  }

  // --- Advanced: exact-id lookups and scoped searches -------------------------------------------
  // Everything below is used by the "advanced feature" building blocks (`src/core/matchers.ts`,
  // `src/core/Ui5Table.ts`, `src/core/Ui5Dialog.ts`) rather than by `Ui5Locator` itself - those
  // all need to act on *one already-resolved control* (by its exact, known DOM id) or search
  // *within* one, rather than searching the whole page from scratch the way `Ui5Locator` does.

  /** Reads one property off the control with the exact id `id`. Used by the `toHaveUi5Property`
   * and `toBeUi5Busy` matchers - see `src/core/matchers.ts`. */
  static async getControlProperty(
    page: Page,
    id: string,
    propertyName: string,
  ): Promise<Ui5PropertyResult> {
    await this.ensure(page);
    return page.evaluate(
      ({ id, propertyName }) => (window as any).__pwSapUi5__.getControlProperty(id, propertyName),
      { id, propertyName },
    );
  }

  /** Reads the visible text off the control with the exact id `id`, trying the same candidate
   * getters `findControlsByText` searches by. Used by the `toHaveUi5Text` matcher. */
  static async getControlText(page: Page, id: string): Promise<Ui5TextResult> {
    await this.ensure(page);
    return page.evaluate(({ id }) => (window as any).__pwSapUi5__.getControlText(id), { id });
  }

  /** Every currently-rendered control of `type` nested anywhere inside the control with exact id
   * `containerId`. Used by `Ui5Table` (rows within a table) and `Ui5Dialog` (buttons within an
   * open dialog) to scope a search to one specific control instead of the whole page. */
  static async findDescendantControlsByType(
    page: Page,
    containerId: string,
    type: string,
  ): Promise<Ui5ControlInfo[]> {
    await this.ensure(page);
    return page.evaluate(
      ({ containerId, type }) =>
        (window as any).__pwSapUi5__.findDescendantControlsByType(containerId, type),
      { containerId, type },
    );
  }

  /** Reads one aggregation (e.g. a table's `columns`, a row's `cells`) off the control with exact
   * id `containerId`. Used by `Ui5Table` for column headers. */
  static async getAggregation(
    page: Page,
    containerId: string,
    aggregationName: string,
  ): Promise<Ui5ControlInfo[]> {
    await this.ensure(page);
    return page.evaluate(
      ({ containerId, aggregationName }) =>
        (window as any).__pwSapUi5__.getAggregation(containerId, aggregationName),
      { containerId, aggregationName },
    );
  }

  /** Every currently-rendered control that reports itself as open (`isOpen() === true`) right
   * now - covers both `sap.m.Dialog` and `sap.m.Popover`. Used by `Ui5Dialog.open()`. */
  static async findOpenPopups(page: Page): Promise<Ui5ControlInfo[]> {
    await this.ensure(page);
    return page.evaluate(() => (window as any).__pwSapUi5__.findOpenPopups());
  }
}
