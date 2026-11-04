#!/usr/bin/env node
// Clear the bundled-spec cache and re-load every spec (use after a remote spec changes).
import { clearSpecCache } from '../src/spec/spec-loader.js';
import { getFramework } from '../src/framework.js';

clearSpecCache();
const { registry, config } = await getFramework({ validateSpec: true });
for (const name of Object.keys(config.services)) {
  console.log(`${name}: ${registry.list({ service: name }).length} operations (validated)`);
}
