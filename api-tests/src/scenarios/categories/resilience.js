import { extractId } from '../resources.js';

/** Behaviour under repetition and concurrency: parallel reads/creates, idempotent PUT and DELETE. */
export function plan({ operations, registry, config }) {
  const n = config.suites.resilience.concurrency;

  return operations.map((op) => {
    const cases = [];
    const group = registry.resourceGroups(op.service).find((g) => g.create === op);

    if (op.method === 'GET') {
      cases.push({
        id: 'concurrent-reads',
        title: `${n} concurrent requests all succeed`,
        async run(ctx) {
          const request = await ctx.request();
          const responses = await Promise.all(Array.from({ length: n }, () => ctx.send(request)));
          ctx.expect(responses.map((r) => r.status)).toEqual(Array(n).fill(responses[0].status));
          ctx.expect(responses[0]).toHaveStatus(ctx.success);
        },
      });
    }

    if (group) {
      cases.push({
        id: 'concurrent-creates',
        title: `${n} concurrent creates all succeed with distinct ids`,
        async run(ctx) {
          const requests = await Promise.all(Array.from({ length: n }, () => ctx.request()));
          const responses = await Promise.all(requests.map((r) => ctx.send(r)));
          for (const res of responses) ctx.expect(res).toHaveStatus(ctx.success);
          const ids = responses.map((res, i) => extractId(group.idParam, res.body, requests[i].body));
          ctx.expect(new Set(ids).size, `duplicate ids: ${ids.join(', ')}`).toBe(n);
        },
      });
    }

    if (op.method === 'PUT') {
      cases.push({
        id: 'idempotent-update',
        title: 'repeating the same PUT gives the same result',
        async run(ctx) {
          const request = await ctx.request();
          const first = await ctx.send(request);
          const second = await ctx.send(request);
          ctx.expect(first).toHaveStatus(ctx.success);
          ctx.expect(second.status).toBe(first.status);
        },
      });
    }

    if (op.method === 'DELETE' && /\{[^}]+\}$/.test(op.path)) {
      cases.push({
        id: 'repeat-delete',
        title: 'deleting twice is safe (second call is success or 404)',
        async run(ctx) {
          const request = await ctx.request();
          ctx.expect(await ctx.send(request)).toHaveStatus(ctx.success);
          ctx.expect(await ctx.send(request)).toHaveStatus([...ctx.success, ...ctx.exp.notFound]);
        },
      });
    }
    return { op, cases };
  });
}
