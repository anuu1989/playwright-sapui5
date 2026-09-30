# Project scaffolding (`pw-sapui5 init`)

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> generated code on this page looks unfamiliar.

`pw-sapui5 init` scaffolds a ready-to-run playwright-sapui5 project in one command: config,
`tsconfig.json`, an example Page Object and test, a `.env.example`, and editor setup - the same
role `npm init playwright@latest` plays for a plain Playwright project, tailored for SAPUI5.

## Usage

```bash
mkdir my-tests && cd my-tests && npm init -y
npm install --save-dev playwright-sapui5 @playwright/test dotenv typescript @types/node
npx pw-sapui5 init --base-url https://your-app.example.com/
npx playwright install chromium
npx playwright test
```

That's the whole setup. The generated example test passes as soon as `--base-url` points at a
real SAPUI5 app (it only asserts the page loaded - see [What it generates](#what-it-generates)
below for what to edit next).

**Note the order**: `playwright-sapui5` has to be installed _before_ `npx pw-sapui5 init` can run

- `npx` only resolves `pw-sapui5` to this package's CLI once it's actually present in
  `node_modules/.bin` (its bin name doesn't match the package name closely enough for `npx` to
  auto-fetch it from the registry on its own).

### Options

| Flag                   | Default                 | Description                                                                                                                                     |
| ---------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `-d, --dir <path>`     | `.` (current directory) | Where to scaffold into                                                                                                                          |
| `-b, --base-url <url>` | a placeholder URL       | Baked into the generated `playwright.config.ts` as the default `BASE_URL` - see [docs/multi-environment-config.md](multi-environment-config.md) |
| `--ci <provider>`      | `github`                | Which CI pipeline file to scaffold: `github`, `azure`, `gitlab`, or `none` to skip it entirely                                                  |
| `-f, --force`          | off                     | Overwrite files that already exist                                                                                                              |

**`init` never overwrites an existing file unless you pass `--force`.** Run it in a directory
that already has some of these files (e.g. your own `.gitignore`) and it skips them, reporting
what it skipped - safe to run more than once, and safe to run in a project that isn't empty.

## What it generates

```
playwright.config.ts    Config wired to read BASE_URL from a .env file (falls back to --base-url)
tsconfig.json            Minimal TypeScript config
.env.example             Copy to .env to set your own BASE_URL
pages/ExamplePage.ts      Starter Page Object - extend Ui5Page, add your own locators
tests/example.spec.ts     Starter test using ExamplePage
.vscode/                 Recommended extensions, format-on-save, a debug launch config, and
                          playwright-sapui5.code-snippets (see below)
.github/workflows/       A ready-to-run CI pipeline (or azure-pipelines.yml / .gitlab-ci.yml -
playwright.yml           see --ci above; --ci none skips this)
.gitignore                Created, or merged into your existing one
package.json              Created only if one doesn't already exist
```

### Editor snippets

`.vscode/playwright-sapui5.code-snippets` ships five snippets for this framework's own most
common patterns - type the prefix in any `.ts` file and hit `Tab`:

| Prefix        | Expands to                                                 |
| ------------- | ---------------------------------------------------------- |
| `ui5page`     | A `Ui5Page` subclass with an `open()` and a locator getter |
| `ui5test`     | A `test(...)` block using a Page Object                    |
| `ui5locator`  | A `ui5(page)....` locator, with a choice of strategy       |
| `ui5fallback` | A self-healing locator with `.fallback(...)`               |
| `ui5matcher`  | A `toHaveUi5Property` assertion                            |

### CI pipeline

By default `init` also scaffolds a working CI pipeline (`--ci github`, the default, writes
`.github/workflows/playwright.yml`; `--ci azure`/`--ci gitlab` write the equivalent for those
systems instead; `--ci none` skips this). Every variant does the same three things: install
dependencies, install the Chromium browser Playwright needs, run `npm test`, then publish the
HTML report as a build artifact - point it at a real environment by setting `BASE_URL` as that
system's own secret/variable (each generated file has a commented-out example showing exactly
where).

## After scaffolding

1. Copy `.env.example` to `.env` and set `BASE_URL` to your real app (if you didn't already pass
   `--base-url`).
2. Either hand-write locators in `pages/ExamplePage.ts` (see
   [docs/locators.md](locators.md) and [docs/page-objects.md](page-objects.md)), or generate a
   starting point from your actual running app:

   ```bash
   npx pw-sapui5 generate --url https://your-app.example.com/ --output pages/HomePage.ts --class-name HomePage
   ```

   See [docs/generator.md](generator.md) for what that command does and its limits.

3. Replace the placeholder assertion in `tests/example.spec.ts` with a real one about your app.

## Why the generated `tsconfig.json` looks the way it does

If you're curious why it doesn't set `moduleResolution` explicitly: TypeScript infers the right
default for `"module": "commonjs"` on its own, and leaving it unset stays correct across
TypeScript major versions - explicit `"node"` resolution was removed outright in a recent
TypeScript major release, and the modern replacement (`"bundler"`) requires an ESM-style `module`
setting that would conflict with the CommonJS output this setup (and Playwright's own test
transform) expects. This exact issue was caught by this repo's own CI, which scaffolds a project
and type-checks it against whatever TypeScript version is current - see
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml).
