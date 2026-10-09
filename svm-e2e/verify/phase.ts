import { chromium, test, expect } from '@playwright/test';
import { loadSettings, storePath } from '../src/config';
import { BlockedError, DataMismatchError, InfraError } from '../src/errors';
import { RunStore } from '../src/store';
import { getAssetComponents, type DueRun } from './svm-api';
import { SvmAssetPage } from './pages/svm-asset-page';

const cfg = loadSettings();

/**
 * One test per due run. The SVM API decides pass/fail; the UI check is reported next to it and
 * never fails the run on its own. Outcomes are written to the run store.
 */
export function registerChecks(phase: 'add' | 'remove', due: DueRun[]): void {
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
          // The browser is launched here, not through the `page` fixture: a fixture failure would
          // happen before this test body and strand the run without recording any outcome. The
          // UI check is evidence only, so a browser problem is a UI FAIL, never a run failure.
          let browser;
          try {
            browser = await chromium.launch();
            const context = await browser.newContext({
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
            await browser?.close();
          }
        });

        const seen = new Date().toISOString();
        store.addEvidence(run.runId, { [`${phase}Ui`]: uiOk ? 'PASS' : 'FAIL' });
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
