/**
 * Shared TypeScript types for the framework. This file has no runtime code at all - every
 * `interface`/`type` declared here is erased completely when compiled to JavaScript (run
 * `npm run build` and look in `dist/core/types.js`: it's an almost-empty file). It exists purely
 * so the rest of the codebase - and your own code, once you `import` from this package - gets
 * type-checking and editor autocomplete for these shapes.
 */

/**
 * The minimal information about a UI5 control that's actually safe to send from the browser back
 * to Node. The real SAPUI5 control object (a live JavaScript object with dozens of methods, only
 * meaningful inside that browser tab) can't cross the Node/browser boundary - only plain,
 * JSON-serializable data can (see docs/architecture.md for exactly why). So every "find controls
 * matching X" function in the bridge script reduces each match down to just this: the control's
 * `id` (enough to build a Playwright `[id="..."]` selector back in Node) and its `type` (shown in
 * self-healing warnings and error messages, so you know what actually matched).
 */
export interface Ui5ControlInfo {
  id: string;
  type: string;
}

/**
 * A richer version of `Ui5ControlInfo`, used only by the Page Object generator
 * (`pw-sapui5 generate`). Generating useful code needs more than just id/type:
 * - `properties` - text/title/value/label the control exposes, shown as a `//` comment above
 *   each generated getter so you can tell controls apart without opening the browser.
 * - `parentId` - the id of this control's parent in the tree. Not used in the generated output
 *   today, but kept here for future tooling (or your own scripts) that wants to understand
 *   nesting, not just a flat list.
 */
export interface Ui5ControlDump {
  id: string;
  type: string;
  properties: Record<string, string>;
  parentId?: string;
}

/**
 * A single locator strategy - one way of describing "the control I mean." This is a *union
 * type*: written with `|` between object shapes, meaning a value of type `Ui5LocatorCriteria` is
 * *exactly one of* these six shapes, never a mix. Every member shares a `by` field with a fixed,
 * literal string value (`'id'`, `'controlType'`, ...) - that's what's called a "discriminated
 * union," and it's what lets code elsewhere safely narrow which shape it's looking at:
 *
 * ```ts
 * function describe(criteria: Ui5LocatorCriteria) {
 *   if (criteria.by === 'id') {
 *     // TypeScript now knows `criteria` has a `value` field here, and NOT `controlType`,
 *     // `path`, `text`, `selector`, or `role` - because only the 'id' shape has `value`.
 *     console.log(criteria.value);
 *   }
 * }
 * ```
 *
 * `SelfHealingResolver`'s browser-side `switch (args.by) { case 'id': ... }` (see
 * `src/core/SelfHealingResolver.ts`) relies on exactly this narrowing.
 *
 * You won't usually construct one of these object literals directly - `Ui5Locator.id(...)`,
 * `.controlType(...)`, `.text(...)`, etc. (or the `ui5(page)` helper that wraps them) build these
 * for you from friendlier function calls. The one place you *will* write one yourself is inside
 * `.fallback({ ... })`, to describe a fallback strategy - see docs/locators.md.
 */
export type Ui5LocatorCriteria =
  | { by: 'id'; value: string; exact?: boolean }
  | { by: 'controlType'; controlType: string; properties?: Record<string, unknown> }
  | { by: 'bindingPath'; path: string; controlType?: string }
  | { by: 'text'; text: string; controlType?: string; exact?: boolean }
  | { by: 'css'; selector: string }
  | { by: 'role'; role: string; name?: string };

/** Options accepted by `waitForUi5()` / `waitForUi5Core()` - see `src/core/waits.ts`. Both `?`
 * marks mean every field here is optional; callers can pass `{}` or omit the options entirely. */
export interface WaitForUi5Options {
  /** Max time to wait, in milliseconds. Default 15000 (`waitForUi5`) or 30000 (`waitForUi5Core`). */
  timeout?: number;
}

/**
 * The payload passed to every `SelfHealingResolver.onHeal(listener)` callback, exactly once per
 * time a locator had to fall back past its primary strategy. `strategyIndex` (0-based - `0` would
 * be the primary strategy itself, so a heal event's index is always `>= 1`) and `attempt`
 * (1-based - the human-friendly "fallback #N" you see in the console warning) describe *which*
 * fallback worked; `strategy` is the actual `Ui5LocatorCriteria` object that succeeded, in case
 * you want to log or collect these centrally to find primary locators that need fixing.
 */
