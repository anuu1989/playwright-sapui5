import type { Page } from '@playwright/test';
import { Ui5Bridge } from './Ui5Bridge';
import { Ui5Locator } from './Ui5Locator';
import { waitForUi5, waitForUi5Core } from './waits';
import type { WaitForUi5Options } from './types';

/**
 * Base class for Page Objects targeting a SAPUI5 app. Extend it and expose one getter per
 * control you need, built from the protected `this.id(...)`, `this.controlType(...)`, etc.
 * helpers - each returns a `Ui5Locator`, so every getter is automatically self-healing and
 * auto-waiting.
 *
 * ```ts
 * export class LoginPage extends Ui5Page {
 *   async open() {
 *     await this.goto('https://example.com/login');
 *   }
 *
 *   get usernameInput() {
 *     return this.controlType('sap.m.Input', { name: 'username' });
 *   }
 *
 *   get loginButton() {
 *     return this.text('Log On', { controlType: 'sap.m.Button' });
 *   }
 * }
 * ```
 *
 * `abstract class` (see docs/typescript-for-beginners.md#classes) means you can never write
 * `new Ui5Page(page)` directly - only `class LoginPage extends Ui5Page { ... }`, then
 * `new LoginPage(page)`. That's deliberate: this class only exists to be built on top of.
 */
export abstract class Ui5Page {
  // `constructor(protected readonly page: Page) {}` is a TypeScript shortcut: writing an access
  // modifier (`protected`) directly on a constructor parameter both declares a class property of
  // the same name AND assigns it from that argument, in one line - equivalent to writing
  // `protected readonly page: Page;` above and `this.page = page;` inside the constructor body
  // by hand. `protected` means only this class and subclasses (your own `LoginPage`, etc.) can
  // read `this.page` - code outside the class can't reach into `somePage.page` directly.
  constructor(protected readonly page: Page) {}

  // --- Locator helpers -------------------------------------------------------------------------
  // These five methods are thin `protected` wrappers around `Ui5Locator`'s own static factories,
  // pre-filled with `this.page` so your own Page Object subclasses never have to pass `page`
  // around themselves - compare `this.id('searchField')` here to the equivalent
  // `Ui5Locator.id(this.page, 'searchField')` you'd otherwise have to write in every getter.

  protected id(value: string, options?: { exact?: boolean }): Ui5Locator {
    return Ui5Locator.id(this.page, value, options);
  }

  protected controlType(type: string, properties?: Record<string, unknown>): Ui5Locator {
    return Ui5Locator.controlType(this.page, type, properties);
  }

  protected bindingPath(path: string, controlType?: string): Ui5Locator {
    return Ui5Locator.bindingPath(this.page, path, controlType);
  }

  protected text(value: string, options?: { controlType?: string; exact?: boolean }): Ui5Locator {
    return Ui5Locator.text(this.page, value, options);
  }

  protected css(selector: string): Ui5Locator {
    return Ui5Locator.css(this.page, selector);
  }

  /** Navigates to `url`, waits for the UI5 runtime to bootstrap, then waits for the app to settle. */
  async goto(url: string, options: WaitForUi5Options = {}): Promise<void> {
    // Bridge must be installed *before* navigation: `addInitScript` only affects documents that
    // load after it's registered, and the app's bootstrap network activity (manifest, component,
    // views, mock data) happens right at the start of that new document's life. Registering the
    // bridge after `goto()` would miss all of it, and auto-wait would settle too early.
    await Ui5Bridge.ensure(this.page);
    await this.page.goto(url);
    // `.catch(() => {})` here: not every app under test necessarily has SAPUI5 booted on the very
    // first route you land on (some apps redirect through a plain login page first, for
    // example), so a timeout waiting for `sap.ui.getCore()` shouldn't stop your test from
    // continuing - you (or the next explicit wait) get to decide what to do next.
    await waitForUi5Core(this.page, options).catch(() => {
      /* not every app under test boots UI5 immediately on this route; caller can still act */
    });
    await this.waitForUi5Ready(options);
  }

  /** Waits until the app has no busy indicator and no pending requests. */
  async waitForUi5Ready(options: WaitForUi5Options = {}): Promise<void> {
    await waitForUi5(this.page, options);
  }
}
