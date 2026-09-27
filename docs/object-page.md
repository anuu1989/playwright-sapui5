# `Ui5ObjectPage`

> New to TypeScript? See [docs/typescript-for-beginners.md](typescript-for-beginners.md) if the
> code on this page looks unfamiliar.

`Ui5ObjectPage` reads and navigates a `sap.uxap.ObjectPageLayout` - the header + sections layout
behind essentially every Fiori Elements object page.

```ts
const objectPage = ui5(page).controlType('sap.uxap.ObjectPageLayout');

const sections = await Ui5ObjectPage.sections(page, objectPage);
expect(sections.map((s) => s.title)).toContain('Product Information');

await Ui5ObjectPage.scrollToSection(page, objectPage, 'Product Information');
expect(await Ui5ObjectPage.selectedSection(page, objectPage)).toBe(
  sections.find((s) => s.title === 'Product Information')!.id,
);
```

## Why this needs a helper

An Object Page can render its top-level sections in two genuinely different ways, and which one a
given app uses isn't something a test should have to special-case:

- **`iconTabBar` mode** - sections render as clickable tabs (see
  [docs/icon-tab-bar.md](icon-tab-bar.md)).
- **Scroll mode** - one long page, all sections stacked, with an anchor bar that highlights
  whichever section you've scrolled past.

Both modes are driven by the exact same underlying section/subsection structure and the same
`scrollToSection()` method under the hood - that's what this class reads and calls, instead of
handling two different DOM shapes.

## API

```ts
Ui5ObjectPage.sections(target, objectPage): Promise<Ui5ObjectPageSection[]>;
Ui5ObjectPage.selectedSection(target, objectPage): Promise<string | undefined>;
Ui5ObjectPage.scrollToSection(target, objectPage, title, options?): Promise<void>;
```

```ts
interface Ui5ObjectPageSection {
  id: string;
  title: string | undefined;
  subSections: { id: string; title: string | undefined }[];
}
```

`selectedSection()` returns the **id** of the section currently in view - the honest answer
regardless of display mode (whichever tab is active, or whichever section the anchor bar is
currently highlighting). `scrollToSection()` takes the section's visible **title** rather than its
id, since the id is an internal SAPUI5-generated string nobody would type by hand; it throws with
the list of known section titles if nothing matches.

`scrollToSection` calls the control's own `scrollToSection()` method - the same official API
SAPUI5's own anchor bar and tab clicks use internally - so it behaves identically whether the page
is in tab mode or scroll mode, and waits for the app to settle afterward, since some Object Pages
lazy-load a section's content on first view.

## Verified

Against a real, live Fiori Elements Object Page (SAP's own "Manage Products" demo - see
[docs/demo-apps.md](demo-apps.md) and
[`examples/tests/fiori-elements-app.spec.ts`](../examples/tests/fiori-elements-app.spec.ts)):
`sections()` returning the real five sections ("Header", "Supplier Information", "Product
Information", "Reviews", "Inventory Information") with their real subsections, `selectedSection()`
matching the page's initial section, and `scrollToSection()` actually moving to the target section
(confirmed by re-reading `selectedSection()` afterward and seeing it match the target section's id
exactly).

## Related

- [docs/icon-tab-bar.md](icon-tab-bar.md) - `Ui5IconTabBar`, for the tab strip an Object Page in
  tab mode renders these sections as
- [docs/flexible-column-layout.md](flexible-column-layout.md) - the shell an Object Page is usually
  shown inside of
