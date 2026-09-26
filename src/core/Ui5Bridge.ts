import type { Frame, Page } from '@playwright/test';
import { bridgeScript } from '../browser/bridgeScript';
import type {
  Ui5BindingContextResult,
  Ui5BridgeActionResult,
  Ui5ControlDump,
  Ui5ControlInfo,
  Ui5DatePickerValue,
  Ui5FilterDataResult,
  Ui5GridTableInfo,
  Ui5I18nResult,
  Ui5MessageInfo,
  Ui5MessageToastRecord,
  Ui5ModelPropertyResult,
  Ui5PropertyResult,
  Ui5SelectInfo,
  Ui5SmartTableInfo,
  Ui5TextResult,
} from './types';

/**
 * Anything this framework's locators/waits/bridge calls can target: the top-level `Page`, or one
 * specific `Frame` within it - most notably, an embedded app's own iframe inside a Fiori
 * Launchpad shell. `Page` and `Frame` both expose the same `.evaluate()`/`.waitForFunction()`/
 * `.locator()` methods this file (and `Ui5Locator`, `waits.ts`, `ui5()`) actually use, which is
 * what makes accepting either, uniformly, possible at all - see docs/cross-frame.md.
 */
export type Ui5Target = Page | Frame;

/** `Frame` has a `.page()` method returning the `Page` that owns it; `Page` has no such method.
 * That difference is this file's only way to tell which one it was given at runtime - useful
 * because `page.addInitScript(...)` (unlike `.evaluate()`) only exists on `Page`, never on
 * `Frame`, so installing the bridge always needs the *owning* `Page`, even when the caller only
 * has a `Frame` in hand. */
function ownerPage(target: Ui5Target): Page {
  const maybeFrame = target as Frame;
  return typeof maybeFrame.page === 'function' ? maybeFrame.page() : (target as Page);
}

// One shared `WeakMap` tracking every target (`Page` *or* `Frame`) this class has started (or
// finished) installing the bridge onto, keyed to the in-flight/completed installation `Promise`
// itself - not just a boolean flag. That distinction matters: `ensure()` is called defensively
// from many places (`Ui5Locator`, `waitForUi5`, `Ui5Page.goto()`, this framework's own
// `page.on('load')` fixture listener, ...), often without waiting for one caller's `ensure()` to
// finish before another starts. A plain `WeakSet` flag set *before* the actual (asynchronous)
// injection completes would let a second, concurrent caller see "already handled" and skip
// straight to using the bridge - before it necessarily exists yet. Storing the `Promise` instead
// means every concurrent caller awaits the exact same in-flight work, so none of them can race
// ahead of it.
//
// Each distinct target - the top-level `Page`, and each `Frame` within it that's ever passed to
// `ensure()` - gets its own entry, because each one needs its *own* one-time "inject into the
// document that's already loaded there" step (see `installBridge` below); `page.addInitScript()`
// only has to be registered once overall (it then covers every frame automatically, present and
// future - see docs/cross-frame.md#how-it-works), but calling it again for a second target is
// harmless (the bridge script itself is idempotent), so this doesn't bother avoiding that.
//
// `WeakMap` (rather than a plain `Map`) is used for the same reason `WeakSet` was chosen before:
// it holds *weak* references, so it won't keep a closed/garbage-collected `Page`/`Frame` object
// alive forever the way a normal `Map` would (a real memory leak risk across a long test run with
// many pages/frames).
const bridgeInstallations = new WeakMap<object, Promise<void>>();

async function installBridge(target: Ui5Target): Promise<void> {
  // `page.addInitScript(fn)` tells Playwright: "run `fn` inside the browser, before any page or
  // frame's own scripts, on every future navigation - including every iframe this Page ever
  // loads, not just its main document." It does NOT run immediately and does NOT affect a
  // document that's already loaded - which is exactly why the next line exists.
  await ownerPage(target).addInitScript(bridgeScript);
  // addInitScript only affects future navigations; inject into `target`'s current document too -
  // whether that's the page's main frame or one specific already-loaded iframe.
  await target.evaluate(bridgeScript).catch(() => {
    /* target may not have a document yet (e.g. about:blank restrictions) - safe to ignore */
  });
}

