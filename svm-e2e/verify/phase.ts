import { test, expect } from '@playwright/test';
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
      page,
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
            if (!control) throw new DataMismatchError('control component missing from SVM');
          }
        });

        const uiOk = await test.step('SVM UI', async () => {
          try {
            const asset = new SvmAssetPage(page, cfg);
            await asset.open(run.projectName);
            if (phase === 'add')
              await expect(asset.componentRow(run.component, run.version)).toBeVisible();
            else await expect(asset.componentRow(run.component, run.version)).toHaveCount(0);
            await expect(asset.componentRow(run.control)).toBeVisible();
            return true;
          } catch (err) {
            test
              .info()
              .annotations.push({
                type: 'ui-check-failed',
                description: (err as Error).message.split('\n')[0],
              });
            return false;
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
