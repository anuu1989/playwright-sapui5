import { test, expect } from '../../src';
import { summarizeHeals } from '../../src';
import type { HealEvent } from '../../src';

/**
 * Covers the pure part of `HealthReporter` - grouping heal events by locator, across tests, into
 * the summary it prints and writes to disk. No browser and no real self-healing involved, which
 * is exactly why these are worth testing here: they're the aggregation edge cases that would
 * otherwise only show up buried in a real CI run's console output. See
 * docs/locator-health.md.
 *
 * `HealthReporter` itself (reading `ui5-heals.json` test attachments, `failOnHeal`'s
 * `{ status: 'failed' }` return) was verified separately against real `npx playwright test` runs -
 * see docs/locator-health.md for exactly what that verification covered.
 */
test.describe('Locator health aggregation', () => {
  const heal = (label: string, strategy: HealEvent['strategy']): HealEvent => ({
    label,
    strategyIndex: 1,
    attempt: 2,
    strategy,
  });

  test('groups heals by label across multiple tests', async () => {
    const summary = summarizeHeals([
      { title: 'test A', heals: [heal('Save button', { by: 'text', text: 'Save' })] },
      { title: 'test B', heals: [heal('Save button', { by: 'text', text: 'Save' })] },
      { title: 'test C', heals: [heal('Cancel button', { by: 'text', text: 'Cancel' })] },
    ]);

    expect(summary.totalHeals).toBe(3);
    expect(summary.rows).toHaveLength(2);

    const saveRow = summary.rows.find((row) => row.label === 'Save button')!;
    expect(saveRow.count).toBe(2);
    expect(saveRow.tests).toEqual(['test A', 'test B']);
  });

  test('sorts rows by heal count, most first', async () => {
    const summary = summarizeHeals([
      { title: 't1', heals: [heal('rare', { by: 'id', value: 'x' })] },
      { title: 't2', heals: [heal('common', { by: 'id', value: 'y' })] },
      { title: 't3', heals: [heal('common', { by: 'id', value: 'y' })] },
      { title: 't4', heals: [heal('common', { by: 'id', value: 'y' })] },
    ]);

    expect(summary.rows.map((row) => row.label)).toEqual(['common', 'rare']);
    expect(summary.rows[0].count).toBe(3);
  });

  test('counts distinct fallback strategies separately, even for the same locator', async () => {
    // A locator's primary strategy can be broken in a way where different tests happen to recover
    // through different fallbacks (e.g. one strategy is flaky rather than fully broken) - the
    // report should show that as two named strategies, not silently collapse them into one count.
    const summary = summarizeHeals([
      { title: 't1', heals: [heal('flaky', { by: 'text', text: 'A' })] },
      { title: 't2', heals: [heal('flaky', { by: 'controlType', controlType: 'sap.m.Button' })] },
      { title: 't3', heals: [heal('flaky', { by: 'text', text: 'A' })] },
    ]);

    const row = summary.rows[0];
    expect(row.count).toBe(3);
    expect(row.strategies).toEqual({
      '{"by":"text","text":"A"}': 2,
      '{"by":"controlType","controlType":"sap.m.Button"}': 1,
    });
  });

  test('a locator with no .as() label is grouped under a fixed placeholder, not dropped', async () => {
    const summary = summarizeHeals([
      {
        title: 't1',
        heals: [{ strategyIndex: 1, attempt: 2, strategy: { by: 'id', value: 'x' } }],
      },
    ]);

    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0].label).toBe('(unnamed locator)');
  });

  test('a test with no heals contributes nothing', async () => {
    const summary = summarizeHeals([{ title: 'clean test', heals: [] }]);
    expect(summary.totalHeals).toBe(0);
    expect(summary.rows).toEqual([]);
  });
});
