# TypeScript, for absolute beginners

Every other guide in this project assumes you can read TypeScript. This page assumes you
**can't** - it explains every piece of TypeScript syntax you'll actually meet in this framework's
code and docs, in plain language, with small examples. Read it once before
[Getting started](getting-started.md), or keep it open in another tab and come back whenever a
piece of syntax looks unfamiliar.

You don't need to become a TypeScript expert to use this framework. You need to recognize maybe
15 pieces of syntax. This page covers all of them.

## What TypeScript actually is

TypeScript is JavaScript with an extra layer: **type annotations**. Every valid JavaScript
program is (almost) valid TypeScript. The difference is that in TypeScript you can - and, in this
project, do - say what _kind_ of value something is: a string, a number, a specific object shape,
and so on. A separate tool (the TypeScript compiler, `tsc`) reads your code and checks that you
never accidentally use a value the wrong way (e.g. call `.toUpperCase()` on a number), catching
that mistake **before** you run anything, instead of finding out at runtime.

```ts
function shout(message: string): string {
  return message.toUpperCase() + '!';
}

shout('hello'); // fine
shout(42); // TypeScript refuses to compile this - 42 isn't a string
```

That's genuinely most of what you need to know conceptually. The rest of this page is about
reading the _syntax_ TypeScript uses to write those annotations.

## How `.ts` files actually run in this project

If you've only used plain JavaScript before, you might expect a manual "compile" step. You don't
need one here:

- **Playwright's test runner** (`playwright test`) understands `.ts` files natively - it
  transforms them on the fly. That's why `npx playwright test tests/example.spec.ts` just works.
- **Publishing the library** (`npm run build`) does run the real compiler (`tsc`), which type-checks
  everything and writes plain `.js` files to `dist/` - that's what gets published to npm and what
  your project actually imports at runtime. You don't need to think about this as a user of the
  library; it's mentioned here so the `dist/` folder and `npm run build` script in
  [the README](../README.md#project-layout) don't seem mysterious.

## Variables: `let` and `const`

Same as JavaScript - nothing TypeScript-specific here, just a reminder since you'll see both:

```ts
const url = 'https://example.com'; // can't be reassigned
let count = 0; // can be reassigned
count = count + 1;
```

This project (and most modern TypeScript) uses `const` by default and only reaches for `let` when
a value genuinely needs to change.

## Type annotations on variables

A colon after a name introduces its type. You'll see this most often on function parameters (next
section), but occasionally on a variable too:

```ts
const name: string = 'CartPage';
const retries: number = 3;
const enabled: boolean = true;
```

In practice, you rarely need to write these for local variables - TypeScript figures out
(**infers**) the type from the value on the right automatically. You'll see explicit annotations
mostly on **function parameters** and **return types**, where TypeScript has nothing to infer
from yet.

## Functions: parameters, optional parameters, return types

```ts
function greet(name: string): string {
  return `Hello, ${name}!`;
}
```

Reading this left to right: `greet` takes one parameter, `name`, which must be a `string`. The
`: string` after the closing `)` says what the function **returns**.

A `?` after a parameter name makes it **optional** - you can call the function without it:

```ts
function greet(name: string, greeting?: string): string {
  return `${greeting ?? 'Hello'}, ${name}!`;
}

greet('Ada'); // "Hello, Ada!"
greet('Ada', 'Hi'); // "Hi, Ada!"
```

(That `??` is the **nullish coalescing operator** - "use the left side, unless it's `null` or
`undefined`, in which case use the right side." You'll see it used defensively throughout this
codebase.)

A default value does the same job as `?`, but also supplies what happens when the argument is
omitted, right in the signature:

```ts
function greet(name: string, greeting: string = 'Hello'): string {
  return `${greeting}, ${name}!`;
}
```

You'll see this exact pattern everywhere in this framework's own source, e.g. in
[`src/core/waits.ts`](../src/core/waits.ts):

```ts
export async function waitForUi5(page: Page, options: WaitForUi5Options = {}): Promise<void> {
```

Breaking that down:

- `export` - this function can be imported by other files (plain JavaScript ES module syntax,
  not TypeScript-specific).
