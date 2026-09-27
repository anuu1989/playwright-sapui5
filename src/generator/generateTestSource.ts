import type { Ui5AppAnalysis } from './analyzeApp';

/**
 * Turns an app analysis into a runnable Playwright spec file. A pure function - analysis in,
 * TypeScript source out, no I/O and no browser - which is what makes the generator's output
 * testable on its own. See docs/test-generator.md.
 *
 * Two principles shape what it emits:
 *
 * **Only tests that should pass.** A generated suite that fails on first run is worse than no
 * suite: it trains people to ignore red. So every emitted assertion is derived from something the
 * analysis actually observed - a table it saw, a route the manifest declares - and the
 * performance ceiling is scaled from the startup it measured rather than picked out of the air.
 *
 * **Never generate a destructive action.** The generator has no idea whether a button says
 * "Delete Order" or "Show Details", and it may well be pointed at a real system. So it clicks
 * nothing: it navigates by route, reads tables, and asserts. Interactions a human should consider
 * are emitted as commented-out TODOs, with the reason attached.
 */
export function generateTestSource(
  analysis: Ui5AppAnalysis,
  options: { title?: string; importFrom?: string } = {},
): string {
  const title = options.title ?? analysis.appTitle ?? analysis.appId ?? 'SAPUI5 app';
  // Normally the published package name; overridable so the generated file can also be run from
  // inside this repository, where the framework is imported by relative path.
  const importFrom = options.importFrom ?? 'playwright-sapui5';
  // Decide which tests to emit *first*, then derive the import list from that decision. Doing it
  // the other way round is how a generated file ends up importing a helper it never uses.
  const plan = planTests(analysis);
  const imports = collectImports(plan);
  const lines: string[] = [];

  lines.push(...fileHeader(analysis, title));
  lines.push(`import { test, expect } from ${quote(importFrom)};`);
  if (imports.length > 0) {
    lines.push(`import { ${imports.join(', ')} } from ${quote(importFrom)};`);
  }
  lines.push('');
  lines.push(`const APP_URL = ${quote(analysis.url)};`);
  lines.push('');
  lines.push(`test.describe(${quote(title)}, () => {`);
  lines.push(...beforeEachBlock());

  lines.push(...smokeTest());
  lines.push(...performanceTest(analysis));
  if (plan.navigation) lines.push(...navigationTest(analysis));
  if (plan.flexibleColumnLayout) lines.push(...flexibleColumnLayoutTest());
  if (plan.smartControls) lines.push(...smartControlsTest());
  if (plan.variantManagement) lines.push(...variantTest());
  if (plan.responsiveTable) lines.push(...responsiveTableTest(analysis));
  else if (plan.gridTable) lines.push(...gridTableTest());
  else if (plan.list) lines.push(...listTest());

  lines.push(...todoBlock(analysis));
  lines.push('});');
  lines.push('');
  return lines.join('\n');
}

/**
 * Navigating and *waiting* in one place. The waits are not optional: `page.goto()` returns as soon
 * as the document loads, which for a SAPUI5 app is long before the runtime has booted or a single
 * control exists. Reading anything at that point sees an empty page - the single most common way a
 * generated suite fails on its first run.
 */
function beforeEachBlock(): string[] {
  return [
    '',
    '  test.beforeEach(async ({ page }) => {',
    '    await page.goto(APP_URL);',
    '    await waitForUi5Core(page);',
    '    await waitForUi5(page).catch(() => {',
    '      /* best-effort: an app that never fully settles is still worth testing */',
    '    });',
    '  });',
  ];
}

/** Emits a single-quoted string literal, matching the quote style of the rest of the generated
 * code. `JSON.stringify` would be simpler but always double-quotes, leaving generated files
 * inconsistent with themselves until someone runs Prettier over them. */
function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** Which tests this app warrants. Computed once so the emitted tests and the import list are
 * guaranteed to agree. */
interface TestPlan {
  navigation: boolean;
  flexibleColumnLayout: boolean;
  smartControls: boolean;
  variantManagement: boolean;
  responsiveTable: boolean;
  gridTable: boolean;
  list: boolean;
}

