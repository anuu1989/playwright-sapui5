import type { Locator } from '@playwright/test';
import { Ui5Bridge, type Ui5Target } from './Ui5Bridge';
import { Ui5Locator } from './Ui5Locator';
import { idSelector, idsSelector } from './domSelectors';
import type { Ui5SelectItem } from './types';

/** Control types a dropdown's *rendered* entries can turn up as once it's open - tried in order.
 * `sap.m.Select` gives its own `sap.ui.core.Item`s a DOM element; `sap.m.ComboBox` and
 * `sap.m.MultiComboBox` instead render a parallel set of `sap.m.StandardListItem`s. */
const RENDERED_ITEM_TYPES = ['sap.m.StandardListItem', 'sap.ui.core.Item'];

/**
 * Picking a value from a dropdown - `sap.m.Select`, `sap.m.ComboBox`, `sap.m.MultiComboBox`, and
 * the `sap.ui.comp.smartfield` variants built on them. See docs/form-inputs.md.
 *
 * Dropdowns are deceptively hard to automate, for a reason that isn't obvious until it bites:
 * **the items you can read are not the items you can click.** A control's `getItems()` returns
 * `sap.ui.core.Item` objects carrying the `key`s the app actually binds on - but for a `ComboBox`
 * those objects have **no DOM element at all** while the dropdown is shut, and even once it opens,
 * what renders is a *separate* set of `sap.m.StandardListItem` controls that mirror them and carry
 * no keys. So an ordinary locator can't see the options before opening, can't match them by key
 * after opening, and has to know which of two unrelated control types a given dropdown renders.
 *
 * This class handles all of that: it reads the real items (with keys) straight off the control,
 * opens the dropdown the way a user does, and clicks the rendered entry - so the app's own
 * `change`/`selectionChange` handlers fire exactly as they would for a real user.
 *
 * ```ts
 * await Ui5Select.selectByText(page, ui5(page).id('countryCombo'), 'Germany');
 * await Ui5Select.selectByKey(page, ui5(page).id('countryCombo'), 'DE');
 * ```
 */
export class Ui5Select {
  /**
   * Every option the dropdown holds, as `{ key, text, id }` - readable **whether or not it's
   * open**, which is the part no ordinary locator can do. Useful both for asserting on the
   * available choices and for finding out what keys an app actually uses.
   */
  static async items(target: Ui5Target, select: Ui5Locator | Locator): Promise<Ui5SelectItem[]> {
    const info = await Ui5Bridge.getSelectInfo(target, await resolveControlId(select));
    return info.items;
  }

  /** The `key` of the currently selected option (single-select controls). */
  static async selectedKey(
    target: Ui5Target,
    select: Ui5Locator | Locator,
  ): Promise<string | undefined> {
    const info = await Ui5Bridge.getSelectInfo(target, await resolveControlId(select));
    return info.selectedKey;
  }

  /** The `key`s of every selected option - for `sap.m.MultiComboBox`, which tracks a list rather
   * than a single value. */
  static async selectedKeys(target: Ui5Target, select: Ui5Locator | Locator): Promise<string[]> {
    const info = await Ui5Bridge.getSelectInfo(target, await resolveControlId(select));
    return info.selectedKeys;
  }

  /** Opens the dropdown - clicking the rendered arrow the way a user would, falling back to the
   * control's own `open()` if there's no arrow element (some variants render differently). */
  static async open(target: Ui5Target, select: Ui5Locator | Locator): Promise<void> {
    const id = await resolveControlId(select);
    const info = await Ui5Bridge.getSelectInfo(target, id);
    if (info.isOpen) return;

    // `<id>-arrow` is SAPUI5's own rendering convention for the dropdown toggle, verified across
    // `sap.m.Select`, `sap.m.ComboBox` and `sap.m.MultiComboBox`.
    const arrow = target.locator(idSelector(`${id}-arrow`));
    if ((await arrow.count()) > 0) {
      await arrow.first().click();
    } else {
      const result = await Ui5Bridge.openSelect(target, id);
      if (!result.ok) {
        throw new Error(
          `[playwright-sapui5] Ui5Select.open: could not open control ${id} (no rendered arrow, and open() ${result.found ? 'failed' : 'is not available on this control'}).`,
        );
      }
    }
    await waitForOpen(target, id);
  }

  /** Closes the dropdown via the control's own `close()`. Mainly for `sap.m.MultiComboBox`, whose
   * list deliberately stays open after each pick so several can be selected in a row. */
  static async close(target: Ui5Target, select: Ui5Locator | Locator): Promise<void> {
    await Ui5Bridge.closeSelect(target, await resolveControlId(select));
  }

