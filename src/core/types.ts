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
