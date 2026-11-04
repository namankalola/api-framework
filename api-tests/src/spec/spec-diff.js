import { OperationRegistry } from './operation-registry.js';
import { resolveSchema } from './schema-resolver.js';

const MAX_DEPTH = 6;
const typeOf = (schema) => [schema?.type].flat().filter(Boolean).join('|') || (schema?.properties ? 'object' : 'any');
const opKey = (op) => `${op.method} ${op.path.replace(/\{[^}]+\}/g, '{}')}`;

/** Flatten a schema into { "pet.tags[].name": { type, required, enum } }. */
function flatten(schema, prefix = '', parentRequired = true, out = {}, depth = 0) {
  if (!schema || depth > MAX_DEPTH) return out;
  const variants = schema.allOf ?? schema.oneOf ?? schema.anyOf;
  if (variants) {
    for (const v of variants) flatten(v, prefix, parentRequired, out, depth + 1);
    return out;
  }
  if (schema.properties) {
    const required = new Set(schema.required ?? []);
    for (const [key, prop] of Object.entries(schema.properties)) {
      const path = prefix ? `${prefix}.${key}` : key;
      out[path] = { type: typeOf(prop), required: parentRequired && required.has(key), enum: prop.enum };
      flatten(prop, path, parentRequired && required.has(key), out, depth + 1);
    }
  }
  if (schema.items) flatten(schema.items, `${prefix}[]`, parentRequired, out, depth + 1);
  return out;
}

function compareFields(before, after, where, direction) {
  const changes = [];
  const add = (severity, message) => changes.push({ severity, message: `${where}: ${message}` });
  for (const [path, field] of Object.entries(after)) {
    const old = before[path];
    if (!old) {
      // A new required request field breaks existing callers; a new response field does not.
      add(
        direction === 'request' && field.required ? 'breaking' : 'info',
        `field "${path}" added${field.required ? ' (required)' : ''}`,
      );
      continue;
    }
    if (old.type !== field.type) add('breaking', `field "${path}" type ${old.type} → ${field.type}`);
    if (direction === 'request' && !old.required && field.required) add('breaking', `field "${path}" is now required`);
    if (direction === 'response' && old.required && !field.required)
      add('warning', `field "${path}" is no longer guaranteed`);
    const removedValues = (old.enum ?? []).filter((v) => field.enum && !field.enum.includes(v));
    const addedValues = (field.enum ?? []).filter((v) => old.enum && !old.enum.includes(v));
    if (removedValues.length)
      add(
        direction === 'response' ? 'warning' : 'breaking',
        `field "${path}" enum removed ${JSON.stringify(removedValues)}`,
      );
    if (addedValues.length)
      add(direction === 'response' ? 'warning' : 'info', `field "${path}" enum added ${JSON.stringify(addedValues)}`);
  }
  for (const path of Object.keys(before).filter((p) => !(p in after))) {
    add(direction === 'response' ? 'breaking' : 'warning', `field "${path}" removed`);
  }
  return changes;
}

function compareOperation(oldOp, newOp, oldDoc, newDoc) {
  const changes = [];
  const add = (severity, message) => changes.push({ severity, message });

  if (oldOp.id !== newOp.id) add('warning', `operationId renamed ${oldOp.id} → ${newOp.id}`);
  if (!oldOp.deprecated && newOp.deprecated) add('warning', 'marked deprecated');
  if (oldOp.requiresAuth !== newOp.requiresAuth)
    add('warning', newOp.requiresAuth ? 'now requires auth' : 'no longer requires auth');

  const params = (op) => new Map(op.parameters.map((p) => [`${p.in}:${p.name}`, p]));
  const [before, after] = [params(oldOp), params(newOp)];
  for (const [key, p] of after) {
    const old = before.get(key);
    if (!old) add(p.required ? 'breaking' : 'info', `parameter ${key} added${p.required ? ' (required)' : ''}`);
    else {
      if (!old.required && p.required) add('breaking', `parameter ${key} is now required`);
      if (typeOf(old.schema) !== typeOf(p.schema))
        add('breaking', `parameter ${key} type ${typeOf(old.schema)} → ${typeOf(p.schema)}`);
    }
  }
  for (const key of [...before.keys()].filter((k) => !after.has(k))) add('warning', `parameter ${key} removed`);

  const flat = (doc, schema, direction) =>
    schema ? flatten(resolveSchema(doc, schema, { maxDepth: 4, direction })) : {};
  if (Boolean(oldOp.requestBody) !== Boolean(newOp.requestBody)) {
    add(
      newOp.requestBody?.required ? 'breaking' : 'warning',
      newOp.requestBody ? 'request body added' : 'request body removed',
    );
  } else if (newOp.requestBody) {
    if (oldOp.requestBody.contentType !== newOp.requestBody.contentType) {
      add('breaking', `request content type ${oldOp.requestBody.contentType} → ${newOp.requestBody.contentType}`);
    }
    changes.push(
      ...compareFields(
        flat(oldDoc, oldOp.requestBody.schema, 'request'),
        flat(newDoc, newOp.requestBody.schema, 'request'),
        'request body',
        'request',
      ),
    );
  }

  for (const status of Object.keys(oldOp.responses).filter((s) => !(s in newOp.responses))) {
    add(/^2/.test(status) ? 'breaking' : 'warning', `response ${status} removed`);
  }
  for (const status of Object.keys(newOp.responses)) {
    if (!(status in oldOp.responses)) {
      add('info', `response ${status} added`);
      continue;
    }
    changes.push(
      ...compareFields(
        flat(oldDoc, oldOp.responses[status].schema, 'response'),
        flat(newDoc, newOp.responses[status].schema, 'response'),
        `response ${status}`,
        'response',
      ),
    );
  }
  return changes;
}

/**
 * Compare two versions of a spec operation by operation.
 * @returns {{ added: object[], removed: object[], changed: { operation: object, previousId: string, changes: { severity: 'breaking'|'warning'|'info', message: string }[] }[] }}
 */
export function diffSpecs(oldDoc, newDoc) {
  const oldOps = new Map(new OperationRegistry({ spec: oldDoc }).list().map((op) => [opKey(op), op]));
  const newOps = new Map(new OperationRegistry({ spec: newDoc }).list().map((op) => [opKey(op), op]));
  const result = { added: [], removed: [], changed: [] };

  for (const [key, op] of newOps) {
    const old = oldOps.get(key);
    if (!old) {
      result.added.push(op);
      continue;
    }
    const changes = compareOperation(old, op, oldDoc, newDoc);
    if (changes.length) result.changed.push({ operation: op, previousId: old.id, changes });
  }
  for (const [key, op] of oldOps) if (!newOps.has(key)) result.removed.push(op);
  return result;
}

export const hasBreakingChanges = (diff) =>
  diff.removed.length > 0 || diff.changed.some((c) => c.changes.some((ch) => ch.severity === 'breaking'));
