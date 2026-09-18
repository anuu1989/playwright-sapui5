import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface InitOptions {
  /** Target directory to scaffold into. */
  dir: string;
  /** Base URL baked into the generated `playwright.config.ts` as the default `BASE_URL`. */
  baseUrl: string;
  /** Overwrite files that already exist, instead of skipping them. */
  force: boolean;
}

export interface InitResult {
  created: string[];
  skipped: string[];
}

function playwrightConfigSource(baseUrl: string): string {
  return `import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

loadEnv({ quiet: true });

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    // Set BASE_URL in a .env file (copy .env.example) to point this at a different environment,
    // without editing this file - see the playwright-sapui5 docs on multi-environment config.
    baseURL: process.env.BASE_URL ?? '${baseUrl}',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
`;
}

const TSCONFIG_SOURCE = `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "lib": ["ES2020", "DOM"],
    "types": ["node"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "noEmit": true
  },
  "include": ["tests", "pages", "playwright.config.ts"]
}
`;

const EXAMPLE_PAGE_SOURCE = `import type { Page } from '@playwright/test';
import { Ui5Page } from 'playwright-sapui5';

/**
 * Starter Page Object. Rename this, then:
 *  - Add locators for your app's real controls - see the playwright-sapui5 docs on locators.
 *  - Or generate a starting point from your running app:
 *    npx pw-sapui5 generate --url <your-app-url> --output pages/HomePage.ts --class-name HomePage
 */
export class ExamplePage extends Ui5Page {
  constructor(page: Page) {
    super(page);
  }

  async open(): Promise<void> {
    await this.goto(''); // resolves against playwright.config.ts's configured baseURL
  }
}
`;

const EXAMPLE_TEST_SOURCE = `import { test, expect } from 'playwright-sapui5';
import { ExamplePage } from '../pages/ExamplePage';

test('the app loads', async ({ page }) => {
  const app = new ExamplePage(page);
  await app.open();

  // TODO: replace with a real assertion about your app, e.g.:
  // await expect(await app.someLocator.resolve()).toBeVisible();
  await expect(page).toHaveURL(/.+/);
});
`;

const ENV_EXAMPLE_SOURCE = `# Copy this file to .env (already gitignored) and set your own values.
# BASE_URL=https://your-app.example.com/
`;

const VSCODE_EXTENSIONS_SOURCE = `{
  "recommendations": ["ms-playwright.playwright", "dbaeumer.vscode-eslint", "esbenp.prettier-vscode"]
}
`;

const VSCODE_SETTINGS_SOURCE = `{
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.formatOnSave": true,
  "typescript.tsdk": "node_modules/typescript/lib"
}
`;

const VSCODE_LAUNCH_SOURCE = `{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug current Playwright test file",
      "program": "\${workspaceFolder}/node_modules/.bin/playwright",
      "args": ["test", "\${relativeFile}", "--headed", "--workers=1"],
      "console": "integratedTerminal",
      "env": { "PWDEBUG": "1" }
    }
  ]
}
`;

const GITIGNORE_LINES = [
  'node_modules/',
  'playwright-report/',
  'test-results/',
  'blob-report/',
  '.env',
  'playwright/.auth/',
];

function packageJsonSource(): string {
  return (
    JSON.stringify(
      {
        name: 'sapui5-playwright-tests',
        version: '0.0.0',
        private: true,
        scripts: {
          test: 'playwright test',
          'test:headed': 'playwright test --headed',
          'test:ui': 'playwright test --ui',
        },
      },
      null,
      2,
    ) + '\n'
  );
}

function writeFileIfAbsent(
  filePath: string,
  content: string,
  force: boolean,
  result: InitResult,
): void {
  if (!force && existsSync(filePath)) {
    result.skipped.push(filePath);
    return;
  }
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf-8');
  result.created.push(filePath);
}

function mergeGitignore(filePath: string, force: boolean, result: InitResult): void {
  const wanted = GITIGNORE_LINES;
  if (!existsSync(filePath)) {
    writeFileSync(filePath, wanted.join('\n') + '\n', 'utf-8');
    result.created.push(filePath);
    return;
  }
  const existing = readFileSync(filePath, 'utf-8');
  const existingLines = new Set(existing.split('\n').map((l) => l.trim()));
  const missing = wanted.filter((line) => !existingLines.has(line));
  if (missing.length === 0) {
    result.skipped.push(filePath);
    return;
  }
  if (!force) {
    // Appending is additive/non-destructive, so this is safe even without --force - but still
    // reported as "created" (modified) rather than silently touched.
  }
  const separator = existing.endsWith('\n') ? '' : '\n';
  writeFileSync(
    filePath,
    existing + separator + '\n# Added by `pw-sapui5 init`\n' + missing.join('\n') + '\n',
    'utf-8',
  );
  result.created.push(filePath);
}

/**
 * Scaffolds a ready-to-run playwright-sapui5 project into `options.dir`: config, tsconfig, an
 * example Page Object + test, .env.example, and editor setup. Never overwrites an existing file
 * unless `options.force` is set - existing files are reported as skipped, not touched.
 */
export function runInit(options: InitOptions): InitResult {
  const result: InitResult = { created: [], skipped: [] };
  const { dir, baseUrl, force } = options;

  writeFileIfAbsent(
    join(dir, 'playwright.config.ts'),
    playwrightConfigSource(baseUrl),
    force,
    result,
  );
  writeFileIfAbsent(join(dir, 'tsconfig.json'), TSCONFIG_SOURCE, force, result);
  writeFileIfAbsent(join(dir, '.env.example'), ENV_EXAMPLE_SOURCE, force, result);
  writeFileIfAbsent(join(dir, 'pages', 'ExamplePage.ts'), EXAMPLE_PAGE_SOURCE, force, result);
  writeFileIfAbsent(join(dir, 'tests', 'example.spec.ts'), EXAMPLE_TEST_SOURCE, force, result);
  writeFileIfAbsent(
    join(dir, '.vscode', 'extensions.json'),
    VSCODE_EXTENSIONS_SOURCE,
    force,
    result,
  );
  writeFileIfAbsent(join(dir, '.vscode', 'settings.json'), VSCODE_SETTINGS_SOURCE, force, result);
  writeFileIfAbsent(join(dir, '.vscode', 'launch.json'), VSCODE_LAUNCH_SOURCE, force, result);
  mergeGitignore(join(dir, '.gitignore'), force, result);

  if (!existsSync(join(dir, 'package.json'))) {
    writeFileIfAbsent(join(dir, 'package.json'), packageJsonSource(), force, result);
  } else {
    result.skipped.push(join(dir, 'package.json'));
  }

  return result;
}
