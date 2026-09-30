# `Ui5Wizard`

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> code on this page looks unfamiliar.

`Ui5Wizard` reads a `sap.m.Wizard`'s steps and current position, and advances it by clicking each
step's own "Next" button - the guided, multi-step flow control behind "Create Product"/"Set Up
Approval" style processes.

```ts
const wizard = ui5(page).controlType('sap.m.Wizard');
const steps = await Ui5Wizard.steps(page, wizard);
expect(steps.map((s) => s.title)).toEqual(['Product Type', 'Product Information', ...]);

await Ui5Wizard.next(page, wizard);
expect(await Ui5Wizard.currentStepIndex(page, wizard)).toBe(1);
```

## Why this needs a helper at all

Two things about a `Wizard` aren't visible text:

- **Which step is "current."** It's not a DOM attribute you can assert on directly - it's the
  control's own `getCurrentStep()`, which (verified against a real `sap.m.Wizard` SDK sample)
  returns the step **control itself**, not merely its id. `Ui5Wizard` unwraps that for you.
- **Whether a step will let you move past it.** A step's `validated` property gates the wizard's
  own progression, and isn't rendered anywhere.

Advancing is otherwise an ordinary click - each step gets its **own** "Next" button (SAPUI5's
default `renderMode: 'Scroll'` keeps every activated step mounted at once, rather than showing
just one), rendered at a verified, predictable id: `<stepId>-nextButton`. `Ui5Wizard.next()` reads
the current step, then clicks that button - the same real interaction a user makes, so the
control's own `complete`/`stepActivate` events fire normally.

## API

```ts
Ui5Wizard.steps(target, wizard): Promise<Ui5WizardStepInfo[]>;
Ui5Wizard.currentStepId(target, wizard): Promise<string | undefined>;
Ui5Wizard.currentStepIndex(target, wizard): Promise<number | undefined>; // 0-based
Ui5Wizard.progress(target, wizard): Promise<number | undefined>; // the wizard's own 1-based getProgress()
Ui5Wizard.next(target, wizard, options?): Promise<void>;
```

```ts
interface Ui5WizardStepInfo {
  id: string;
  title: string | undefined;
  validated: boolean; // the wizard won't allow moving past an unvalidated step
  optional: boolean;
}
```

`currentStepIndex()` is usually more useful than the raw id for an assertion like
`expect(await Ui5Wizard.currentStepIndex(page, wizard)).toBe(2)`. It's computed by finding
`currentStepId` inside `steps()` - so it only differs from `progress() - 1` once
`enableBranching` lets a user jump backward without losing progress on steps already completed
ahead of where they currently are.

`next()` throws a clear error if the current step has no `-nextButton` in the DOM - which is
expected on the wizard's **last** step, whose action is a differently-labelled "finish" button
(`finishButtonText`) that this deliberately doesn't guess at clicking. Drive that one with an
ordinary locator instead, scoped by its own text.

## Verified

Against the SAPUI5 SDK's own official `sap.m.Wizard` sample (a real "Create Product" wizard with
four steps): `steps()` returning the real step titles/validation state, `currentStepId()` and
`currentStepIndex()` correctly identifying the first step, `progress()` returning `1`, and
`next()` - a real click on `<stepId>-nextButton` - actually advancing the wizard, confirmed by
`currentStepIndex()` becoming `1` and `progress()` becoming `2` afterward. See
[`examples/tests/wizard.spec.ts`](../examples/tests/wizard.spec.ts).

## Related

- [docs/object-page.md](object-page.md), [docs/icon-tab-bar.md](icon-tab-bar.md) - other
  step/section-style navigation helpers with the same "read state off the control, click the real
  DOM to change it" shape
