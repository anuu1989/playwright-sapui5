import type { Frame, Page } from '@playwright/test';
import { Ui5Bridge } from './Ui5Bridge';

export interface FindUi5FrameOptions {
  /** Overall timeout (ms) to keep polling for a matching frame. Default 30000. */
  timeout?: number;
  /**
   * Optional filter narrowing which iframes count as candidates, checked before the (more
   * expensive) SAPUI5-readiness check - e.g. `(frame) => frame.url().includes('someAppId')`.
   * Useful when a shell might have more than one iframe and you know something about the one
   * you want (its URL, its `name()`) ahead of time. Without it, every iframe on the page is a
   * candidate.
   */
  predicate?: (frame: Frame) => boolean;
}

/**
 * Finds the child iframe, within `page`, that has its own ready SAPUI5 runtime - the pattern a
 * Fiori Launchpad (or any other UI5 "shell" app) uses to embed a separate app: the shell itself
 * is one SAPUI5 app, running in the page's main frame, and it loads the actual target app inside
 * an `<iframe>`, which boots its *own*, entirely separate SAPUI5 runtime and control tree.
 *
 * This deliberately only ever considers frames *other than* `page.mainFrame()` - the shell's own
 * main frame is almost always itself a (ready) SAPUI5 app, so a check that didn't exclude it
 * would usually just find the shell again instead of the embedded app you actually want.
 *
 * Once you have the `Frame`, use it exactly like a `Page` with this framework: `ui5(frame)`,
 * `new SomePageObject(frame)` is not supported (`Ui5Page` is `Page`-only by design - see
 * docs/cross-frame.md#page-objects-and-frames), but `Ui5Locator`'s static factories,
 * `waitForUi5`/`waitForUi5Core`, and `Ui5Bridge` itself all accept a `Frame` directly. See
 * docs/cross-frame.md for a full worked example and current limitations.
 */
export async function findUi5Frame(page: Page, options: FindUi5FrameOptions = {}): Promise<Frame> {
  const timeout = options.timeout ?? 30000;
  const deadline = Date.now() + timeout;
  const mainFrame = page.mainFrame();

  // A simple poll loop, not `waitForFunction`: the thing being waited on here - "does some other
  // frame exist yet, and if so, has SAPUI5 booted inside it" - spans multiple frames and multiple
  // async round trips (one `evaluate` per candidate frame), which isn't a single in-browser
  // predicate `waitForFunction` could check in one shot the way `Ui5Bridge`'s other methods do.
  for (;;) {
    const candidates = page.frames().filter((frame) => frame !== mainFrame && !frame.isDetached());
    const filtered = options.predicate ? candidates.filter(options.predicate) : candidates;

    for (const frame of filtered) {
      // A frame mid-navigation, or one that's just a tracking/ad iframe with no SAPUI5 at all,
      // should never abort the search for the rest - `isCoreReady` itself already swallows most
      // failures, but `.catch(() => false)` covers the rest (e.g. cross-origin frames Playwright
      // can't evaluate into at all).
      const ready = await Ui5Bridge.isCoreReady(frame).catch(() => false);
      if (ready) return frame;
    }

    if (Date.now() >= deadline) {
      throw new Error(
        `[playwright-sapui5] findUi5Frame: no iframe with a ready SAPUI5 core found within ${timeout}ms.`,
      );
    }
    await page.waitForTimeout(200);
  }
}
