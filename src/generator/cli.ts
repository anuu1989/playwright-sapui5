#!/usr/bin/env node
// That first line is a "shebang" - on macOS/Linux, it tells the shell to run this file with
// `node`, so once it's executable and referenced from `package.json`'s `"bin"` field, typing
// `pw-sapui5` (or `npx pw-sapui5`) works without anyone having to type `node` themselves. It has
// to be the literal first line of the file, before even a comment, or it won't be recognized.
import { chromium } from '@playwright/test';
import { Command } from 'commander';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Ui5Bridge } from '../core/Ui5Bridge';
import { waitForUi5, waitForUi5Core } from '../core/waits';
import { generatePageObjectSource } from './generatePageObjectSource';
import { analyzeUi5App } from './analyzeApp';
import { generateTestSource } from './generateTestSource';
import { runInit } from './initCommand';
import { runDoctor } from './doctorCommand';

/**
 * This file is deliberately thin: it defines the CLI's subcommands (`generate`, `generate-tests`
 * and `init`),
 * parses their flags with the `commander` library, and calls straight into the same building
 * blocks the rest of the framework uses (`Ui5Bridge`, `waitForUi5*`) or into the other two
 * generator files (`generatePageObjectSource`, `runInit`) for the actual work. Nothing here is
 * reachable from `import ... from 'playwright-sapui5'` - this file only ever runs as a
 * standalone process, launched via the `pw-sapui5` command.
 */

const program = new Command();

program
  .name('pw-sapui5')
  .description('CLI utilities for the playwright-sapui5 framework')
  .version('0.1.0');

// --- `pw-sapui5 generate` --------------------------------------------------------------------
// See docs/generator.md for the full picture; docs/architecture.md#the-generate-cli-flow for how
// this fits into the rest of the codebase. In short: launch a real (non-test-runner) browser,
// navigate to the target app, wait for it to settle, read its control tree, and write a Page
// Object file from what was found.
program
  .command('generate')
  .description(
    'Inspect a running SAPUI5 app and generate a starter Page Object class from its control tree',
  )
  .requiredOption('-u, --url <url>', 'URL of the SAPUI5 app to inspect')
  .option('-o, --output <path>', 'Output file path', './GeneratedPage.ts')
  .option('-c, --class-name <name>', 'Generated class name', 'GeneratedPage')
  .option('--headed', 'Run the inspection browser in headed mode', false)
  .option('--timeout <ms>', 'Navigation / ready timeout in milliseconds', '30000')
  .action(
    // `commander` always hands flag values to `.action()`'s callback as an object keyed by each
    // option's long name (`--class-name` becomes `opts.className`, camelCased automatically) -
    // this inline type annotation just tells TypeScript what shape to expect, since `commander`
    // itself can't know that ahead of time from the `.option(...)` calls above.
    async (opts: {
      url: string;
      output: string;
      className: string;
      headed: boolean;
      timeout: string;
    }) => {
      // Every `--timeout`/similar CLI flag arrives as a `string` (command-line arguments are
      // always text) - `Number(...)` converts it to the actual number the rest of this code
      // needs to pass around as a `timeout` option.
      const timeout = Number(opts.timeout);
      console.log(`Launching browser and navigating to ${opts.url} ...`);
      // `chromium.launch()` here is a direct Playwright API call, completely independent of the
      // `playwright test` runner - this CLI command isn't a test, it's a one-off browser
      // automation script, so it manages its own browser lifecycle (launch here, `.close()` in
      // the `finally` block below) instead of relying on Playwright Test's fixtures.
      const browser = await chromium.launch({ headless: !opts.headed });
      try {
        const page = await browser.newPage();
        // Install the bridge before navigating - see the comment in Ui5Page.goto() for why order matters.
        await Ui5Bridge.ensure(page);
        await page.goto(opts.url, { timeout });
        await waitForUi5Core(page, { timeout });
        await waitForUi5(page, { timeout });

        const dump = await Ui5Bridge.dumpControlTree(page);
        console.log(`Found ${dump.length} UI5 controls.`);

        // From here on, everything is plain Node.js file I/O and pure string generation - the
        // actual template logic lives entirely in `generatePageObjectSource` (a separate,
        // dependency-free function - see `src/generator/generatePageObjectSource.ts`), so this
        // file's job is just "get a dump, then write whatever that function returns to disk."
        const source = generatePageObjectSource(dump, opts.className);
        writeFileSync(opts.output, source, 'utf-8');
        console.log(`Page object written to ${opts.output}`);
      } finally {
        // `finally` guarantees the browser closes whether the `try` block succeeded or threw -
        // without this, a failed navigation or a bad URL would leave an orphaned Chromium
        // process running in the background every time.
        await browser.close();
      }
    },
  );

