import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { writeFileSync } from 'node:fs';
import type { HealEvent } from '../core/types';

/**
 * Turns self-healing from a live console warning into a run-level trend report. See
 * docs/locator-health.md.
 *
 * `SelfHealingResolver.onHeal()` already exists, but as a plain event subscription it only tells
 * you about a heal *while a test is running*, in whatever process that test happens to be in - a
 * reporter, by contrast, runs in Playwright's main process, which is a different process from the
 * one a worker actually executes tests in whenever more than one worker is used (the default).
 * Registering `onHeal()` from a reporter would silently hear nothing.
 *
 * The fix already exists elsewhere in this framework: the `ui5HealthTracking` fixture
 * (`src/fixtures/test.ts`) subscribes *inside* the worker, collects every heal from the test that
 * just ran, and attaches them to the test result as `ui5-heals.json` - the same
 * attach-in-the-worker, read-in-the-reporter pattern `JiraReporter` already uses for the
 * `ui5-control-tree.txt` diagnostics attachment. This reporter just reads that attachment back
 * across every test and aggregates it.
 *
 * ```ts
 * // playwright.config.ts
 * reporter: [['list'], ['playwright-sapui5/reporter/health']],
 * ```
 *
 * A locator that heals once is a warning. One that heals in every run is a locator that's already
 * wrong and is only passing because its fallback is doing the real work - this is what makes that
 * visible before it degrades further into an outright failure.
 */
export interface HealthReporterOptions {
  /** Write the full aggregation to this path as JSON - e.g. to diff against a previous run's
   * output and catch a locator that started healing only recently. */
  outputFile?: string;
  /** Fail the whole run if anything healed at all. Off by default - a heal is a warning about
   * drift, not a defect in the app under test, so failing a build over it without being asked
   * would be a surprising thing for this reporter to do. Only escalates a run that would
   * otherwise report `'passed'` - a run that already failed for its own reasons keeps that more
   * specific status. */
  failOnHeal?: boolean;
}

export interface HealAggregateRow {
  label: string;
  count: number;
  tests: string[];
  /** `JSON.stringify(strategy)` -> how many times that exact fallback is what caught it. Usually
   * one entry, but a locator can heal via different fallbacks across different tests. */
  strategies: Record<string, number>;
}

export interface HealthSummary {
  totalHeals: number;
  /** Sorted by `count`, descending - the locator that healed most is the one worth fixing first. */
  rows: HealAggregateRow[];
}

/**
 * The actual aggregation, deliberately kept as a pure function with no Playwright reporter
 * machinery involved - this is the part with real edge cases (grouping by label, counting
 * distinct fallback strategies separately, sort order, an unlabeled locator not silently
 * disappearing) and pure functions are what let those be tested directly, the same way
 * `jiraIssueKeys.ts`'s `extractIssueKeys` is tested without a real Jira. See
 * examples/tests/health.spec.ts.
 */
export function summarizeHeals(perTest: { title: string; heals: HealEvent[] }[]): HealthSummary {
  const aggregates = new Map<
    string,
    { label: string; count: number; tests: Set<string>; strategies: Map<string, number> }
  >();
  let totalHeals = 0;

  for (const { title, heals } of perTest) {
    for (const event of heals) {
      const label = event.label ?? '(unnamed locator)';
      const aggregate = aggregates.get(label) ?? {
        label,
        count: 0,
        tests: new Set<string>(),
        strategies: new Map<string, number>(),
      };
      aggregate.count += 1;
      aggregate.tests.add(title);
      const strategyKey = JSON.stringify(event.strategy);
      aggregate.strategies.set(strategyKey, (aggregate.strategies.get(strategyKey) ?? 0) + 1);
      aggregates.set(label, aggregate);
      totalHeals += 1;
    }
  }

  const rows = [...aggregates.values()]
    .sort((a, b) => b.count - a.count)
    .map((row) => ({
      label: row.label,
      count: row.count,
      tests: [...row.tests],
      strategies: Object.fromEntries(row.strategies),
    }));

  return { totalHeals, rows };
}

export default class HealthReporter implements Reporter {
  private readonly options: HealthReporterOptions;
  private readonly perTest: { title: string; heals: HealEvent[] }[] = [];

  constructor(options: HealthReporterOptions = {}) {
    this.options = options;
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const attachment = result.attachments.find((a) => a.name === 'ui5-heals.json');
    if (!attachment?.body) return;

    let heals: HealEvent[];
    try {
      heals = JSON.parse(attachment.body.toString());
    } catch {
      // A malformed attachment must never break the run's reporting - just skip it.
      return;
    }
    if (heals.length === 0) return;

    this.perTest.push({ title: test.titlePath().filter(Boolean).join(' › '), heals });
  }

  // `async` (rather than returning the object directly) purely to match Playwright's own `onEnd`
  // signature, which expects `void | Promise<{ status? } | undefined>` - a bare returned object
  // isn't assignable to that union, a `Promise`-wrapped one is.
  async onEnd(result: FullResult): Promise<{ status?: FullResult['status'] } | void> {
    const summary = summarizeHeals(this.perTest);
    if (summary.rows.length === 0) return;

    console.log('');
    console.log(
      `[playwright-sapui5] ${summary.totalHeals} self-heal(s) across ${summary.rows.length} locator(s) - the primary strategy needs attention:`,
    );
    for (const row of summary.rows) {
      console.log(`  ${row.count}x  ${row.label}  (${row.tests.length} test(s))`);
      for (const [strategy, count] of Object.entries(row.strategies)) {
        console.log(`        healed via ${strategy}  (${count}x)`);
      }
    }

    if (this.options.outputFile) {
      writeFileSync(this.options.outputFile, JSON.stringify(summary.rows, null, 2), 'utf-8');
      console.log(`[playwright-sapui5] wrote locator health report to ${this.options.outputFile}`);
    }

    if (this.options.failOnHeal && result.status === 'passed') {
      // Overriding `process.exitCode` directly here does *not* work - Playwright's runner
      // computes the process exit code from the final run status itself, after every reporter's
      // `onEnd` has returned, and that computation ignores anything a reporter set on
      // `process.exitCode` along the way. Returning `{ status: 'failed' }` is the documented,
      // actually-effective way for a reporter to turn an otherwise-green run red - confirmed
      // against a real run: setting `process.exitCode` here left the process exiting 0 even with
      // `failOnHeal: true` and a real heal recorded, while this return value does not.
      return { status: 'failed' };
    }
  }
}
