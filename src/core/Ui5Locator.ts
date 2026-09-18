import type { Locator, Page } from '@playwright/test';
import { SelfHealingResolver } from './SelfHealingResolver';
import { waitForUi5 } from './waits';
import type { Ui5LocatorCriteria } from './types';

export interface Ui5ActionOptions {
  /** Overall timeout (ms) for resolving the locator (split across fallback strategies). */
  timeout?: number;
  /** Wait for the app to settle (no busy indicator / pending requests) before acting. Default true. */
  autoWaitUi5?: boolean;
}

/**
 * A smart, chainable locator for SAPUI5 controls.
 *
 * Build one with the static factories (`Ui5Locator.id`, `.controlType`, `.bindingPath`, `.text`,
 * `.css`) or via the `ui5(page)` helper. Chain `.fallback(...)` to add alternate strategies that
 * are tried, in order, if earlier ones don't find anything within their time budget - this is
 * the framework's self-healing behaviour.
 *
 * ```ts
 * await ui5(page)
 *   .controlType('sap.m.Button', { text: 'Save' })
 *   .fallback({ by: 'id', value: 'saveButton' })
 *   .as('Save button')
 *   .click();
 * ```
 *
 * For readers new to TypeScript: this file is written as an ordinary `class` (see
 * docs/typescript-for-beginners.md#classes if that word is new). Every method that returns
 * `Ui5Locator` or `this` is designed to be **chained** - each one returns the object itself (or a
 * new one), so you can keep calling `.` after it, exactly like `.controlType(...).fallback(...).click()`
 * above does. That's a common pattern called a "fluent" or "builder" API.
 */
export class Ui5Locator {
  // `strategies` holds every criteria object this locator will try, in order: index 0 is always
  // the "primary" one (set in the constructor), and any `.fallback(...)` calls push more onto
  // the end. `readonly` means this array reference itself can't be reassigned after construction
  // (you also can't do `this.strategies = []` later) - but you CAN still `.push()` onto it, which
  // is exactly what `.fallback()` does below. `label` is optional (`?`) and used only for
  // human-readable warnings/errors - see `.as()`.
  private readonly strategies: Ui5LocatorCriteria[] = [];
  private label?: string;

  // The constructor is `private`: outside code can't write `new Ui5Locator(...)` directly. The
  // only way to get one is through the static factory methods below (`Ui5Locator.id(...)`, etc.)
  // - this is a deliberate design choice ("private constructor + static factories" is a common
  // TypeScript/Java-style pattern) that keeps every `Ui5Locator` guaranteed to start from a valid
  // primary strategy, since the factories are the only code path that can call `new`.
  private constructor(
    private readonly page: Page,
    primary: Ui5LocatorCriteria,
  ) {
    this.strategies.push(primary);
  }

  // --- Factories -----------------------------------------------------------------------------
  // Each of these `static` methods is a different way to describe "the control I mean." They
  // all do the same thing internally: build one `Ui5LocatorCriteria` object (see
  // `src/core/types.ts` for what each shape looks like) and pass it to the private constructor.
  // `static` means you call these on the *class itself* (`Ui5Locator.id(...)`), not on an
  // instance - there's no `Ui5Locator` to call a method on yet, since building one is the whole
  // point of calling a factory.

  /** Matches a control whose id equals, or ends with `--<value>` (view-scoped id suffix). */
  static id(page: Page, value: string, options: { exact?: boolean } = {}): Ui5Locator {
    return new Ui5Locator(page, { by: 'id', value, exact: options.exact });
  }

  /** Matches by full UI5 control type name (e.g. `sap.m.Button`), optionally filtered by property values. */
  static controlType(
    page: Page,
    controlType: string,
    properties?: Record<string, unknown>,
  ): Ui5Locator {
    return new Ui5Locator(page, { by: 'controlType', controlType, properties });
  }

  /** Matches a control whose binding context path equals `path`. */
  static bindingPath(page: Page, path: string, controlType?: string): Ui5Locator {
    return new Ui5Locator(page, { by: 'bindingPath', path, controlType });
  }

  /** Matches by visible text/title/value/label (whichever the control exposes). */
  static text(
    page: Page,
    text: string,
    options: { controlType?: string; exact?: boolean } = {},
  ): Ui5Locator {
    return new Ui5Locator(page, {
      by: 'text',
      text,
      controlType: options.controlType,
      exact: options.exact,
    });
  }

