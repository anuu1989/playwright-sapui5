import { chromium, test, expect, type Browser } from '@playwright/test';
import { loadSettings, storePath } from '../src/config';
import { BlockedError, DataMismatchError, InfraError } from '../src/errors';
import { RunStore } from '../src/store';
import { getAssetComponents, type DueRun } from './svm-api';
import { SvmAssetPage } from './pages/svm-asset-page';

const cfg = loadSettings();

// One browser for every check in this file instead of one per run. It is launched lazily inside the
// UI step (not through the `page` fixture), so a launch failure is recorded as a UI FAIL instead of
// happening before the test body and stranding the run with no outcome.
let sharedBrowser: Promise<Browser> | undefined;
const getBrowser = () => {
  sharedBrowser ??= chromium.launch();
  sharedBrowser.catch(() => (sharedBrowser = undefined)); // retry the launch on the next check
  return sharedBrowser;
};

/**
 * One test per due run. The SVM API check and the SVM UI check must both pass (the UI check can be
 * made evidence-only with svm.ui_check_gates: false). Outcomes are written to the run store.
 */
export function registerChecks(phase: 'add' | 'remove', due: DueRun[]): void {
  test.afterAll(async () => {
    const browser = await sharedBrowser?.catch(() => undefined);
    sharedBrowser = undefined;
    await browser?.close();
  });
  const store = new RunStore(storePath());
  for (const run of due) {
    test(`SVM ${phase === 'add' ? 'shows added' : 'dropped removed'} component · ${run.runId}`, async ({
      request,
    }) => {
      try {
        await test.step('SVM API', async () => {
          const comps = await getAssetComponents(request, cfg, run);
          const hit = comps.find((c) => c.name === run.component && c.version === run.version);
          const control = comps.find((c) => c.name === run.control);
          if (phase === 'add') {
            expect(hit, 'component in SVM').toBeDefined();
            if (!hit!.vulnIds.some((id) => run.vulnIds.includes(id))) {
              throw new DataMismatchError(
                `SVM vulnerabilities [${hit!.vulnIds}] share nothing with Black Duck's [${run.vulnIds}]`,
              );
            }
          } else {
            expect(hit, 'component absent from SVM').toBeUndefined();
            // Absence alone could mean SVM lost the whole asset.
            if (run.expectControl && !control)
              throw new DataMismatchError('control component missing from SVM');
          }
        });

        const uiOk = await test.step('SVM UI', async () => {
          let context;
          try {
            context = await (
              await getBrowser()
            ).newContext({
              storageState: process.env.SVM_UI_STORAGE_STATE || undefined,
            });
            const page = await context.newPage();
            const asset = new SvmAssetPage(page, cfg);
            await asset.open(run.projectName);
            try {
              if (phase === 'add')
                await expect(asset.componentRow(run.component, run.version)).toBeVisible();
              else await expect(asset.componentRow(run.component, run.version)).toHaveCount(0);
              if (run.expectControl || phase === 'add') {
                await expect(asset.componentRow(run.control)).toBeVisible();
              }
              return true;
            } finally {
              await test.info().attach('svm-asset-page', {
                body: await page.screenshot({ fullPage: true }),
                contentType: 'image/png',
              });
            }
          } catch (err) {
            test.info().annotations.push({
              type: 'ui-check-failed',
              description: (err as Error).message.split('\n')[0],
            });
            return false;
          } finally {
            await context?.close();
          }
        });

        const seen = new Date().toISOString();
        store.addEvidence(run.runId, { [`${phase}Ui`]: uiOk ? 'PASS' : 'FAIL' });
        // Flowchart: the test passes only when the API check AND the UI check pass. A UI miss is
        // retried like any other miss; set svm.ui_check_gates: false to make the UI evidence only.
        if (!uiOk && cfg.svm.ui_check_gates) {
          throw new Error('SVM API check passed but the SVM UI check failed');
        }
        if (phase === 'add')
          store.transition(run.runId, 'ADD_VERIFIED', {
            addResult: 'PASS',
            svmAddSeenAt: seen,
            nextCheckAt: seen,
          });
        else
          store.transition(run.runId, 'REMOVE_VERIFIED', {
            removeResult: 'PASS',
            svmRemoveSeenAt: seen,
          });
      } catch (err) {
        if (err instanceof DataMismatchError) {
          store.transition(run.runId, phase === 'add' ? 'ADD_FAILED' : 'REMOVE_FAILED', {
            [phase === 'add' ? 'addResult' : 'removeResult']: 'FAIL',
            evidence: { ...store.get(run.runId)?.evidence, failure: err.message },
          });
        } else if (err instanceof InfraError || err instanceof BlockedError) {
          store.recordError(run.runId, phase, err.message, cfg.timing);
        } else {
          store.recordMiss(run.runId, phase, cfg.timing);
        }
        throw err;
      }
    });
  }
}
