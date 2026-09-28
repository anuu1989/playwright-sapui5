import { test, expect } from '../../src';
import { updateFlakyHistory, findQuarantineCandidates } from '../../src';
import type { FlakyHistory, FlakyTestThisRun } from '../../src';

/**
 * Covers the pure part of `FlakyTestReporter` - folding a run's results into cross-run history,
 * and deciding which tests cross the quarantine threshold. No browser or reporter machinery
 * needed, the same way `examples/tests/health.spec.ts` covers `summarizeHeals` directly. See
 * docs/flaky-tests.md.
 *
 * `FlakyTestReporter` itself (reading `TestCase.outcome()`, writing/reading `historyFile`,
 * `failOnQuarantineCandidate` actually changing the run's exit code) was verified separately
 * against real `npx playwright test` runs of a deliberately flaky test across three consecutive
 * invocations - see docs/flaky-tests.md for exactly what that verification covered and found.
 */
test.describe('Flaky test history aggregation', () => {
  const run = (id: string, outcome: FlakyTestThisRun['outcome']): FlakyTestThisRun => ({
    id,
    title: `some.spec.ts › ${id}`,
    file: 'some.spec.ts',
    outcome,
    attempts: outcome === 'flaky' ? 2 : 1,
  });

  test('updateFlakyHistory appends a run and caps retained history at historyLimit', () => {
    let history: FlakyHistory = {};
    history = updateFlakyHistory(history, [run('t1', 'flaky')], {
      historyLimit: 2,
      runAt: '2026-01-01T00:00:00.000Z',
    });
    history = updateFlakyHistory(history, [run('t1', 'expected')], {
      historyLimit: 2,
      runAt: '2026-01-02T00:00:00.000Z',
    });
    history = updateFlakyHistory(history, [run('t1', 'expected')], {
      historyLimit: 2,
      runAt: '2026-01-03T00:00:00.000Z',
    });

    // Capped at 2 - the oldest ('flaky', day 1) has aged out, not the newest.
    expect(history['t1'].runs).toEqual([
      { at: '2026-01-02T00:00:00.000Z', outcome: 'expected' },
      { at: '2026-01-03T00:00:00.000Z', outcome: 'expected' },
    ]);
  });

  test('a test not present in this run keeps its prior history untouched', () => {
    let history: FlakyHistory = {};
    history = updateFlakyHistory(history, [run('t1', 'flaky')], {
      historyLimit: 20,
      runAt: '2026-01-01T00:00:00.000Z',
    });
    // Only t2 ran this time (e.g. --grep narrowed the suite) - t1's history must survive.
    history = updateFlakyHistory(history, [run('t2', 'expected')], {
      historyLimit: 20,
      runAt: '2026-01-02T00:00:00.000Z',
    });

    expect(history['t1'].runs).toHaveLength(1);
    expect(history['t2'].runs).toHaveLength(1);
  });

  test('findQuarantineCandidates requires both the threshold and the minimum run count', () => {
    const history: FlakyHistory = {
      // 1/2 troubled = 50%, well over threshold, but only 2 tracked runs - too few to flag.
      tooFewRuns: {
        title: 'too few runs',
        file: 'x.spec.ts',
        runs: [
          { at: '1', outcome: 'flaky' },
          { at: '2', outcome: 'expected' },
        ],
      },
      // 1/5 troubled = 20%, at the threshold, enough runs - flagged.
      atThreshold: {
        title: 'at threshold',
        file: 'x.spec.ts',
        runs: [
          { at: '1', outcome: 'unexpected' },
          { at: '2', outcome: 'expected' },
          { at: '3', outcome: 'expected' },
          { at: '4', outcome: 'expected' },
          { at: '5', outcome: 'expected' },
        ],
      },
      // 0/5 troubled - never flagged regardless of run count.
      reliable: {
        title: 'always passes',
        file: 'x.spec.ts',
        runs: Array.from({ length: 5 }, (_, i) => ({
          at: String(i),
          outcome: 'expected' as const,
        })),
      },
    };

    const candidates = findQuarantineCandidates(history, {
      quarantineThreshold: 0.2,
      minRuns: 3,
    });

    expect(candidates.map((c) => c.id)).toEqual(['atThreshold']);
    expect(candidates[0].troubledRuns).toBe(1);
    expect(candidates[0].totalRuns).toBe(5);
  });

  test('findQuarantineCandidates sorts worst-first', () => {
    const history: FlakyHistory = {
      mild: {
        title: 'mild',
        file: 'x.spec.ts',
        runs: [
          { at: '1', outcome: 'unexpected' },
          { at: '2', outcome: 'expected' },
          { at: '3', outcome: 'expected' },
          { at: '4', outcome: 'expected' },
        ],
      },
      severe: {
        title: 'severe',
        file: 'x.spec.ts',
        runs: [
          { at: '1', outcome: 'unexpected' },
          { at: '2', outcome: 'flaky' },
          { at: '3', outcome: 'unexpected' },
          { at: '4', outcome: 'expected' },
        ],
      },
    };

    const candidates = findQuarantineCandidates(history, { quarantineThreshold: 0.1, minRuns: 1 });
    expect(candidates.map((c) => c.id)).toEqual(['severe', 'mild']);
  });
});