// --- `pw-sapui5 generate-tests` ---------------------------------------------------------------
// See docs/test-generator.md. Same shape as `generate` above - drive a real browser, inspect a
// real app - but where that writes a Page Object describing the app's *controls*, this analyses
// what kind of app it is (its routes, its control mix, its measured startup) and writes a runnable
// spec file. The analysis lives in `analyzeApp.ts` and the templating in `generateTestSource.ts`;
// this command only glues them together.
program
  .command('generate-tests')
  .description('Inspect a running SAPUI5 app and generate a runnable starter test suite for it')
  .requiredOption('-u, --url <url>', 'URL of the SAPUI5 app to inspect')
  .option('-o, --output <path>', 'Output spec file path', './generated.spec.ts')
  .option('-t, --title <title>', 'Title for the generated test.describe block')
  .option(
    '--import-from <module>',
    'Module the generated file imports the framework from',
    'playwright-sapui5',
  )
  .option('--headed', 'Run the inspection browser in headed mode', false)
  .option('--timeout <ms>', 'Navigation / ready timeout in milliseconds', '30000')
  .action(
    async (opts: {
      url: string;
      output: string;
      title?: string;
      importFrom: string;
      headed: boolean;
      timeout: string;
    }) => {
      const timeout = Number(opts.timeout);
      console.log(`Launching browser and analysing ${opts.url} ...`);
      const browser = await chromium.launch({ headless: !opts.headed });
      try {
        const page = await browser.newPage();
        const analysis = await analyzeUi5App(page, opts.url, { timeout });

        // A short report, because the analysis is the interesting part - it's what decides which
        // tests get written, so it's worth seeing rather than hiding behind the output file.
        console.log(`  App:      ${analysis.appTitle ?? analysis.appId ?? '(unnamed)'}`);
        console.log(`  Controls: ${analysis.totalControls} rendered`);
        console.log(
          `  Routes:   ${analysis.navigableRoutes.length} navigable, ${analysis.parameterizedRoutes.length} need parameters`,
        );
        const detected = Object.entries(analysis.features)
          .filter(([, present]) => present)
          .map(([feature]) => feature);
        console.log(`  Detected: ${detected.length > 0 ? detected.join(', ') : 'nothing special'}`);
        console.log(`  Startup:  ~${analysis.bootstrapMs}ms to settle`);

        const source = generateTestSource(analysis, {
          title: opts.title,
          importFrom: opts.importFrom,
        });
        writeFileSync(opts.output, source, 'utf-8');
        console.log(`\nTest suite written to ${opts.output}`);
        console.log('Run it with:  npx playwright test ' + opts.output);
      } finally {
        await browser.close();
      }
    },
  );

