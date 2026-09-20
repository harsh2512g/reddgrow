import { z } from 'zod';
export const privacyRequestSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(['export', 'delete']),
    status: z.enum([
      'requested',
      'processing',
      'completed',
      'failed',
      'expired',
      'revoked',
      'canceled',
    ]),
    created_at: z.iso.datetime({ offset: true }),
    confirmed_at: z.iso.datetime({ offset: true }).nullable(),
    completed_at: z.iso.datetime({ offset: true }).nullable(),
    expires_at: z.iso.datetime({ offset: true }).nullable(),
    error_code: z.string().max(100).nullable(),
    download_available: z.boolean(),
  })
  .strict();
export const privacyRequestsSchema = z.array(privacyRequestSchema).max(50);
export const exportDownloadSchema = z
  .object({
    id: z.uuid(),
    path: z.string().max(256),
    bucket: z.literal('privacy-exports'),
    expires_at: z.iso.datetime({ offset: true }),
    bytes: z
      .number()
      .int()
      .positive()
      .max(70 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const privacyCreatedSchema = z.object({ id: z.uuid() }).strict();
