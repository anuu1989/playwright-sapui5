#!/usr/bin/env node
import { chromium } from '@playwright/test';
import { Command } from 'commander';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Ui5Bridge } from '../core/Ui5Bridge';
import { waitForUi5, waitForUi5Core } from '../core/waits';
import { generatePageObjectSource } from './generatePageObjectSource';
import { runInit } from './initCommand';

const program = new Command();

program
  .name('pw-sapui5')
  .description('CLI utilities for the playwright-sapui5 framework')
  .version('0.1.0');

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
    async (opts: {
      url: string;
      output: string;
      className: string;
      headed: boolean;
      timeout: string;
    }) => {
      const timeout = Number(opts.timeout);
      console.log(`Launching browser and navigating to ${opts.url} ...`);
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

        const source = generatePageObjectSource(dump, opts.className);
        writeFileSync(opts.output, source, 'utf-8');
        console.log(`Page object written to ${opts.output}`);
      } finally {
        await browser.close();
      }
    },
  );

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
    const dir = resolve(opts.dir);
    console.log(`Scaffolding a playwright-sapui5 project in ${dir} ...`);
    const result = runInit({ dir, baseUrl: opts.baseUrl, force: opts.force });

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

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