export interface HealEvent {
  label?: string;
  strategyIndex: number;
  strategy: Ui5LocatorCriteria;
  attempt: number;
}

/**
 * The shape of a function you can pass to `SelfHealingResolver.onHeal(...)`. This is a *function
 * type* - it doesn't describe data, it describes what a valid callback looks like: takes one
 * `HealEvent` argument, returns nothing (`void`). TypeScript will refuse to let you pass anything
 * with a different signature to `onHeal`.
 */
export type HealListener = (event: HealEvent) => void;

/**
 * The result of reading one property off a control by its exact id (`Ui5Bridge.getControlProperty`).
 * Three separate booleans/fields rather than just returning the value (or `undefined`) directly:
 * a missing control, a control with no such property, and a property whose real value happens to
 * be `undefined`/`null` are three different situations, and the custom `expect` matchers in
 * `src/core/matchers.ts` need to tell them apart to produce a genuinely useful failure message.
 */
export interface Ui5PropertyResult {
  found: boolean;
  hasProperty: boolean;
  value: unknown;
}

/** The result of reading a control's visible text by its exact id (`Ui5Bridge.getControlText`) -
 * see `Ui5PropertyResult` above for why this isn't just a plain `string | undefined`. */
export interface Ui5TextResult {
  found: boolean;
  value: string | undefined;
}

/**
 * The result of an action the bridge performed by calling a method directly on a control (e.g.
 * `Ui5Bridge.triggerSmartFilterBarSearch`, `Ui5Bridge.setSmartFilterBarData`) rather than reading
 * one. `found: false` means no control with that id exists (or it doesn't have the method being
 * called - e.g. a `setFilterData` call against a control that isn't actually a `SmartFilterBar`);
 * `ok: false` with `found: true` means the control exists and has the method, but calling it threw.
 */
export interface Ui5BridgeActionResult {
  found: boolean;
  ok: boolean;
  error?: string;
}

/** The result of reading a `sap.ui.comp.smartfilterbar.SmartFilterBar`'s current filter values
 * (`Ui5Bridge.getSmartFilterBarData`) - see `Ui5PropertyResult` above for why this isn't just a
 * plain `Record<string, unknown> | undefined`. */
export interface Ui5FilterDataResult {
  found: boolean;
  value: Record<string, unknown> | undefined;
}

/**
 * The result of reading a `sap.ui.comp.smarttable.SmartTable`'s inner table and row count
 * (`Ui5Bridge.getSmartTableInfo`) - see `src/core/Ui5SmartTable.ts`. `innerTable` is `null` when
 * the `SmartTable` hasn't built its inner table yet (e.g. before its first `search()`/data load);
 * `rowCount` is `undefined` when the inner table exists but its binding hasn't loaded data yet, or
 * doesn't expose a length the way `getBinding('rows')`/`getBinding('items')` normally do.
 */
export interface Ui5SmartTableInfo {
  found: boolean;
  innerTable: Ui5ControlInfo | null;
  rowCount: number | undefined;
}

/**
 * The result of reading a `sap.ui.table.Table`'s (the "grid" table control) virtualized row state
 * (`Ui5Bridge.getGridTableInfo`) - see `src/core/Ui5GridTable.ts`. `renderedRows` is only the
 * subset of the control's pooled row elements that currently hold real data (see the comment on
 * `getGridTableInfo` in `src/browser/bridgeScript.ts` for why that's not always the whole pool);
 * `rowCount`/`firstVisibleRow` are `undefined` if the control hasn't bound any data yet.
 */
export interface Ui5GridTableInfo {
  found: boolean;
  rowCount: number | undefined;
  firstVisibleRow: number | undefined;
  renderedRows: Ui5ControlInfo[];
}

/** The result of reading one translated text from the app's own i18n `ResourceBundle`
 * (`Ui5Bridge.getI18nText`) - `found: false` means no bundle on the page had that key at all,
 * which is a genuinely different situation from "the text is an empty string". See
 * `src/core/Ui5I18n.ts`. */
