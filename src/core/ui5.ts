import type { Page } from '@playwright/test';
import { Ui5Locator } from './Ui5Locator';

/**
 * Fluent, function-style entry point into `Ui5Locator`, for use outside of a Page Object:
 *
 * ```ts
 * import { ui5 } from 'playwright-sapui5';
 *
 * await ui5(page).controlType('sap.m.Button', { text: 'Save' }).click();
 * await ui5(page).id('productList').waitFor();
 * ```
 *
 * There's no class here, no `new`, nothing stateful - `ui5(page)` is a plain function that
 * returns a plain object literal, and every property on that object is a small arrow function
 * closing over the `page` parameter (that's what lets `ui5(page).id('x')` work without you
 * having to write `ui5(page).id(page, 'x')` - the `page` is already "baked in" by the closure).
 * Each of those arrow functions does nothing but forward to the matching `Ui5Locator` static
 * factory - this file exists purely for the nicer call syntax, not for any different behavior.
 * `Ui5Page`'s own `protected id(...)`/`controlType(...)`/etc. methods (see `src/core/Ui5Page.ts`)
 * are the exact same idea, just as class methods instead of a returned object's properties.
 */
export function ui5(page: Page) {
  return {
    id: (value: string, options?: { exact?: boolean }) => Ui5Locator.id(page, value, options),
    controlType: (type: string, properties?: Record<string, unknown>) =>
      Ui5Locator.controlType(page, type, properties),
    bindingPath: (path: string, controlType?: string) =>
      Ui5Locator.bindingPath(page, path, controlType),
    text: (value: string, options?: { controlType?: string; exact?: boolean }) =>
      Ui5Locator.text(page, value, options),
    css: (selector: string) => Ui5Locator.css(page, selector),
    role: (role: string, name?: string) => Ui5Locator.role(page, role, name),
  };
}