  /** Escape hatch: matches by a plain CSS selector, still benefiting from auto-wait and healing. */
  static css(page: Page, selector: string): Ui5Locator {
    return new Ui5Locator(page, { by: 'css', selector });
  }

  /** Escape hatch: matches by ARIA role, via Playwright's own `getByRole`. */
  static role(page: Page, role: string, name?: string): Ui5Locator {
    return new Ui5Locator(page, { by: 'role', role, name });
  }

  // --- Chaining --------------------------------------------------------------------------------

  /**
   * Adds a fallback strategy, tried only if all earlier strategies fail to match in time.
   * Returns `this` (the same object, not a new one) so you can keep chaining - notice the return
   * type `this` rather than `Ui5Locator`: TypeScript's special `this` type means "whatever
   * concrete type the caller actually has," which mostly matters if this class were ever
   * subclassed, but is otherwise just a more precise way to say "returns itself."
   */
  fallback(criteria: Ui5LocatorCriteria): this {
    this.strategies.push(criteria);
    return this;
  }

  /** A human-readable name used in self-heal warnings and error messages. */
  as(label: string): this {
    this.label = label;
    return this;
  }

  // --- Resolution ------------------------------------------------------------------------------

  /**
   * Resolves to a plain Playwright `Locator` - use this to drop down to the full Playwright API
   * for anything this class's convenience methods don't cover (e.g. `expect(...)` assertions,
   * `.dragTo(...)`, screenshots). This is an `async` method (see
   * docs/typescript-for-beginners.md#async-await-and-promises) - it does browser round trips
   * internally, so you must `await` it.
   *
   * All of the resolution logic actually lives in `SelfHealingResolver` (a separate file/class) -
   * this method's whole job is to hand it `this.strategies` (the full fallback chain built up by
   * the factory + any `.fallback()` calls) plus the timeout/label options.
   */
  async resolve(options: { timeout?: number } = {}): Promise<Locator> {
    return SelfHealingResolver.resolve(this.page, this.strategies, {
      timeout: options.timeout,
      label: this.label,
    });
  }

  /**
   * Shared setup every action method (`.click()`, `.fill()`, ...) runs before actually acting:
   * auto-wait for the app to settle, then resolve the locator. `private` because it's an
   * implementation detail - outside code always goes through `.click()`/`.fill()`/etc., never
   * calls `.prepare()` directly.
   */
  private async prepare(options: Ui5ActionOptions = {}): Promise<Locator> {
    if (options.autoWaitUi5 !== false) {
      // `.catch(() => {})` here means: if `waitForUi5` times out (the app never fully settles),
      // swallow that error and continue anyway, rather than failing the whole action just
      // because of a background wait that's "best-effort" by design. The action itself
      // (`.click()`, etc.) will still fail on its own if the element genuinely isn't there.
      await waitForUi5(this.page, { timeout: options.timeout }).catch(() => {
        /* best-effort: don't fail the action just because busy-state never settled */
      });
    }
    return this.resolve({ timeout: options.timeout });
  }

  /**
   * Many SAPUI5 form controls (`sap.m.SearchField`, `sap.m.Input`, `sap.m.ComboBox`, ...) render
   * their control id on an outer wrapper `<div>`, with the actual `<input>` nested a level or two
   * inside (typically `<controlId>-I`, an internal DOM id that isn't itself a UI5 control, so it
   * can't be found via `id()`/`controlType()`). Playwright's `.fill()` requires an
   * input/textarea/contenteditable element, so resolving straight to the control's root would
   * fail for exactly these controls - the ones you're most likely to want to fill. If the
   * resolved element isn't fillable itself, this looks one level down for one that is.
   */
  private async toFillableLocator(locator: Locator): Promise<Locator> {
    // `.evaluate(fn)` runs `fn` *inside the browser*, against the DOM element `locator` resolves
    // to, and sends the return value back to Node - the same Node/browser boundary explained in
    // docs/architecture.md, just for a single element instead of the whole bridge. `el` here is a
    // real DOM element (typed as `Element` by Playwright), never a SAPUI5 control object.
    const isFillable = await locator
      .evaluate((el) => {
        const tag = el.tagName.toLowerCase();
        return tag === 'input' || tag === 'textarea' || (el as HTMLElement).isContentEditable;
      })
      .catch(() => false);
    if (isFillable) return locator;

    // `locator.locator(selector)` searches *inside* the element `locator` already points to - a
    // "scoped" search, not a fresh page-wide one. `.first()` picks the first match if there's
    // more than one nested input (rare, but possible for composite controls).
    const nested = locator.locator('input, textarea, [contenteditable="true"]').first();
    return (await nested.count().catch(() => 0)) > 0 ? nested : locator;
  }

