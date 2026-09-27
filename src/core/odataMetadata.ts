/**
 * Validating a mock payload against a real OData service's `$metadata` - the EDMX/CSDL XML
 * document every OData V2/V4 service publishes describing its entity types and their properties.
 * See docs/odata-metadata.md.
 *
 * The problem this solves: `mockODataCollection`/`mockODataEntity` (`odataMock.ts`) happily send
 * whatever `data` you hand them - a renamed field, a typo'd one, a property that never existed on
 * the real entity type - and the failure only shows up later, deep inside the app, as a confusing
 * binding error or a silently blank field. Checking `data`'s shape against the service's own
 * published contract catches that at test-setup time instead, with the exact property name that's
 * wrong.
 *
 * A small, purpose-built XML scan rather than a general XML parser dependency - EDMX's shape here
 * is narrow and well-known (self-closing `<Property>` elements inside `<EntityType>` blocks), and
 * pulling in a full XML/DOM library for that would be a large dependency for a small job, the same
 * reasoning `jiraClient.ts` and `odataMock.ts`'s own multipart batch builder already use.
 */

export interface ODataPropertySchema {
  name: string;
  /** The raw EDM type string as the service published it - e.g. `'Edm.String'`, `'Edm.Int32'`,
   * `'Collection(Edm.String)'`, or a complex/entity type's own name for a nested property. */
  type: string;
  nullable: boolean;
}

export interface ODataEntityTypeSchema {
  name: string;
  properties: ODataPropertySchema[];
  /** Navigation property names (an `$expand`-able relationship, not a plain data field) - present
   * in mock data for an expanded query, and deliberately not type-checked. */
  navigationPropertyNames: string[];
}

/** A parsed `$metadata` document. Entity types are keyed by their simple name (`'Product'`, not
 * `'ODataDemo.Product'`) - metadata's own errors already tell you which namespace you fetched. */
export interface ODataMetadata {
  entityTypes: Map<string, ODataEntityTypeSchema>;
}

/**
 * Parses an EDMX `$metadata` XML document into an `ODataMetadata`. Works against both V2 and V4
 * EDMX (they differ in the outer `edmx:Edmx`/`Schema` namespace URIs, which this doesn't care
 * about - it only looks at `EntityType`/`Property`/`NavigationProperty` element and attribute
 * names, which are the same shape in both versions).
 *
 * Deliberately narrow: reads `EntityType` blocks and their direct `Property`/`NavigationProperty`
 * children only. `ComplexType` definitions, associations, function imports and annotations are
 * not parsed - a property whose type is a complex type is still recorded (so its *name* is
 * validated), just not its own nested shape.
 */
export function parseODataMetadata(xml: string): ODataMetadata {
  const entityTypes = new Map<string, ODataEntityTypeSchema>();

  // One EntityType block at a time: `<EntityType Name="X" ...> ... </EntityType>`. `[\s\S]*?` (not
  // `.*?`) because a real EntityType body spans multiple lines once formatted, and `.` doesn't
  // match newlines by default.
  const entityTypeBlock = /<EntityType\b([^>]*)>([\s\S]*?)<\/EntityType>/g;
  let entityMatch: RegExpExecArray | null;
  while ((entityMatch = entityTypeBlock.exec(xml))) {
    const [, attrs, body] = entityMatch;
    const name = attribute(attrs, 'Name');
    if (!name) continue; // malformed metadata - skip rather than throw, this is a read helper

    const properties: ODataPropertySchema[] = [];
    const propertyTag = /<Property\b([^>]*?)\/?>/g;
    let propMatch: RegExpExecArray | null;
    while ((propMatch = propertyTag.exec(body))) {
      const propAttrs = propMatch[1];
      const propName = attribute(propAttrs, 'Name');
      const propType = attribute(propAttrs, 'Type');
      if (!propName || !propType) continue;
      properties.push({
        name: propName,
        type: propType,
        // EDM's own default is `Nullable="true"` when the attribute is omitted entirely.
        nullable: attribute(propAttrs, 'Nullable') !== 'false',
      });
    }

    const navigationPropertyNames: string[] = [];
    const navTag = /<NavigationProperty\b([^>]*?)\/?>/g;
    let navMatch: RegExpExecArray | null;
    while ((navMatch = navTag.exec(body))) {
      const navName = attribute(navMatch[1], 'Name');
      if (navName) navigationPropertyNames.push(navName);
    }

    entityTypes.set(name, { name, properties, navigationPropertyNames });
  }

  return { entityTypes };
}

/** Pulls one attribute's value out of a tag's raw attribute string (`Name="X" Type="Y"`). Simple
 * on purpose - EDMX attribute values don't contain the characters that would need real XML
 * attribute parsing to handle correctly. */
