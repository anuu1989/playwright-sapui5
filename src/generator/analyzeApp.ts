import type { Page } from '@playwright/test';
import { Ui5Bridge } from '../core/Ui5Bridge';
import { Ui5Performance } from '../core/Ui5Performance';
import { summarizeByType } from '../core/diagnostics';
import type { Ui5ControlInfo, Ui5RouteInfo } from '../core/types';

/**
 * What the generator learned about an app by loading it. Everything here is *observed* - read off
 * the running app - rather than configured, which is the whole point: the generator's output is
 * only as good as what it can actually see.
 */
export interface Ui5AppAnalysis {
  url: string;
  appId?: string;
  appTitle?: string;
  componentName?: string;
  routerClass?: string;
  /** Routes reachable without inventing data - no required parameters. These are the ones worth
   * generating navigation tests for. */
  navigableRoutes: Ui5RouteInfo[];
  /** Routes needing parameters the generator has no way to know. Emitted as commented-out TODOs
   * rather than silently skipped, so nobody assumes the app has fewer screens than it does. */
  parameterizedRoutes: Ui5RouteInfo[];
  dataSources: string[];
  modelNames: string[];
  hasI18n: boolean;
  controlCounts: { type: string; count: number }[];
  totalControls: number;
  /** Which of this framework's helpers apply to this app, decided by what's actually rendered. */
  features: {
    flexibleColumnLayout: boolean;
    smartFilterBar: boolean;
    smartTable: boolean;
    gridTable: boolean;
    responsiveTable: boolean;
    list: boolean;
    searchField: boolean;
    variantManagement: boolean;
    toolPage: boolean;
    planningCalendar: boolean;
    objectPage: boolean;
  };
  responsiveTables: Ui5ControlInfo[];
  gridTables: Ui5ControlInfo[];
  lists: Ui5ControlInfo[];
  /** How many rows/items were actually on screen during the analysis. This is what decides
   * whether the generated test asserts `> 0` or merely `>= 0`: an app whose table only fills
   * after a search (a Fiori Elements list report, say) legitimately shows zero rows on load, and
   * generating a `> 0` assertion for it would produce a suite that fails on its first run. */
  observedRows: { responsiveTable: number; list: number };
  /** Measured startup, used to derive a performance ceiling that suits this app rather than an
   * arbitrary constant. */
  bootstrapMs: number;
}

/** Control types whose presence tells the generator which helper to reach for. */
const FEATURE_TYPES = {
  flexibleColumnLayout: 'sap.f.FlexibleColumnLayout',
  smartFilterBar: 'sap.ui.comp.smartfilterbar.SmartFilterBar',
  smartTable: 'sap.ui.comp.smarttable.SmartTable',
  gridTable: 'sap.ui.table.Table',
  responsiveTable: 'sap.m.Table',
  list: 'sap.m.List',
  searchField: 'sap.m.SearchField',
  variantManagement: 'sap.ui.comp.smartvariants.SmartVariantManagement',
  toolPage: 'sap.tnt.ToolPage',
  planningCalendar: 'sap.m.PlanningCalendar',
  objectPage: 'sap.uxap.ObjectPageLayout',
} as const;

/**
 * Loads an app and works out what it is: which screens it has, what it's built from, and which of
 * this framework's helpers apply. Everything the test generator emits is derived from this.
 *
 * Deliberately does no clicking. The analysis has to be safe to run against any URL someone hands
 * it - including a real system - so it only navigates, reads and measures.
 */
export async function analyzeUi5App(
  page: Page,
  url: string,
  options: { timeout?: number } = {},
): Promise<Ui5AppAnalysis> {
  const timeout = options.timeout ?? 30000;

  // Measuring the bootstrap doubles as the navigation and the settle wait.
  const timings = await Ui5Performance.measureBootstrap(page, url, { timeout });

  const manifest = await Ui5Bridge.getAppManifestInfo(page);
  const modelNames: string[] = await Ui5Bridge.listModelNames(page).catch(() => []);
  const dump = await Ui5Bridge.dumpControlTree(page);
  const controlCounts = summarizeByType(dump);
  const present = new Set(controlCounts.map((entry) => entry.type));

  const features = Object.fromEntries(
    Object.entries(FEATURE_TYPES).map(([feature, type]) => [feature, present.has(type)]),
  ) as Ui5AppAnalysis['features'];

  // A route is safely navigable when it needs no parameters. Optional ones (`:id:`) are fine to
  // omit, which is exactly what makes them optional.
  const navigableRoutes = manifest.routes.filter((route) => route.required.length === 0);
  const parameterizedRoutes = manifest.routes.filter((route) => route.required.length > 0);

  return {
    url,
    appId: manifest.appId,
    // A manifest title is often the i18n placeholder `{{appTitle}}`; resolve it when it is.
    appTitle: (await resolveTitle(page, manifest.appTitle)) ?? (await page.title()),
    componentName: manifest.componentName,
    routerClass: manifest.routerClass,
    navigableRoutes,
    parameterizedRoutes,
    dataSources: manifest.dataSources,
    modelNames,
    hasI18n: modelNames.includes('i18n'),
    controlCounts,
    totalControls: dump.length,
    features,
    responsiveTables: await Ui5Bridge.findControlsByType(page, FEATURE_TYPES.responsiveTable),
    gridTables: await Ui5Bridge.findControlsByType(page, FEATURE_TYPES.gridTable),
    lists: await Ui5Bridge.findControlsByType(page, FEATURE_TYPES.list),
    // Row controls already showed up in the control census, so counting them costs nothing extra.
    observedRows: {
      responsiveTable: countOf(controlCounts, 'sap.m.ColumnListItem'),
      list:
        countOf(controlCounts, 'sap.m.StandardListItem') +
        countOf(controlCounts, 'sap.m.ObjectListItem') +
        countOf(controlCounts, 'sap.m.CustomListItem'),
    },
    bootstrapMs: timings.settledMs,
  };
}

function countOf(counts: { type: string; count: number }[], type: string): number {
  return counts.find((entry) => entry.type === type)?.count ?? 0;
}

/** A manifest `title` is frequently `{{someKey}}` - a pointer into the i18n bundle rather than a
 * title. Resolve it so the generated file's header says something a human recognizes. */
async function resolveTitle(page: Page, title: string | undefined): Promise<string | undefined> {
  if (!title) return undefined;
  const match = /^\{\{(.+)\}\}$/.exec(title.trim());
  if (!match) return title;
  const result = await Ui5Bridge.getI18nText(page, match[1]).catch(() => undefined);
  return result?.found ? result.value : title;
}
