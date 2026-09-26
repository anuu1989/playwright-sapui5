// This file is the package's entire public API surface. Whatever your own code can reach via
// `import { X } from 'playwright-sapui5'` is listed here - and, just as importantly, anything
// NOT re-exported from this file (helper functions used only internally, private class members,
// the raw `bridgeScript` function itself) is not part of the public API and can change between
// versions without it counting as a breaking change. If you're looking for where a symbol
// actually lives, follow the `from '...'` path on its line below.

// Importing this file (even without using anything it exports by name) is what makes the
// `declare module '@playwright/test'` type augmentation inside it take effect for anyone who
// imports from this package - see the comment at the bottom of `src/core/matchers.ts`. It's
// already reached transitively (via `./fixtures/test`, exported below), but importing it
// explicitly here means that stays true even if that internal path ever changes.
import './core/matchers';

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
export type { Ui5Target } from './core/Ui5Bridge';
export { SelfHealingResolver } from './core/SelfHealingResolver';
export { Ui5Table } from './core/Ui5Table';
export { Ui5Dialog } from './core/Ui5Dialog';
export { Ui5SmartFilterBar } from './core/Ui5SmartFilterBar';
export { Ui5SmartTable } from './core/Ui5SmartTable';
export { Ui5GridTable } from './core/Ui5GridTable';
export { Ui5ValueHelpDialog } from './core/Ui5ValueHelpDialog';
export { Ui5I18n } from './core/Ui5I18n';
export { Ui5Model } from './core/Ui5Model';
export { Ui5MessageToast } from './core/Ui5MessageToast';
export { Ui5Messages } from './core/Ui5Messages';
export { Ui5Select } from './core/Ui5Select';
export { Ui5DatePicker } from './core/Ui5DatePicker';
export { waitForUi5, waitForUi5Core } from './core/waits';
export { findUi5Frame } from './core/findUi5Frame';
export type { FindUi5FrameOptions } from './core/findUi5Frame';
export { test, expect } from './fixtures/test';
export { generatePageObjectSource } from './generator/generatePageObjectSource';
export { mockODataCollection, mockODataEntity, mockODataError } from './core/odataMock';
export type {
  Ui5ControlDump,
  Ui5ControlInfo,
  Ui5LocatorCriteria,
  WaitForUi5Options,
  HealEvent,
  HealListener,
  Ui5PropertyResult,
  Ui5TextResult,
  Ui5BridgeActionResult,
  Ui5FilterDataResult,
  Ui5SmartTableInfo,
  Ui5GridTableInfo,
  Ui5I18nResult,
  Ui5ModelPropertyResult,
  Ui5BindingContextResult,
  Ui5MessageToastRecord,
  Ui5MessageInfo,
  Ui5SelectItem,
  Ui5SelectInfo,
  Ui5DatePickerValue,
} from './core/types';
export type {
  ODataVersion,
  MockODataCollectionOptions,
  MockODataErrorOptions,
} from './core/odataMock';
