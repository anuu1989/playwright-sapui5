/**
 * Phase 0 spike: checks every assumption this package makes against YOUR Black Duck and SVM, using
 * your own tokens, and writes a pass/fail report. Run it before the first real run:
 *
 *   BD_URL=... BD_API_TOKEN=... SVM_API_URL=... SVM_API_TOKEN=... SVM_UI_URL=... npm run spike
 *
 * It only touches the test project: it creates a version and code location named e2e-spike-<time>,
 * uploads two SBOMs to it, then unmaps the code location again. Add --no-svm to skip the SVM checks
 * and --keep to leave the code location mapped.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BdClient } from '../src/bd-client';
import { loadSettings, PACKAGE_ROOT, requireEnv } from '../src/config';
import { BlockedError } from '../src/errors';
import { buildAddSbom, buildRemoveSbom } from '../src/sbom-builder';
import { ApiScanUploader } from '../src/scan-uploader';

type Status = 'PASS' | 'FAIL' | 'SKIP' | 'INFO';
const rows: { step: string; status: Status; detail: string }[] = [];
const args = process.argv.slice(2);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function step<T>(
  name: string,
  fn: () => Promise<{ detail: string; value?: T; status?: Status }>,
) {
  try {
    const r = await fn();
    rows.push({ step: name, status: r.status ?? 'PASS', detail: r.detail });
    console.log(`${(r.status ?? 'PASS').padEnd(4)}  ${name}: ${r.detail}`);
    return r.value;
  } catch (err) {
    const detail =
      err instanceof BlockedError
        ? `denied (${err.status}) - ${err.message}`
        : (err as Error).message;
    rows.push({ step: name, status: 'FAIL', detail });
    console.log(`FAIL  ${name}: ${detail}`);
    return undefined;
  }
}

async function until(check: () => Promise<boolean>, timeoutMs: number, everyMs = 15_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return true;
    if (Date.now() >= end) return false;
    await sleep(everyMs);
  }
}

async function main() {
  const cfg = loadSettings();
  const bd = new BdClient(cfg.blackduck.url, requireEnv('BD_API_TOKEN'));
  const uploader = new ApiScanUploader(
    bd,
    cfg.blackduck.sbom_upload_path,
    cfg.blackduck.sbom_content_type,
  );
  const id = `e2e-spike-${new Date().toISOString().replace(/\D/g, '').slice(0, 12)}`;
  const vulnerable = cfg.components[0];
  const sbomInput = {
    runId: id,
    projectName: cfg.blackduck.project,
    vulnerable,
    control: cfg.control_component,
  };
  console.log(
    `Black Duck ${cfg.blackduck.url}, project ${cfg.blackduck.project}, spike id ${id}\n`,
  );

  await step('Black Duck: authenticate', async () => {
    await bd.bearer();
    return { detail: 'API token exchanged for a bearer token' };
  });
  const pv = await step('Black Duck: test project and version', async () => {
    const v = await bd.ensureVersion(cfg.blackduck.project, id);
    return { detail: `project ${v.projectId}, version ${v.versionId} created`, value: v };
  });
  if (!pv) return finish();

  const uploaded = await step('Upload add SBOM (scan upload only)', async () => {
    await uploader.upload({
      sbom: buildAddSbom(sbomInput),
      codeLocation: id,
      projectName: cfg.blackduck.project,
      versionName: id,
    });
    return {
      detail: `${cfg.blackduck.sbom_upload_path} accepted ${cfg.blackduck.sbom_content_type}`,
      value: true,
    };
  });

  if (uploaded) {
    await step('BOM built with the vulnerable component and the control', async () => {
      let comps: { name: string; version: string }[] = [];
      const ok = await until(async () => {
        comps = await bd.getBomComponents(pv);
        return (
          comps.some((c) => c.name === vulnerable.name) &&
          comps.some((c) => c.name === cfg.control_component.name)
        );
      }, cfg.timing.bom_ready_timeout_minutes * 60_000);
      if (!ok)
        throw new Error(
          `not in the BOM within ${cfg.timing.bom_ready_timeout_minutes} min; BOM has: ${comps.map((c) => `${c.name}@${c.version}`).join(', ') || 'nothing'}`,
        );
      const match = comps.find((c) => c.name === vulnerable.name);
      return {
        detail: `found ${match?.name}@${match?.version} (expected version ${vulnerable.version})`,
        status: match?.version === vulnerable.version ? 'PASS' : 'FAIL',
      };
    });
    await step('Vulnerabilities listed for the vulnerable component', async () => {
      const v = await bd.getComponentVulns(pv, vulnerable.name, vulnerable.version);
      if (v.length === 0)
        throw new Error(
          `none for ${vulnerable.name}@${vulnerable.version} - pick another component in settings.yaml`,
        );
      return { detail: `${v.length}: ${v.slice(0, 5).join(', ')}` };
    });
    const cl = await step('Code location visible and mapped to the version', async () => {
      const c = await bd.findCodeLocation(id);
      if (!c) throw new Error(`code location ${id} not found`);
      return { detail: `id ${c.id}, mapped=${c.mapped}`, value: c };
    });

    const replaced = await step(
      'Replace scan removes the component (scan rights only)',
      async () => {
        await uploader.upload({
          sbom: buildRemoveSbom(sbomInput),
          codeLocation: id,
          projectName: cfg.blackduck.project,
          versionName: id,
        });
        const wait = cfg.timing.removal_fallback_after_minutes;
        const gone = await until(
          async () => !(await bd.getBomComponents(pv)).some((c) => c.name === vulnerable.name),
          wait * 60_000,
        );
        if (!gone)
          throw new Error(
            `still in the BOM ${wait} min after the replacement scan - duplicate detection or a minimum scan interval may be on; ask the admin`,
          );
        const control = (await bd.getBomComponents(pv)).some(
          (c) => c.name === cfg.control_component.name,
        );
        return {
          detail: `component gone; control ${control ? 'still present' : 'also gone'}`,
          value: true,
          status: control ? 'PASS' : 'FAIL',
        };
      },
    );

    if (cl) {
      await step('Unmap code location (fallback A2) allowed for this account', async () => {
        if (args.includes('--keep')) return { detail: 'skipped (--keep)', status: 'SKIP' };
        await bd.unmapCodeLocation(cl.id);
        const after = await bd.findCodeLocation(id);
        return {
          detail: `unmap call accepted; mapped=${after?.mapped}${replaced ? '' : ' (replace scan had failed, so this is the fallback)'}`,
          status: after?.mapped ? 'FAIL' : 'PASS',
        };
      });
    }
  }

  if (args.includes('--no-svm')) {
    rows.push({ step: 'SVM checks', status: 'SKIP', detail: '--no-svm' });
  } else {
    await step('SVM API: components endpoint reachable and in the expected shape', async () => {
      const { getAssetComponents } = await import('../verify/svm-api');
      const { request } = await import('@playwright/test');
      const ctx = await request.newContext();
      try {
        const comps = await getAssetComponents(ctx, cfg, {
          runId: id,
          projectName: cfg.blackduck.project,
          component: vulnerable.name,
          version: vulnerable.version,
          control: cfg.control_component.name,
          controlVersion: cfg.control_component.version,
          vulnIds: [],
          expectControl: true,
        });
        return {
          detail: `${comps.length} component(s) for ${cfg.blackduck.project}; first: ${comps[0] ? `${comps[0].name}@${comps[0].version} [${comps[0].vulnIds.slice(0, 3).join(', ')}]` : 'none'}`,
        };
      } finally {
        await ctx.dispose();
      }
    });
    await step('SVM UI: asset page reachable', async () => {
      const url =
        cfg.svm.ui_url +
        cfg.svm.asset_ui_path.replace('{project}', encodeURIComponent(cfg.blackduck.project));
      const res = await fetch(url, { redirect: 'manual' });
      return {
        detail: `GET ${url} -> ${res.status} (a redirect to a login page is expected; use SVM_UI_STORAGE_STATE for signed-in checks)`,
        status: res.status >= 500 ? 'FAIL' : 'PASS',
      };
    });
    rows.push({
      step: 'SVM sync timing and removal semantics',
      status: 'INFO',
      detail: `Cannot be spiked in one sitting. Ask the SVM owner: is "${cfg.timing.sync_wait_hours}h" a maximum or typical, and does SVM drop a component that leaves the Black Duck BOM or mark it resolved?`,
    });
  }
  finish();
}

function finish() {
  const failed = rows.filter((r) => r.status === 'FAIL');
  const md = [
    '# Phase 0 spike report',
    '',
    `Run at ${new Date().toISOString()}`,
    '',
    '| Step | Result | Detail |',
    '| --- | --- | --- |',
    ...rows.map((r) => `| ${r.step} | ${r.status} | ${r.detail.replace(/\|/g, '\\|')} |`),
    '',
    failed.length
      ? `**${failed.length} step(s) failed.** Fix the matching setting or code (see docs/runbook.md, "Phase 0 spike") and rerun.`
      : '**All checked steps passed.** Record the exact API calls above, then decide between options A, A2 and B.',
    '',
  ].join('\n');
  const out = resolve(PACKAGE_ROOT, 'results/spike-report.md');
  mkdirSync(resolve(PACKAGE_ROOT, 'results'), { recursive: true });
  writeFileSync(out, md);
  console.log(`\nReport written to ${out}`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
