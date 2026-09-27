import type { Locator } from '@playwright/test';
import { Ui5Bridge, type Ui5Target } from './Ui5Bridge';
import { idsSelector } from './domSelectors';

/**
 * Finds the controls in `target` whose displayed content is inherently time-based - "2 minutes
 * ago", today's date, a live clock - and returns them as a `Locator[]` ready to pass straight to
 * Playwright's own `toHaveScreenshot(name, { mask: [...] })`. See
 * docs/visual-testing.md#masking-dynamic-content.
 *
 * Detection reads each control's real **binding type** (`{ path: '...', type: new
 * sap.ui.model.type.DateTime() }`), not its rendered text - so it's exact, not a guess. A plain
 * control whose text happens to *look* like a date (`"2024-01-01"` typed in as a literal string,
 * no binding at all) is correctly left alone, and one bound with a date/time type is masked
 * regardless of what its formatted output currently looks like. What it can't catch: content
 * that's dynamic for a reason other than a date/time binding type - a random id, a live counter
 * formatted by custom app code rather than a SAPUI5 type. Mask those explicitly yourself, the same
 * way you would with plain Playwright.
 *
 * ```ts
 * const dynamic = await maskDynamicUi5Content(page);
 * await expect(page).toHaveScreenshot('dashboard.png', { mask: dynamic });
 * ```
 */
export async function maskDynamicUi5Content(target: Ui5Target): Promise<Locator[]> {
  const controls = await Ui5Bridge.findControlsWithDateTimeBinding(target);
  if (controls.length === 0) return [];
  // One locator covering every match, `.first()`'d per element the way self-healing's own
  // `controlsToLocator` does - `toHaveScreenshot`'s `mask` option masks every element a locator
  // resolves to, so a single multi-match `Locator` here is exactly what it wants.
  return [target.locator(idsSelector(controls.map((c) => c.id)))];
}
