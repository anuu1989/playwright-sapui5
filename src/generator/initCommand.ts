import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * The file-writing logic behind `pw-sapui5 init` (see `src/generator/cli.ts` for the actual CLI
 * command that calls `runInit()` below). Unlike the rest of the generator, this file does no
 * browser automation at all - it's plain Node.js file I/O, plus a handful of template-literal
 * strings holding the content of each file it can create.
 */

/** Which CI system to scaffold a pipeline file for - see the three `*Source()` functions below.
 * `'none'` is an explicit opt-out, for a team whose CI isn't any of the other three (or who'd
 * rather set it up by hand). */
export type CiProvider = 'github' | 'azure' | 'gitlab' | 'none';

export interface InitOptions {
  /** Target directory to scaffold into. */
  dir: string;
  /** Base URL baked into the generated `playwright.config.ts` as the default `BASE_URL`. */
  baseUrl: string;
  /** Overwrite files that already exist, instead of skipping them. */
  force: boolean;
  /** Which CI pipeline file to scaffold. Defaults to `'github'` - the same "batteries included,
   * inert if unused" reasoning `init` already applies to `.vscode/`. */
  ci?: CiProvider;
}

export interface InitResult {
  created: string[];
  skipped: string[];
}

/**
 * Builds the generated `playwright.config.ts`'s source text. This is a *function*, not a plain
 * constant string like the other templates below, because it's the one file whose content
 * actually depends on an argument (`baseUrl`) - the others are identical every time `init` runs.
 * Notice the backtick (`` ` ``) template literal spans this whole function - everything between
 * the two backticks becomes the literal text of the generated file, including its own
 * `${baseUrl}` placeholder, which gets substituted with the real value before this function
 * returns (that's what template literals do - the same feature used everywhere else in this
 * codebase for single-line strings, just here spanning many lines at once).
 */
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

// Everything below, down to `GITIGNORE_LINES`, is a plain `const` holding one generated file's
// exact text - no placeholders to fill in, so (unlike `playwrightConfigSource` above) these
// don't need to be functions. Naming them `SCREAMING_SNAKE_CASE` is this codebase's usual
// convention for a constant that's never reassigned and morally "global" within the file.

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

// `\${...}` (with a backslash before the `$`) inside this template literal is how you write a
// LITERAL `${...}` in the *generated* file's own text, without JavaScript trying to substitute it
// right now - the generated `launch.json` needs VS Code's own `${workspaceFolder}` /
// `${relativeFile}` variables to survive as literal text, not be replaced by this function.
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

// A handful of ready-to-use snippets for the framework's own most common patterns - `Tab`-expand
// `ui5page`/`ui5test`/`ui5locator`/`ui5fallback`/`ui5matcher` in any `.ts` file. These exist for
// the same reason the framework has a Page Object generator at all: a tester new to this
// framework shouldn't have to hold its exact API shapes in their head, or go copy-paste them out
// of docs, just to write the next ordinary test. VS Code's snippet placeholder syntax
// (`${1:default text}`, `$0` for where the cursor lands last) is unrelated to - and not evaluated
// by - the JavaScript template literal this whole constant is written as; it's just text VS Code
// itself interprets once the file lands in `.vscode/`. A `.code-snippets` file is strict JSON
// (no trailing commas, no comments), unlike most of VS Code's own JSONC config files - verified
// by actually running `pw-sapui5 init` and parsing the result with `JSON.parse`.
const VSCODE_SNIPPETS_SOURCE = `{
  "playwright-sapui5: Page Object": {
    "scope": "typescript",
    "prefix": "ui5page",
    "body": [
      "import type { Page } from '@playwright/test';",
      "import { Ui5Page, ui5 } from 'playwright-sapui5';",
      "",
      "export class \${1:MyPage} extends Ui5Page {",
      "  constructor(page: Page) {",
      "    super(page);",
      "  }",
      "",
      "  async open(): Promise<void> {",
      "    await this.goto('\${2:}');",
      "  }",
      "",
      "  get \${3:someControl}() {",
      "    return ui5(this.page).\${4:controlType('sap.m.Button')};",
      "  }",
      "}",
      "$0"
    ]
  },
  "playwright-sapui5: test": {
    "scope": "typescript",
    "prefix": "ui5test",
    "body": [
      "import { test, expect } from 'playwright-sapui5';",
      "import { \${1:MyPage} } from '../pages/\${1:MyPage}';",
      "",
      "test('\${2:does the thing}', async ({ page }) => {",
      "  const app = new \${1:MyPage}(page);",
      "  await app.open();",
      "",
      "  $0",
      "});"
    ]
  },
  "playwright-sapui5: ui5() locator": {
    "scope": "typescript",
    "prefix": "ui5locator",
    "body": [
      "ui5(\${1:page}).\${2|id('$3'),controlType('sap.m.$3'),text('$3'),bindingPath('$3')|}$0"
    ]
  },
  "playwright-sapui5: self-healing locator with fallback": {
    "scope": "typescript",
    "prefix": "ui5fallback",
    "body": [
      "ui5(\${1:page})",
      "  .\${2:id('$3')}",
      "  .fallback({ by: '\${4:text}', \${5:text: '$3'} }, { label: '\${6:$3}' })$0"
    ]
  },
  "playwright-sapui5: custom expect matcher": {
    "scope": "typescript",
    "prefix": "ui5matcher",
    "body": [
      "await expect(await \${1:locator}.resolve()).toHaveUi5Property('\${2:text}', \${3:'expected value'});$0"
    ]
  }
}
`;

