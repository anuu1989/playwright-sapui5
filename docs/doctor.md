# `pw-sapui5 doctor` (zero-code smoke check)

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> code on this page looks unfamiliar.

`pw-sapui5 doctor --url <url>` launches a browser, loads the app, and answers one question: **did
this even come up cleanly?** No test file, no config - just an exit code and a short report,
which is exactly the shape a CI pipeline step wants before it bothers running the real suite
against an environment.

Every check it runs already exists as a library call elsewhere in this framework
([`Ui5Performance`](performance.md), [`Ui5Messages`](messages.md)) - this command doesn't add new
capability, it exposes what's already there as something you can run without writing any code.

## Usage

```bash
npx pw-sapui5 doctor --url https://your-app.example.com/
```

```
Checking https://your-app.example.com/ ...

  ✓ bootstraps - SAPUI5 core ready after 1434ms
  ✓ renders controls - 217 controls rendered
  ✓ startup budget - settled after 2706ms (budget 15000ms)
  ✓ no message-model errors - none

OK
```

Exits `0` when every check passes, `1` otherwise - drop it straight into a pipeline step:

```yaml
# example CI step
- run: npx pw-sapui5 doctor --url $STAGING_URL --timeout 60000
```

A failing check looks the same, with the reason inline and a non-zero exit:

```
  ✗ startup budget - settled after 18219ms (budget 15000ms)

FAILED
```

### Options

| Flag               | Default      | Description                                                            |
| ------------------ | ------------ | ---------------------------------------------------------------------- |
| `-u, --url <url>`  | _(required)_ | URL of the SAPUI5 app to check                                         |
| `--timeout <ms>`   | `30000`      | Navigation / ready timeout                                             |
| `--budget-ms <ms>` | `15000`      | The "startup budget" check fails past this many milliseconds to settle |
| `--headed`         | off          | Run the checking browser headed                                        |

## What it checks

1. **Bootstraps** - the SAPUI5 runtime reaches "core ready" (`sap.ui.getCore()` exists) within
   `--timeout`. If this fails, every other check is skipped - there's nothing left to check.
2. **Renders controls** - at least one SAPUI5 control actually rendered. Passes the "core ready"
   milestone but shows zero controls is its own distinct failure mode (a component that threw
   during its own `init()`, say), worth reporting separately from a total bootstrap failure.
3. **Startup budget** - the app fully settles (no busy indicator, no in-flight requests, a stable
   control tree - the same condition [`waitForUi5`](auto-wait.md) waits for) within `--budget-ms`.
4. **No message-model errors** - [`Ui5Messages.errors()`](messages.md) is empty. This is the check
   most worth having in CI: an OData backend failure can leave the UI looking fine while the
   central message model already has the error in it, and a person skimming a screenshot would
   never notice.

Each check is independent and reported on its own - a slow app that still boots cleanly fails only
the "startup budget" check, not all four.

## When to use it

- **Before running the real suite against an environment** - a quick, code-free "is this
  environment even up" gate, so a real test failure isn't spent debugging an environment that was
  never going to work.
- **After a deploy**, as a lightweight smoke check distinct from the full regression suite.
- **When filing or triaging a bug** - a one-line command that tells you whether the app is in a
  basically-working state before you go looking for the actual defect.

It is deliberately not a replacement for real tests: it proves the app came up, not that any
specific feature works.

## Verified

Run against the real, live Shopping Cart demo this framework's other examples use
(`https://ui5.sap.com/test-resources/sap/m/demokit/cart/webapp/index.html`): the success path
(all four checks pass, exit `0`), a bootstrap failure against an unreachable URL (exit `1`, only
the "bootstraps" check fails), and a startup-budget failure via a deliberately tiny `--budget-ms`
(exit `1`, only that one check fails, everything else still reported).

## Related

- [docs/performance.md](performance.md) - `Ui5Performance`, the library call the timing checks are
  built on
- [docs/messages.md](messages.md) - `Ui5Messages`, the library call the error check is built on
- [docs/locator-health.md](locator-health.md) - a different kind of CI gate: not "does the app
  work", but "are the tests' own locators drifting"
