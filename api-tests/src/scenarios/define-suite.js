import { test } from '../fixtures/index.js';
import { getFramework } from '../framework.js';
import { createCaseContext, knownIssue } from './context.js';
import { planCategory } from './plan.js';
import { PreconditionError, ResourceResolver } from './resources.js';

/**
 * Generated tests for a category, grouped per operation. Spec files declare them so test
 * locations point at the spec file. Each test id is "<category>:<service>:<operationId>:<case>";
 * use it in `suites.knownIssues` or with --grep.
 *
 * @returns {Promise<{ title: string, tests: { title: string, details: object, body: Function }[] }[]>}
 */
export async function generatedSuite(category) {
  const framework = await getFramework();
  const { config, registry } = framework;

  return planCategory(framework, category).map((group) => ({
    title: `${group.service}:${group.opId}`,
    tests: group.cases.map((c) => {
      const key = `${category}:${group.service}:${group.opId}:${c.id}`;
      return {
        title: c.title,
        details: { tag: [`@${category}`, '@generated'], annotation: { type: 'case id', description: key } },
        async body({ api, data }, testInfo) {
          const reason = knownIssue(config, key);
          const resources = new ResourceResolver({ registry, config, api, data });
          const ctx = createCaseContext({
            op: group.op,
            service: group.service,
            api,
            data,
            framework,
            resources,
            testInfo,
          });
          try {
            await c.run(ctx);
          } catch (error) {
            if (error instanceof PreconditionError) test.skip(true, error.message);
            // Known issues become expected failures only when they reproduce, so data-dependent
            // issues never make the run flaky.
            if (reason) test.fail(true, `known issue: ${reason}`);
            throw error;
          }
          if (reason) testInfo.annotations.push({ type: 'known issue did not reproduce', description: reason });
        },
      };
    }),
  }));
}