- `async` - this function uses `await` inside it and always returns a `Promise` (see the [Async
  & Promises](#async-await-and-promises) section below).
- `page: Page` - a required parameter named `page`, of type `Page` (a type that `@playwright/test`
  defines - a browser tab, essentially).
- `options: WaitForUi5Options = {}` - an optional-in-practice parameter: if you don't pass one,
  it defaults to an empty object `{}`.
- `: Promise<void>` - the return type. `Promise` means "this resolves eventually, asynchronously"
  and `void` means "it doesn't resolve to any particular value" (see [Generics](#generics-the-t-in-arrayt) for what the `<...>` means).

## Objects and `interface`

An `interface` names the **shape** of an object: which properties it has, and their types.

```ts
interface Ui5ControlInfo {
  id: string;
  type: string;
}

const control: Ui5ControlInfo = { id: 'saveButton', type: 'sap.m.Button' };
```

This is exactly [`src/core/types.ts`](../src/core/types.ts) in this repo. Once you write
`interface Ui5ControlInfo`, TypeScript will refuse to let you build one missing a property, with
the wrong type, or with extra unexpected properties - all mistakes that plain JavaScript would
silently let you make and only reveal as a bug much later.

A `?` on an object property means "this property is optional," same idea as on a function
parameter:

```ts
interface Ui5ControlDump {
  id: string;
  type: string;
  parentId?: string; // may or may not be present
}
```

## Union types: "this, or that"

A `|` between types means "one of these." This is used constantly in this framework:

```ts
type Ui5LocatorCriteria =
  | { by: 'id'; value: string; exact?: boolean }
  | { by: 'controlType'; controlType: string; properties?: Record<string, unknown> }
  | { by: 'text'; text: string; controlType?: string; exact?: boolean };
```

Read this as: "a `Ui5LocatorCriteria` is _either_ an object with `by: 'id'` and a `value`, _or_
an object with `by: 'controlType'` and a `controlType`, _or_ an object with `by: 'text'` and a
`text`." The `'id'`, `'controlType'`, `'text'` values here are **literal types** - not just "any
string," but _that exact string and nothing else_. This is what lets
[`SelfHealingResolver`](../src/core/SelfHealingResolver.ts) safely branch on `criteria.by` and
have TypeScript guarantee every case is handled - a `switch` over a union like this is one of
TypeScript's most useful patterns, and it's exactly how the framework matches a locator's
strategy internally.

You don't need to write your own `Ui5LocatorCriteria` values directly as a beginner (you'll use
`ui5(page).id(...)`, `.controlType(...)`, etc. instead - see [docs/locators.md](locators.md)) -
but recognizing this shape will help when reading the framework's source or error messages.

## `type` vs `interface`

You'll see both `type Foo = ...` and `interface Foo { ... }` in this codebase. For your purposes
as a user of this framework, treat them as the same idea - a name for a shape of data. The
convention this project follows: `interface` for a plain object shape, `type` when the shape is a
union (like `Ui5LocatorCriteria` above) or otherwise not a single plain object.

## Arrays

```ts
const strategies: Ui5LocatorCriteria[] = [];
const names: string[] = ['a', 'b', 'c'];
```

`T[]` means "an array of `T`." That's it - `string[]` is an array of strings, `Ui5LocatorCriteria[]`
is an array of `Ui5LocatorCriteria` objects, and so on.

## Generics: the `<T>` in `Array<T>`

You'll see angle brackets after a type name throughout this codebase and in Playwright's own
types: `Promise<void>`, `Promise<Locator>`, `Record<string, unknown>`. This is TypeScript's way of
writing "a type that's parameterized by another type" - a **generic**.

- **`Promise<T>`** - "a promise that eventually resolves to a value of type `T`."
  `Promise<string>` resolves to a string. `Promise<void>` resolves to nothing meaningful (you'd
  `await` it for its side effect, not its return value).
- **`Record<K, V>`** - "an object whose keys are of type `K` and whose values are of type `V`."
  `Record<string, unknown>` (used for locator `properties` filters, e.g. `{ text: 'Save' }`) means
  "an object with string keys, and I'm not going to promise what type the values are."
- **`Array<T>`** is the same thing as `T[]` - just a different way to write it. This codebase uses
  `T[]`.

You don't need to write your own generic functions to use this framework - just recognize
`Something<OtherThing>` as "a `Something`, specialized to work with `OtherThing`."

## `unknown` vs `any`

Both mean "TypeScript doesn't know (or isn't told) exactly what this is," but they behave very
differently:

- **`any`** turns off type checking entirely for that value - you can do anything with it, and
  TypeScript won't stop you, even if it's wrong. Used sparingly in this codebase, mostly inside
  the browser bridge script (see below).
- **`unknown`** is safer: TypeScript still forces you to check what something actually is before
  you use it (e.g. with `typeof x === 'string'`). Used for property filter values
  (`Record<string, unknown>`), since a locator's property filter could reasonably be a string, a
  number, or a boolean.

As a beginner, the practical takeaway: if you see `any` in this codebase (mostly in
[`src/browser/bridgeScript.ts`](../src/browser/bridgeScript.ts)), it's because that code is
reaching into SAPUI5's own runtime objects, whose exact shape TypeScript has no way to know about

- not because the code is being careless.

## Classes

If you've used classes in any other language (or even in plain JavaScript), TypeScript's classes
will feel familiar, with a bit more annotation. This is the shape of `Ui5Page`, simplified:

```ts
export abstract class Ui5Page {
  constructor(protected readonly page: Page) {}

  protected id(value: string, options?: { exact?: boolean }): Ui5Locator {
    return Ui5Locator.id(this.page, value, options);
  }

  async goto(url: string): Promise<void> {
    await this.page.goto(url);
  }
}
```

Piece by piece:

- **`abstract class`** - a class that can't be instantiated directly (`new Ui5Page(page)` is not
  allowed). It only exists to be **extended**: `class CartPage extends Ui5Page { ... }`. This is
  exactly how you're meant to use it - see [docs/page-objects.md](page-objects.md).
- **`constructor(protected readonly page: Page) {}`** - this is a TypeScript shortcut. Writing
  `protected readonly page: Page` _inside the constructor's parameter list_ automatically creates
  a `page` property on the class and assigns it from the argument - equivalent to writing
  `protected readonly page: Page; constructor(page: Page) { this.page = page; }` the long way.
  - `protected` - this property is only accessible from inside this class or a subclass (like
    your own `CartPage`), not from outside code.
  - `readonly` - once set in the constructor, it can never be reassigned.
- **`protected id(...)`** - a method, accessible the same way as the `protected` property above.
  This is why, inside your own Page Object (which `extends Ui5Page`), you can call `this.id(...)`
  - but code outside the class can't call `somePage.id(...)` directly.
- **`async goto(url: string): Promise<void>`** - a method that uses `await` inside it. See the
  next section.

### Getters

You'll see `get someName()` a lot, both in `Ui5Page`'s own code and in every example Page Object:

```ts
class CartPage extends Ui5Page {
  get searchField() {
    return this.controlType('sap.m.SearchField');
  }
}
```

A `get` method is called **without** parentheses, like a property, not a method:

```ts
cart.searchField; // calls the getter, no ()
cart.searchField(); // wrong - searchField is not a function you call
```

Getters are used throughout this framework's Page Objects for locators specifically because a
locator is cheap to build and doesn't perform any action by itself (see
[docs/locators.md](locators.md)) - reading `cart.searchField` reads naturally as "the page's
search field," and you then call an action on it: `await cart.searchField.click()`.

## Async, `await`, and Promises

This is the single most important concept to understand, because **almost every function in this
framework is asynchronous** - browser automation is inherently about waiting for things (a page
to load, a network request to finish, an element to appear).

A `Promise` represents a value that isn't ready yet, but will be (or will fail) at some point in
the future. `async`/`await` is syntax for working with promises without nested callback
soup:

```ts
async function example() {
  const result = await somethingThatTakesTime();
  console.log(result); // only runs once the promise resolves
}
```

- Any function that uses `await` inside it must itself be marked `async`.
- `await somePromise` pauses that function (without blocking anything else) until the promise
  resolves, then gives you the resolved value.
- Calling an `async` function returns a `Promise` itself - which is why you'll see `async` and
  `Promise<...>` return types paired together everywhere in this codebase, e.g.
  `async click(): Promise<void>`.
- **You must `await` (or otherwise handle) a promise**, or your code will move on before the
  operation actually finishes - one of the most common bugs for anyone new to async code:

  ```ts
  cart.selectCategory('Laptops'); // BUG: missing `await` - the click may not have happened yet
  await expect(...).toBeVisible(); // could run too early
  ```

  ```ts
  await cart.selectCategory('Laptops'); // correct
  await expect(...).toBeVisible();
  ```

Every example in this project's docs uses `await` on every framework call for exactly this
reason - copy that habit.

## Import and export

```ts
// exporting from a file (e.g. src/core/Ui5Page.ts)
export class Ui5Page {
  /* ... */
}

// importing it elsewhere
import { Ui5Page } from 'playwright-sapui5';
```

`export` marks something as usable from other files; `import { Name } from '...'` (with curly
braces) pulls in one or more specific named exports. You'll also occasionally see
`import type { Page } from '@playwright/test'` - the `type` keyword there tells TypeScript "I only
need this for type-checking, not at runtime," which lets the compiler skip generating an actual
`import` for it in the compiled JavaScript. As a beginner, you can treat `import type { X }` the
same as `import { X }` - it behaves identically in your own code.

## Optional chaining: `?.`

```ts
const isReady = (window as any).__pwSapUi5__?.isCoreReady() === true;
```

`?.` means "if the thing on the left is `null` or `undefined`, stop here and produce `undefined`
instead of throwing an error." Without it, `window.__pwSapUi5__.isCoreReady()` would crash if
`__pwSapUi5__` hadn't been set up yet; with `?.`, it safely evaluates to `undefined` instead, and
the `=== true` check simply fails (which is the correct behavior here - "not ready yet").

## Type assertions: `as`

```ts
const w = window as unknown as Record<string, any>;
```

`as` tells TypeScript "trust me, treat this value as this other type" - it's an escape hatch, not
a conversion (it does nothing at runtime; the value is unchanged). You'll see this mostly in
[`src/browser/bridgeScript.ts`](../src/browser/bridgeScript.ts), where the code is deliberately
reaching into `window`'s SAPUI5-specific properties that TypeScript's built-in browser types have
no idea exist. `as unknown as X` (going through `unknown` first) is a common pattern for "this
cast is a big enough jump that TypeScript wants extra confirmation you mean it."

## Putting it all together: a fully annotated real example

Here's the test from [docs/getting-started.md](getting-started.md), with every piece of syntax
labeled:

```ts
import { test, expect } from 'playwright-sapui5';
// ^ import two named exports from the 'playwright-sapui5' package

import { CartPage } from '../pages/CartPage';
// ^ import one named export from a local file (relative path, starts with '.')

test('selecting a category shows its products', async ({ page }) => {
  //                                            ^async  ^ destructured parameter: pull `page`
  //                                             function  out of the object Playwright passes in
  const cart = new CartPage(page);
  // ^ `new ClassName(...)` constructs an instance of a class - creates one CartPage object

  await cart.open();
  // ^ `open()` is async (returns a Promise), so we `await` it before moving on

  await cart.selectCategory('Laptops');
  // ^ same idea - wait for the click (and everything it triggers) to actually happen

  await expect(await cart.text('Astro Laptop 1516').resolve()).toBeVisible();
  // ^ two `await`s here: one for `.resolve()` (returns a Promise<Locator>),
  //   one implicitly for `expect(...).toBeVisible()` (Playwright's assertions are also async)
});
```

If you can read that comment-by-comment breakdown and it makes sense, you have every piece of
TypeScript syntax you need for this entire framework.

## Reading a TypeScript error message

When you get something wrong, TypeScript (and your editor, if it has TypeScript support - VS Code
does, out of the box) will tell you, often before you even run anything. A typical one looks like:

```
Argument of type 'number' is not assignable to parameter of type 'string'.
```

Read these left to right as "you gave me _this_, but I expected _that_." They can look intimidating
with generics involved (`Promise<Locator>` vs `Promise<void>`, say), but the structure is always
the same: find the two types being compared, and figure out why they don't match. Most errors
you'll hit while using this framework come down to one of:

- Forgetting `await` on an async call (you'll get a `Promise<X>` where a plain `X` was expected).
- A typo in a property name inside an object literal (e.g. `{ contolType: '...' }` instead of
  `{ controlType: '...' }`).
- Passing the wrong type to a locator strategy (e.g. a number where a string was expected).

## Where to go from here

You now have enough to read every code example in this project's documentation. Continue with
[Getting started](getting-started.md), and come back here any time a piece of syntax looks
unfamiliar - this page isn't meant to be read once and forgotten, it's a reference.

If you want a deeper, general (not SAPUI5-specific) introduction to TypeScript afterward, the
official [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html) is
thorough and beginner-friendly.
