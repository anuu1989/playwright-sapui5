import { describe, expect, it } from 'vitest';
import { startRun } from '../src/orchestrator';
import { setup } from './helpers';

const H = 3_600_000;

describe('store.recordMiss', () => {
  it('retries every 30 min inside the window then times out', async () => {
    const { deps, store, cfg, advance } = setup();
    const run = await startRun(deps);
    advance(8 * H);
    store.recordMiss(run.runId, 'add', cfg.timing);
    expect(store.get(run.runId)!.nextCheckAt).toBe(
      new Date(Date.UTC(2026, 0, 1, 8, 30)).toISOString(),
    );
    advance(2 * H); // 10h after add: window closed
    store.recordMiss(run.runId, 'add', cfg.timing);
    expect(store.get(run.runId)!.state).toBe('ADD_TIMEOUT');
    expect(store.get(run.runId)!.addResult).toBe('TIMEOUT');
  });
  it('recordError keeps state and does not count a miss', async () => {
    const { deps, store, cfg } = setup();
    const run = await startRun(deps);
    store.recordError(run.runId, 'add', 'boom', cfg.timing);
    const r = store.get(run.runId)!;
    expect(r.state).toBe('ADDED');
    expect(r.attempts).toBe(0);
    expect(r.addResult).toBe('ERROR');
  });
});
