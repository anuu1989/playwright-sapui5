import type { Locator } from '@playwright/test';
import { Ui5Bridge, type Ui5Target } from './Ui5Bridge';
import { Ui5Locator } from './Ui5Locator';

/**
 * Setting and reading `sap.m.DatePicker` values without fighting date formats. See
 * docs/form-inputs.md.
 *
 * Dates are the classic source of flaky SAPUI5 tests, for two independent reasons:
 *
 * 1. **Display format varies by locale.** The same day renders as `Apr 14, 2014`, `14.04.2014` or
 *    `2014-04-14` depending on the app's configuration and the user's language - so a test that
 *    types a literal date string only works on the locale it was written against.
 * 2. **ISO strings are a timezone trap.** `new Date('2024-03-15')` parses as UTC midnight, which
 *    in any timezone behind UTC *is still the 14th locally* - a bug that shows up as an
 *    off-by-one-day failure only for some contributors, or only in CI.
 *
 * `setDate()` sidesteps both: it takes calendar parts (or a `Date`), passes year/month/day across
 * as plain integers, and sets the value through the control's own API - then fires the control's
 * `change` event so the app's handlers run exactly as they would after a user edit.
 *
 * ```ts
 * await Ui5DatePicker.setDate(page, ui5(page).id('deliveryDate'), '2024-03-15');
 * const { date, displayValue } = await Ui5DatePicker.getDate(page, ui5(page).id('deliveryDate'));
 * ```
 */
export class Ui5DatePicker {
  /**
   * Sets the date. Accepts either a JavaScript `Date` (read in **local** time, matching what the
   * picker displays) or a `'YYYY-MM-DD'` string - the string form being the one that can't be
   * misinterpreted, since it never goes through `Date` parsing at all.
   *
   * Fires the control's `change` event afterwards, so anything the app does in response to a user
   * picking a date (validation, dependent fields, a re-filter) happens here too.
   */
  static async setDate(
    target: Ui5Target,
    datePicker: Ui5Locator | Locator,
    date: Date | string,
  ): Promise<void> {
    const { year, month, day } = toCalendarParts(date);
    const id = await resolveControlId(datePicker);
    const result = await Ui5Bridge.setDatePickerDate(target, id, year, month, day);
    if (!result.found) {
      throw new Error(
        `[playwright-sapui5] Ui5DatePicker.setDate: control ${id} has no setDateValue() - is it really a sap.m.DatePicker?`,
      );
    }
    if (!result.ok) {
      throw new Error(
        `[playwright-sapui5] Ui5DatePicker.setDate failed: ${result.error ?? 'unknown error'}`,
      );
    }
  }

  /**
   * The current value, both ways: `date` as a JavaScript `Date` built from the control's own
   * calendar parts (so it's the day the picker shows, in local time, with no timezone shift), and
   * `displayValue` as the formatted string actually rendered in the field.
   *
   * `date` is `null` when the field is empty.
   */
  static async getDate(
    target: Ui5Target,
    datePicker: Ui5Locator | Locator,
  ): Promise<{ date: Date | null; displayValue: string }> {
    const id = await resolveControlId(datePicker);
    const value = await Ui5Bridge.getDatePickerDate(target, id);
    if (!value.found) {
      throw new Error(
        `[playwright-sapui5] Ui5DatePicker.getDate: no control found with id "${id}".`,
      );
    }
    const hasDate =
      value.year !== undefined && value.month !== undefined && value.day !== undefined;
    return {
      date: hasDate ? new Date(value.year!, value.month! - 1, value.day!) : null,
      displayValue: value.value ?? '',
    };
  }

  /**
   * Types `text` into the field literally, as a user would - the escape hatch for when what's
   * under test *is* the app's parsing and validation of typed input (an invalid date, an unusual
   * format, a value-state error). For simply getting a date into the field, prefer `setDate()`,
   * which doesn't depend on matching the locale's display format.
   */
  static async typeDate(datePicker: Ui5Locator | Locator, text: string): Promise<void> {
    const locator =
      datePicker instanceof Ui5Locator ? await datePicker.resolve() : (datePicker as Locator);
    // The control's root is a wrapper; the real <input> sits inside it - the same nesting
    // `Ui5Locator.fill()` handles for `sap.m.Input`/`SearchField`. No `target` parameter here
    // (unlike the other methods on this class): typing goes entirely through the resolved
    // `Locator`, which already knows which page or frame it belongs to, so there'd be nothing to
    // do with one.
    const field = locator.first().locator('input').first();
    await field.fill(text);
    await field.press('Enter');
  }
}

/** Normalizes either accepted input into unambiguous calendar parts. A `Date` is read with the
 * **local** getters (`getFullYear`/`getMonth`/`getDate`) because that's the day the user sees;
 * a `'YYYY-MM-DD'` string is split textually, never parsed, so no timezone logic touches it. */
function toCalendarParts(date: Date | string): { year: number; month: number; day: number } {
  if (date instanceof Date) {
    if (Number.isNaN(date.getTime())) {
      throw new Error('[playwright-sapui5] Ui5DatePicker: received an invalid Date.');
    }
    return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!match) {
    throw new Error(
      `[playwright-sapui5] Ui5DatePicker: expected a Date or a 'YYYY-MM-DD' string, got "${date}". Use typeDate() if you mean to type a locale-formatted value literally.`,
    );
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

async function resolveControlId(control: Ui5Locator | Locator): Promise<string> {
  const locator = control instanceof Ui5Locator ? await control.resolve() : control;
  return locator.first().evaluate((el) => el.id);
}
