import { test, expect } from '@playwright/test';
import { deepMerge } from '../../src/utils/deep-merge.js';
import { buildQuery, fillPath, joinUrl } from '../../src/utils/url.js';
import { findMatch, matchesGlob } from '../../src/utils/glob.js';
import { getByPath, resolveTemplate } from '../../src/utils/object-path.js';
import { maskFields, maskHeaders, maskUrl } from '../../src/utils/mask.js';
import { deref, resolvePointer, toPointer } from '../../src/utils/json-pointer.js';
import { buildExchangeRecord } from '../../src/core/request-logger.js';

test.describe('deepMerge', () => {
  test('merges nested objects, replaces arrays, keeps base on undefined', () => {
    const base = { a: { b: 1, c: [1, 2] }, d: 'x' };
    expect(deepMerge(base, { a: { c: [3] }, d: undefined, e: 1 })).toEqual({ a: { b: 1, c: [3] }, d: 'x', e: 1 });
    expect(base.a.c).toEqual([1, 2]);
  });
});

test.describe('url helpers', () => {
  test('joinUrl keeps the base path', () => {
    expect(joinUrl('https://h/api/v3/', '/pet')).toBe('https://h/api/v3/pet');
    expect(joinUrl('https://h', 'https://other/x')).toBe('https://other/x');
  });

  test('buildQuery repeats array keys and skips empty values', () => {
    expect(buildQuery({ tags: ['a', 'b'], skip: undefined, n: 1 })).toBe('?tags=a&tags=b&n=1');
    expect(buildQuery({})).toBe('');
  });

  test('fillPath encodes values and names missing params', () => {
    expect(fillPath('/user/{name}', { name: 'a b/c' })).toBe('/user/a%20b%2Fc');
    expect(() => fillPath('/pet/{petId}', {}, 'getPetById')).toThrow(/petId.*getPetById/);
  });
});

test.describe('glob', () => {
  test('matches wildcards case-insensitively', () => {
    expect(matchesGlob('negative:petstore:addPet:body-x', 'negative:*:addpet:*')).toBe(true);
    expect(findMatch('petstore:getUserByName', ['petstore:*User*'])).toBe('petstore:*User*');
    expect(findMatch('petstore:addPet', ['petstore:*User*'])).toBeUndefined();
  });
});

test.describe('object paths', () => {
  test('reads $.paths and resolves templates', () => {
    const body = { data: { items: [{ id: 7 }] } };
    expect(getByPath(body, '$.data.items[0].id')).toBe(7);
    expect(resolveTemplate({ id: '$.data.items[0].id', fixed: 'x' }, body)).toEqual({ id: 7, fixed: 'x' });
  });
});

test.describe('json pointer', () => {
  test('round-trips escaped tokens and follows $ref chains', () => {
    const doc = { paths: { '/pet/{id}': { get: 1 } }, a: { $ref: '#/b' }, b: { $ref: '#/c' }, c: { ok: true } };
    expect(toPointer(['paths', '/pet/{id}', 'get'])).toBe('#/paths/~1pet~1{id}/get');
    expect(resolvePointer(doc, '#/paths/~1pet~1{id}/get')).toBe(1);
    expect(deref(doc, doc.a)).toEqual({ ok: true });
  });
});

test.describe('masking', () => {
  test('masks headers, nested fields, query params and cURL', () => {
    expect(maskHeaders({ Authorization: 'Bearer x', Accept: 'a' }, ['authorization'])).toEqual({
      Authorization: '***',
      Accept: 'a',
    });
    expect(maskFields({ user: { Password: 'p', name: 'n' } }, ['password'])).toEqual({
      user: { Password: '***', name: 'n' },
    });
    expect(maskUrl('https://h/x?token=abc&a=1', ['token'])).toBe('https://h/x?token=***&a=1');

    const record = buildExchangeRecord(
      { method: 'POST', url: 'https://h/login', headers: { api_key: 'k' }, body: { password: 'p' } },
      null,
      { maskHeaders: ['api_key'], maskFields: ['password'], maxBodyChars: 100 },
    );
    expect(record.curl).not.toContain("'k'");
    expect(record.curl).not.toContain('"p"');
    expect(record.curl).toContain('***');
  });
});
