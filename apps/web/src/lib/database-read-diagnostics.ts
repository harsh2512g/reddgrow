import 'server-only';
import { createLogger } from '@threadsignal/shared';

export type DatabaseReadOperation =
  | 'workspace.memberships'
  | 'workspace.organizations'
  | 'drafts.list'
  | 'drafts.titles'
  | 'drafts.usage'
  | 'drafts.persona'
  | 'drafts.detail'
  | 'drafts.versions'
  | 'drafts.claims'
  | 'drafts.compliance'
  | 'drafts.jobs'
  | 'drafts.review';

const logger = createLogger({ service: 'web' });

/** Explicit projection only: SDK errors can contain full request URLs and customer values. */
export function databaseReadDiagnostic(error: unknown, status?: number) {
  const record =
    typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {};
  const code = typeof record.code === 'string' ? record.code : '';
  // PostgREST wraps fetch exceptions in a plain error with a "TimeoutError:" prefix.
  // Inspect that prefix only for classification; never include its message in a log.
  const timeout =
    record.name === 'TimeoutError' ||
    code === 'ETIMEDOUT' ||
    (typeof record.message === 'string' && record.message.startsWith('TimeoutError:'));
  return {
    databaseCode: /^(?:PGRST\d{3}|[0-9A-Z]{5})$/.test(code) ? code : null,
    status:
      typeof status === 'number' &&
      Number.isInteger(status) &&
      (status === 0 || (status >= 100 && status <= 599))
        ? status
        : null,
    // An abort or SQL cancellation alone does not prove a timeout.
    timeout: timeout ? true : null,
  };
}

export function reportDatabaseReadFailure(
  operation: DatabaseReadOperation,
  error: unknown,
  status?: number,
) {
  logger.warn({ operation, ...databaseReadDiagnostic(error, status) }, 'Database read failed');
}
