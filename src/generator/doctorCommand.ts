import type { Page } from '@playwright/test';
import { Ui5Performance } from '../core/Ui5Performance';
import { Ui5Messages } from '../core/Ui5Messages';

/**
 * The logic behind `pw-sapui5 doctor` (see `src/generator/cli.ts` for the CLI command that calls
 * `runDoctor()` below). Kept separate from the CLI file for the same reason `initCommand.ts` is -
 * it's plain, testable logic with no `console.log` formatting mixed in, given a `Page` someone
 * else already launched.
 *
 * The point of this command: everything it checks already exists as a library call
 * (`Ui5Performance`, `Ui5Messages`) that you'd otherwise have to write into a throwaway test just
 * to sanity-check an environment before running the real suite against it - "did this app even
 * come up cleanly?" This wraps the same three checks as a zero-code CLI gate, so a CI pipeline (or
 * a person, before filing a bug) can ask that question in one command instead of writing one.
 */

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorReport {
  url: string;
  ok: boolean;
  checks: DoctorCheck[];
  /** `undefined` only when the app never bootstrapped far enough to measure. */
  timings?: { navigationMs: number; coreReadyMs: number; settledMs: number };
  controlCount?: number;
}

export interface DoctorOptions {
  /** Navigation / ready timeout in milliseconds. Default 30000. */
  timeout?: number;
  /** Fail the "startup budget" check if the app takes longer than this to settle. Default 15000. */
  budgetMs?: number;
}

/**
 * Navigates `page` to `url` and runs three checks: does the app bootstrap at all, does it render
 * any controls, and does it settle within budget - then, separately, whether SAPUI5's own central
 * message model picked up any errors along the way (an OData failure the UI never displays is
 * exactly the kind of thing this catches that a screenshot wouldn't).
 *
 * Each check is independent and never throws past this function - a failure in one (the app never
 * bootstraps, say) is recorded as a failed check rather than an exception, so the caller always
 * gets a complete report to print, and a bad app can't crash the CLI instead of just failing it.
 */
export async function runDoctor(
  page: Page,
  url: string,
  options: DoctorOptions = {},
): Promise<DoctorReport> {
  const timeout = options.timeout ?? 30000;
  const budgetMs = options.budgetMs ?? 15000;
  const checks: DoctorCheck[] = [];
  let timings: DoctorReport['timings'];
  let controlCount: number | undefined;

  try {
    // measureBootstrap() does its own navigation and its own bridge install - see
    // docs/performance.md. It only throws if the app never reaches "SAPUI5 core ready" at all;
    // "core ready but never fully settles" is swallowed internally and still returns real numbers,
    // which is exactly the distinction the two checks below need to make separately.
    const bootstrap = await Ui5Performance.measureBootstrap(page, url, { timeout });
    timings = {
      navigationMs: bootstrap.navigationMs,
      coreReadyMs: bootstrap.coreReadyMs,
      settledMs: bootstrap.settledMs,
    };
    controlCount = bootstrap.metrics.controlCount;

    checks.push({
      name: 'bootstraps',
      ok: true,
      detail: `SAPUI5 core ready after ${bootstrap.coreReadyMs}ms`,
    });
    checks.push({
      name: 'renders controls',
      ok: (controlCount ?? 0) > 0,
      detail:
        (controlCount ?? 0) > 0
          ? `${controlCount} controls rendered`
          : 'no controls found - the app may not have finished booting, or nothing matched a real view',
    });
    checks.push({
      name: 'startup budget',
      ok: bootstrap.settledMs <= budgetMs,
      detail: `settled after ${bootstrap.settledMs}ms (budget ${budgetMs}ms)`,
    });
  } catch (error) {
    checks.push({
      name: 'bootstraps',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    // Reads whatever is in the model right now, whether or not the bootstrap checks above
    // succeeded - a message can be worth reporting even from a page that only half-loaded.
    const errors = await Ui5Messages.errors(page);
    checks.push({
      name: 'no message-model errors',
      ok: errors.length === 0,
      detail:
        errors.length === 0
          ? 'none'
          : errors.map((error) => error.message ?? '(no message text)').join('; '),
    });
  } catch (error) {
    // The SAPUI5 runtime never came up far enough to have a message model at all - already
    // covered by the failed "bootstraps" check above, so this isn't reported as a second failure,
    // just noted.
    checks.push({
      name: 'no message-model errors',
      ok: true,
      detail: `skipped: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  return { url, ok: checks.every((check) => check.ok), checks, timings, controlCount };
}
