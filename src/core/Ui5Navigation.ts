import { Ui5Bridge, type Ui5Target } from './Ui5Bridge';
import { waitForUi5 } from './waits';

/**
 * Navigating a SAPUI5 app by **route**, rather than by clicking through to where you want to be.
 * See docs/navigation.md.
 *
 * SAPUI5 apps are hash-routed: `#/category/LT` *is* the screen you're on, and the path never
 * changes. Two things follow, and this class covers both.
 *
 * Jumping straight to a deep screen turns a five-click setup into one line, which matters when
 * twenty tests all need the same starting state. But there's a right and a wrong way to do it:
 * assigning `location.hash` only *looks* like navigation, and an app that reacts to its router's
 * own events can end up half-initialized. `navTo()` goes through the app's real router instead,
 * so its matched-route handlers, view loading and history entry all happen exactly as they would
 * for a user.
 *
 * ```ts
 * await Ui5Navigation.navTo(page, 'category', { id: 'LT' });
 * expect(await Ui5Navigation.hash(page)).toBe('#/category/LT');
 * ```
 */
export class Ui5Navigation {
  /** The current URL hash - what identifies the screen in a hash-routed app. */
  static async hash(target: Ui5Target): Promise<string> {
    return Ui5Bridge.getHash(target);
  }

  /**
   * Navigates via the app's own router, then waits for it to settle.
   *
   * `routeName` is the name the app gave the route in its `manifest.json` (its `"routes"`
   * section), and `parameters` fills that route's pattern - so `navTo(page, 'category', { id:
   * 'LT' })` for a route patterned `category/{id}`.
   *
   * Throws if the app has no router at all. It does **not** throw for a route name that doesn't
   * exist: SAPUI5's own `navTo` logs an error and does nothing in that case (verified against a
   * live app), so the navigation silently fails. Follow it with `waitForHash()` when you need to
   * be sure the route actually took - that turns a silent no-op into a real failure.
   */
  static async navTo(
    target: Ui5Target,
    routeName: string,
    parameters: Record<string, unknown> = {},
    options: { timeout?: number } = {},
  ): Promise<void> {
    const result = await Ui5Bridge.routerNavTo(target, routeName, parameters);
    if (!result.found) {
      throw new Error(
        `[playwright-sapui5] Ui5Navigation.navTo: no SAPUI5 component with a router was found on this page.`,
      );
    }
    if (!result.ok) {
      throw new Error(
        `[playwright-sapui5] Ui5Navigation.navTo("${routeName}") failed: ${result.error ?? 'unknown error'}`,
      );
    }
    await waitForUi5(target, { timeout: options.timeout }).catch(() => {
      /* best-effort, as with every other action in this framework */
    });
  }

  /**
   * Waits until the hash matches - a substring, or a `RegExp` for anything looser.
   *
   * Useful after an action that navigates: the hash is the most reliable signal that a *route*
   * change actually happened, as opposed to some content merely re-rendering in place.
   */
  static async waitForHash(
    target: Ui5Target,
    expected: string | RegExp,
    options: { timeout?: number } = {},
  ): Promise<string> {
    const timeout = options.timeout ?? 5000;
    const deadline = Date.now() + timeout;
    const matches = (hash: string) =>
      typeof expected === 'string' ? hash.includes(expected) : expected.test(hash);

    for (;;) {
      const hash = await this.hash(target);
      if (matches(hash)) return hash;
      if (Date.now() >= deadline) {
        throw new Error(
          `[playwright-sapui5] Ui5Navigation.waitForHash: hash did not match ${String(expected)} within ${timeout}ms. Current hash: "${hash}"`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
