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