/**
 * Node-side access point to the in-browser UI5 bridge. Handles injecting the bridge script
 * exactly once per target, and exposes typed methods that call into it.
 *
 * Most consumers should use `Ui5Locator` / `Ui5Page` instead of this class directly - it's
 * exposed for advanced use cases (e.g. the Page Object generator, or custom wait conditions).
 *
 * Every method here follows the exact same three-line shape: `ensure()` the bridge is installed,
 * then `target.evaluate(...)` to call one specific function on `window.__pwSapUi5__` and bring
 * its return value back to Node. See `src/browser/bridgeScript.ts` for what each of those bridge
 * functions actually does, and docs/architecture.md for the full Node ↔ browser picture.
 */
export class Ui5Bridge {
  /** Ensures the bridge is present on `target`, for both its current document and future
   * navigations. Safe to call repeatedly, and safe to call concurrently from multiple places at
   * once (see the comment on `bridgeInstallations` above) - every caller, whenever they call it,
   * only resolves once the *same* underlying installation has actually finished. */
  static async ensure(target: Ui5Target): Promise<void> {
    let installation = bridgeInstallations.get(target);
    if (!installation) {
      // Call `installBridge(target)` and store its `Promise` *synchronously*, in the same tick -
      // before this function's own next `await` - so that if another call to `ensure()` for the
      // same target happens before this installation finishes, it's guaranteed to find this
      // `Promise` already in the map (rather than finding nothing and starting a second,
      // redundant installation, or - a real bug this exact pattern replaced, see
      // docs/architecture.md#a-real-concurrency-bug-this-caught - finding a "done" flag that was
      // set too early and returning before the real work was complete).
      installation = installBridge(target);
      bridgeInstallations.set(target, installation);
    }
    await installation;
  }

  static async isCoreReady(target: Ui5Target): Promise<boolean> {
    await this.ensure(target);
    // `(window as any).__pwSapUi5__?.isCoreReady() ?? false` - two pieces worth calling out for
    // beginners: `?.` ("optional chaining") means "if `__pwSapUi5__` is undefined, stop here and
    // produce `undefined` instead of throwing"; `?? false` ("nullish coalescing") then converts
    // that possible `undefined` into a real `boolean`, so this function's declared return type
    // (`Promise<boolean>`) is always honestly met - see docs/typescript-for-beginners.md.
    return target.evaluate(() => (window as any).__pwSapUi5__?.isCoreReady() ?? false);
  }

  static async isBusy(target: Ui5Target): Promise<boolean> {
    await this.ensure(target);
    return target.evaluate(() => (window as any).__pwSapUi5__?.isBusy() ?? false);
  }

  static async findControlsById(
    target: Ui5Target,
    idSuffix: string,
    exact = false,
  ): Promise<Ui5ControlInfo[]> {
    await this.ensure(target);
    // `target.evaluate(fn, arg)` - same shape as `page.waitForFunction` in
    // `SelfHealingResolver.ts`, just without the "keep retrying" behavior: it runs `fn` once,
    // inside the browser, with `arg` passed in as plain data, and returns whatever `fn` returns.
    // The destructured `{ idSuffix, exact }` parameter here is the *browser-side* copy of the
    // Node-side `idSuffix`/`exact` values above - two separate variables with the same names,
    // living on two separate sides of the Node/browser boundary.
    return target.evaluate(
      ({ idSuffix, exact }) => (window as any).__pwSapUi5__.findControlsById(idSuffix, exact),
      { idSuffix, exact },
    );
  }

  static async findControlsByType(
    target: Ui5Target,
    controlType: string,
    properties?: Record<string, unknown>,
  ): Promise<Ui5ControlInfo[]> {
    await this.ensure(target);
    return target.evaluate(
      ({ controlType, properties }) =>
        (window as any).__pwSapUi5__.findControlsByType(controlType, properties),
      { controlType, properties },
    );
  }

  static async findControlsByBindingPath(
    target: Ui5Target,
    path: string,
    controlType?: string,
  ): Promise<Ui5ControlInfo[]> {
    await this.ensure(target);
    return target.evaluate(
      ({ path, controlType }) =>
        (window as any).__pwSapUi5__.findControlsByBindingPath(path, controlType),
      { path, controlType },
    );
  }

  static async findControlsByText(
    target: Ui5Target,
    text: string,
    controlType?: string,
    exact = false,
  ): Promise<Ui5ControlInfo[]> {
    await this.ensure(target);
    return target.evaluate(
      ({ text, controlType, exact }) =>
        (window as any).__pwSapUi5__.findControlsByText(text, controlType, exact),
      { text, controlType, exact },
    );
  }

