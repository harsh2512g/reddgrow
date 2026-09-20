import { measuredProviderRequest } from '@threadsignal/shared';
import { z } from 'zod';
import {
  EmailProviderError,
  parseEmailMessage,
  type EmailMessage,
  type EmailProvider,
  type EmailReceipt,
} from './contracts.js';

export interface ResendEmailOptions {
  apiKey: string;
  from: string;
  fetch?: typeof fetch;
}
const configSchema = z.object({
  apiKey: z.string().regex(/^re_[A-Za-z0-9_-]{8,}$/),
  from: z.email().max(254),
});

/** Delivery jobs persist idempotency keys before calling this transport. No body or recipient is logged. */
export class ResendEmailProvider implements EmailProvider {
  readonly mode = 'resend';
  private readonly config: z.infer<typeof configSchema>;
  private readonly transport: typeof fetch;
  constructor(options: ResendEmailOptions) {
    const result = configSchema.safeParse(options);
    if (!result.success) throw new EmailProviderError('EMAIL_CONFIGURATION');
    this.config = result.data;
    this.transport = options.fetch ?? fetch;
  }
  async send(message: EmailMessage): Promise<EmailReceipt> {
    const request = parseEmailMessage(message);
    let preferenceUrl: URL | undefined;
    if (request.preferenceUrl) {
      preferenceUrl = new URL(request.preferenceUrl);
      if (
        preferenceUrl.username ||
        preferenceUrl.password ||
        preferenceUrl.hash ||
        !(
          preferenceUrl.protocol === 'https:' ||
          (preferenceUrl.protocol === 'http:' &&
            ['127.0.0.1', 'localhost'].includes(preferenceUrl.hostname))
        )
      ) {
        throw new EmailProviderError('EMAIL_INPUT');
      }
    }
    try {
      const response = await measuredProviderRequest('resend', () =>
        this.transport('https://api.resend.com/emails', {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': request.idempotencyKey,
          },
          body: JSON.stringify({
            from: `ThreadSignal <${this.config.from}>`,
            to: [request.to],
            subject: request.subject,
            text: request.text,
            ...(request.html ? { html: request.html } : {}),
            ...(preferenceUrl
              ? { headers: { 'List-Unsubscribe': `<${preferenceUrl.href}>` } }
              : {}),
          }),
        }),
      );
      if (!response.ok && response.status !== 409) {
        await response.body?.cancel();
        throw new EmailProviderError(
          'EMAIL_UNAVAILABLE',
          response.status === 429 || response.status >= 500,
        );
      }
      const reader = response.body?.getReader();
      if (!reader) throw new EmailProviderError('EMAIL_RESPONSE');
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 65_536) {
          await reader.cancel();
          throw new EmailProviderError('EMAIL_RESPONSE');
        }
        chunks.push(value);
      }
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        throw new EmailProviderError('EMAIL_RESPONSE');
      }
      if (!response.ok) {
        const upstream = z.object({ name: z.string() }).safeParse(body);
        if (
          response.status === 409 &&
          upstream.success &&
          upstream.data.name === 'invalid_idempotent_request'
        )
          throw new EmailProviderError('EMAIL_IDEMPOTENCY_CONFLICT');
        throw new EmailProviderError(
          'EMAIL_UNAVAILABLE',
          response.status === 429 ||
            response.status >= 500 ||
            (response.status === 409 &&
              upstream.success &&
              upstream.data.name === 'concurrent_idempotent_requests'),
        );
      }
      const receipt = z.object({ id: z.uuid() }).safeParse(body);
      if (!receipt.success) throw new EmailProviderError('EMAIL_RESPONSE');
      return { id: receipt.data.id, delivery: 'queued' };
    } catch (error) {
      if (error instanceof EmailProviderError) throw error;
      throw new EmailProviderError('EMAIL_UNAVAILABLE', true);
    }
  }
}