function planTests(analysis: Ui5AppAnalysis): TestPlan {
  // A SmartFilterBar means the table below it is populated by searching, which the smart-controls
  // test already drives - a second, standalone table test would just assert against an empty
  // table before any search happened.
  const smartControls = analysis.features.smartFilterBar && analysis.features.smartTable;
  const responsiveTable = analysis.responsiveTables.length > 0 && !smartControls;
  const gridTable = !responsiveTable && analysis.gridTables.length > 0 && !smartControls;
  return {
    navigation: analysis.navigableRoutes.length > 0,
    flexibleColumnLayout: analysis.features.flexibleColumnLayout,
    smartControls,
    variantManagement: analysis.features.variantManagement,
    responsiveTable,
    gridTable,
    list: !responsiveTable && !gridTable && analysis.lists.length > 0,
  };
}

function fileHeader(analysis: Ui5AppAnalysis, title: string): string[] {
  const detected = Object.entries(analysis.features)
    .filter(([, present]) => present)
    .map(([feature]) => feature);
  return [
    '/**',
    ` * Generated by \`pw-sapui5 generate-tests\` from a live run of this app.`,
    ' *',
    ` * App:        ${title}${analysis.appId ? ` (${analysis.appId})` : ''}`,
    ` * Controls:   ${analysis.totalControls} rendered, top types: ${analysis.controlCounts
      .slice(0, 5)
      .map((entry) => `${entry.type} x${entry.count}`)
      .join(', ')}`,
    ` * Routes:     ${analysis.navigableRoutes.length} navigable, ${analysis.parameterizedRoutes.length} needing parameters`,
    ` * Detected:   ${detected.length > 0 ? detected.join(', ') : 'no specialised controls'}`,
    ' *',
    ' * This is a STARTING POINT, not a finished suite. Everything below was derived from what the',
    ' * app actually rendered, so it should pass as-is - but it only covers what a machine can',
    ' * safely infer: navigation, presence and shape. It deliberately clicks nothing, because the',
    ' * generator can\'t tell "Show Details" from "Delete Order" and may be pointed at a real',
    ' * system. See the TODOs at the bottom for what to add by hand.',
    ' */',
  ];
}

/** Derived from the plan, never from the analysis directly - that's what keeps the import list and
 * the emitted tests in step. Importing a helper the file never uses is a lint error in a
 * reasonably configured project, so a generated file that did it wouldn't be usable as-is. */
function collectImports(plan: TestPlan): string[] {
  const imports = new Set<string>([
    'Ui5Messages',
    'Ui5Performance',
    'waitForUi5',
    'waitForUi5Core',
  ]);
  if (plan.navigation) imports.add('Ui5Navigation');
  if (plan.flexibleColumnLayout) imports.add('Ui5FlexibleColumnLayout');
  if (plan.smartControls) {
    imports.add('Ui5SmartFilterBar');
    imports.add('Ui5SmartTable');
  }
  if (plan.variantManagement) imports.add('Ui5VariantManagement');
  if (plan.responsiveTable || plan.list) imports.add('Ui5Table');
  if (plan.gridTable) imports.add('Ui5GridTable');
  // `ui5()` is only needed by the tests that build a locator for one specific control.
  if (
    plan.smartControls ||
    plan.variantManagement ||
    plan.responsiveTable ||
    plan.gridTable ||
    plan.list
  ) {
    imports.add('ui5');
  }
  return [...imports].sort();
}

function smokeTest(): string[] {
  return [
    '',
    "  test('loads and renders without errors', async ({ page }) => {",
    '',
    '    // The app rendered a real control tree - the most basic "did it actually start" check,',
    '    // and one a screenshot or a DOM assertion can miss when UI5 half-boots.',
    '    const metrics = await Ui5Performance.metrics(page);',
    '    expect(metrics.controlCount ?? 0).toBeGreaterThan(0);',
    '',
    "    // SAPUI5's central message model collects validation and OData backend errors - including",
    '    // ones the UI never surfaces anywhere visible.',
    '    expect(await Ui5Messages.errors(page)).toEqual([]);',
    '  });',
  ];
}

