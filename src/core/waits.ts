import type { Page } from '@playwright/test';
import { Ui5Bridge } from './Ui5Bridge';
import type { WaitForUi5Options } from './types';

/**
 * Waits until `sap.ui.getCore()` exists on the page, i.e. the SAPUI5 runtime has bootstrapped.
 * Useful right after `page.goto()`. Safe to call on non-UI5 pages (it will just time out;
 * catch it or use `waitForUi5` instead, which degrades gracefully).
 */
export async function waitForUi5Core(page: Page, options: WaitForUi5Options = {}): Promise<void> {
  const timeout = options.timeout ?? 30000;
  await Ui5Bridge.ensure(page);
  await page.waitForFunction(
    () => (window as any).__pwSapUi5__?.isCoreReady() === true,
    undefined,
    {
      timeout,
    },
  );
  // Best-effort: a UI5 app's bootstrap (manifest, component, views, initial OData/mock data) is
  // almost entirely network-bound, but not all of that loading is guaranteed to go through
  // fetch/XHR in a way our own instrumentation can see (e.g. script-tag module loading). Riding
  // Playwright's own network-idle detection here catches it regardless of the mechanism, once,
  // before `waitForUi5` starts polling the control tree for the (much shorter) final settle.
  await page.waitForLoadState('networkidle', { timeout }).catch(() => {
    /* apps with polling, websockets, or analytics beacons may never go fully idle - that's fine */
  });
}

/**
 * Waits until the app looks "settled": no global BusyIndicator, no control-level `busy` state,
 * no in-flight fetch/XHR requests, and the UI5 control tree has stopped growing/changing for a
 * short quiet period. That last part matters as much as the busy checks - right after
 * `page.goto()`, an app's initial component/view bootstrap often doesn't set any busy state or
 * go through fetch/XHR at all, so without it this would return before a single control has
 * rendered. This is the framework's core auto-wait primitive - call it before interacting with
 * controls that might still be loading.
 *
 * On a page where SAPUI5 never loads at all, this still resolves (quickly) rather than throwing,
 * so it's safe to sprinkle liberally.
 */
export async function waitForUi5(page: Page, options: WaitForUi5Options = {}): Promise<void> {
  const timeout = options.timeout ?? 15000;
  await Ui5Bridge.ensure(page);
  await page.waitForFunction(
    () => {
      const bridge = (window as any).__pwSapUi5__;
      return bridge ? bridge.isSettled() : true;
    },
    undefined,
    { timeout },
  );
}
