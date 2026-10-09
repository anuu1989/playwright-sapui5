/**
 * Full local demo: starts the mock Black Duck + SVM, then drives the real CLI and the real
 * Playwright specs until the run reaches a final state.
 *
 *   npm run demo                      happy path (replace scan removes the component)
 *   npm run demo -- --ignore-replace  replace scan is ignored -> falls back to unmap
 *   npm run demo -- --block           removal denied (403)  -> REMOVAL_BLOCKED
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startMock } from '../mock/server';
import { RunStore } from '../src/store';
import { FINAL_STATES } from '../src/types';

const root = resolve(__dirname, '..');
const args = process.argv.slice(2);

async function main() {
  const mock = await startMock({
    syncEveryMs: 4000,
    ignoreReplace: args.includes('--ignore-replace'),
    blockRemoval: args.includes('--block'),
  });
  const dir = mkdtempSync(join(tmpdir(), 'svm-e2e-demo-'));
  const storeFile = join(dir, 'e2e_runs.json');
  const env = {
    ...process.env,
    SVM_E2E_CONFIG: 'config/mock.yaml',
    BD_URL: mock.url,
    SVM_API_URL: mock.url,
    SVM_UI_URL: mock.url,
    BD_API_TOKEN: 'demo',
    SVM_API_TOKEN: 'demo',
    STORE_PATH: storeFile,
  };
  // Async on purpose: the mock server lives in this process and must keep answering the children.
  const sh = (cmd: string, quiet = false) =>
    new Promise<number>((done) =>
      spawn(cmd, { cwd: root, env, shell: true, stdio: quiet ? 'ignore' : 'inherit' }).on(
        'close',
        (c) => done(c ?? 1),
      ),
    );
  console.log(
    `Mock Black Duck + SVM on ${mock.url}  (sync every 4 s, scenario: ${args.join(' ') || 'happy path'})\n`,
  );

  try {
    if ((await sh('npm run --silent start-run')) !== 0) throw new Error('start-run failed');
    const store = new RunStore(storeFile);
    const started = Date.now();
    let last = '';
    while (Date.now() - started < 180_000) {
      await sh('npm run --silent tick');
      await sh('npx playwright test --pass-with-no-tests --reporter=dot', true);
      const run = store.all()[0];
      if (run.state !== last) {
        console.log(
          `[${((Date.now() - started) / 1000).toFixed(0).padStart(3)}s] ${run.state}${run.removalMethod !== 'none' ? ` (removal: ${run.removalMethod})` : ''}`,
        );
        last = run.state;
      }
      if (FINAL_STATES.includes(run.state)) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
    console.log('');
    await sh('npm run --silent notify');
    const final = store.all()[0];
    process.exitCode = FINAL_STATES.includes(final.state) ? 0 : 1;
  } finally {
    await mock.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
main();