/**
 * Builds a GitHub Actions workflow that installs dependencies, installs the Chromium browser
 * Playwright needs, runs the suite, and uploads the HTML report as a build artifact on every
 * run (not just failures - a green run's report is still useful for a quick "what actually ran"
 * check). Mirrors the shape this framework's *own* CI uses to run its example suite (see
 * `.github/workflows/ci.yml` in this repo) minus the steps that are specific to developing the
 * library itself (linting/type-checking/building the library, the `npm pack` scaffolding smoke
 * test) - a consumer project has none of that, just tests to run.
 */
function githubActionsWorkflowSource(): string {
  return `name: Playwright tests

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium

      - name: Run tests
        run: npm test
        env:
          CI: true
          # Set repo secrets/variables and reference them here to point CI at a different
          # environment than your local .env - see docs/multi-environment-config.md.
          # BASE_URL: \${{ vars.BASE_URL }}

      - name: Upload Playwright report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 14
`;
}

/** Builds an Azure Pipelines YAML file - the CI system many SAP-shop enterprise teams already
 * standardize on. Same three real steps as the GitHub Actions template above (install deps,
 * install the browser, run tests), in Azure Pipelines' own task syntax, plus publishing the HTML
 * report as a named pipeline artifact so it's downloadable from the run's own Artifacts tab. */
function azurePipelinesSource(): string {
  return `trigger:
  branches:
    include: [main]

pr:
  branches:
    include: ['*']

pool:
  vmImage: ubuntu-latest

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '20.x'
    displayName: 'Use Node.js 20'

  - script: npm ci
    displayName: 'Install dependencies'

  - script: npx playwright install --with-deps chromium
    displayName: 'Install Playwright browsers'

  - script: npm test
    displayName: 'Run tests'
    env:
      CI: true
      # Set a pipeline variable and reference it here to point CI at a different environment
      # than your local .env - see docs/multi-environment-config.md.
      # BASE_URL: $(BASE_URL)

  - task: PublishPipelineArtifact@1
    condition: always()
    inputs:
      targetPath: 'playwright-report'
      artifact: 'playwright-report'
    displayName: 'Publish Playwright report'
`;
}

/** Builds a GitLab CI file - `image` pins the same Node major version as every other template
 * here, and the `artifacts` block is GitLab's equivalent of the "always upload the report" step
 * the GitHub Actions/Azure templates both have, kept even on failure via `when: always`. */
function gitlabCiSource(): string {
  return `image: node:20

stages:
  - test

test:
  stage: test
  script:
    - npm ci
    - npx playwright install --with-deps chromium
    - npm test
  variables:
    CI: "true"
    # Set a CI/CD variable in GitLab's project settings and reference it here to point CI at a
    # different environment than your local .env - see docs/multi-environment-config.md.
    # BASE_URL: $BASE_URL
  artifacts:
    when: always
    paths:
      - playwright-report/
    expire_in: 14 days
`;
}

// Used by `mergeGitignore()` below - a plain array (not a single template string like the files
// above) because, unlike the others, a `.gitignore` might already exist in the target directory
// and need individual lines merged into it rather than being written wholesale.
const GITIGNORE_LINES = [
  'node_modules/',
  'playwright-report/',
  'test-results/',
  'blob-report/',
  '.env',
  'playwright/.auth/',
];

/** Builds a minimal `package.json`, only ever used when the target directory doesn't already
 * have one - see the very end of `runInit()` below. */
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
      null, // no custom replacer function
      2, // indent with 2 spaces, for a human-readable file
    ) + '\n' // JSON.stringify never adds a trailing newline; files conventionally end with one
  );
}