export interface Ui5I18nResult {
  found: boolean;
  value: string | undefined;
}

/** The result of reading a value out of a model by binding path (`Ui5Bridge.getModelProperty`).
 * `found: false` covers both "no such model" and "reading that path threw"; `value` is
 * `undefined` for a path that exists but holds nothing. See `src/core/Ui5Model.ts`. */
export interface Ui5ModelPropertyResult {
  found: boolean;
  value: unknown;
}

/**
 * The result of reading the data object a control is bound to
 * (`Ui5Bridge.getBindingContextData`). Three distinct outcomes matter here and are worth telling
 * apart: the control doesn't exist (`found: false`), it exists but isn't bound to anything
 * (`hasContext: false` - common for a container, or a row whose data hasn't arrived yet), or it's
 * bound and `data` holds the full entity. See `src/core/Ui5Model.ts`.
 */
export interface Ui5BindingContextResult {
  found: boolean;
  hasContext: boolean;
  path: string | undefined;
  data: unknown;
}

/** One recorded `sap.m.MessageToast`, captured when the app raised it rather than read off the
 * DOM - see the instrumentation notes in `src/browser/bridgeScript.ts` and `src/core/Ui5MessageToast.ts`.
 * `at` is a browser-side `Date.now()` timestamp. */
export interface Ui5MessageToastRecord {
  text: string;
  at: number;
}

/** One entry from SAPUI5's own message model (validation errors, OData backend errors, anything
 * the app pushed itself) - see `src/core/Ui5Messages.ts`. `type` is SAPUI5's `MessageType`
 * (`'Error'`, `'Warning'`, `'Success'`, `'Information'`, `'None'`). */
export interface Ui5MessageInfo {
  type: string | undefined;
  message: string | undefined;
  description: string | undefined;
  target: string | undefined;
}

/** One entry of a dropdown-style control (`sap.m.Select`, `sap.m.ComboBox`, ...). `key` is what
 * the app binds and filters on; `text` is what the user sees; `id` is the underlying
 * `sap.ui.core.Item`'s own id - which, for a `ComboBox`, is *not* the id of the clickable element
 * rendered when the dropdown opens. See `src/core/Ui5Select.ts`. */
export interface Ui5SelectItem {
  id: string;
  key: string | undefined;
  text: string | undefined;
}

/** A dropdown-style control's items and current state (`Ui5Bridge.getSelectInfo`).
 * `selectedKey` is set by single-select controls, `selectedKeys` by `sap.m.MultiComboBox`. */
export interface Ui5SelectInfo {
  found: boolean;
  items: Ui5SelectItem[];
  selectedKey: string | undefined;
  selectedKeys: string[];
  isOpen: boolean;
}

/** A `sap.m.DatePicker`'s current value (`Ui5Bridge.getDatePickerDate`), as plain calendar parts
 * plus the formatted string the field displays. Parts rather than a string or timestamp
 * deliberately - see the notes on `setDatePickerDate` in `src/browser/bridgeScript.ts` for why
 * dates crossing this boundary are a timezone trap otherwise. */
export interface Ui5DatePickerValue {
  found: boolean;
  year: number | undefined;
  month: number | undefined;
  day: number | undefined;
  value: string | undefined;
}

/** One saved variant of a variant management control - `key` is what the app activates it by,
 * `text` is the name the user sees in the dropdown. See `src/core/Ui5VariantManagement.ts`. */
export interface Ui5Variant {
  key: string | undefined;
  text: string | undefined;
}

/** A variant management control's saved variants and which one is currently active
 * (`Ui5Bridge.getVariantInfo`). */
export interface Ui5VariantInfo {
  found: boolean;
  currentKey: string | undefined;
  variants: Ui5Variant[];
}

/** A `sap.f.FlexibleColumnLayout`'s current state (`Ui5Bridge.getFlexibleColumnLayoutInfo`).
 * `layout` is SAPUI5's own layout enum value (`'OneColumn'`, `'TwoColumnsMidExpanded'`, ...); the
 * three page ids are whichever page is currently showing in each column, if any. See
 * `src/core/Ui5FlexibleColumnLayout.ts`. */
