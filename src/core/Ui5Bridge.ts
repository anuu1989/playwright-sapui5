import type { Page } from '@playwright/test';
import { bridgeScript } from '../browser/bridgeScript';
import type { Ui5ControlDump, Ui5ControlInfo } from './types';

const initializedPages = new WeakSet<object>();

/**
 * Node-side access point to the in-browser UI5 bridge. Handles injecting the bridge script
 * exactly once per `Page`, and exposes typed methods that call into it.
 *
 * Most consumers should use `Ui5Locator` / `Ui5Page` instead of this class directly - it's
 * exposed for advanced use cases (e.g. the Page Object generator, or custom wait conditions).
 */
export class Ui5Bridge {
  /** Ensures the bridge is present on `page`, for both the current document and future navigations. */
  static async ensure(page: Page): Promise<void> {
    if (initializedPages.has(page)) return;
    initializedPages.add(page);
    await page.addInitScript(bridgeScript);
    // addInitScript only affects future navigations; inject into the current document too.
    await page.evaluate(bridgeScript).catch(() => {
      /* page may not have a document yet (e.g. about:blank restrictions) - safe to ignore */
    });
  }

  static async isCoreReady(page: Page): Promise<boolean> {
    await this.ensure(page);
    return page.evaluate(() => (window as any).__pwSapUi5__?.isCoreReady() ?? false);
  }

  static async isBusy(page: Page): Promise<boolean> {
    await this.ensure(page);
    return page.evaluate(() => (window as any).__pwSapUi5__?.isBusy() ?? false);
  }

  static async findControlsById(
    page: Page,
    idSuffix: string,
    exact = false,
  ): Promise<Ui5ControlInfo[]> {
    await this.ensure(page);
    return page.evaluate(
      ({ idSuffix, exact }) => (window as any).__pwSapUi5__.findControlsById(idSuffix, exact),
      { idSuffix, exact },
    );
  }

  static async findControlsByType(
    page: Page,
    controlType: string,
    properties?: Record<string, unknown>,
  ): Promise<Ui5ControlInfo[]> {
    await this.ensure(page);
    return page.evaluate(
      ({ controlType, properties }) =>
        (window as any).__pwSapUi5__.findControlsByType(controlType, properties),
      { controlType, properties },
    );
  }

  static async findControlsByBindingPath(
    page: Page,
    path: string,
    controlType?: string,
  ): Promise<Ui5ControlInfo[]> {
    await this.ensure(page);
    return page.evaluate(
      ({ path, controlType }) =>
        (window as any).__pwSapUi5__.findControlsByBindingPath(path, controlType),
      { path, controlType },
    );
  }

  static async findControlsByText(
    page: Page,
    text: string,
    controlType?: string,
    exact = false,
  ): Promise<Ui5ControlInfo[]> {
    await this.ensure(page);
    return page.evaluate(
      ({ text, controlType, exact }) =>
        (window as any).__pwSapUi5__.findControlsByText(text, controlType, exact),
      { text, controlType, exact },
    );
  }

  static async dumpControlTree(page: Page): Promise<Ui5ControlDump[]> {
    await this.ensure(page);
    return page.evaluate(() => (window as any).__pwSapUi5__.dumpControlTree());
  }
}
