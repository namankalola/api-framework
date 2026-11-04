import { refOf } from '../context.js';

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};

/** Latency budget per read operation (p95 over a few sequential samples after a warm-up call). */
export function plan({ operations, config }) {
  const { samples, maxResponseMs, perOperation } = config.suites.performance;

  return operations
    .filter((op) => op.method === 'GET')
    .map((op) => {
      const budget = perOperation[refOf(op)] ?? perOperation[op.id] ?? maxResponseMs;
      return {
        op,
        cases: [
          {
            id: 'latency-p95',
            title: `p95 latency within ${budget} ms (${samples} samples)`,
            async run(ctx) {
              const request = await ctx.request();
              await ctx.send(request); // warm-up: connection setup and caches
              const timings = [];
              for (let i = 0; i < samples; i += 1) {
                const res = await ctx.send(request);
                ctx.expect(res.status).toBeLessThan(500);
                timings.push(res.durationMs);
              }
              const stats = {
                p50: percentile(timings, 50),
                p95: percentile(timings, 95),
                max: Math.max(...timings),
                samples: timings,
              };
              ctx.testInfo?.annotations.push({
                type: 'latency',
                description: `p50 ${stats.p50} ms, p95 ${stats.p95} ms, max ${stats.max} ms`,
              });
              ctx
                .expect(stats.p95, `p95 ${stats.p95} ms exceeds ${budget} ms (${timings.join(', ')})`)
                .toBeLessThanOrEqual(budget);
            },
          },
        ],
      };
    });
}