export interface Ui5FlexibleColumnLayoutInfo {
  found: boolean;
  layout: string | undefined;
  beginPage: string | undefined;
  midPage: string | undefined;
  endPage: string | undefined;
}

/** One tab of a `sap.m.IconTabBar` (a `sap.m.IconTabFilter`). `count` is the badge number, if the
 * app set one - it's real bound data, not something readable from the rendered DOM without
 * knowing which nested `<span>` happens to hold it. See `src/core/Ui5IconTabBar.ts`. */
export interface Ui5IconTabItem {
  id: string;
  key: string | undefined;
  text: string | undefined;
  count: string | undefined;
}

/** A `sap.m.IconTabBar`'s current state (`Ui5Bridge.getIconTabBarInfo`). See
 * `src/core/Ui5IconTabBar.ts`. */
export interface Ui5IconTabBarInfo {
  found: boolean;
  selectedKey: string | undefined;
  items: Ui5IconTabItem[];
}

/** One section of a `sap.uxap.ObjectPageLayout` (a `sap.uxap.ObjectPageSection`), with its
 * subsections. See `src/core/Ui5ObjectPage.ts`. */
export interface Ui5ObjectPageSection {
  id: string;
  title: string | undefined;
  subSections: { id: string; title: string | undefined }[];
}

/** A `sap.uxap.ObjectPageLayout`'s current state (`Ui5Bridge.getObjectPageInfo`). `selectedSection`
 * is the id of the top-level section currently in view - the honest answer to "which section is
 * showing", whether the page is in icon-tab mode (clicking a tab) or scroll mode (the anchor bar
 * highlighting as you scroll past each section). See `src/core/Ui5ObjectPage.ts`. */
export interface Ui5ObjectPageInfo {
  found: boolean;
  selectedSection: string | undefined;
  sections: Ui5ObjectPageSection[];
}

/** A `sap.m.SplitApp`'s current state (`Ui5Bridge.getSplitAppInfo`). `mode` is SAPUI5's own
 * `sap.m.SplitAppMode` enum (`'ShowHideMode'`, `'StretchCompressMode'`, `'PopoverMode'`,
 * `'HideMode'`) - the thing that decides whether a "hidden" master page means "not showing" or
 * "showing, just collapsed behind a toggle", which the DOM alone doesn't tell you. See
 * `src/core/Ui5SplitApp.ts`. */
export interface Ui5SplitAppInfo {
  found: boolean;
  mode: string | undefined;
  masterPage: string | undefined;
  detailPage: string | undefined;
}

/** Load/performance numbers for a page (`Ui5Bridge.getPerformanceMetrics`). The browser timings
 * describe the document load; `ui5ResourceCount`/`controlCount` describe what SAPUI5 then pulled
 * in and built on top of it - which is where a UI5 app's real startup cost lives. See
 * `src/core/Ui5Performance.ts`. */
export interface Ui5PerformanceMetrics {
  responseEndMs: number | undefined;
  domContentLoadedMs: number | undefined;
  loadEventMs: number | undefined;
  resourceCount: number | undefined;
  ui5ResourceCount: number | undefined;
  controlCount: number | undefined;
}

/** Timings for one full app startup, measured around a navigation
 * (`Ui5Performance.measureBootstrap`). All values are milliseconds from the moment navigation
 * started. */
export interface Ui5BootstrapTimings {
  navigationMs: number;
  coreReadyMs: number;
  settledMs: number;
  metrics: Ui5PerformanceMetrics;
}

/** One route from an app's `manifest.json` routing table. `required` parameters (`{id}` in the
 * pattern) must be supplied to navigate there; `optional` ones (`:id:`) need not be - which is
 * what decides whether a route can be reached without inventing data. See
 * `src/generator/analyzeApp.ts`. */
export interface Ui5RouteInfo {
  name: string;
  pattern: string;
  required: string[];
  optional: string[];
}

/** An app's `manifest.json` descriptor as read from the running component
 * (`Ui5Bridge.getAppManifestInfo`). */
export interface Ui5ManifestInfo {
  found: boolean;
  appId: string | undefined;
  appTitle: string | undefined;
  componentName: string | undefined;
  routerClass: string | undefined;
  routes: Ui5RouteInfo[];
  dataSources: string[];
}