  /** Used by the Page Object generator (`pw-sapui5 generate`) - see `src/generator/cli.ts`. */
  static async dumpControlTree(target: Ui5Target): Promise<Ui5ControlDump[]> {
    await this.ensure(target);
    return target.evaluate(() => (window as any).__pwSapUi5__.dumpControlTree());
  }

  // --- Advanced: exact-id lookups and scoped searches -------------------------------------------
  // Everything below is used by the "advanced feature" building blocks (`src/core/matchers.ts`,
  // `src/core/Ui5Table.ts`, `src/core/Ui5Dialog.ts`) rather than by `Ui5Locator` itself - those
  // all need to act on *one already-resolved control* (by its exact, known DOM id) or search
  // *within* one, rather than searching the whole page from scratch the way `Ui5Locator` does.

  /** Reads one property off the control with the exact id `id`. Used by the `toHaveUi5Property`
   * and `toBeUi5Busy` matchers - see `src/core/matchers.ts`. */
  static async getControlProperty(
    target: Ui5Target,
    id: string,
    propertyName: string,
  ): Promise<Ui5PropertyResult> {
    await this.ensure(target);
    return target.evaluate(
      ({ id, propertyName }) => (window as any).__pwSapUi5__.getControlProperty(id, propertyName),
      { id, propertyName },
    );
  }

  /** Reads the visible text off the control with the exact id `id`, trying the same candidate
   * getters `findControlsByText` searches by. Used by the `toHaveUi5Text` matcher. */
  static async getControlText(target: Ui5Target, id: string): Promise<Ui5TextResult> {
    await this.ensure(target);
    return target.evaluate(({ id }) => (window as any).__pwSapUi5__.getControlText(id), { id });
  }

  /** Every currently-rendered control of `type` nested anywhere inside the control with exact id
   * `containerId`. Used by `Ui5Table` (rows within a table) and `Ui5Dialog` (buttons within an
   * open dialog) to scope a search to one specific control instead of the whole page. */
  static async findDescendantControlsByType(
    target: Ui5Target,
    containerId: string,
    type: string,
  ): Promise<Ui5ControlInfo[]> {
    await this.ensure(target);
    return target.evaluate(
      ({ containerId, type }) =>
        (window as any).__pwSapUi5__.findDescendantControlsByType(containerId, type),
      { containerId, type },
    );
  }

  /** Reads one aggregation (e.g. a table's `columns`, a row's `cells`) off the control with exact
   * id `containerId`. Used by `Ui5Table` for column headers. */
  static async getAggregation(
    target: Ui5Target,
    containerId: string,
    aggregationName: string,
  ): Promise<Ui5ControlInfo[]> {
    await this.ensure(target);
    return target.evaluate(
      ({ containerId, aggregationName }) =>
        (window as any).__pwSapUi5__.getAggregation(containerId, aggregationName),
      { containerId, aggregationName },
    );
  }

  /** Every currently-rendered control that reports itself as open (`isOpen() === true`) right
   * now - covers both `sap.m.Dialog` and `sap.m.Popover`. Used by `Ui5Dialog.open()`. */
  static async findOpenPopups(target: Ui5Target): Promise<Ui5ControlInfo[]> {
    await this.ensure(target);
    return target.evaluate(() => (window as any).__pwSapUi5__.findOpenPopups());
  }

  // --- Advanced: sap.ui.comp SmartFilterBar / SmartTable -----------------------------------------
  // Backs `Ui5SmartFilterBar` and `Ui5SmartTable` - see docs/smart-controls.md. Unlike everything
  // above, these call an actual method *on* the control (`setFilterData`, `search`, ...), not just
  // read from it - see `Ui5BridgeActionResult` in `src/core/types.ts` for how a call that fails is
  // told apart from a control that was never found in the first place.

  /** Sets several filter values at once on a SmartFilterBar with exact id `id`, via its own
   * `setFilterData(data)` method. Used by `Ui5SmartFilterBar.setFilterData()`. */
  static async setSmartFilterBarData(
    target: Ui5Target,
    id: string,
    data: Record<string, unknown>,
  ): Promise<Ui5BridgeActionResult> {
    await this.ensure(target);
    return target.evaluate(
      ({ id, data }) => (window as any).__pwSapUi5__.setSmartFilterBarData(id, data),
      { id, data },
    );
  }

