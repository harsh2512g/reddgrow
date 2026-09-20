import { createHash } from 'node:crypto';
import { createLogger } from '@threadsignal/shared';
import { ResendEmailProvider, type ResendEmailOptions } from './resend.js';
import {
  EmailProviderError,
  parseEmailMessage,
  type EmailConsoleSink,
  type EmailMessage,
  type EmailProvider,
  type EmailReceipt,
} from './contracts.js';

export * from './contracts.js';
export * from './resend.js';
export * from './notifications.js';

/** Console metadata proves the adapter ran; recipient, subject, and body are never printed. */
export class ConsoleEmailProvider implements EmailProvider {
  readonly mode = 'console';
  constructor(private readonly sink: EmailConsoleSink = createLogger({ service: 'email' })) {}
  async send(message: EmailMessage): Promise<EmailReceipt> {
    const request = parseEmailMessage(message);
    const id = `console_${createHash('sha256').update(request.idempotencyKey).digest('hex').slice(0, 24)}`;
    this.sink.info({ messageId: id, delivery: 'suppressed' }, 'Local email delivery suppressed');
    return { id, delivery: 'suppressed' };
  }
}

export function createEmailProvider(
  mode: 'console' | 'resend' = 'console',
  sink?: EmailConsoleSink,
  options?: ResendEmailOptions,
): EmailProvider {
  if (mode === 'resend') {
    if (!options) throw new EmailProviderError('EMAIL_CONFIGURATION');
    return new ResendEmailProvider(options);
  }
  return new ConsoleEmailProvider(sink);
}
