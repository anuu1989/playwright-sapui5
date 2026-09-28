import type { APIRequestContext } from '@playwright/test';
import { Ui5ODataClient } from './Ui5ODataClient';
import type { ODataMetadata } from './odataMetadata';

export interface Ui5ODataSeedOptions {
  /**
   * `$metadata` (from `fetchODataMetadata`) and the entity type name (see docs/odata-metadata.md
   * - the *type* name, e.g. `'Product'`, not the entity *set* name `'Products'` passed as `seed`'s
   * first argument) - used to look up the entity type's `<Key>` and auto-build the delete
   * predicate from the created entity's own key value(s).
   *
   * Only used when every key property is `Edm.String` - the one case a predicate can be built
   * without risking wrong OData literal syntax (`Edm.Int64` needs an `L` suffix, `Edm.Decimal` an
   * `M` suffix, `Edm.Guid` a `guid'...'` wrapper, `Edm.DateTime` a `datetime'...'` wrapper - none
   * of that has been verified against a real SAP Gateway, so it isn't guessed at here). Anything
   * else - a composite key, a non-string key, no metadata at all - needs `keyPredicate` instead.
   */
  entityType?: string;
  metadata?: ODataMetadata;
  /**
   * Builds the delete predicate yourself from the created entity's own body (the `d` wrapper
   * already unwrapped) - required for composite keys or non-`Edm.String` key types.
   *
   * ```ts
   * keyPredicate: (created) => `ProductID=${created.ProductID}` // Edm.Int32, unquoted
   * ```
   */
  keyPredicate?: (created: Record<string, unknown>) => string;
}

interface SeededEntity {
  entitySet: string;
  keyPredicate: string;
}

export interface Ui5ODataCleanupFailure extends SeededEntity {
  error: unknown;
}

/**
 * Seeds OData records for a test via `Ui5ODataClient` and guarantees they're deleted again -
 * even when the test fails partway through - instead of every test file hand-rolling its own
 * `try`/`finally` (or, worse, an `afterEach` that silently never runs because the test threw
 * before recording what to clean up). See docs/odata-seeder.md.
 *
 * ```ts
 * const seeder = await Ui5ODataSeeder.create(page.request, serviceUrl);
 * const product = await seeder.seed('Products', { ProductID: 'P1', Name: 'Widget' },
 *   { metadata, entityType: 'Product' }); // ProductID is Edm.String -> predicate auto-derived
 * // ... test uses the seeded product ...
 * await seeder.cleanup(); // deletes it, most-recently-seeded first
 * ```
 *
 * Cleanup order is LIFO deliberately - the last thing seeded is often the thing that depends on
 * everything seeded before it (a line item depending on its parent order), so deleting in reverse
 * avoids a delete failing because a dependent record still references it.
 */
export class Ui5ODataSeeder {
  private readonly seeded: SeededEntity[] = [];

  private constructor(private readonly client: Ui5ODataClient) {}

  /** Runs `Ui5ODataClient`'s own CSRF handshake and wraps the result. */
  static async create(
    request: APIRequestContext,
    serviceUrl: string,
    options: { headers?: Record<string, string> } = {},
  ): Promise<Ui5ODataSeeder> {
    return new Ui5ODataSeeder(await Ui5ODataClient.create(request, serviceUrl, options));
  }

  /** Wraps an already-created `Ui5ODataClient` - use this to share one CSRF handshake between a
   * seeder and direct `read()`/`update()` calls in the same test, instead of handshaking twice. */
  static fromClient(client: Ui5ODataClient): Ui5ODataSeeder {
    return new Ui5ODataSeeder(client);
  }

  /**
   * Creates an entity in `entitySet` via `data` and tracks it for `cleanup()`. Returns exactly
   * what `Ui5ODataClient.create` returns (the raw, still-`d`-wrapped JSON body), so existing
   * assertions against `Ui5ODataClient.create`'s return shape keep working unchanged.
   */
  async seed<T = unknown>(
    entitySet: string,
    data: Record<string, unknown>,
    options: Ui5ODataSeedOptions = {},
  ): Promise<T> {
    const created = await this.client.create(entitySet, data);
    const body = unwrapODataBody(created);
    const keyPredicate = options.keyPredicate
      ? options.keyPredicate(body)
      : this.deriveKeyPredicate(entitySet, body, options);
    this.seeded.push({ entitySet, keyPredicate });
    return created as T;
  }

  private deriveKeyPredicate(
    entitySet: string,
    body: Record<string, unknown>,
    options: Ui5ODataSeedOptions,
  ): string {
    if (!options.metadata || !options.entityType) {
      throw new Error(
        `[playwright-sapui5] Ui5ODataSeeder.seed: can't derive a delete predicate for "${entitySet}" ` +
          `without either options.keyPredicate or both options.metadata and options.entityType. ` +
          `See docs/odata-seeder.md.`,
      );
    }
    const schema = options.metadata.entityTypes.get(options.entityType);
    if (!schema) {
      const known = [...options.metadata.entityTypes.keys()].join(', ') || '(none)';
      throw new Error(
        `[playwright-sapui5] Ui5ODataSeeder.seed: no entity type named "${options.entityType}" in the ` +
          `given $metadata. Known entity types: ${known}.`,
      );
    }
    if (schema.keyPropertyNames.length === 0) {
      throw new Error(
        `[playwright-sapui5] Ui5ODataSeeder.seed: "${options.entityType}" has no <Key> in $metadata - ` +
          `pass options.keyPredicate to build the delete predicate yourself.`,
      );
    }
    const propertiesByName = new Map(schema.properties.map((p) => [p.name, p]));
    const nonString = schema.keyPropertyNames.filter(
      (name) => propertiesByName.get(name)?.type !== 'Edm.String',
    );
    if (nonString.length > 0) {
      throw new Error(
        `[playwright-sapui5] Ui5ODataSeeder.seed: "${options.entityType}"'s key propert${
          nonString.length > 1 ? 'ies' : 'y'
        } (${nonString.join(', ')}) ${nonString.length > 1 ? 'are' : 'is'} not Edm.String - automatic ` +
          `predicate formatting only supports string keys, to avoid guessing at unverified OData ` +
          `literal syntax for other EDM types. Pass options.keyPredicate to build it yourself, e.g. ` +
          `(created) => \`${nonString[0]}=\${created.${nonString[0]}}\` (Edm.Int32/Int64, unquoted).`,
      );
    }
    return schema.keyPropertyNames
      .map((name) => `${name}='${String(body[name]).replace(/'/g, "''")}'`)
      .join(',');
  }

  /**
   * Deletes every seeded entity, most-recently-seeded first. A failed delete doesn't stop the
   * rest - every entity is attempted regardless - and is reported back in the returned array
   * rather than thrown, so one already-gone record doesn't hide the others. Always empties the
   * tracked list, even when some deletes fail, so a second `cleanup()` call is a no-op rather than
   * re-attempting entities that no longer exist.
   */
  async cleanup(): Promise<Ui5ODataCleanupFailure[]> {
    const failures: Ui5ODataCleanupFailure[] = [];
    for (const entry of this.seeded.slice().reverse()) {
      try {
        await this.client.delete(`${entry.entitySet}(${entry.keyPredicate})`);
      } catch (error) {
        failures.push({ ...entry, error });
      }
    }
    this.seeded.length = 0;
    return failures;
  }
}

function unwrapODataBody(response: unknown): Record<string, unknown> {
  if (response && typeof response === 'object' && 'd' in (response as Record<string, unknown>)) {
    return (response as { d: Record<string, unknown> }).d;
  }
  return (response ?? {}) as Record<string, unknown>;
}
