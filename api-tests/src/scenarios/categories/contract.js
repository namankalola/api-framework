import { findResponse } from '../../validation/schema-validator.js';

/** Every GET is called with real data; status, content type and body must match the spec. */
export function plan({ operations }) {
  return operations
    .filter((op) => op.method === 'GET')
    .map((op) => ({
      op,
      cases: [
        {
          id: 'matches-spec',
          title: 'response matches the documented status, content type and schema',
          async run(ctx) {
            const res = await ctx.send(await ctx.request());
            ctx.expect(res.status, 'server error').toBeLessThan(500);

            const documented = findResponse(op, res.status);
            ctx.expect(documented, `status ${res.status} is not documented for ${op.id}`).not.toBeNull();
            if (documented?.contentType && res.text) {
              ctx
                .expect(res)
                .toHaveHeader(
                  'content-type',
                  new RegExp(documented.contentType.split(';')[0].replace(/[+.]/g, '\\$&'), 'i'),
                );
            }
            ctx.expect(res).toMatchSchema();
          },
        },
      ],
    }));
}
