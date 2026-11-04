import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { DataFactory, hashSeed } from '../../src/data/data-factory.js';
import { deriveNegativeCases } from '../../src/data/negative-cases.js';
import { applyHints, hintFor } from '../../src/data/smart-hints.js';
import { OperationRegistry } from '../../src/spec/operation-registry.js';
import { extractId } from '../../src/scenarios/resources.js';
import { findLeaks } from '../../src/scenarios/payloads.js';
import config from '../../config/index.js';

const petstore = JSON.parse(fs.readFileSync(new URL('../../specs/petstore.json', import.meta.url), 'utf8'));
const registry = new OperationRegistry({ petstore }, 'petstore');
const factory = (seed = 7) => new DataFactory({ registry, config, seed });

test.describe('data factory', () => {
  test('generates schema-valid bodies with overrides and unique ids', () => {
    const pet = factory().build('addPet', { status: 'sold' });
    expect(pet).toMatchObject({ status: 'sold', name: expect.any(String), photoUrls: expect.any(Array) });
    expect(pet.id).toBeGreaterThan(1_000_000);
    expect(factory().build('createUser').email).toMatch(/@/);
  });

  test('is deterministic for a seed', () => {
    const { id: _a, ...first } = factory(42).build('addPet');
    const { id: _b, ...second } = factory(42).build('addPet');
    expect(first).toEqual(second);
    expect(hashSeed(1, 'a')).toBe(hashSeed(1, 'a'));
    expect(hashSeed(1, 'a')).not.toBe(hashSeed(1, 'b'));
  });

  test('can generate required fields only, params and file content', () => {
    expect(Object.keys(factory().build('addPet', {}, { optional: false })).sort()).toEqual(['name', 'photoUrls']);
    expect(factory().params('findPetsByStatus').query.status).toMatch(/available|pending|sold/);
    expect(factory().build('uploadFile').length).toBeGreaterThan(0);
  });
});

test.describe('smart hints', () => {
  test('maps property names to faker and respects constraints', () => {
    expect(hintFor('emailAddress', { type: 'string' })).toBe('internet.email');
    expect(hintFor('user_name', { type: 'string' })).toBe('internet.username');
    expect(hintFor('status', { type: 'string', enum: ['a'] })).toBeNull();
    expect(applyHints({ type: 'integer' }).minimum).toBe(1);
    expect(applyHints({ type: 'integer', minimum: -5 }).minimum).toBe(-5);
  });
});

test.describe('negative cases', () => {
  test('derives missing, null, type, enum and range violations', () => {
    const schema = {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', maxLength: 3 },
        age: { type: 'integer', minimum: 0 },
        kind: { type: 'string', enum: ['a', 'b'] },
      },
    };
    const names = deriveNegativeCases(schema, { name: 'abc', age: 1, kind: 'a' }).map((c) => c.name);
    expect(names).toEqual([
      'empty body',
      'name: missing required field',
      'name: null for required field',
      'name: wrong type (expected string)',
      'name: longer than maxLength 3',
      'age: wrong type (expected integer)',
      'age: below minimum 0',
      'kind: wrong type (expected string)',
      'kind: value outside enum',
    ]);
  });
});

test.describe('resource ids and leak detection', () => {
  test('extracts ids by convention', () => {
    expect(extractId('petId', { id: 5 })).toBe(5);
    expect(extractId('orderId', { orderId: 'o-1', id: 9 })).toBe('o-1');
    expect(extractId('username', {}, { username: 'bob' })).toBe('bob');
    expect(extractId('id', { data: { id: 3 } })).toBe(3);
  });

  test('detects leaked internals', () => {
    expect(findLeaks('unable to convert input to io.swagger.petstore.model.Pet')).toEqual(['internal class name']);
    expect(findLeaks('{"photoUrls":["/tmp/inflector1.tmp"]}')).toEqual(['server file path']);
    expect(findLeaks('at com.acme.Foo.bar(Foo.java:42)')).toContain('Java stack trace');
    expect(findLeaks('{"message":"Pet not found"}')).toEqual([]);
  });
});