// --- `pw-sapui5 init` -------------------------------------------------------------------------
// See docs/init.md for the full picture. Unlike `generate` above, this command does no browser
// automation at all - it's a thin wrapper around `runInit()` (all the actual file-writing logic
// lives in `src/generator/initCommand.ts`) that just prints what happened and what to do next.
program
  .command('init')
  .description(
    'Scaffold a ready-to-run playwright-sapui5 project (config, example test, editor setup)',
  )
  .option('-d, --dir <path>', 'Target directory', '.')
  .option(
    '-b, --base-url <url>',
    'Base URL to bake into playwright.config.ts',
    'https://your-app.example.com/',
  )
  .option('-f, --force', 'Overwrite files that already exist', false)
  .action((opts: { dir: string; baseUrl: string; force: boolean }) => {
    // `resolve(opts.dir)` turns whatever the user typed (`.`, `../my-tests`, an absolute path,
    // ...) into a full, absolute path - both so the console output below is unambiguous about
    // exactly where files were written, and so `runInit()` itself never has to worry about
    // relative-path edge cases.
    const dir = resolve(opts.dir);
    console.log(`Scaffolding a playwright-sapui5 project in ${dir} ...`);
    const result = runInit({ dir, baseUrl: opts.baseUrl, force: opts.force });

    // `runInit()` returns a plain `{ created, skipped }` report rather than printing anything
    // itself - that's what keeps `initCommand.ts` testable without needing to capture console
    // output. All of the actual user-facing formatting happens here instead.
    for (const file of result.created) {
      console.log(`  created  ${file}`);
    }
    for (const file of result.skipped) {
      console.log(`  skipped  ${file} (already exists - pass --force to overwrite)`);
    }

    console.log('');
    console.log('Next steps:');
    console.log(
      '  npm install --save-dev playwright-sapui5 @playwright/test dotenv typescript @types/node',
    );
    console.log('  npx playwright install chromium');
    console.log('  npx playwright test');
    console.log('');
    console.log('Then edit pages/ExamplePage.ts and tests/example.spec.ts for your own app -');
    console.log('or generate a starting Page Object from it directly:');
    console.log(
      '  npx pw-sapui5 generate --url <your-app-url> --output pages/HomePage.ts --class-name HomePage',
    );
  });

// --- `pw-sapui5 doctor` -----------------------------------------------------------------------
// See docs/doctor.md. A zero-code smoke check: launch a browser, load the app, and answer "did
// this even come up cleanly?" - bootstraps, renders something, settles within budget, no errors
// in SAPUI5's own message model. Every check reuses a library call the rest of this framework
// already has (`Ui5Performance`, `Ui5Messages`) - this just exposes them as a CI gate that needs
// no test file at all. Exits non-zero on failure, so it drops straight into a pipeline step.
program
  .command('doctor')
  .description(
    'Zero-code smoke check: does the app bootstrap, render controls, settle in budget, and report no message-model errors?',
  )
  .requiredOption('-u, --url <url>', 'URL of the SAPUI5 app to check')
  .option('--timeout <ms>', 'Navigation / ready timeout in milliseconds', '30000')
  .option(
    '--budget-ms <ms>',
    'Startup budget - the "settles in budget" check fails past this many milliseconds',
    '15000',
  )
  .option('--headed', 'Run the checking browser in headed mode', false)
  .action(async (opts: { url: string; timeout: string; budgetMs: string; headed: boolean }) => {
    const timeout = Number(opts.timeout);
    const budgetMs = Number(opts.budgetMs);
    console.log(`Checking ${opts.url} ...`);
    const browser = await chromium.launch({ headless: !opts.headed });
    try {
      const page = await browser.newPage();
      const report = await runDoctor(page, opts.url, { timeout, budgetMs });

      console.log('');
      for (const check of report.checks) {
        console.log(`  ${check.ok ? '✓' : '✗'} ${check.name} - ${check.detail}`);
      }
      console.log('');
      console.log(report.ok ? 'OK' : 'FAILED');

      if (!report.ok) {
        // The CLI's exit code, not an exception - a failing app is an expected, well-formed
        // outcome for this command to report, not a bug in the command itself.
        process.exitCode = 1;
      }
    } finally {
      await browser.close();
    }
  });

// `program.parseAsync(process.argv)` is `commander`'s entry point: it reads the actual
// command-line arguments the process was invoked with, works out which subcommand (`generate` or
// `init`) and flags were given, and calls the matching `.action(...)` callback above. Both of
// those callbacks are `async`, so this whole call returns a `Promise` - the `.catch(...)` here is
// this file's top-level error handling: if either subcommand throws (a bad URL, a filesystem
// error, ...), print it and exit with a non-zero status code instead of letting Node crash with
// an unhandled rejection warning.
program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
