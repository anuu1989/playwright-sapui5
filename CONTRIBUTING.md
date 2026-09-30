# Contributing to playwright-sapui5

Thanks for considering a contribution. This project is a testing framework for real SAPUI5/Fiori
apps, so the bar for any change is simple: **it has to work against a real, live app, not just
look right.** The sections below cover setup, the standards a PR is expected to meet, and how to
submit one.

By participating in this project you're expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Getting set up

```bash
git clone https://github.com/<your-fork>/playwright-sapui5.git
cd playwright-sapui5
./setup.sh
```

`setup.sh` installs the right Node version (via `nvm`, if you have it - see `.nvmrc`), installs
dependencies, installs Playwright's Chromium browser, builds/lints/type-checks the library, then
runs the example suite against real, live public SAPUI5 demo apps. If you'd rather run each step
yourself, or `setup.sh` doesn't fit your platform:

```bash
npm install
npx playwright install chromium
npm run build
npm run lint
npm run typecheck
npm test
```

Node 18+ is required (Node 20 is what CI and `.nvmrc` use). See
[docs/troubleshooting.md#old-nodejs-patch-versions](docs/troubleshooting.md#old-nodejs-patch-versions)
if an old default Node version on your machine causes confusing errors.

## Before you open a PR

- **`npm run lint`, `npm run typecheck`, and `npm run build` all pass.** CI (`.github/workflows/ci.yml`)
  runs all three, plus a smoke test that packs the library and type-checks a freshly-scaffolded
  `pw-sapui5 init` project against it - a real regression class this project has hit before.
- **`npm run format`** (Prettier) if you touched formatting-sensitive files - `npm run format:check`
  is what CI-adjacent tooling expects clean.
- **`npm test`** passes locally. The suite runs against real, live public SAPUI5 apps (the SDK's
  own samples, and a handful of complete demo apps - see [docs/demo-apps.md](docs/demo-apps.md)),
  not mocks of the framework, so a green run is real evidence the change works.

## The standard this project holds itself to

This is the part that matters most, and the reason the docs read the way they do:

**Never document or ship a framework capability that hasn't been run against a real, live SAPUI5
app.** Guessed control-type names, guessed DOM id/rendering conventions, and guessed API shapes
have all been wrong in ways that looked obviously correct - see almost any "Verified" section in
`docs/*.md` for a concrete example (a `SegmentedButton`'s selected item not changing its `type`
property, `sap.m.Select` vs `sap.m.ComboBox` rendering completely different DOM for their options,
SAPUI5's `navTo` silently doing nothing for an unknown route instead of throwing). If you're
adding or changing a control-facing feature:

1. Drive the real control from a script or a throwaway test first, and read what it actually does
   - the SAPUI5 SDK's own **Samples** section (one control each) or **Demo Apps** section (whole
     apps) are the usual source; see [docs/demo-apps.md](docs/demo-apps.md) for the four this repo
     already uses.
2. Build the feature from what you actually observed, not from the SAPUI5 API docs alone (which
   describe the intended contract, not always the exact rendered/runtime behavior this framework
   depends on).
3. Add a real, passing example test under `examples/tests/` that exercises it against that live
   app - see any existing file there for the pattern.
4. Write (or update) a doc page under `docs/` with a **Verified** section stating plainly what was
   confirmed and against what. If something genuinely can't be verified this way, say so - don't
   ship it as if it were.

If a capability can't be exercised against a public app (some `$batch` OData behavior,
cross-frame launchpad shells), build the smallest harness that still uses the real SAPUI5 runtime
rather than skipping verification - see `docs/odata-mocking.md`'s `$batch` section or
`examples/tests/cross-frame.spec.ts` for what that looks like in practice.

## Code style

- Follow the codebase's own conventions rather than introducing new ones - this project favors
  small, focused files, a consistent `static async method(target, locator, ...)` shape for
  control-state helpers (see `src/core/Ui5Select.ts` for a representative example), and error
  messages prefixed `[playwright-sapui5]` with enough context to actually debug from.
- Comments explain **why**, not what - a well-named function doesn't need a comment restating its
  name, but a non-obvious constraint, a verified gotcha, or the reasoning behind an unusual choice
  does. Skim any file under `src/core/` for the level of detail this project expects.
- Every new public class/function gets exported from `src/index.ts`, documented in
  `docs/api-reference.md`, and given its own `docs/<feature>.md` page (or added to an existing
  one, if it's a natural fit) - see `docs/wizard.md` for a template covering "why this needs a
  helper," the API surface, a real gotcha if one turned up, and the verification section.

## Reporting bugs / requesting features

Open a GitHub issue. For a bug, include: the SAPUI5 control/version involved if relevant, a
minimal repro (a real app URL is far more useful than a description), and what you expected vs.
what happened. For a feature request, a real-world scenario it would unblock is more useful than
an abstract API proposal.

## License

By contributing, you agree your contributions are licensed under this project's [MIT
License](LICENSE).
