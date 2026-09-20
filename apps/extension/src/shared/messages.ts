import { z } from 'zod';
import { codeSchema, tokenSchema } from '@threadsignal/extension-contracts';

const draftTarget = { draftId: z.uuid(), expectedVersion: z.number().int().min(1) };
export const panelMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('status') }).strict(),
  z.object({ type: z.literal('connect'), code: codeSchema }).strict(),
  z.object({ type: z.literal('disconnect') }).strict(),
  z.object({ type: z.literal('lookup') }).strict(),
  z
    .object({
      type: z.literal('save'),
      ...draftTarget,
      content: z.string().trim().min(1).max(12_000),
    })
    .strict(),
  z.object({ type: z.literal('copy'), ...draftTarget }).strict(),
  z.object({ type: z.literal('insert'), ...draftTarget }).strict(),
  z
    .object({
      type: z.literal('published'),
      ...draftTarget,
      commentUrl: z.string().url().max(2048),
      confirmed: z.literal(true),
    })
    .strict(),
]);
export type PanelMessage = z.infer<typeof panelMessageSchema>;

export const sessionMetadataSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    organizationName: z.string().min(1).max(200),
    name: z.string().min(1).max(200),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type SessionMetadata = z.infer<typeof sessionMetadataSchema>;
export const credentialsSchema = z
  .object({ token: tokenSchema, session: sessionMetadataSchema })
  .strict();
export type Credentials = z.infer<typeof credentialsSchema>;

export type PanelResponse<T = unknown> =
  { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
