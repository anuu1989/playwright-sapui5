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
 */
export class Ui5Locator {
  private readonly strategies: Ui5LocatorCriteria[] = [];
  private label?: string;

  private constructor(
    private readonly page: Page,
    primary: Ui5LocatorCriteria,
  ) {
    this.strategies.push(primary);
  }

  // --- Factories -----------------------------------------------------------------------------

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

  /** Adds a fallback strategy, tried only if all earlier strategies fail to match in time. */
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

  /** Resolves to a plain Playwright `Locator` - use this to drop down to the full Playwright API. */
  async resolve(options: { timeout?: number } = {}): Promise<Locator> {
    return SelfHealingResolver.resolve(this.page, this.strategies, {
      timeout: options.timeout,
      label: this.label,
    });
  }

  private async prepare(options: Ui5ActionOptions = {}): Promise<Locator> {
    if (options.autoWaitUi5 !== false) {
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
    const isFillable = await locator
      .evaluate((el) => {
        const tag = el.tagName.toLowerCase();
        return tag === 'input' || tag === 'textarea' || (el as HTMLElement).isContentEditable;
      })
      .catch(() => false);
    if (isFillable) return locator;

    const nested = locator.locator('input, textarea, [contenteditable="true"]').first();
    return (await nested.count().catch(() => 0)) > 0 ? nested : locator;
  }

  // --- Convenience actions (auto-wait + self-heal, then delegate to Playwright) ----------------

  async click(options: Ui5ActionOptions & Parameters<Locator['click']>[0] = {}): Promise<void> {
    const locator = await this.prepare(options);
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

  async getText(options: Ui5ActionOptions = {}): Promise<string> {
    const locator = await this.prepare(options);
    return locator.first().innerText();
  }

  async isVisible(options: Ui5ActionOptions = {}): Promise<boolean> {
    const locator = await this.resolve({ timeout: options.timeout }).catch(() => null);
    if (!locator) return false;
    return locator.first().isVisible();
  }

  async isEnabled(options: Ui5ActionOptions = {}): Promise<boolean> {
    const locator = await this.prepare(options);
    return locator.first().isEnabled();
  }

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