  // --- Convenience actions (auto-wait + self-heal, then delegate to Playwright) ----------------
  // Every method below follows the same three-step shape: (1) `prepare()` - auto-wait, then
  // resolve to a plain Playwright `Locator`; (2) do anything this method needs beyond that
  // (nothing, usually - `toFillableLocator` for `.fill()` is the one exception); (3) call the
  // matching method on the real Playwright `Locator` and let Playwright's own actionability
  // checks, retries, and error messages take over completely. This framework's job ends the
  // moment step 3 starts - see docs/architecture.md#flow-2-what-click-actually-does for the full
  // trace of one of these, end to end.

  /**
   * `options: Ui5ActionOptions & Parameters<Locator['click']>[0] = {}` - reading this signature:
   * `&` combines two types into one that has *all* of both types' fields (an "intersection
   * type" - the opposite of the `|` union type used in `Ui5LocatorCriteria`). So the `options`
   * object here can carry both this framework's own options (`timeout`, `autoWaitUi5`) *and*
   * whatever options Playwright's own `Locator.click()` accepts (`force`, `modifiers`, ...) -
   * `Parameters<Locator['click']>[0]` is TypeScript-speak for "the type of `click`'s first
   * parameter," extracted automatically from Playwright's own types rather than retyped by hand,
   * so it always stays in sync with whatever Playwright version you're using.
   */
  async click(options: Ui5ActionOptions & Parameters<Locator['click']>[0] = {}): Promise<void> {
    const locator = await this.prepare(options);
    // `.first()` - if a strategy matched more than one control (common for `controlType(...)`
    // with no further filter), act on the first match in document order rather than letting
    // Playwright's strict mode throw "resolved to N elements." You control which one is "first"
    // by how specific your criteria are.
    await locator.first().click(options);
  }

  async fill(
    value: string,
    options: Ui5ActionOptions & Parameters<Locator['fill']>[1] = {},
  ): Promise<void> {
    const locator = await this.prepare(options);
    const fillable = await this.toFillableLocator(locator.first());
    await fillable.fill(value, options);
  }

  async check(options: Ui5ActionOptions & Parameters<Locator['check']>[0] = {}): Promise<void> {
    const locator = await this.prepare(options);
    await locator.first().check(options);
  }

  async uncheck(options: Ui5ActionOptions & Parameters<Locator['uncheck']>[0] = {}): Promise<void> {
    const locator = await this.prepare(options);
    await locator.first().uncheck(options);
  }

  async hover(options: Ui5ActionOptions & Parameters<Locator['hover']>[0] = {}): Promise<void> {
    const locator = await this.prepare(options);
    await locator.first().hover(options);
  }

  /** Reads the resolved element's rendered text. Returns a plain `string`, not a `Locator` -
   * this one doesn't act on the page, it reads from it. */
  async getText(options: Ui5ActionOptions = {}): Promise<string> {
    const locator = await this.prepare(options);
    return locator.first().innerText();
  }

  /**
   * Unlike the action methods above, this one deliberately does **not** call `.prepare()` (which
   * would throw if nothing ever matches) - it calls `.resolve()` directly and catches a failure
   * into `null`, so "the control was never there" correctly reports `false` instead of throwing.
   * That's the right behavior for a yes/no visibility check: a missing element isn't an error
   * here, it's simply "not visible."
   */
  async isVisible(options: Ui5ActionOptions = {}): Promise<boolean> {
    const locator = await this.resolve({ timeout: options.timeout }).catch(() => null);
    if (!locator) return false;
    return locator.first().isVisible();
  }

  async isEnabled(options: Ui5ActionOptions = {}): Promise<boolean> {
    const locator = await this.prepare(options);
    return locator.first().isEnabled();
  }

  /** Same "don't throw, just report 0" reasoning as `isVisible()` above. */
  async count(options: { timeout?: number } = {}): Promise<number> {
    const locator = await this.resolve(options).catch(() => null);
    if (!locator) return 0;
    return locator.count();
  }

  async waitFor(options: Ui5ActionOptions & Parameters<Locator['waitFor']>[0] = {}): Promise<void> {
    const locator = await this.prepare(options);
    await locator.first().waitFor(options);
  }
}
