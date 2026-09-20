import { z } from 'zod';

export const emailInputSchema = z.object({
  to: z.email(),
  subject: z
    .string()
    .min(1)
    .max(200)
    .refine((value) => !/[\r\n]/.test(value)),
  text: z.string().min(1).max(100_000),
  html: z.string().min(1).max(100_000).optional(),
  preferenceUrl: z.url().max(2048).optional(),
  idempotencyKey: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
});
export type EmailMessage = z.infer<typeof emailInputSchema>;
export interface EmailReceipt {
  id: string;
  delivery: 'suppressed' | 'queued';
}
export interface EmailProvider {
  readonly mode: 'console' | 'resend';
  send(message: EmailMessage): Promise<EmailReceipt>;
}
export interface EmailConsoleSink {
  info(metadata: { messageId: string; delivery: 'suppressed' }, message: string): void;
}
export class EmailProviderError extends Error {
  constructor(
    readonly code:
      | 'EMAIL_CONFIGURATION'
      | 'EMAIL_INPUT'
      | 'EMAIL_UNAVAILABLE'
      | 'EMAIL_RESPONSE'
      | 'EMAIL_IDEMPOTENCY_CONFLICT',
    readonly retryable = false,
  ) {
    super(code);
    this.name = 'EmailProviderError';
  }
}
export function parseEmailMessage(message: unknown): EmailMessage {
  const result = emailInputSchema.safeParse(message);
  if (!result.success) throw new EmailProviderError('EMAIL_INPUT');
  return result.data;
}
