import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadSettings, PACKAGE_ROOT, storePath } from '../src/config';
import { RunStore } from '../src/store';
import type { RunRow } from '../src/types';

export const DUE_FILE = resolve(PACKAGE_ROOT, '.due-runs.json');

const toDue = (r: RunRow) => ({
  runId: r.runId,
  projectName: r.projectName,
  component: r.componentName,
  version: r.componentVersion,
  control: r.controlComponent,
  controlVersion: r.controlVersion,
  vulnIds: r.vulnIds,
});

/** Playwright collects tests synchronously, so due runs are written to a file the specs read. */
export default function globalSetup(): void {
  loadSettings(); // fail early on a broken config
  const store = new RunStore(storePath());
  writeFileSync(
    DUE_FILE,
    JSON.stringify({
      add: store.dueRuns(['WAITING_ADD_SYNC']).map(toDue),
      remove: store.dueRuns(['REMOVED']).map(toDue),
    }),
  );
}
