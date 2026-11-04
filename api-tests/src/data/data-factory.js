import { createGeneratorSync } from 'json-schema-faker';
import { allLocales, Faker } from '@faker-js/faker';
import { resolveSchema } from '../spec/schema-resolver.js';
import { deepMerge, isPlainObject } from '../utils/deep-merge.js';
import { applyHints } from './smart-hints.js';
import { deriveNegativeCases } from './negative-cases.js';

/** Stable 32-bit hash, used to derive a per-test seed from the run seed. */
export function hashSeed(...parts) {
  let h = 2166136261;
  for (const ch of parts.join('|')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/**
 * The `data` fixture: realistic, schema-valid test data generated from the OpenAPI spec.
 *
 *   data.build('addPet', { status: 'sold' })   request body for an operation, with overrides
 *   data.params('findPetsByStatus')            { path, query } with every required param filled
 *   data.fromSchema('User', { username })      any named component schema
 *   data.invalid('addPet')                     negative cases derived from the schema
 *   data.unique('order')                       unique string, safe across parallel workers
 *   data.faker                                 seeded Faker instance
 */
export class DataFactory {
  constructor({ registry, config, seed, workerIndex = 0 }) {
    this.registry = registry;
    this.options = config.data;
    this.seed = seed;
    this.workerIndex = workerIndex;
    this.counter = 0;

    const locale = allLocales[this.options.locale] ?? allLocales.en;
    this.faker = new Faker({ locale: [locale, allLocales.en, allLocales.base] });
    this.faker.seed(seed);
    const generatorOptions = {
      seed,
      useExamplesValue: false, // spec examples are constant; reusing them causes collisions
      useDefaultValue: true,
      maxDefaultItems: 2,
      refDepth: this.options.maxRefDepth,
      extensions: { faker: this.faker },
    };
    this.generators = {
      full: createGeneratorSync({ ...generatorOptions, alwaysFakeOptionals: this.options.includeOptionalFields }),
      required: createGeneratorSync({ ...generatorOptions, alwaysFakeOptionals: false, optionalsProbability: 0 }),
    };
  }

  /** Resolved (no $ref) request schema of an operation's body, or null. */
  requestSchema(ref) {
    const operation = this.registry.get(ref);
    if (!operation.requestBody?.schema) return null;
    return resolveSchema(this.registry.doc(operation.service), operation.requestBody.schema, {
      maxDepth: this.options.maxRefDepth,
      direction: 'request',
    });
  }

  #generate(service, schema, direction, { optional = true } = {}) {
    const resolved = resolveSchema(this.registry.doc(service), schema, {
      maxDepth: this.options.maxRefDepth,
      direction,
    });
    const value = this.generators[optional ? 'full' : 'required'].generate(applyHints(resolved));
    // Small generated ids collide with existing records on shared environments.
    if (isPlainObject(value) && ['integer', 'number'].includes(resolved.properties?.id?.type) && 'id' in value) {
      value.id = this.uniqueId();
    }
    return { resolved, value };
  }

  #requestSchema(ref) {
    const operation = this.registry.get(ref);
    if (!operation.requestBody?.schema) throw new Error(`Operation "${operation.id}" has no request body schema`);
    return operation;
  }

  /**
   * Generate a request body for an operation. Overrides are deep-merged; arrays replace.
   * Pass `{ optional: false }` to generate required fields only.
   */
  build(ref, overrides = {}, { optional = true } = {}) {
    const operation = this.#requestSchema(ref);
    const { value } = this.#generate(operation.service, operation.requestBody.schema, 'request', { optional });
    return isPlainObject(value) ? deepMerge(value, overrides) : value;
  }

  /** Generate `count` request bodies. */
  buildMany(ref, count, overrides = {}) {
    return Array.from({ length: count }, () => this.build(ref, overrides));
  }

  /** Generate an instance of a named component schema ("Pet", "User"). */
  fromSchema(name, overrides = {}, { service = this.registry.defaultService } = {}) {
    const doc = this.registry.doc(service);
    const ref = doc.swagger === '2.0' ? `#/definitions/${name}` : `#/components/schemas/${name}`;
    const { value } = this.#generate(service, { $ref: ref }, 'request');
    return deepMerge(value, overrides);
  }

  /** Generate required (and optionally all) path/query/header params: `{ path, query, headers }`. */
  params(ref, overrides = {}, { includeOptional = false } = {}) {
    const operation = this.registry.get(ref);
    const result = { path: {}, query: {}, headers: {} };
    const target = { path: 'path', query: 'query', header: 'headers' };
    for (const param of operation.parameters) {
      if (!target[param.in] || !(param.required || includeOptional)) continue;
      result[target[param.in]][param.name] = this.#generate(
        operation.service,
        param.schema ?? { type: 'string' },
        'request',
      ).value;
    }
    return deepMerge(result, overrides);
  }

  /** Negative test cases (missing/wrong-type/out-of-range fields) for an operation's body. */
  invalid(ref, validOverrides = {}) {
    const operation = this.#requestSchema(ref);
    const { resolved, value } = this.#generate(operation.service, operation.requestBody.schema, 'request');
    return deriveNegativeCases(resolved, deepMerge(value, validOverrides));
  }

  /** Unique, readable string such as "order_w2_lq3k9x_1"; never repeats within a run. */
  unique(prefix = 'test') {
    this.counter += 1;
    return `${prefix}_w${this.workerIndex}_${Date.now().toString(36)}_${this.counter}`;
  }

  /** Unique positive integer, handy for numeric ids. */
  uniqueId() {
    this.counter += 1;
    return Number(`${Date.now() % 1e9}${this.workerIndex}${this.counter % 100}`);
  }
}
