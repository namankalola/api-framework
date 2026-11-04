#!/usr/bin/env node
/**
 * Show what changed between two versions of a spec and which tests are affected.
 *
 *   npm run spec:diff -- --old old.json --new specs/petstore.json
 *   npm run spec:diff -- --old old.json --service petstore     (new = the service's configured spec)
 *   npm run spec:diff -- --git HEAD~1 --service petstore       (old = that file at a git revision)
 *   add --json for machine-readable output; exits 1 when there are breaking changes
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import SwaggerParser from '@apidevtools/swagger-parser';
import { ROOT } from '../config/paths.js';
import config from '../config/index.js';
import { readSpecFile } from '../src/spec/spec-file.js';
import { diffSpecs, hasBreakingChanges } from '../src/spec/spec-diff.js';

const { values: args } = parseArgs({
  options: {
    old: { type: 'string' },
    new: { type: 'string' },
    service: { type: 'string' },
    git: { type: 'string' },
    json: { type: 'boolean', default: false },
  },
});

async function load(file) {
  const local = readSpecFile(file);
  return SwaggerParser.bundle(local.format === 'postman' ? local.doc : file);
}

function listTestFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'generated' || entry.name === 'unit' ? [] : listTestFiles(full);
    return entry.name.endsWith('.spec.js') ? [full] : [];
  });
}

/** Hand-written tests that reference an operationId (generated suites adapt by themselves). */
function impactedTests(operationIds) {
  const files = listTestFiles(path.join(ROOT, 'tests'));
  const hits = {};
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const id of operationIds) {
      if (new RegExp(`['":]${id}['"]`).test(text))
        (hits[id] ??= []).push(path.relative(ROOT, file).replace(/\\/g, '/'));
    }
  }
  return hits;
}

async function main() {
  const newFile = args.new ?? (args.service && config.services[args.service]?.spec);
  if (!newFile || (!args.old && !args.git)) {
    console.error(
      'Usage: npm run spec:diff -- (--old <file> | --git <rev>) (--new <file> | --service <name>) [--json]',
    );
    process.exitCode = 2;
    return;
  }
  const newPath = path.resolve(ROOT, newFile);
  let oldPath = args.old && path.resolve(ROOT, args.old);
  if (args.git) {
    const relative = path.relative(ROOT, newPath).replace(/\\/g, '/');
    oldPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'spec-diff-')), path.basename(newPath));
    // "./" makes the path relative to this folder, so it works when api-tests/ is nested in a larger repo.
    fs.writeFileSync(oldPath, execFileSync('git', ['show', `${args.git}:./${relative}`], { cwd: ROOT }));
  }

  const diff = diffSpecs(await load(oldPath), await load(newPath));
  const touched = [...diff.removed.map((op) => op.id), ...diff.changed.flatMap((c) => [c.operation.id, c.previousId])];
  const impacted = impactedTests([...new Set(touched)]);
  const breaking = hasBreakingChanges(diff);

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          breaking,
          added: diff.added.map(({ id, method, path: p, tags }) => ({ id, method, path: p, tags })),
          removed: diff.removed.map(({ id, method, path: p }) => ({ id, method, path: p })),
          changed: diff.changed.map((c) => ({ id: c.operation.id, previousId: c.previousId, changes: c.changes })),
          impactedTests: impacted,
        },
        null,
        2,
      ),
    );
  } else {
    const line = (op) => `${op.method.padEnd(7)} ${op.path.padEnd(36)} ${op.id}`;
    console.log(`\nAdded (${diff.added.length})`);
    diff.added.forEach((op) => console.log(`  + ${line(op)}`));
    console.log(`\nRemoved (${diff.removed.length})`);
    diff.removed.forEach((op) => console.log(`  - ${line(op)}`));
    console.log(`\nChanged (${diff.changed.length})`);
    for (const c of diff.changed) {
      console.log(`  ~ ${line(c.operation)}`);
      for (const ch of c.changes) console.log(`      [${ch.severity}] ${ch.message}`);
    }
    console.log('\nHand-written tests to review');
    if (!Object.keys(impacted).length) console.log('  (none)');
    for (const [id, files] of Object.entries(impacted)) console.log(`  ${id}: ${files.join(', ')}`);
    console.log(
      `\n${breaking ? 'BREAKING changes found.' : 'No breaking changes.'} Generated suites pick up all changes automatically.`,
    );
  }
  if (breaking) process.exitCode = 1;
}

await main();
