import { describe, expect, it } from 'vitest';
import { BlockedError } from '../src/errors';
import { cleanup, maybeStartNext, plan, startRun, tick } from '../src/orchestrator';
import { setup } from './helpers';

const H = 3_600_000;
const MIN = 60_000;

describe('orchestrator', () => {
  it('startRun uploads the add SBOM and saves an ADDED run due in 8h', async () => {
    const { deps, store, uploader } = setup();
    const run = await startRun(deps);
    expect(uploader.uploads).toEqual([{ phase: 'add', components: ['log4j-core', 'slf4j-api'] }]);
    expect(store.get(run.runId)).toMatchObject({ state: 'ADDED', vulnIds: ['CVE-2021-44228'] });
    expect(new Date(run.nextCheckAt).getTime() - new Date(run.addedAt).getTime()).toBe(8 * H);
  });

  it('rejects a component Black Duck lists no vulnerabilities for', async () => {
    const { deps, bd } = setup();
    bd.vulns = [];
    await expect(startRun(deps)).rejects.toThrow(/no vulnerabilities/);
  });

  it('moves ADDED to WAITING_ADD_SYNC only once due', async () => {
    const { deps, store, advance } = setup();
    const run = await startRun(deps);
    await tick(deps);
    expect(store.get(run.runId)!.state).toBe('ADDED');
    advance(8 * H);
    await tick(deps);
    expect(store.get(run.runId)!.state).toBe('WAITING_ADD_SYNC');
  });

  it('removes through a replace scan, and a repeated tick is harmless', async () => {
    const { deps, store, uploader, advance } = setup();
    const run = await startRun(deps);
    store.transition(run.runId, 'ADD_VERIFIED');
    await tick(deps); // uploads remove SBOM
    expect(store.get(run.runId)!.state).toBe('REMOVING');
    advance(5 * MIN);
    await tick(deps); // BOM confirms removal
    const r = store.get(run.runId)!;
    expect(r).toMatchObject({ state: 'REMOVED', removalMethod: 'scan_replace' });
    expect(new Date(r.nextCheckAt).getTime() - new Date(r.removedAt!).getTime()).toBe(8 * H);
    await tick(deps);
    expect(uploader.uploads.filter((u) => u.phase === 'remove')).toHaveLength(1);
  });

  it('falls back to unmap when the replace scan is ignored', async () => {
    const { deps, store, bd, uploader, advance } = setup();
    uploader.ignoreRemove = true;
    const run = await startRun(deps);
    store.transition(run.runId, 'ADD_VERIFIED');
    await tick(deps);
    advance(30 * MIN);
    await tick(deps);
    expect(bd.unmapCalls).toBe(0);
    advance(31 * MIN);
    await tick(deps); // past the 60 min fallback -> unmap
    expect(bd.unmapCalls).toBe(1);
    await tick(deps);
    expect(store.get(run.runId)).toMatchObject({ state: 'REMOVED', removalMethod: 'scan_unmap' });
  });

  it('marks REMOVAL_BLOCKED on 401/403 and keeps the add result', async () => {
    const { deps, store, uploader } = setup();
    const run = await startRun(deps);
    store.transition(run.runId, 'ADD_VERIFIED', { addResult: 'PASS' });
    uploader.upload = async () => {
      throw new BlockedError(403);
    };
    await tick(deps);
    expect(store.get(run.runId)).toMatchObject({
      state: 'REMOVAL_BLOCKED',
      removeResult: 'BLOCKED',
      addResult: 'PASS',
    });
  });

  it('cleanup flags runs with no progress for 24h', async () => {
    const { deps, advance } = setup();
    const run = await startRun(deps);
    advance(25 * H);
    expect((await cleanup(deps)).stuck).toEqual([run.runId]);
  });

  it('tries the next candidate when Black Duck lists no vulnerabilities for the first', async () => {
    const { deps, bd, uploader, cfg } = setup();
    const [first, second] = cfg.components;
    bd.vulnsByName = { [first.name]: [], [second.name]: ['CVE-2015-7501'] };
    const run = await startRun(deps);
    expect(run.componentName).toBe(second.name);
    expect(run.vulnIds).toEqual(['CVE-2015-7501']);
    expect(uploader.uploads.map((u) => u.components[0])).toEqual([first.name, second.name]);
  });

  it('starts the next cycle only after the latest run passed and nothing is in flight', async () => {
    const { deps, store, advance } = setup();
    expect(await maybeStartNext(deps)).toBeUndefined(); // the first run is started explicitly
    const run = await startRun(deps);
    advance(60_000);
    expect(await maybeStartNext(deps)).toBeUndefined(); // still in flight
    store.transition(run.runId, 'ADD_TIMEOUT');
    expect(await maybeStartNext(deps)).toBeUndefined(); // a failed run stops the loop
    store.transition(run.runId, 'REMOVE_VERIFIED');
    const next = await maybeStartNext(deps);
    expect(next?.runId).not.toBe(run.runId);
    expect(store.all()).toHaveLength(2);
  });

  it('does not loop when the cycle mode is scheduled', async () => {
    const { deps, store } = setup();
    const run = await startRun(deps);
    store.transition(run.runId, 'REMOVE_VERIFIED');
    const scheduled = { ...deps, cfg: { ...deps.cfg, cycle: { mode: 'scheduled' as const } } };
    expect(await maybeStartNext(scheduled)).toBeUndefined();
  });

  it('plans no work until something is due, so an idle tick can skip everything', async () => {
    const { deps, store, cfg, advance } = setup();
    expect(plan(store, cfg, deps.now!()).work).toBe(false); // empty store
    const run = await startRun(deps);
    expect(plan(store, cfg, deps.now!())).toMatchObject({
      blackDuck: false,
      svm: false,
      work: false,
    });
    advance(8 * 3_600_000);
    expect(plan(store, cfg, deps.now!())).toMatchObject({ blackDuck: true, svm: true });
    store.transition(run.runId, 'REMOVING');
    expect(plan(store, cfg, deps.now!())).toMatchObject({ blackDuck: true, svm: false });
    store.transition(run.runId, 'REMOVE_VERIFIED');
    expect(plan(store, cfg, deps.now!())).toMatchObject({ blackDuck: true, notify: true }); // next cycle + notify
  });

  it('can probe SVM earlier than the 8 hour wait without moving the timeout deadline', async () => {
    const { deps, cfg, store, advance } = setup();
    const early = {
      ...deps,
      cfg: { ...cfg, timing: { ...cfg.timing, first_check_after_hours: 6 } },
    };
    const run = await startRun(early);
    expect(new Date(run.nextCheckAt).getTime() - new Date(run.addedAt).getTime()).toBe(
      6 * 3_600_000,
    );
    advance(6 * 3_600_000);
    store.recordMiss(run.runId, 'add', early.cfg.timing); // early miss: just retried
    expect(store.get(run.runId)!.state).toBe('ADDED');
  });
});
