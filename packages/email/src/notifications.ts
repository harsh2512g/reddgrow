import { z } from 'zod';
import { EmailProviderError } from './contracts.js';

export const notificationCategories = [
  'welcome',
  'invitation',
  'ingestion_complete',
  'ingestion_failed',
  'daily_digest',
  'high_score_alert',
  'trial_ending',
  'usage_limit',
  'payment_failed',
  'subscription_changed',
] as const;
export const notificationCategorySchema = z.enum(notificationCategories);
export type NotificationCategory = z.infer<typeof notificationCategorySchema>;
const clockSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const notificationPreferencesSchema = z.object({
  categories: z.record(notificationCategorySchema, z.boolean()),
  digestTime: clockSchema,
  minimumScore: z.number().int().min(0).max(100),
  quietHours: z.object({ enabled: z.boolean(), start: clockSchema, end: clockSchema }),
});
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  categories: {
    welcome: true,
    invitation: true,
    ingestion_complete: true,
    ingestion_failed: true,
    daily_digest: true,
    high_score_alert: true,
    trial_ending: true,
    usage_limit: true,
    payment_failed: true,
    subscription_changed: true,
  },
  digestTime: '09:00',
  minimumScore: 80,
  quietHours: { enabled: false, start: '22:00', end: '08:00' },
};

function minutes(value: string) {
  const [hours, minute] = value.split(':').map(Number);
  return (hours ?? 0) * 60 + (minute ?? 0);
}
export function getZonedClock(
  now: Date,
  timeZone: string,
): { date: string; time: string; minutes: number } {
  if (!Number.isFinite(now.getTime()) || timeZone.length > 100)
    throw new EmailProviderError('EMAIL_INPUT');
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
  } catch {
    throw new EmailProviderError('EMAIL_INPUT');
  }
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const time = `${pick('hour')}:${pick('minute')}`;
  return { date: `${pick('year')}-${pick('month')}-${pick('day')}`, time, minutes: minutes(time) };
}
export function isQuietHour(
  now: Date,
  timeZone: string,
  quietHours: NotificationPreferences['quietHours'],
): boolean {
  const input = notificationPreferencesSchema.shape.quietHours.safeParse(quietHours);
  if (!input.success) throw new EmailProviderError('EMAIL_INPUT');
  if (!input.data.enabled || input.data.start === input.data.end) return false;
  const current = getZonedClock(now, timeZone).minutes;
  const start = minutes(input.data.start),
    end = minutes(input.data.end);
  return start < end ? current >= start && current < end : current >= start || current < end;
}

export interface NotificationScheduleInput {
  category: NotificationCategory;
  preferences: NotificationPreferences;
  timeZone: string;
  now: Date;
  score?: number;
  lastDigestLocalDate?: string;
  dailyDigestAllowed?: boolean;
}
export type NotificationScheduleDecision = {
  send: boolean;
  reason:
    | 'ready'
    | 'disabled'
    | 'quiet_hours'
    | 'below_score'
    | 'before_digest_time'
    | 'already_sent'
    | 'plan_required';
  localDate: string;
};
/** Uses actual organization wall time; the durable outbox must enforce one digest per local date. */
export function notificationScheduleDecision(
  input: NotificationScheduleInput,
): NotificationScheduleDecision {
  const parsed = notificationPreferencesSchema.safeParse(input.preferences);
  if (!parsed.success || !notificationCategorySchema.safeParse(input.category).success)
    throw new EmailProviderError('EMAIL_INPUT');
  const preferences = parsed.data;
  const clock = getZonedClock(input.now, input.timeZone);
  const result = (
    reason: NotificationScheduleDecision['reason'],
  ): NotificationScheduleDecision => ({ send: reason === 'ready', reason, localDate: clock.date });
  if (!preferences.categories[input.category]) return result('disabled');
  if (input.category === 'daily_digest') {
    if (input.dailyDigestAllowed !== true) return result('plan_required');
    if (input.lastDigestLocalDate === clock.date) return result('already_sent');
    if (clock.minutes < minutes(preferences.digestTime)) return result('before_digest_time');
  }
  if (
    input.category === 'high_score_alert' &&
    (!Number.isFinite(input.score) ||
      (input.score ?? -1) < preferences.minimumScore ||
      (input.score ?? 101) > 100)
  )
    return result('below_score');
  if (isQuietHour(input.now, input.timeZone, preferences.quietHours)) return result('quiet_hours');
  return result('ready');
}

const templateInputSchema = z.object({
  category: notificationCategorySchema,
  organizationName: z.string().trim().min(1).max(120),
  appUrl: z.url().max(2048),
  summary: z.string().trim().min(1).max(500).optional(),
  count: z.number().int().min(0).max(1_000_000).optional(),
  score: z.number().min(0).max(100).optional(),
  actionPath: z.string().max(2048).optional(),
});
export type NotificationTemplateInput = z.infer<typeof templateInputSchema>;
const content: Record<
  NotificationCategory,
  { subject: string; heading: string; body: string; label: string; path: string }
