# More free demo apps

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> code on this page looks unfamiliar.

Every other doc in this project either explains one piece of the framework, or points at an
isolated, single-control sample from the SAPUI5 SDK's **Samples** section (a page built to show
off one control, nothing else). This page is different: it's a tour of four real, complete, free
applications from the SDK's own **[Demo Apps](https://ui5.sap.com/#/demoapps)** catalog - each one
a genuine, functioning app built to demonstrate a whole SAPUI5 pattern, not a single control. If
you're building tests against a real Fiori app and want to see this framework used against
something closer to what you're actually testing than a controls showcase, these are it.

All four are free, public, and live - no login, no setup, nothing to install. Every example below
is a real, passing test; run them yourself with `npm test` (see
[Getting started](getting-started.md#7-run-the-examples-in-this-repository)) or open the app URL
directly in a browser to look around first.

| App                                                                         | Pattern it demonstrates                                               | Example test                                                                 |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [Manage Products](#manage-products-a-real-fiori-elements-app)               | A complete Fiori Elements List Report + Object Page                   | [`fiori-elements-app.spec.ts`](../examples/tests/fiori-elements-app.spec.ts) |
| [Browse Orders](#browse-orders-master-detail-navigation)                    | Classic master-detail / list-detail navigation                        | [`master-detail.spec.ts`](../examples/tests/master-detail.spec.ts)           |
| [Team Calendar](#team-calendar-samplanningcalendar)                         | `sap.m.PlanningCalendar` - resource rows, appointments, view switches | [`team-calendar.spec.ts`](../examples/tests/team-calendar.spec.ts)           |
| [Shop Administration Tool](#shop-administration-tool-a-different-app-shell) | An `sap.tnt.ToolPage` app shell (side nav + tool header)              | [`tool-page-shell.spec.ts`](../examples/tests/tool-page-shell.spec.ts)       |

None of these needed new framework code - every example below is built entirely from things
already covered elsewhere in these docs (`ui5()`, `Ui5Table`, `Ui5SmartFilterBar`/`Ui5SmartTable`,
custom matchers). That's deliberate: the point of this page is to show the existing toolkit
holding up against real, complete applications, not to introduce anything new. The one exception
is a genuinely new gotcha found along the way - see
[docs/troubleshooting.md#an-auto-detected-row-type-turns-out-to-be-wrong-immediately-after-navigation](troubleshooting.md#an-auto-detected-row-type-turns-out-to-be-wrong-immediately-after-navigation).

## Manage Products (a real Fiori Elements app)

```
https://ui5.sap.com/test-resources/sap/suite/ui/generic/template/demokit/sample.manage.products.sepmra/test/index.html?sap-ui-theme=sap_horizon#masterDetail-display
```

A complete, smart-template-generated Fiori Elements app: a List Report (SmartFilterBar +
SmartTable, 114 products) that navigates to a full Object Page (header, IconTabBar sections,
nested tables for reviews/inventory) when you select a row. This is what
[`Ui5SmartFilterBar`/`Ui5SmartTable`](smart-controls.md) look like used against the real thing
they were built for, rather than an isolated SDK sample - search, read the true row count, wrap
the (here, plain `sap.m.Table`) result list with [`Ui5Table`](ui5-table.md), click a row, and read
the Object Page that opens exactly the way you'd read any other page: `ui5(page).text(...)`.

Worth noticing in [`fiori-elements-app.spec.ts`](../examples/tests/fiori-elements-app.spec.ts):
the list report stays mounted in the DOM behind the Object Page after navigating (the same
`NavContainer`-keeps-previous-pages behavior documented in
[docs/troubleshooting.md](troubleshooting.md#an-id-locator-matches-two-elements-instead-of-one-and-playwright-refuses-to-act)),
so a plain-text search for something that also appears in the list (like an availability status)
can match more elements than you expect - scope with `controlType` the same way you would anywhere
else.

## Browse Orders (master-detail navigation)

```
https://ui5.sap.com/test-resources/sap/m/demokit/orderbrowser/webapp/test/mockServer.html?sap-ui-theme=sap_horizon
```

The classic `sap.m.SplitContainer`-based master-detail shell: a list of orders on one side, a
detail pane on the other, selecting a row updates the detail pane in place - no full-page
navigation, no route change. [`master-detail.spec.ts`](../examples/tests/master-detail.spec.ts)
wraps the master list with [`Ui5Table`](ui5-table.md), reads the selected row's own `title`
property through [`Ui5Bridge`](api-reference.md#ui5bridge) (the same "control property, not
rendered text" approach the [custom matchers](expect-matchers.md) use), and confirms the detail
pane's header updates to match - plus a second, nested `Ui5Table` for the detail pane's own "Line
Items" table.

This app's mock data loads on a delay that doesn't go through a real `fetch`/`XHR` call, so this
framework's request-tracking can't see it - which is exactly the timing gotcha behind
[docs/troubleshooting.md#an-auto-detected-row-type-turns-out-to-be-wrong-immediately-after-navigation](troubleshooting.md#an-auto-detected-row-type-turns-out-to-be-wrong-immediately-after-navigation).
Worth reading if you hit an unexpected row type or content mismatch right after navigating to a
real app of your own.

## Team Calendar (sap.m.PlanningCalendar)

```
https://ui5.sap.com/test-resources/sap/m/demokit/teamCalendar/webapp/index.html?sap-ui-theme=sap_horizon
```

A resource-row-by-date-column scheduling view - team members down the side, appointments across
the top, a Day/Week/Month view switch. Unlike a table or list, there's no natural "row" concept
here to wrap with a dedicated helper class - so
[`team-calendar.spec.ts`](../examples/tests/team-calendar.spec.ts) deliberately uses nothing but
this framework's general-purpose primitives (`ui5()`, `Ui5Bridge.findControlsByType`) to show they
hold up on their own: resource names are `sap.m._PlanningCalendarRowHeader` controls (findable
like any other, private-looking leading underscore notwithstanding), appointments are
`sap.ui.unified.CalendarAppointment` controls, and switching views is an ordinary button click
that changes how many of them exist.

One gotcha worth calling out: the Day/Week/Month toggle is an `sap.m.SegmentedButton`, but its
individual `SegmentedButtonItem`s are non-visual aggregation items with no DOM element of their
own - the thing that's actually rendered and clickable is the paired `sap.m.Button` each one
wraps. Always find the control that actually renders (`controlType: 'sap.m.Button'`, in this
case), not whichever type happens to hold the text you're matching on. And once clicked, that
button's own `type` property doesn't change to reflect selection - the parent `SegmentedButton`'s
`selectedKey` property is the real, verified signal for which item is currently active.

## Shop Administration Tool (a different app shell)

```
https://ui5.sap.com/test-resources/sap/tnt/demokit/toolpageapp/webapp/index.html?sap-ui-theme=sap_horizon
```

Every other example in this repo - including the other three apps on this page - runs inside a
plain `sap.m.App`/`sap.m.SplitApp` shell. This one uses `sap.tnt.ToolPage` instead: a side
navigation panel plus a tool header, the layout real backoffice/admin tools commonly use.
[`tool-page-shell.spec.ts`](../examples/tests/tool-page-shell.spec.ts) reads a dashboard
[`Ui5Table`](ui5-table.md) ("Customer Overview"), then drives navigation via
`sap.tnt.NavigationListItem` clicks - including an _expandable_ navigation group ("Statistics"),
where clicking the group itself only expands/collapses it, and the sub-item underneath is the one
that actually navigates. The point: side navigation, however it's styled, is still just "click
something, content changes" - no different from any other navigation pattern this framework
already handles.
