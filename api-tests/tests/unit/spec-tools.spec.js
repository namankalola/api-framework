import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { inferSchema } from '../../src/spec/schema-inference.js';
import { isPostmanCollection, postmanBaseUrl, postmanToOpenApi } from '../../src/spec/postman-converter.js';
import { baseUrlFromSpec, envPrefixFor, inferAuth, serviceNameFor } from '../../src/spec/discovery.js';
import { OperationRegistry } from '../../src/spec/operation-registry.js';
import { diffSpecs, hasBreakingChanges } from '../../src/spec/spec-diff.js';
import { resolveSchema } from '../../src/spec/schema-resolver.js';

const readJson = (file) => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), 'utf8'));
const petstore = readJson('../../specs/petstore.json');
const collection = readJson('../../examples/postman/jsonplaceholder.postman_collection.json');

test.describe('schema inference', () => {
  test('infers types, formats and required keys from samples', () => {
    const schema = inferSchema(
      { id: 1, email: 'a@b.co', at: '2024-01-01T10:00:00Z', tags: ['x'], note: 'n' },
      { id: 2.5, email: 'c@d.co', at: '2024-01-02T10:00:00Z', tags: [] },
    );
    expect(schema.properties.id.type).toBe('number');
    expect(schema.properties.email.format).toBe('email');
    expect(schema.properties.at.format).toBe('date-time');
    expect(schema.properties.tags).toEqual({ type: 'array', items: { type: 'string' } });
    expect(schema.required).toEqual(['id', 'email', 'at', 'tags']);
  });
});

test.describe('postman converter', () => {
  test('converts folders, path variables, bodies and saved responses', () => {
    expect(isPostmanCollection(collection)).toBe(true);
    expect(isPostmanCollection(petstore)).toBe(false);
    expect(postmanBaseUrl(collection)).toBe('https://jsonplaceholder.typicode.com');

    const doc = postmanToOpenApi(collection);
    expect(Object.keys(doc.paths)).toEqual(['/posts', '/posts/{id}']);
    expect(doc.paths['/posts'].get.operationId).toBe('listPosts');
    expect(doc.paths['/posts'].get.tags).toEqual(['Posts']);
    expect(doc.paths['/posts/{id}'].get.parameters[0]).toMatchObject({
      name: 'id',
      in: 'path',
      schema: { type: 'integer' },
    });
    expect(doc.paths['/posts'].post.requestBody.content['application/json'].schema.required).toEqual([
      'title',
      'body',
      'userId',
    ]);
    expect(doc.paths['/posts'].post.responses['201'].content['application/json'].schema.properties.id.type).toBe(
      'integer',
    );

    const registry = new OperationRegistry({ jp: doc });
    const [group] = registry.resourceGroups('jp');
    expect(group).toMatchObject({ collectionPath: '/posts', idParam: 'id' });
    expect([group.read.id, group.update.id, group.remove.id]).toEqual(['getPost', 'updatePost', 'deletePost']);
  });
});

test.describe('discovery', () => {
  test('derives service names, env prefixes, base URLs and auth', () => {
    expect(serviceNameFor('Orders API.postman_collection.json')).toBe('orders-api');
    expect(serviceNameFor('billing.openapi.yaml')).toBe('billing');
    expect(envPrefixFor('orders-api')).toBe('ORDERS_API');

    expect(
      baseUrlFromSpec({
        servers: [{ url: '/api' }, { url: 'https://{env}.x.io/v1', variables: { env: { default: 'qa' } } }],
      }),
    ).toBe('https://qa.x.io/v1');
    expect(baseUrlFromSpec({ swagger: '2.0', host: 'h.io', basePath: '/v2', schemes: ['https'] })).toBe(
      'https://h.io/v2',
    );
    expect(baseUrlFromSpec(petstore)).toBeUndefined();

    const { auth, missing } = inferAuth(petstore, 'UNIT_TEST_SVC');
    expect(auth).toMatchObject({ type: 'apiKey', name: 'api_key', in: 'header' });
    expect(missing).toEqual(['UNIT_TEST_SVC_API_KEY']);
  });
});

test.describe('operation registry', () => {
  const registry = new OperationRegistry({ petstore }, 'petstore');

  test('infers REST resources and their creators', () => {
    const pet = registry.resourceGroups('petstore').find((g) => g.collectionPath === '/pet');
    expect(pet).toMatchObject({ idParam: 'petId' });
    expect([pet.create.id, pet.read.id, pet.update.id, pet.remove.id]).toEqual([
      'addPet',
      'getPetById',
      'updatePet',
      'deletePet',
    ]);
    expect(registry.creatorFor(registry.get('uploadFile'), 'petId').id).toBe('addPet');
    expect(registry.creatorFor(registry.get('getOrderById'), 'orderId').id).toBe('placeOrder');
  });

  test('matches concrete paths and flags auth requirements', () => {
    expect(registry.match('petstore', 'GET', '/pet/findByStatus?status=sold').id).toBe('findPetsByStatus');
    expect(registry.match('petstore', 'GET', '/pet/42').id).toBe('getPetById');
    expect(registry.get('getInventory').requiresAuth).toBe(true);
    expect(registry.get('placeOrder').requiresAuth).toBe(false);
    expect(() => registry.get('addPett')).toThrow(/Did you mean: addPet/);
  });

  test('resolves request schemas without readOnly fields', () => {
    const doc = {
      components: {
        schemas: {
          A: {
            type: 'object',
            required: ['id', 'x'],
            properties: { id: { type: 'integer', readOnly: true }, x: { type: 'string' } },
          },
        },
      },
    };
    expect(resolveSchema(doc, { $ref: '#/components/schemas/A' }, { direction: 'request' })).toEqual({
      type: 'object',
      required: ['x'],
      properties: { x: { type: 'string' } },
    });
  });
});

test.describe('spec diff', () => {
  test('classifies breaking, warning and info changes', () => {
    const next = structuredClone(petstore);
    next.components.schemas.Pet.required.push('status');
    delete next.components.schemas.Order.properties.complete;
    delete next.paths['/user/logout'];
    next.paths['/pet/findByStatus'].get.parameters.push({
      name: 'limit',
      in: 'query',
      required: true,
      schema: { type: 'integer' },
    });

    const diff = diffSpecs(petstore, next);
    expect(diff.removed.map((op) => op.id)).toEqual(['logoutUser']);
    const messages = (id) =>
      diff.changed.find((c) => c.operation.id === id).changes.map((c) => `${c.severity}: ${c.message}`);
    expect(messages('addPet')).toContain('breaking: request body: field "status" is now required');
    expect(messages('findPetsByStatus')).toContain('breaking: parameter query:limit added (required)');
    expect(messages('getOrderById')).toContain('breaking: response 200: field "complete" removed');
    expect(hasBreakingChanges(diff)).toBe(true);
    expect(hasBreakingChanges(diffSpecs(petstore, petstore))).toBe(false);
  });
});
