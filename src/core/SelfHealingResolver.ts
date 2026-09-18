import type { Locator, Page } from '@playwright/test';
import { Ui5Bridge } from './Ui5Bridge';
import type { HealEvent, HealListener, Ui5ControlInfo, Ui5LocatorCriteria } from './types';

function escapeAttrValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function controlsToLocator(page: Page, matches: Ui5ControlInfo[]): Locator {
  if (matches.length === 0) {
    // A selector that structurally can never match anything, so `.count()` is 0 and
    // `.waitFor()` behaves the same as "not found" instead of throwing a syntax error.
    return page.locator('[data-playwright-sapui5-no-match]');
  }
  const selector = matches.map((m) => `[id="${escapeAttrValue(m.id)}"]`).join(', ');
  return page.locator(selector);
}

/** Resolves a single strategy into a Playwright `Locator`, polling until it matches or times out. */
async function resolveCriteria(
  page: Page,
  criteria: Ui5LocatorCriteria,
  timeoutMs: number,
): Promise<Locator> {
  if (criteria.by === 'css') {
    const locator = page.locator(criteria.selector);
    await locator.first().waitFor({ state: 'attached', timeout: timeoutMs });
    return locator;
  }

  if (criteria.by === 'role') {
    const locator = page.getByRole(criteria.role as Parameters<Page['getByRole']>[0], {
      name: criteria.name,
    });
    await locator.first().waitFor({ state: 'attached', timeout: timeoutMs });
    return locator;
  }

  await Ui5Bridge.ensure(page);

  const deadline = Date.now() + timeoutMs;
  let matches: Ui5ControlInfo[] = [];
  // Poll in-browser via waitForFunction so we retry while UI5 is still rendering/binding data,
  // instead of treating a transient "not found yet" as a hard failure for this strategy.
  const remaining = () => Math.max(0, deadline - Date.now());

  const handle = await page.waitForFunction(
    (args) => {
      const bridge = (window as any).__pwSapUi5__;
      if (!bridge) return null;
      let result: Ui5ControlInfo[] = [];
      switch (args.by) {
        case 'id':
          result = bridge.findControlsById(args.value, args.exact);
          break;
        case 'controlType':
          result = bridge.findControlsByType(args.controlType, args.properties);
          break;
        case 'bindingPath':
          result = bridge.findControlsByBindingPath(args.path, args.controlType);
          break;
        case 'text':
          result = bridge.findControlsByText(args.text, args.controlType, args.exact);
          break;
      }
      return result.length ? result : null;
    },
    criteria,
    { timeout: remaining() },
  );
  matches = (await handle.jsonValue()) as Ui5ControlInfo[];
  await handle.dispose();

  return controlsToLocator(page, matches);
}

export class SelfHealingResolver {
  private static listeners: HealListener[] = [];

  /** Subscribe to fallback events, e.g. for custom logging/reporting. Returns an unsubscribe function. */
  static onHeal(listener: HealListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private static emit(event: HealEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // listener errors must never break locator resolution
      }
    }
  }

  /**
   * Resolves the first strategy in `strategies` that matches, trying each in order.
   * The overall `timeout` budget is split evenly across strategies. Throws if all fail.
   */
  static async resolve(
    page: Page,
    strategies: Ui5LocatorCriteria[],
    options: { timeout?: number; label?: string } = {},
  ): Promise<Locator> {
    if (strategies.length === 0) {
      throw new Error('[playwright-sapui5] Ui5Locator has no strategies to resolve.');
    }
    const totalTimeout = options.timeout ?? 10000;
    const perStrategyTimeout = Math.max(1000, Math.floor(totalTimeout / strategies.length));

    let lastError: unknown;
    for (let i = 0; i < strategies.length; i++) {
      try {
        const locator = await resolveCriteria(page, strategies[i], perStrategyTimeout);
        if ((await locator.count()) === 0) {
          throw new Error('no matching elements');
        }
        if (i > 0) {
          const event: HealEvent = {
            label: options.label,
            strategyIndex: i,
            strategy: strategies[i],
            attempt: i + 1,
          };
          this.emit(event);
          console.warn(
            `[playwright-sapui5] Self-healed locator "${options.label ?? 'unnamed'}" using fallback #${i + 1}: ${JSON.stringify(
              strategies[i],
            )}`,
          );
        }
        return locator;
      } catch (err) {
        lastError = err;
      }
    }
    throw new Error(
      `[playwright-sapui5] All ${strategies.length} locator strategies failed for "${options.label ?? 'unnamed locator'}". Last error: ${String(lastError)}`,
    );
  }
}
