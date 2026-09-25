import type { Ui5Target } from './Ui5Bridge';
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
 * There's no class here, no `new`, nothing stateful - `ui5(target)` is a plain function that
 * returns a plain object literal, and every property on that object is a small arrow function
 * closing over the `target` parameter (that's what lets `ui5(page).id('x')` work without you
 * having to write `ui5(page).id(page, 'x')` - the `target` is already "baked in" by the closure).
 * Each of those arrow functions does nothing but forward to the matching `Ui5Locator` static
 * factory - this file exists purely for the nicer call syntax, not for any different behavior.
 * `Ui5Page`'s own `protected id(...)`/`controlType(...)`/etc. methods (see `src/core/Ui5Page.ts`)
 * are the exact same idea, just as class methods instead of a returned object's properties.
 *
 * `target` accepts a `Page` or a `Frame` - pass a `Frame` (e.g. one found with `findUi5Frame()`)
 * to build locators scoped to one specific iframe, such as an embedded app loaded inside a Fiori
 * Launchpad shell. See docs/cross-frame.md.
 */
export function ui5(target: Ui5Target) {
  return {
    id: (value: string, options?: { exact?: boolean }) => Ui5Locator.id(target, value, options),
    controlType: (type: string, properties?: Record<string, unknown>) =>
      Ui5Locator.controlType(target, type, properties),
    bindingPath: (path: string, controlType?: string) =>
      Ui5Locator.bindingPath(target, path, controlType),
    text: (value: string, options?: { controlType?: string; exact?: boolean }) =>
      Ui5Locator.text(target, value, options),
    css: (selector: string) => Ui5Locator.css(target, selector),
    role: (role: string, name?: string) => Ui5Locator.role(target, role, name),
  };
}
