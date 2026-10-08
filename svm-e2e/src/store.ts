import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Timing } from './config';
import { FINAL_STATES, type ResultCode, type RunRow, type RunState } from './types';

const MIN = 60_000;
const HOUR = 3_600_000;

/**
 * e2e_runs table backed by a JSON file - fine for the single runner the plan starts with. The
 * interface is small so it can move to SQLite/Postgres later without touching callers. A file
 * store has no row locking: run the tick pipeline with concurrency 1.
 */
export class RunStore {
  constructor(
    private file: string,
    private now: () => Date = () => new Date(),
  ) {}

  private read(): RunRow[] {
    if (!existsSync(this.file)) return [];
    return JSON.parse(readFileSync(this.file, 'utf8')) as RunRow[];
  }

  private write(rows: RunRow[]): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(rows, null, 2));
    renameSync(tmp, this.file); // atomic: a crash never leaves a half-written file
  }

  all(): RunRow[] {
    return this.read();
  }

  get(runId: string): RunRow | undefined {
    return this.read().find((r) => r.runId === runId);
  }

  insert(row: RunRow): void {
    const rows = this.read();
    if (rows.some((r) => r.runId === row.runId)) throw new Error(`Run ${row.runId} already exists`);
    this.write([...rows, row]);
  }

  dueRuns(states: RunState[], at: Date = this.now()): RunRow[] {
    return this.read().filter(
      (r) => states.includes(r.state) && new Date(r.nextCheckAt).getTime() <= at.getTime(),
    );
  }

  update(runId: string, patch: Partial<RunRow>): RunRow {
    const rows = this.read();
    const i = rows.findIndex((r) => r.runId === runId);
    if (i < 0) throw new Error(`Unknown run ${runId}`);
    rows[i] = { ...rows[i], ...patch, updatedAt: this.now().toISOString() };
    this.write(rows);
    return rows[i];
  }

  /** Move to a new state; attempts restart because they count per state. */
  transition(runId: string, state: RunState, patch: Partial<RunRow> = {}): RunRow {
    return this.update(runId, { attempts: 0, ...patch, state });
  }

  /** Merge keys into the evidence blob. */
  addEvidence(runId: string, evidence: Record<string, unknown>): RunRow {
    const run = this.get(runId);
    if (!run) throw new Error(`Unknown run ${runId}`);
    return this.update(runId, { evidence: { ...run.evidence, ...evidence } });
  }

  /**
   * SVM did not show the change yet: check again in retry_every_minutes, or give up with a
   * TIMEOUT once the retry window (sync_wait + retry_window after the change) has closed.
   */
  recordMiss(runId: string, phase: 'add' | 'remove', timing: Timing): RunRow {
    const run = this.get(runId);
    if (!run) throw new Error(`Unknown run ${runId}`);
    const anchor = new Date(phase === 'add' ? run.addedAt : (run.removedAt ?? run.addedAt));
    const deadline = anchor.getTime() + (timing.sync_wait_hours + timing.retry_window_hours) * HOUR;
    const next = this.now().getTime() + timing.retry_every_minutes * MIN;
    if (next > deadline) {
      return phase === 'add'
        ? this.update(runId, { state: 'ADD_TIMEOUT', addResult: 'TIMEOUT' })
        : this.update(runId, { state: 'REMOVE_TIMEOUT', removeResult: 'TIMEOUT' });
    }
    return this.update(runId, {
      attempts: run.attempts + 1,
      nextCheckAt: new Date(next).toISOString(),
    });
  }

  /** Infrastructure problem: keep the state, retry later, never count it as a miss. */
  recordError(runId: string, phase: 'add' | 'remove', message: string, timing: Timing): RunRow {
    const run = this.get(runId);
    if (!run) throw new Error(`Unknown run ${runId}`);
    const result: Partial<RunRow> =
      phase === 'add' ? { addResult: 'ERROR' } : { removeResult: 'ERROR' };
    return this.update(runId, {
      ...result,
      nextCheckAt: new Date(this.now().getTime() + timing.retry_every_minutes * MIN).toISOString(),
      evidence: { ...run.evidence, lastError: message },
    });
  }

  finalUnnotified(): RunRow[] {
    return this.read().filter((r) => FINAL_STATES.includes(r.state) && !r.notified);
  }
}

export function overallResult(run: RunRow): ResultCode | 'PENDING' {
  if (!FINAL_STATES.includes(run.state)) return 'PENDING';
  const results = [run.addResult, run.removeResult];
  for (const code of ['FAIL', 'TIMEOUT', 'ERROR', 'BLOCKED'] as const) {
    if (results.includes(code)) return code;
  }
  return 'PASS';
}
