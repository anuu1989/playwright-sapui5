import { afterEach, describe, expect, it } from 'vitest';
import { BdClient } from '../src/bd-client';
import { startMock, type MockHandle } from '../mock/server';
import { startRun, tick } from '../src/orchestrator';
import { ApiScanUploader } from '../src/scan-uploader';
import { setup } from './helpers';

let mock: MockHandle | undefined;
afterEach(async () => mock?.close());

/** Real BdClient + ApiScanUploader over HTTP against the mock; only the clock and store are test doubles. */
async function harness(opts: Parameters<typeof startMock>[0] = {}) {
  mock = await startMock(opts);
  const base = setup();
  const bd = new BdClient(mock.url, 'token');
  const uploader = new ApiScanUploader(bd, base.cfg.blackduck.sbom_upload_path);
  const cfg = { ...base.cfg, timing: { ...base.cfg.timing, removal_fallback_after_minutes: 60 } };
  return {
    ...base,
    cfg,
    bd,
    deps: { ...base.deps, bd, uploader, cfg, now: () => new Date(base.clock.t) },
    mock,
  };
}

describe('against the mock Black Duck/SVM', () => {
  it('adds, then removes through a replace scan', async () => {
    const h = await harness();
    const run = await startRun(h.deps);
    expect(run.vulnIds).toEqual(['CVE-2021-44228']);
    h.store.transition(run.runId, 'ADD_VERIFIED');
    await tick(h.deps);
    await tick(h.deps);
    expect(h.store.get(run.runId)).toMatchObject({
      state: 'REMOVED',
      removalMethod: 'scan_replace',
    });
    expect(
      (await h.bd.getBomComponents({ projectId: run.projectId, versionId: run.versionId })).map(
        (c) => c.name,
      ),
    ).toEqual(['slf4j-api']);
  });

  it('falls back to unmap when the replace scan is ignored', async () => {
    const h = await harness({ ignoreReplace: true });
    const run = await startRun(h.deps);
    h.store.transition(run.runId, 'ADD_VERIFIED');
    await tick(h.deps);
    h.advance(61 * 60_000);
    await tick(h.deps); // fallback unmap
    await tick(h.deps);
    expect(h.store.get(run.runId)).toMatchObject({ state: 'REMOVED', removalMethod: 'scan_unmap' });
  });

  it('turns a 403 on the remove upload into REMOVAL_BLOCKED', async () => {
    const h = await harness({ blockRemoval: true });
    const run = await startRun(h.deps);
    h.store.transition(run.runId, 'ADD_VERIFIED');
    await tick(h.deps);
    expect(h.store.get(run.runId)).toMatchObject({
      state: 'REMOVAL_BLOCKED',
      removeResult: 'BLOCKED',
    });
  });

  it('rejects a bad API token as BLOCKED', async () => {
    mock = await startMock();
    const bad = new BdClient(mock.url, 'x', (u, i) =>
      fetch(u, { ...i, headers: { ...i?.headers, Authorization: 'nope' } }),
    );
    await expect(bad.ensureVersion('svm-e2e-sync', 'v')).rejects.toMatchObject({
      name: 'BlockedError',
    });
  });
});
