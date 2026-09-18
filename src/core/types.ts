/**
 * Minimal info about a resolved UI5 control, sent across the Playwright <-> browser bridge.
 */
export interface Ui5ControlInfo {
  id: string;
  type: string;
}

/**
 * A richer dump of a control, used by the Page Object generator.
 */
export interface Ui5ControlDump {
  id: string;
  type: string;
  properties: Record<string, string>;
  parentId?: string;
}

/** A single locator strategy. `Ui5Locator` resolves these in order until one matches. */
export type Ui5LocatorCriteria =
  | { by: 'id'; value: string; exact?: boolean }
  | { by: 'controlType'; controlType: string; properties?: Record<string, unknown> }
  | { by: 'bindingPath'; path: string; controlType?: string }
  | { by: 'text'; text: string; controlType?: string; exact?: boolean }
  | { by: 'css'; selector: string }
  | { by: 'role'; role: string; name?: string };

export interface WaitForUi5Options {
  /** Max time to wait, in milliseconds. Default 15000. */
  timeout?: number;
}

/** Emitted whenever a `Ui5Locator` had to fall back past its primary strategy. */
export interface HealEvent {
  label?: string;
  strategyIndex: number;
  strategy: Ui5LocatorCriteria;
  attempt: number;
}

export type HealListener = (event: HealEvent) => void;
