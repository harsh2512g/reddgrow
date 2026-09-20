import { z } from 'zod';
export const providerStateSchema = z
  .object({
    name: z.enum(['Reddit', 'AI', 'Crawler', 'Email', 'Billing']),
    adapter: z.string().max(40),
    external_enabled: z.boolean(),
  })
  .strict();
export const providerStatesSchema = z.array(providerStateSchema).length(5);
