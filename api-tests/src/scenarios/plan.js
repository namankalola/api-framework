import { TEST_ENV } from '../../config/index.js';
import { createPlanContext } from './context.js';
import * as contract from './categories/contract.js';
import * as positive from './categories/positive.js';
import * as negative from './categories/negative.js';
import * as boundary from './categories/boundary.js';
import * as security from './categories/security.js';
import * as resilience from './categories/resilience.js';
import * as performance from './categories/performance.js';

export const CATEGORIES = { contract, positive, negative, boundary, security, resilience, performance };

/** Case plan for one category: [{ service, opId, op, cases: [{ id, title, run }] }]. */
export function planCategory(framework, category) {
  const { config } = framework;
  if (!config.suites.categories.includes(category)) return [];
  if (category === 'security' && !config.suites.security.enabledEnvs.includes(TEST_ENV)) return [];
  return CATEGORIES[category]
    .plan(createPlanContext(framework))
    .map((group) => ({
      ...group,
      service: group.service ?? group.op.service,
      opId: group.opId ?? group.op.id,
      cases: group.cases.slice(0, config.suites.maxCasesPerOperation),
    }))
    .filter((group) => group.cases.length > 0);
}