/**
 * The one safety rule every file this module writes goes through: never silently overwrite
 * something that's already there. If `filePath` exists and `force` is `false`, record it as
 * `skipped` and return without touching it; otherwise (doesn't exist, or `force` is `true`)
 * create any missing parent directories and write the file, recording it as `created`. This is
 * what makes `pw-sapui5 init` safe to run more than once, or inside a directory that isn't empty.
 */
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
  // `{ recursive: true }` creates every missing directory in the path, not just the immediate
  // parent - e.g. writing to `pages/ExamplePage.ts` in a brand new directory needs `pages/`
  // itself to be created first, which a non-recursive `mkdirSync` would refuse to do implicitly.
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf-8');
  result.created.push(filePath);
}

/**
 * `.gitignore` gets special handling instead of going through `writeFileIfAbsent()`: if one
 * already exists, this framework's own recommended lines (`GITIGNORE_LINES`) are *appended* to
 * it rather than the whole file being skipped or replaced - so running `init` in a project that
 * already has a `.gitignore` still ends up ignoring `node_modules/`, `.env`, etc., without
 * clobbering whatever was already in there.
 */
function mergeGitignore(filePath: string, force: boolean, result: InitResult): void {
  const wanted = GITIGNORE_LINES;
  if (!existsSync(filePath)) {
    // No existing file at all - this is the simple case, equivalent to `writeFileIfAbsent` but
    // without needing the `force` check (there's nothing to conflict with).
    writeFileSync(filePath, wanted.join('\n') + '\n', 'utf-8');
    result.created.push(filePath);
    return;
  }
  const existing = readFileSync(filePath, 'utf-8');
  // Build a `Set` of every line already present (trimmed, so stray whitespace doesn't cause a
  // false "this line is missing" positive) - a `Set`'s `.has()` check is an O(1) lookup, so this
  // scales fine even for a `.gitignore` with hundreds of existing lines.
  const existingLines = new Set(existing.split('\n').map((l) => l.trim()));
  const missing = wanted.filter((line) => !existingLines.has(line));
  if (missing.length === 0) {
    // Every line we'd want is already there (e.g. `init` already ran once before) - nothing to
    // do, report it as skipped rather than as a no-op "created."
    result.skipped.push(filePath);
    return;
  }
  // Appending new lines to an existing `.gitignore` is additive and non-destructive - it can
  // never remove or change anything the file already had - so this proceeds even without
  // `--force`; `force` only guards genuinely destructive overwrites elsewhere in this file.
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
 *
 * Every line in the body below is one `writeFileIfAbsent(...)` call for one generated file -
 * there's no cleverness here, just a straight list of "these are the files `init` produces."
 * See docs/init.md for what each one actually contains and why.
 */
export function runInit(options: InitOptions): InitResult {
  const result: InitResult = { created: [], skipped: [] };
  // Destructuring `options` into local variables here is purely for brevity in the calls below -
  // `options.dir`/`options.baseUrl`/`options.force`/`options.ci` would work identically.
  const { dir, baseUrl, force, ci = 'github' } = options;

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
  writeFileIfAbsent(
    join(dir, '.vscode', 'playwright-sapui5.code-snippets'),
    VSCODE_SNIPPETS_SOURCE,
    force,
    result,
  );
  mergeGitignore(join(dir, '.gitignore'), force, result);

  // CI scaffolding - each provider writes to its own conventional path, so unlike every other
  // file above there's no single fixed target; `'none'` (an explicit opt-out) writes nothing.
  if (ci === 'github') {
    writeFileIfAbsent(
      join(dir, '.github', 'workflows', 'playwright.yml'),
      githubActionsWorkflowSource(),
      force,
      result,
    );
  } else if (ci === 'azure') {
    writeFileIfAbsent(join(dir, 'azure-pipelines.yml'), azurePipelinesSource(), force, result);
  } else if (ci === 'gitlab') {
    writeFileIfAbsent(join(dir, '.gitlab-ci.yml'), gitlabCiSource(), force, result);
  }

  // `package.json` is the one file with genuinely different logic from every other line above:
  // it's only ever created if the target directory doesn't have one at all - `init` never offers
  // to overwrite an existing `package.json` even with `--force`, since that file almost
  // certainly has project-specific content (other dependencies, scripts, metadata) that has
  // nothing to do with this framework and would be actively harmful to replace.
  if (!existsSync(join(dir, 'package.json'))) {
    writeFileIfAbsent(join(dir, 'package.json'), packageJsonSource(), force, result);
  } else {
    result.skipped.push(join(dir, 'package.json'));
  }

  return result;
}