  /**
   * Opens the dropdown and clicks the option whose visible text is `text` - the same sequence a
   * user performs, so the app's own selection handlers run normally.
   *
   * Matching is exact by default; pass `{ exact: false }` to match any option *containing* `text`,
   * which is handy for options that carry a code alongside the label (`'PR (Projector)'`).
   */
  static async selectByText(
    target: Ui5Target,
    select: Ui5Locator | Locator,
    text: string,
    options: { exact?: boolean } = {},
  ): Promise<void> {
    const id = await resolveControlId(select);
    const exact = options.exact ?? true;

    const info = await Ui5Bridge.getSelectInfo(target, id);
    if (!info.found) {
      throw new Error(
        `[playwright-sapui5] Ui5Select.selectByText: control ${id} has no items aggregation - is it really a Select/ComboBox?`,
      );
    }
    const match = info.items.find((item) =>
      exact ? item.text === text : (item.text ?? '').includes(text),
    );
    if (!match) {
      throw new Error(
        `[playwright-sapui5] Ui5Select.selectByText: no option with text ${exact ? `"${text}"` : `containing "${text}"`}. Available: ${JSON.stringify(info.items.map((item) => item.text))}`,
      );
    }

    await this.open(target, select);
    await clickRenderedItem(target, id, match);
  }

  /**
   * Opens the dropdown and picks the option whose `key` is `key` - the value the app actually
   * binds on, which is usually the stable thing to write a test against, since it doesn't change
   * when the label is retranslated or reworded.
   *
   * Works by resolving the key to its option through the control itself, then clicking that
   * option's rendered entry - because the rendered entries carry no keys of their own.
   */
  static async selectByKey(
    target: Ui5Target,
    select: Ui5Locator | Locator,
    key: string,
  ): Promise<void> {
    const id = await resolveControlId(select);
    const info = await Ui5Bridge.getSelectInfo(target, id);
    if (!info.found) {
      throw new Error(
        `[playwright-sapui5] Ui5Select.selectByKey: control ${id} has no items aggregation - is it really a Select/ComboBox?`,
      );
    }
    const match = info.items.find((item) => item.key === key);
    if (!match) {
      throw new Error(
        `[playwright-sapui5] Ui5Select.selectByKey: no option with key "${key}". Available keys: ${JSON.stringify(info.items.map((item) => item.key))}`,
      );
    }

    await this.open(target, select);
    await clickRenderedItem(target, id, match);
  }
}

/** Waits for the control to report itself open, so a click on an option can't race the popover's
 * open animation. */
async function waitForOpen(target: Ui5Target, id: string, timeout = 5000): Promise<void> {
  const deadline = Date.now() + timeout;
  for (;;) {
    if ((await Ui5Bridge.getSelectInfo(target, id)).isOpen) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `[playwright-sapui5] Ui5Select: the dropdown for ${id} did not report itself open within ${timeout}ms.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * Clicks the rendered entry corresponding to one option. Two different things can be on screen,
 * depending on the control:
 *
 * 1. The option's *own* element - `sap.m.Select` renders its `sap.ui.core.Item`s directly, so the
 *    item id from `getItems()` is clickable as-is.
 * 2. A mirrored `sap.m.StandardListItem` - `sap.m.ComboBox`/`MultiComboBox` render these instead,
 *    with unrelated ids, so the only way across is to match on the visible text.
 */
async function clickRenderedItem(
  target: Ui5Target,
  selectId: string,
  item: Ui5SelectItem,
): Promise<void> {
  const own = target.locator(idSelector(item.id));
  if ((await own.count()) > 0) {
    await clickWithFallback(own.first());
    return;
  }

  for (const type of RENDERED_ITEM_TYPES) {
    const rendered = await Ui5Bridge.findControlsByType(target, type);
    if (rendered.length === 0) continue;
    const candidates = target
      .locator(idsSelector(rendered.map((control) => control.id)))
      .filter({ hasText: item.text ?? '' });
    if ((await candidates.count()) > 0) {
      await clickWithFallback(candidates.first());
      return;
    }
  }

  throw new Error(
    `[playwright-sapui5] Ui5Select: the dropdown for ${selectId} is open, but no rendered entry matching "${item.text}" could be found to click.`,
  );
}

/**
 * Clicks an item already resolved to a single, unambiguous element (by id, or by exact/contained
 * rendered text - never a guess). Tries an ordinary click first, the same as any other locator in
 * this framework - real user interaction, subject to Playwright's own visible/stable checks.
 *
 * The fallback exists for a real, if rare, failure mode: re-selecting an option that's *already*
 * selected (e.g. `selectByKey(items[0].key)` right after `selectByText` already picked that same
 * item) resolves to an element that's already carrying `aria-selected`/its "selected" CSS class
 * *before* the click even starts - and on at least one observed CI run, Playwright's actionability
 * check on that element never settled as visible/stable within the click's own timeout, even
 * though the exact same target genuinely exists and is exactly the one intended. `force: true`
 * skips that check and dispatches the click directly - safe specifically here, where the element
 * was never ambiguous to begin with, unlike a locator this framework had to guess at.
 */
async function clickWithFallback(locator: Locator): Promise<void> {
  try {
    await locator.click({ timeout: 10000 });
  } catch {
    await locator.click({ force: true });
  }
}

/** Accepts either a `Ui5Locator` or an already-resolved Playwright `Locator`, the same as the
 * custom matchers - what's actually needed is the control's exact DOM id. */
async function resolveControlId(control: Ui5Locator | Locator): Promise<string> {
  const locator = control instanceof Ui5Locator ? await control.resolve() : control;
  return locator.first().evaluate((el) => el.id);
}