function performanceTest(analysis: Ui5AppAnalysis): string[] {
  // Scale the ceiling off the observed startup so it suits this app, with a floor so a fast
  // machine's measurement doesn't produce a budget nothing else can meet.
  const ceiling = Math.max(15000, Math.ceil((analysis.bootstrapMs * 3) / 1000) * 1000);
  return [
    '',
    "  test('starts up within a sensible budget', async ({ page }) => {",
    '    const timings = await Ui5Performance.measureBootstrap(page, APP_URL);',
    '',
    `    // Measured at ~${analysis.bootstrapMs}ms when these tests were generated; this ceiling is`,
    '    // roughly 3x that, so it catches a real regression without flaking on a slow CI runner.',
    `    expect(timings.settledMs).toBeLessThan(${ceiling});`,
    '  });',
  ];
}

function navigationTest(analysis: Ui5AppAnalysis): string[] {
  const routes = analysis.navigableRoutes.slice(0, 8);
  const lines = [
    '',
    '  // One per route the manifest declares reachable without parameters. `waitForHash` matters',
    "  // here: SAPUI5's own navTo does nothing for an unknown route rather than throwing, so",
    '  // without it a broken route would pass silently.',
    `  for (const route of ${JSON.stringify(routes.map((route) => ({ name: route.name, pattern: route.pattern })))}) {`,
    // Single-quoted here on purpose: the `${route.name}` has to survive into the generated file
    // as a template placeholder, not be interpolated while generating it.
    '    test(`navigates to the "${route.name}" route`, async ({ page }) => {',
    '      await Ui5Navigation.navTo(page, route.name);',
    '      await Ui5Navigation.waitForHash(page, route.pattern);',
    '',
    '      expect(await Ui5Messages.errors(page)).toEqual([]);',
    '    });',
    '  }',
  ];
  return lines;
}

function flexibleColumnLayoutTest(): string[] {
  return [
    '',
    "  test('the multi-column shell reports a valid layout', async ({ page }) => {",
    '',
    "    // All columns exist in the DOM at all times, so the control's own layout enum is the only",
    '    // honest answer to "how many columns are showing".',
    '    const layout = await Ui5FlexibleColumnLayout.layout(page);',
    '    expect(layout).toBeTruthy();',
    '    expect(await Ui5FlexibleColumnLayout.visibleColumnCount(page)).toBeGreaterThanOrEqual(1);',
    '  });',
  ];
}

function smartControlsTest(): string[] {
  return [
    '',
    "  test('the list report searches and returns rows', async ({ page }) => {",
    '',
    '    const filterBar = await Ui5SmartFilterBar.from(',
    "      ui5(page).controlType('sap.ui.comp.smartfilterbar.SmartFilterBar'),",
    '    );',
    '    const smartTable = await Ui5SmartTable.from(',
    "      ui5(page).controlType('sap.ui.comp.smarttable.SmartTable'),",
    '    );',
    '',
    '    // Searching with no filter set is what pressing "Go" on an empty filter bar does.',
    '    await filterBar.search({ timeout: 20000 });',
    '',
    "    // The true count from the table's data binding - not however many rows happen to be",
    '    // rendered, which matters because a SmartTable is often backed by a virtualized grid.',
    '    expect(await smartTable.rowCount()).toBeGreaterThanOrEqual(0);',
    '    expect(await Ui5Messages.errors(page)).toEqual([]);',
    '  });',
  ];
}

function variantTest(): string[] {
  return [
    '',
    "  test('variant management exposes at least the standard variant', async ({ page }) => {",
    '',
    '    const variantManagement = ui5(page).controlType(',
    "      'sap.ui.comp.smartvariants.SmartVariantManagement',",
    '    );',
    '    await variantManagement.waitFor({ timeout: 20000 });',
    '',
    '    expect((await Ui5VariantManagement.variants(page, variantManagement)).length,',
    '    ).toBeGreaterThan(0);',
    '    expect(await Ui5VariantManagement.currentKey(page, variantManagement)).toBeTruthy();',
    '  });',
  ];
}