  /** Reads a SmartFilterBar's current filter values. Used by `Ui5SmartFilterBar.getFilterData()`. */
  static async getSmartFilterBarData(target: Ui5Target, id: string): Promise<Ui5FilterDataResult> {
    await this.ensure(target);
    return target.evaluate(({ id }) => (window as any).__pwSapUi5__.getSmartFilterBarData(id), {
      id,
    });
  }

  /** Triggers a SmartFilterBar's search directly, via its own `search()` method - equivalent to
   * clicking its "Go" button. Used by `Ui5SmartFilterBar.search()`. */
  static async triggerSmartFilterBarSearch(
    target: Ui5Target,
    id: string,
  ): Promise<Ui5BridgeActionResult> {
    await this.ensure(target);
    return target.evaluate(
      ({ id }) => (window as any).__pwSapUi5__.triggerSmartFilterBarSearch(id),
      { id },
    );
  }

  /** Reads a SmartTable's inner table (`sap.m.Table` or `sap.ui.table.Table` - decided at
   * runtime) and its true row count, from that table's own data binding. Used by `Ui5SmartTable`. */
  static async getSmartTableInfo(target: Ui5Target, id: string): Promise<Ui5SmartTableInfo> {
    await this.ensure(target);
    return target.evaluate(({ id }) => (window as any).__pwSapUi5__.getSmartTableInfo(id), { id });
  }

  // --- Advanced: sap.ui.table.Table (grid/tree table) --------------------------------------------
  // Backs `Ui5GridTable` - see docs/ui5-grid-table.md. This control virtualizes its rows (a small
  // pooled set of DOM row elements, re-bound as it scrolls), which is why these two methods exist
  // separately from `Ui5Table`'s DOM-search-based approach - see `Ui5GridTableInfo` in
  // `src/core/types.ts` and the comment on `getGridTableInfo` in `src/browser/bridgeScript.ts`.

  /** Reads a grid table's currently-rendered row ids plus the row count/scroll position needed to
   * know which data indices they correspond to right now. Used by `Ui5GridTable`. */
  static async getGridTableInfo(target: Ui5Target, id: string): Promise<Ui5GridTableInfo> {
    await this.ensure(target);
    return target.evaluate(({ id }) => (window as any).__pwSapUi5__.getGridTableInfo(id), { id });
  }

  /** Scrolls a grid table so data row `rowIndex` becomes one of its rendered rows, via the
   * control's own `setFirstVisibleRow(rowIndex)`. Used by `Ui5GridTable.scrollToRow()`. */
  static async scrollGridTableToRow(
    target: Ui5Target,
    id: string,
    rowIndex: number,
  ): Promise<Ui5BridgeActionResult> {
    await this.ensure(target);
    return target.evaluate(
      ({ id, rowIndex }) => (window as any).__pwSapUi5__.scrollGridTableToRow(id, rowIndex),
      { id, rowIndex },
    );
  }

  // --- Advanced: the app's own data, texts and messages -----------------------------------------
  // Backs `Ui5I18n`, `Ui5Model`, `Ui5MessageToast` and `Ui5Messages`. Everything above this point
  // reads *controls*; these read what the app is actually made of underneath them - its
  // translated texts, its model data, and the messages it raised - so a test can assert on those
  // directly instead of on whatever happens to be rendered as display text.

  /** Reads one translated text from the app's own i18n `ResourceBundle`. Used by `Ui5I18n`. */
  static async getI18nText(
    target: Ui5Target,
    key: string,
    args?: unknown[],
    modelName?: string,
  ): Promise<Ui5I18nResult> {
    await this.ensure(target);
    return target.evaluate(
      ({ key, args, modelName }) => (window as any).__pwSapUi5__.getI18nText(key, args, modelName),
      { key, args, modelName },
    );
  }

  /** Reads a value out of a model by binding path. Used by `Ui5Model.getProperty()`. */
  static async getModelProperty(
    target: Ui5Target,
    path: string,
    modelName?: string,
    controlId?: string,
  ): Promise<Ui5ModelPropertyResult> {
    await this.ensure(target);
    return target.evaluate(
      ({ path, modelName, controlId }) =>
        (window as any).__pwSapUi5__.getModelProperty(path, modelName, controlId),
      { path, modelName, controlId },
    );
  }

