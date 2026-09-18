// This file is the package's entire public API surface. Whatever your own code can reach via
// `import { X } from 'playwright-sapui5'` is listed here - and, just as importantly, anything
// NOT re-exported from this file (helper functions used only internally, private class members,
// the raw `bridgeScript` function itself) is not part of the public API and can change between
// versions without it counting as a breaking change. If you're looking for where a symbol
// actually lives, follow the `from '...'` path on its line below.

export { Ui5Locator } from './core/Ui5Locator';
// `export type { ... }` (as opposed to a plain `export { ... }`) re-exports something that only
// exists at the type level - `Ui5ActionOptions` is an `interface`, erased entirely when compiled
// to JavaScript (see docs/typescript-for-beginners.md#objects-and-interface). Marking it this way
// lets TypeScript's build step skip generating a runtime import for it, since there'd be nothing
// there to import.
export type { Ui5ActionOptions } from './core/Ui5Locator';
export { Ui5Page } from './core/Ui5Page';
export { ui5 } from './core/ui5';
export { Ui5Bridge } from './core/Ui5Bridge';
export { SelfHealingResolver } from './core/SelfHealingResolver';
export { waitForUi5, waitForUi5Core } from './core/waits';
export { test, expect } from './fixtures/test';
export { generatePageObjectSource } from './generator/generatePageObjectSource';
export type {
  Ui5ControlDump,
  Ui5ControlInfo,
  Ui5LocatorCriteria,
  WaitForUi5Options,
  HealEvent,
  HealListener,
} from './core/types';
