import { z } from 'zod';

const dependencyState = z.enum(['ready', 'unavailable', 'unconfigured']);
export const readinessSchema = z
  .object({
    status: z.enum(['ready', 'unavailable']),
    checks: z.object({ database: dependencyState, redis: dependencyState }),
    requestId: z.uuid(),
  })
  .refine(
    (value) =>
      (value.status === 'ready') ===
      (value.checks.database === 'ready' && value.checks.redis === 'ready'),
    { message: 'Readiness must match dependency checks' },
  );
export type Readiness = z.infer<typeof readinessSchema>;