  /** Reads the whole data object the control with exact id `id` is bound to. Used by
   * `Ui5Model.getBindingContextData()`. */
  static async getBindingContextData(
    target: Ui5Target,
    id: string,
    modelName?: string,
  ): Promise<Ui5BindingContextResult> {
    await this.ensure(target);
    return target.evaluate(
      ({ id, modelName }) => (window as any).__pwSapUi5__.getBindingContextData(id, modelName),
      { id, modelName },
    );
  }

  /** Every model name set on any of the app's components (`''` = the default, unnamed model).
   * Used by `Ui5Model.listModels()`. */
  static async listModelNames(target: Ui5Target): Promise<string[]> {
    await this.ensure(target);
    return target.evaluate(() => (window as any).__pwSapUi5__.listModelNames());
  }

  /** Every `sap.m.MessageToast` raised since the bridge was installed - recorded as the app
   * raises them, so they survive the toast's own ~3s auto-hide. Used by `Ui5MessageToast`. */
  static async getMessageToasts(target: Ui5Target): Promise<Ui5MessageToastRecord[]> {
    await this.ensure(target);
    return target.evaluate(() => (window as any).__pwSapUi5__.getMessageToasts());
  }

  /** Empties the recorded toast log. Used by `Ui5MessageToast.clear()`. */
  static async clearMessageToasts(target: Ui5Target): Promise<void> {
    await this.ensure(target);
    await target.evaluate(() => (window as any).__pwSapUi5__.clearMessageToasts());
  }

  /** Every message in SAPUI5's own message model (validation/OData/app errors). Used by
   * `Ui5Messages`. */
  static async getUi5Messages(target: Ui5Target): Promise<Ui5MessageInfo[]> {
    await this.ensure(target);
    return target.evaluate(() => (window as any).__pwSapUi5__.getUi5Messages());
  }

  /** Removes every message from SAPUI5's message model. Used by `Ui5Messages.clear()`. */
  static async clearUi5Messages(target: Ui5Target): Promise<boolean> {
    await this.ensure(target);
    return target.evaluate(() => (window as any).__pwSapUi5__.clearUi5Messages());
  }

  // --- Advanced: form input controls ------------------------------------------------------------
  // Backs `Ui5Select` and `Ui5DatePicker` - see docs/form-inputs.md.

  /** A dropdown's items, selection and open state - readable whether or not it's open, which an
   * ordinary locator can't do since a closed `ComboBox` renders none of its items. Used by
   * `Ui5Select`. */
  static async getSelectInfo(target: Ui5Target, id: string): Promise<Ui5SelectInfo> {
    await this.ensure(target);
    return target.evaluate(({ id }) => (window as any).__pwSapUi5__.getSelectInfo(id), { id });
  }

  /** Opens a dropdown via the control's own `open()`. Used by `Ui5Select` as a fallback when the
   * rendered arrow isn't clickable. */
  static async openSelect(target: Ui5Target, id: string): Promise<Ui5BridgeActionResult> {
    await this.ensure(target);
    return target.evaluate(({ id }) => (window as any).__pwSapUi5__.openSelect(id), { id });
  }

  /** Closes a dropdown via the control's own `close()`. Used by `Ui5Select.close()`. */
  static async closeSelect(target: Ui5Target, id: string): Promise<Ui5BridgeActionResult> {
    await this.ensure(target);
    return target.evaluate(({ id }) => (window as any).__pwSapUi5__.closeSelect(id), { id });
  }

  /** Sets a `sap.m.DatePicker`'s date from calendar parts and fires its `change` event. Used by
   * `Ui5DatePicker.setDate()`. */
  static async setDatePickerDate(
    target: Ui5Target,
    id: string,
    year: number,
    month: number,
    day: number,
  ): Promise<Ui5BridgeActionResult> {
    await this.ensure(target);
    return target.evaluate(
      ({ id, year, month, day }) =>
        (window as any).__pwSapUi5__.setDatePickerDate(id, year, month, day),
      { id, year, month, day },
    );
  }

  /** Reads a `sap.m.DatePicker`'s date as calendar parts plus its displayed text. Used by
   * `Ui5DatePicker.getDate()`. */
  static async getDatePickerDate(target: Ui5Target, id: string): Promise<Ui5DatePickerValue> {
    await this.ensure(target);
    return target.evaluate(({ id }) => (window as any).__pwSapUi5__.getDatePickerDate(id), { id });
  }
}
