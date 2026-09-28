import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Turns Playwright's own per-run retry data into a run-level (and, optionally, cross-run) flaky
 * test report - a different question from `HealthReporter`'s (self-healing *locators*, not
 * inconsistent *tests*). See docs/flaky-tests.md.
 *
 * Playwright already knows when a test needed a retry to pass - `TestCase.outcome()` returns
 * `'flaky'` for exactly that case - but that information only exists for the length of one run's
 * console output, and only if `retries` is configured at all. This reporter aggregates it into a
 * clear summary every run, and - given `historyFile` - persists it across runs so a test that's
 * inconsistent over time shows up even on a run with no failures of its own (and even with
 * `retries: 0`, where Playwright's own single-run `'flaky'` outcome never fires at all).
 *
 * ```ts
 * // playwright.config.ts
 * reporter: [['list'], ['playwright-sapui5/reporter/flaky-tests', { historyFile: '.pw-sapui5/flaky-history.json' }]],
 * ```
 *
 * Reports, deliberately, rather than quarantining anything itself - it has no mechanism to skip a
 * test (that's a decision this framework leaves to you, via your own `test.skip()`/`--grep-invert`
 * once you've seen the list), and `failOnQuarantineCandidate` is opt-in and off by default.
 */
export interface FlakyTestReporterOptions {
  /** Persist pass/flaky/fail history across runs to this JSON file, and compute flakiness over
   * time from it - not just this one run. Without it, this reporter only reports outcomes
   * Playwright itself already computed for this run (which needs `retries` configured to ever
   * report anything, since a test that just fails outright - no retry to recover it - is a
   * regular failure, not what this reporter calls flaky). */
  historyFile?: string;
  /** How many of the most recent runs to retain per test in `historyFile`. Default 20. */
  historyLimit?: number;
  /** A test whose share of tracked runs that weren't a clean pass (`troubledRuns / totalRuns`) is
   * at least this is reported as a quarantine candidate. Default 0.2 (20%). Only meaningful
   * together with `historyFile`. */
  quarantineThreshold?: number;
  /** Minimum tracked runs before a test can be flagged as a quarantine candidate - avoids
   * flagging a test off a single bad run. Default 3. */
  minRunsForQuarantine?: number;
  /** Write the full report (this run's flaky tests, plus quarantine candidates if `historyFile`
   * is set) to this path as JSON. */
  outputFile?: string;
  /** Fail the whole run if any quarantine candidate was found. Off by default. Only escalates a
   * run that would otherwise report `'passed'` - see `HealthReporter`'s `failOnHeal` for why. */
  failOnQuarantineCandidate?: boolean;
}

export type FlakyOutcome = 'expected' | 'unexpected' | 'flaky';

export interface FlakyTestThisRun {
  id: string;
  title: string;
  file: string;
  outcome: FlakyOutcome;
  attempts: number;
}

export interface FlakyHistoryRun {
  at: string;
  outcome: FlakyOutcome;
}

export interface FlakyHistoryEntry {
  title: string;
  file: string;
  /** Oldest first, capped at `historyLimit`. */
  runs: FlakyHistoryRun[];
}

/** Keyed by `TestCase.id` - stable across runs for the same file/title/project. */
export type FlakyHistory = Record<string, FlakyHistoryEntry>;

export interface QuarantineCandidate {
  id: string;
  title: string;
  file: string;
  totalRuns: number;
  troubledRuns: number;
  flakinessRate: number;
}

/**
 * Folds this run's results into `history`, capping each test's retained runs at
 * `options.historyLimit`. Pure and deterministic (`options.runAt` stands in for "now") so it's
 * testable without a real Playwright run - see examples/tests/flaky-tests.spec.ts.
 */
export function updateFlakyHistory(
  history: FlakyHistory,
  thisRun: FlakyTestThisRun[],
  options: { historyLimit: number; runAt: string },
): FlakyHistory {
  const next: FlakyHistory = { ...history };
  for (const test of thisRun) {
    const entry = next[test.id] ?? { title: test.title, file: test.file, runs: [] };
    const runs = [...entry.runs, { at: options.runAt, outcome: test.outcome }];
    next[test.id] = {
      title: test.title,
      file: test.file,
      runs: runs.slice(-options.historyLimit),
    };
  }
  return next;
}

/**
 * Tests whose tracked history shows they don't reliably pass - `troubledRuns` (anything short of
 * a clean `'expected'` pass) at or above `options.quarantineThreshold` of tracked runs, once at
 * least `options.minRuns` runs have been tracked. Sorted worst-first.
 */
export function findQuarantineCandidates(
  history: FlakyHistory,
  options: { quarantineThreshold: number; minRuns: number },
): QuarantineCandidate[] {
  const candidates: QuarantineCandidate[] = [];
  for (const [id, entry] of Object.entries(history)) {
    if (entry.runs.length < options.minRuns) continue;
    const troubledRuns = entry.runs.filter((run) => run.outcome !== 'expected').length;
    const flakinessRate = troubledRuns / entry.runs.length;
    if (flakinessRate < options.quarantineThreshold) continue;
    candidates.push({
      id,
      title: entry.title,
      file: entry.file,
      totalRuns: entry.runs.length,
      troubledRuns,
      flakinessRate,
    });
  }
  return candidates.sort((a, b) => b.flakinessRate - a.flakinessRate);
}

export default class FlakyTestReporter implements Reporter {
  private readonly options: Required<
    Omit<FlakyTestReporterOptions, 'historyFile' | 'outputFile' | 'failOnQuarantineCandidate'>
  > &
    FlakyTestReporterOptions;
  private readonly perTest = new Map<string, FlakyTestThisRun>();

  constructor(options: FlakyTestReporterOptions = {}) {
    this.options = {
      historyLimit: options.historyLimit ?? 20,
      quarantineThreshold: options.quarantineThreshold ?? 0.2,
      minRunsForQuarantine: options.minRunsForQuarantine ?? 3,
      ...options,
    };
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const outcome = test.outcome();
    if (outcome === 'skipped') return;
    // Last write wins: onTestEnd fires once per attempt, and test.outcome() already reflects
    // every attempt so far - by the time the final attempt's call happens, it's the correct,
    // final classification, so simply overwriting on each call needs no extra bookkeeping.
    this.perTest.set(test.id, {
      id: test.id,
      title: test.titlePath().filter(Boolean).join(' › '),
      file: test.location.file,
      outcome,
      attempts: result.retry + 1,
    });
  }

  async onEnd(result: FullResult): Promise<{ status?: FullResult['status'] } | void> {
    const thisRun = [...this.perTest.values()];
    const flakyThisRun = thisRun.filter((t) => t.outcome === 'flaky');

    let quarantineCandidates: QuarantineCandidate[] = [];
    let history: FlakyHistory | undefined;
    if (this.options.historyFile) {
      history = this.readHistory(this.options.historyFile);
      history = updateFlakyHistory(history, thisRun, {
        historyLimit: this.options.historyLimit,
        runAt: new Date().toISOString(),
      });
      this.writeHistory(this.options.historyFile, history);
      quarantineCandidates = findQuarantineCandidates(history, {
        quarantineThreshold: this.options.quarantineThreshold,
        minRuns: this.options.minRunsForQuarantine,
      });
    }

    if (flakyThisRun.length > 0) {
      console.log('');
      console.log(
        `[playwright-sapui5] ${flakyThisRun.length} test(s) needed a retry to pass this run:`,
      );
      for (const test of flakyThisRun) {
        console.log(`  ${test.title}  (${test.attempts} attempts)`);
      }
    }
    if (quarantineCandidates.length > 0) {
      console.log('');
      console.log(
        `[playwright-sapui5] ${quarantineCandidates.length} quarantine candidate(s) - not reliably passing across tracked runs:`,
      );
      for (const candidate of quarantineCandidates) {
        console.log(
          `  ${candidate.title}  (${candidate.troubledRuns}/${candidate.totalRuns} troubled runs, ${Math.round(candidate.flakinessRate * 100)}%)`,
        );
      }
    }

    if (this.options.outputFile) {
      writeFileSync(
        this.options.outputFile,
        JSON.stringify({ flakyThisRun, quarantineCandidates }, null, 2),
        'utf-8',
      );
      console.log(`[playwright-sapui5] wrote flaky test report to ${this.options.outputFile}`);
    }

    if (
      this.options.failOnQuarantineCandidate &&
      quarantineCandidates.length > 0 &&
      result.status === 'passed'
    ) {
      // See HealthReporter's failOnHeal for why this return value, not process.exitCode, is what
      // actually changes the process exit code.
      return { status: 'failed' };
    }
  }

  private readHistory(path: string): FlakyHistory {
    if (!existsSync(path)) return {};
    try {
      return JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
      // A corrupt or hand-edited history file must never break the run - start fresh instead.
      return {};
    }
  }

  private writeHistory(path: string, history: FlakyHistory): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(history, null, 2), 'utf-8');
  }
}