function responsiveTableTest(analysis: Ui5AppAnalysis): string[] {
  // Only assert the table has content if it actually had content during the analysis. A Fiori
  // Elements list report legitimately shows zero rows until someone searches, and emitting a
  // `> 0` assertion for one would ship a suite that fails on its first run.
  const sawRows = analysis.observedRows.responsiveTable > 0;
  return [
    '',
    "  test('the table renders rows', async ({ page }) => {",
    '',
    "    // Waiting for a row first: Ui5Table.from() waits for the table's root, not for its data,",
    '    // and its row-type detection can otherwise latch onto the wrong thing. See',
    '    // docs/troubleshooting.md.',
    "    await ui5(page).controlType('sap.m.ColumnListItem').waitFor({ timeout: 15000 });",
    "    const table = await Ui5Table.from(ui5(page).controlType('sap.m.Table'));",
    '',
    sawRows
      ? `    expect(await table.rowCount()).toBeGreaterThan(0); // ${analysis.observedRows.responsiveTable} rows seen when generated`
      : '    expect(await table.rowCount()).toBeGreaterThanOrEqual(0); // empty until searched when generated',
    '    expect((await table.columnHeaders()).length).toBeGreaterThan(0);',
    '  });',
  ];
}

function gridTableTest(): string[] {
  return [
    '',
    "  test('the grid table reports its true row count', async ({ page }) => {",
    '',
    "    const tableLocator = ui5(page).controlType('sap.ui.table.Table');",
    '    await tableLocator.waitFor({ timeout: 15000 });',
    '    const table = await Ui5GridTable.from(tableLocator);',
    '',
    '    // From the data binding, not the DOM: a grid table only renders a small window of its rows.',
    '    expect(await table.rowCount()).toBeGreaterThanOrEqual(0);',
    '    expect((await table.columnHeaders()).length).toBeGreaterThan(0);',
    '  });',
  ];
}

function listTest(): string[] {
  return [
    '',
    "  test('the list renders items', async ({ page }) => {",
    '',
    "    const listLocator = ui5(page).controlType('sap.m.List');",
    '    await listLocator.waitFor({ timeout: 15000 });',
    '    const list = await Ui5Table.from(listLocator);',
    '',
    '    expect(await list.rowCount()).toBeGreaterThanOrEqual(0);',
    '  });',
  ];
}

/** What a machine shouldn't decide on its own, written down so it doesn't look like the app has
 * fewer screens or behaviours than it really does. */
function todoBlock(analysis: Ui5AppAnalysis): string[] {
  const lines = [
    '',
    '  // ---------------------------------------------------------------------------------------',
    '  // TODO: the parts a generator should not write for you',
    '  //',
    '  // Nothing above clicks anything. Add the real user journeys here - they are what actually',
    '  // tests the app, and they need a human who knows which buttons are safe to press and what',
    '  // the app is supposed to do afterwards.',
  ];

  if (analysis.parameterizedRoutes.length > 0) {
    lines.push('  //');
    lines.push('  // Routes needing parameters the generator had no way to invent:');
    for (const route of analysis.parameterizedRoutes.slice(0, 8)) {
      lines.push(
        `  //   await Ui5Navigation.navTo(page, '${route.name}', { ${route.required
          .map((parameter) => `${parameter}: '...'`)
          .join(', ')} });  // pattern: ${route.pattern}`,
      );
    }
  }

  if (analysis.features.searchField) {
    lines.push('  //');
    lines.push(
      '  // A search field was found - filling it is safe, asserting the result is yours:',
    );
    lines.push("  //   await ui5(page).controlType('sap.m.SearchField').fill('something');");
  }

  lines.push('  //');
  lines.push('  // Also worth adding by hand:');
  lines.push('  //   - assertions on business data via Ui5Model (docs/model-data.md)');
  lines.push('  //   - text assertions via Ui5I18n so they survive translation (docs/i18n.md)');
  lines.push('  //   - toast/message assertions after actions (docs/messages.md)');
  lines.push(
    '  // ---------------------------------------------------------------------------------------',
  );
  return lines;
}
