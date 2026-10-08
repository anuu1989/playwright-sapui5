import type { BdApi } from './bd-client';
import type { Settings } from './config';
import { BlockedError } from './errors';
import { buildAddSbom, buildRemoveSbom, type SbomInput } from './sbom-builder';
import type { ScanUploader } from './scan-uploader';
import type { RunStore } from './store';
import { FINAL_STATES, type RunRow } from './types';

const MIN = 60_000;
const HOUR = 3_600_000;

export interface Deps {
  bd: BdApi;
  uploader: ScanUploader;
  store: RunStore;
  cfg: Settings;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

const nowOf = (d: Deps) => (d.now ?? (() => new Date()))();
const iso = (ms: number) => new Date(ms).toISOString();

function runId(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}`;
  return `e2e-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

function sbomInput(run: RunRow, cfg: Settings): SbomInput {
  const vulnerable = cfg.components.find((c) => c.name === run.componentName) ?? cfg.components[0];
  return {
    runId: run.runId,
    projectName: run.projectName,
    vulnerable,
    control: cfg.control_component,
  };
}

const hasComponent = (comps: { name: string; version: string }[], name: string, version: string) =>
  comps.some((c) => c.name === name && c.version === version);

/** Start: upload the add SBOM, wait for the BOM, confirm component + a vulnerability, save as ADDED. */
export async function startRun(d: Deps): Promise<RunRow> {
  const log = d.log ?? console.log;
  const sleep = d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const { cfg } = d;
  const vulnerable = cfg.components[0];
  const id = runId(nowOf(d));
  const versionName =
    cfg.blackduck.version_strategy === 'per_run' ? id : cfg.blackduck.shared_version;

  const pv = await d.bd.ensureVersion(cfg.blackduck.project, versionName);
  const input: SbomInput = {
    runId: id,
    projectName: cfg.blackduck.project,
    vulnerable,
    control: cfg.control_component,
  };
  await d.uploader.upload({
    sbom: buildAddSbom(input),
    codeLocation: id,
    projectName: cfg.blackduck.project,
    versionName,
  });
  log(`[${id}] add SBOM uploaded`);

  const deadline = nowOf(d).getTime() + cfg.timing.bom_ready_timeout_minutes * MIN;
  for (;;) {
    const comps = await d.bd.getBomComponents(pv);
    if (
      hasComponent(comps, vulnerable.name, vulnerable.version) &&
      hasComponent(comps, cfg.control_component.name, cfg.control_component.version)
    )
      break;
    if (nowOf(d).getTime() >= deadline)
      throw new Error(`[${id}] BOM not ready within ${cfg.timing.bom_ready_timeout_minutes} min`);
    await sleep(30_000);
  }
  const vulnIds = await d.bd.getComponentVulns(pv, vulnerable.name, vulnerable.version);
  if (vulnIds.length === 0) {
    throw new Error(
      `[${id}] Black Duck lists no vulnerabilities for ${vulnerable.name}@${vulnerable.version}; pick another component`,
    );
  }
  const cl = await d.bd.findCodeLocation(id);

  const now = nowOf(d);
  const row: RunRow = {
    runId: id,
    state: 'ADDED',
    removalMethod: 'none',
    projectId: pv.projectId,
    projectName: cfg.blackduck.project,
    versionId: pv.versionId,
    versionName,
    codeLocationId: cl?.id,
    componentName: vulnerable.name,
    componentVersion: vulnerable.version,
    vulnIds,
    controlComponent: cfg.control_component.name,
    controlVersion: cfg.control_component.version,
    addedAt: now.toISOString(),
    nextCheckAt: iso(now.getTime() + cfg.timing.sync_wait_hours * HOUR),
    attempts: 0,
    evidence: {},
    updatedAt: now.toISOString(),
  };
  d.store.insert(row);
  log(`[${id}] ADDED, ${vulnIds.length} vulnerabilities, first SVM check at ${row.nextCheckAt}`);
  return row;
}

/** Black Duck side of one hourly tick. Every handler re-reads Black Duck first, so repeats are safe. */
export async function tick(d: Deps): Promise<void> {
  const log = d.log ?? console.log;
  const now = nowOf(d);

  for (const run of d.store.dueRuns(['ADDED'], now)) {
    d.store.transition(run.runId, 'WAITING_ADD_SYNC', { nextCheckAt: now.toISOString() });
    log(`[${run.runId}] ADDED -> WAITING_ADD_SYNC`);
  }
  for (const run of d.store
    .all()
    .filter((r) => r.state === 'ADD_VERIFIED' || r.state === 'REMOVING')) {
    try {
      await removeStep(d, run);
    } catch (err) {
      if (err instanceof BlockedError) {
        d.store.transition(run.runId, 'REMOVAL_BLOCKED', {
          removeResult: 'BLOCKED',
          evidence: { ...run.evidence, blocked: err.message },
        });
        log(`[${run.runId}] removal BLOCKED (${err.status})`);
      } else {
        // Infrastructure trouble: leave the state alone, the next tick retries.
        d.store.addEvidence(run.runId, { lastError: (err as Error).message });
        log(`[${run.runId}] removal step error: ${(err as Error).message}`);
      }
    }
  }
}

/** ADD_VERIFIED: upload the remove SBOM. REMOVING: confirm the BOM dropped it, else unmap after the fallback delay. */
export async function removeStep(d: Deps, run: RunRow): Promise<void> {
  const log = d.log ?? console.log;
  const { cfg } = d;
  const pv = { projectId: run.projectId, versionId: run.versionId };
  const now = nowOf(d);
  const gone = async () => {
    const comps = await d.bd.getBomComponents(pv);
    return (
      !hasComponent(comps, run.componentName, run.componentVersion) &&
      comps.some((c) => c.name === run.controlComponent)
    );
  };
  const markRemoved = (method: RunRow['removalMethod']) => {
    d.store.transition(run.runId, 'REMOVED', {
      removalMethod: method,
      removedAt: now.toISOString(),
      nextCheckAt: iso(now.getTime() + cfg.timing.sync_wait_hours * HOUR),
    });
    log(`[${run.runId}] REMOVED via ${method}, first SVM check at +${cfg.timing.sync_wait_hours}h`);
  };

  if (run.state === 'ADD_VERIFIED') {
    if (!(await gone())) {
      await d.uploader.upload({
        sbom: buildRemoveSbom(sbomInput(run, cfg)),
        codeLocation: run.runId,
        projectName: run.projectName,
        versionName: run.versionName,
      });
      log(`[${run.runId}] remove SBOM uploaded`);
    }
    d.store.transition(run.runId, 'REMOVING', {
      removalMethod: 'scan_replace',
      removeUploadedAt: now.toISOString(),
    });
    // Black Duck needs a few minutes to process; the BOM is checked from the next tick.
    return;
  }

  // REMOVING
  if (await gone())
    return markRemoved(run.removalMethod === 'none' ? 'scan_replace' : run.removalMethod);
  const uploadedAt = new Date(run.removeUploadedAt ?? run.addedAt).getTime();
  if (
    run.removalMethod === 'scan_replace' &&
    now.getTime() - uploadedAt >= cfg.timing.removal_fallback_after_minutes * MIN
  ) {
    const cl = await d.bd.findCodeLocation(run.runId);
    if (cl?.mapped) await d.bd.unmapCodeLocation(cl.id);
    d.store.update(run.runId, { removalMethod: 'scan_unmap', removeUploadedAt: now.toISOString() });
    log(`[${run.runId}] replace scan did not remove the component; unmapped code location (A2)`);
  }
}

/** Flag runs with no progress for stuck_after_hours and unmap leftovers of finished runs. */
export async function cleanup(d: Deps): Promise<{ stuck: string[]; unmapped: string[] }> {
  const log = d.log ?? console.log;
  const now = nowOf(d).getTime();
  const stuck: string[] = [];
  const unmapped: string[] = [];
  for (const run of d.store.all()) {
    const final = FINAL_STATES.includes(run.state);
    if (!final && now - new Date(run.updatedAt).getTime() > d.cfg.timing.stuck_after_hours * HOUR) {
      stuck.push(run.runId);
      log(`[${run.runId}] STUCK in ${run.state} since ${run.updatedAt}`);
    }
    if (final && run.state !== 'REMOVE_VERIFIED' && run.state !== 'REMOVAL_BLOCKED') {
      const cl = await d.bd.findCodeLocation(run.runId).catch(() => undefined);
      if (cl?.mapped) {
        await d.bd.unmapCodeLocation(cl.id);
        unmapped.push(run.runId);
        log(`[${run.runId}] unmapped leftover code location`);
      }
    }
  }
  return { stuck, unmapped };
}
