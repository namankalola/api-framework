// Cases are planned from every spec at run time, so new endpoints are covered automatically.
import { test } from '../../src/fixtures/index.js';
import { generatedSuite } from '../../src/scenarios/define-suite.js';

for (const group of await generatedSuite('positive')) {
  test.describe(group.title, () => {
    for (const t of group.tests) test(t.title, t.details, t.body);
  });
}
