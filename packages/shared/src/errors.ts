import { z } from 'zod';

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string().regex(/^[A-Z][A-Z_]{0,63}$/),
    message: z.string().max(240),
    requestId: z.uuid(),
  }),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export function serviceUnavailable(requestId: string): ErrorResponse {
  return errorResponseSchema.parse({
    error: {
      code: 'SERVICE_UNAVAILABLE',
      message: 'The service is temporarily unavailable. Try again shortly.',
      requestId,
    },
  });
}

export class ProviderUnavailableError extends Error {
  readonly code = 'PROVIDER_UNAVAILABLE';
  constructor() {
    super('The selected external provider is not enabled in Phase 0.');
    this.name = 'ProviderUnavailableError';
  }
}
