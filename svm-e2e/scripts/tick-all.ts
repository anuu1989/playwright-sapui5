/**
 * The hourly job: Black Duck steps, then the SVM checks only if one is due (no browser start-up
 * otherwise), then notifications. The exit code is Playwright's, so a failed check fails the job
 * after the notification went out.
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { loadSettings, storePath } from '../src/config';
import { plan } from '../src/orchestrator';
import { RunStore } from '../src/store';

const root = resolve(__dirname, '..');
const run = (cmd: string) =>
  spawnSync(cmd, { cwd: root, shell: true, stdio: 'inherit' }).status ?? 1;

let code = run('npm run --silent tick');
if (code !== 0) process.exit(code); // Black Duck trouble: do not check SVM against stale state

const { svm } = plan(new RunStore(storePath()), loadSettings());
code = svm ? run('npx playwright test --pass-with-no-tests') : 0;
if (!svm) console.log('No SVM check is due; skipping Playwright.');

run('npm run --silent notify');
process.exit(code);