> = {
  welcome: {
    subject: 'Welcome to ThreadSignal',
    heading: 'Make room for useful conversations.',
    body: 'Your workspace is ready. Add verified product knowledge to begin researching relevant opportunities. Every reply remains yours to review and publish manually.',
    label: 'Open your workspace',
    path: '/app',
  },
  invitation: {
    subject: 'Workspace invitation created',
    heading: 'Your invitation is ready.',
    body: 'An invitation was created from your workspace. Review pending invitations and their roles in team settings.',
    label: 'Review team invitations',
    path: '/app/settings/team',
  },
  ingestion_complete: {
    subject: 'Your knowledge source is ready',
    heading: 'Grounded in your sources.',
    body: 'Knowledge processing completed. Review the included documents and search the source evidence before using it in a reply.',
    label: 'Review knowledge',
    path: '/app/knowledge',
  },
  ingestion_failed: {
    subject: 'A knowledge source needs attention',
    heading: 'Let’s get this source ready.',
    body: 'Knowledge processing could not finish. Open the source to review its safe error details and retry when ready.',
    label: 'Review source status',
    path: '/app/knowledge',
  },
  daily_digest: {
    subject: 'Your ThreadSignal daily digest',
    heading: 'Today’s conversations, in focus.',
    body: 'Review your workspace’s current opportunities. Scores help prioritize research; they do not guarantee outcomes or permission to promote.',
    label: 'Review opportunities',
    path: '/app/opportunities',
  },
  high_score_alert: {
    subject: 'An opportunity is ready to review',
    heading: 'A conversation worth a closer look.',
    body: 'An opportunity meets your alert threshold. Read the current discussion and community rules before deciding whether to participate.',
    label: 'Review opportunity',
    path: '/app/opportunities',
  },
  trial_ending: {
    subject: 'Your ThreadSignal trial is ending',
    heading: 'Keep your next chapter open.',
    body: 'Your trial is approaching its end. Review plans and current usage. Your existing workspace data is preserved when new usage is paused.',
    label: 'Review plans',
    path: '/app/settings/billing',
  },
  usage_limit: {
    subject: 'A workspace usage limit was reached',
    heading: 'You’ve reached this period’s limit.',
    body: 'Additional usage is paused at your plan limit. Review usage and choose an upgrade or cleanup path. Existing work remains available.',
    label: 'Review usage',
    path: '/app/settings/billing',
  },
  payment_failed: {
    subject: 'Your ThreadSignal payment needs attention',
    heading: 'Please review your billing details.',
    body: 'A subscription payment was unsuccessful. Review the workspace billing page for the grace-period deadline and next steps. Existing data will not be deleted.',
    label: 'Manage billing',
    path: '/app/settings/billing',
  },
  subscription_changed: {
    subject: 'Your ThreadSignal subscription changed',
    heading: 'Your workspace plan is up to date.',
    body: 'Review the current plan, renewal date and usage limits in your billing settings. Existing data is preserved when limits change.',
    label: 'Review subscription',
    path: '/app/settings/billing',
  },
};
function escape(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );
}
export function renderNotification(input: NotificationTemplateInput): {
  subject: string;
  text: string;
  html: string;
  preferenceUrl: string;
} {
  const parsed = templateInputSchema.safeParse(input);
  if (!parsed.success) throw new EmailProviderError('EMAIL_INPUT');
  const request = parsed.data;
  const origin = new URL(request.appUrl);
  if (
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/' ||
    !(
      origin.protocol === 'https:' ||
      (origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname))
    )
  )
    throw new EmailProviderError('EMAIL_INPUT');
  const template = content[request.category];
  const path = request.actionPath ?? template.path;
  if (!path.startsWith('/app') && !path.startsWith('/invite'))
    throw new EmailProviderError('EMAIL_INPUT');
  if (path.includes('\\') || path.startsWith('//')) throw new EmailProviderError('EMAIL_INPUT');
  const action = new URL(path, origin);
  if (action.origin !== origin.origin || action.hash) throw new EmailProviderError('EMAIL_INPUT');
  const preferenceUrl = `${origin.origin}/app/settings/notifications`;
  const countLabels: Partial<Record<NotificationCategory, readonly [string, string, string]>> = {
    daily_digest: ['opportunity', 'opportunities', 'to review'],
    invitation: ['invitation', 'invitations', 'created'],
    ingestion_complete: ['page', 'pages', 'processed'],
    usage_limit: ['unit', 'units', 'used for this metric'],
  };
  const label = countLabels[request.category];
  const facts = [
    request.count === undefined || !label
      ? null
      : `${request.count} ${request.count === 1 ? label[0] : label[1]} ${label[2]}.`,
    request.score === undefined ? null : `Opportunity score: ${request.score}/100.`,
    request.summary,
  ].filter((value): value is string => Boolean(value));
  const subject = template.subject;
  const text = [
    `ThreadSignal · ${request.organizationName}`,
    template.heading,
    template.body,
    ...facts,
    `${template.label}: ${action.href}`,
    `Manage notification preferences or unsubscribe by category: ${preferenceUrl}`,
    'ThreadSignal never submits Reddit comments for you.',
  ].join('\n\n');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(subject)}</title></head><body style="margin:0;background:#f5f4fb;color:#20243b;font-family:Arial,sans-serif;line-height:1.65"><main style="max-width:560px;margin:32px auto;padding:32px;background:#ffffff;border-radius:20px"><p style="font-size:13px;font-weight:bold;letter-spacing:2px;color:#5543c4">THREADSIGNAL</p><p>${escape(request.organizationName)}</p><h1 style="font-size:28px;line-height:1.2">${escape(template.heading)}</h1><p>${escape(template.body)}</p>${facts.map((fact) => `<p>${escape(fact)}</p>`).join('')}<p style="margin:28px 0"><a href="${escape(action.href)}" style="display:inline-block;background:#5543c4;color:#ffffff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:bold">${escape(template.label)}</a></p><hr style="border:0;border-top:1px solid #e4e2ee"><p style="font-size:13px"><a href="${escape(preferenceUrl)}" style="color:#5543c4">Manage preferences or unsubscribe by category</a></p><p style="font-size:12px">ThreadSignal never submits Reddit comments for you.</p></main></body></html>`;
  return { subject, text, html, preferenceUrl };
}

/** Future messaging destinations share a contract without adding an active Slack integration. */
export interface NotificationDestination {
  readonly channel: 'email' | 'slack';
  deliver(deliveryId: string): Promise<void>;
}