function attribute(attrs: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return match?.[1];
}

/**
 * Fetches and parses a service's `$metadata` document. Plain `fetch()` - no page, no browser
 * needed, since `$metadata` is a static document a test can (and should) fetch once, independent
 * of whatever page it's about to mock a route on.
 *
 * ```ts
 * const metadata = await fetchODataMetadata('https://services.odata.org/V2/Northwind/Northwind.svc/$metadata');
 * ```
 */
export async function fetchODataMetadata(
  url: string,
  options: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<ODataMetadata> {
  const response = await fetch(url, {
    headers: options.headers,
    signal: AbortSignal.timeout(options.timeoutMs ?? 15000),
  });
  if (!response.ok) {
    throw new Error(
      `[playwright-sapui5] fetchODataMetadata: GET ${url} failed: ${response.status} ${response.statusText}`,
    );
  }
  return parseODataMetadata(await response.text());
}

export interface ODataValidationIssue {
  /** Where in `data` the problem is - `'[2].ProductID'` for the third record's `ProductID` field,
   * or just the entity type name for a lookup failure. */
  path: string;
  message: string;
}

/**
 * Checks `data` (a single record, or an array of them) against `entityType`'s real shape in
 * `metadata`. Returns every issue found - an empty array means nothing looked wrong.
 *
 * **What this catches, reliably:** a property name that doesn't exist on the real entity type -
 * the typo'd or renamed field that would otherwise silently bind nothing in the real app. This is
 * the check worth having; it has no false-positive risk.
 *
 * **What this catches, best-effort:** a value whose JS type is unambiguously wrong for its EDM
 * type - a string for `Edm.Boolean`, a non-array for a `Collection(...)`. Deliberately lenient
 * beyond that: OData V2's JSON serialization represents `Edm.Int64`/`Edm.Decimal` as **quoted
 * strings** (to avoid JS number precision loss) and dates as `/Date(1234567890000)/`-style
 * strings, so numeric-vs-string and date-shaped mismatches are not flagged - doing so would flag
 * correctly-shaped mocks as broken. Nested complex-type shapes, required/key-field presence, and
 * expanded navigation-property payloads are not validated at all.
 */
export function validateAgainstODataMetadata(
  metadata: ODataMetadata,
  entityType: string,
  data: Record<string, unknown> | Record<string, unknown>[],
): ODataValidationIssue[] {
  const schema = metadata.entityTypes.get(entityType);
  if (!schema) {
    const known = [...metadata.entityTypes.keys()].join(', ') || '(none found in this $metadata)';
    return [
      {
        path: entityType,
        message: `no entity type named "${entityType}" in this $metadata. Known entity types: ${known}.`,
      },
    ];
  }

  const propertiesByName = new Map(schema.properties.map((p) => [p.name, p]));
  const navigationNames = new Set(schema.navigationPropertyNames);
  const records = Array.isArray(data) ? data : [data];
  const issues: ODataValidationIssue[] = [];

  records.forEach((record, index) => {
    const prefix = Array.isArray(data) ? `[${index}].` : '';
    for (const key of Object.keys(record)) {
      const property = propertiesByName.get(key);
      if (!property) {
        if (navigationNames.has(key)) continue; // an expanded navigation property - not a plain field
        const known = [...propertiesByName.keys()].join(', ') || '(none)';
        issues.push({
          path: `${prefix}${key}`,
          message: `"${key}" is not a property of "${entityType}". Known properties: ${known}.`,
        });
        continue;
      }
      const typeIssue = unambiguousTypeMismatch(property, record[key]);
      if (typeIssue) issues.push({ path: `${prefix}${key}`, message: typeIssue });
    }
  });

  return issues;
}

/** Only flags a mismatch that's wrong regardless of OData's JSON serialization quirks - see the
 * "best-effort" note on `validateAgainstODataMetadata` above for exactly why this stays narrow. */
function unambiguousTypeMismatch(
  property: ODataPropertySchema,
  value: unknown,
): string | undefined {
  if (value === null || value === undefined) return undefined; // nullability isn't checked here

  if (property.type.startsWith('Collection(')) {
    return Array.isArray(value)
      ? undefined
      : `expected an array for "Collection(...)" property "${property.name}", got ${typeof value}.`;
  }
  if (property.type === 'Edm.Boolean') {
    return typeof value === 'boolean'
      ? undefined
      : `expected a boolean for "${property.name}" (Edm.Boolean), got ${typeof value}.`;
  }
  // Every other EDM primitive (String, Int*, Decimal, DateTime, Guid, Binary, ...) and every
  // complex/entity type is deliberately not checked further - see the doc comment above.
  return undefined;
}
