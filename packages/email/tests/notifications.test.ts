import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  EmailProviderError,
  ResendEmailProvider,
  getZonedClock,
  isQuietHour,
  notificationCategories,
  notificationScheduleDecision,
  renderNotification,
} from '../src/index.js';

const message = {
  to: 'recipient@example.test',
  subject: 'Safe fixture',
  text: 'A safe fixture message.',
  html: '<p>A safe fixture message.</p>',
  idempotencyKey: 'delivery-fixture-1',
  preferenceUrl: 'http://127.0.0.1:3000/app/settings/notifications',
};
const config = {
  apiKey: ['re', 'syntheticfixtureonly'].join('_'),
  from: 'notifications@example.test',
};
const receiptId = '34be3a38-f872-4d74-a1d3-d8f33c7c39ba';
function resend(body: unknown = { id: receiptId }, status = 200) {
  const transport = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));
  return { adapter: new ResendEmailProvider({ ...config, fetch: transport }), transport };
}
describe('Resend transport contract', () => {
  it('uses a fixed endpoint, bounded request, immutable idempotency key and branded multipart body', async () => {
    const { adapter, transport } = resend();
    expect(transport).not.toHaveBeenCalled();
    expect(await adapter.send(message)).toEqual({ id: receiptId, delivery: 'queued' });
    expect(await adapter.send(message)).toEqual({ id: receiptId, delivery: 'queued' });
    const [url, init] = transport.mock.calls[0] ?? [];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init?.redirect).toBe('error');
    expect(init?.headers).toMatchObject({ 'Idempotency-Key': message.idempotencyKey });
    expect(JSON.parse(String(init?.body))).toEqual({
      from: `ThreadSignal <${config.from}>`,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
      headers: { 'List-Unsubscribe': `<${message.preferenceUrl}>` },
    });
    expect(transport.mock.calls[1]?.[1]?.body).toBe(init?.body);
  });
  it.each([429, 500, 503])('marks transient provider failures retryable (%i)', async (status) => {
    await expect(
      resend({ name: 'transient', message: 'private data' }, status).adapter.send(message),
    ).rejects.toMatchObject({ code: 'EMAIL_UNAVAILABLE', retryable: true });
  });
  it('distinguishes conflicting idempotency from concurrent identical requests', async () => {
    await expect(
      resend({ name: 'invalid_idempotent_request' }, 409).adapter.send(message),
    ).rejects.toMatchObject({ code: 'EMAIL_IDEMPOTENCY_CONFLICT', retryable: false });
    await expect(
      resend({ name: 'concurrent_idempotent_requests' }, 409).adapter.send(message),
    ).rejects.toMatchObject({ code: 'EMAIL_UNAVAILABLE', retryable: true });
  });
  it('does not leak upstream errors and refuses permanent authorization failure', async () => {
    await expect(
      resend(
        { name: 'validation_error', message: 'private recipient information' },
        403,
      ).adapter.send(message),
    ).rejects.toMatchObject({ message: 'EMAIL_UNAVAILABLE', retryable: false });
    const adapter = new ResendEmailProvider({
      ...config,
      fetch: async () => {
        throw new Error('private key or response');
      },
    });
    await expect(adapter.send(message)).rejects.toMatchObject({
      message: 'EMAIL_UNAVAILABLE',
      retryable: true,
    });
  });
  it('validates configuration and message before transport', async () => {
    const { adapter, transport } = resend();
    await expect(adapter.send({ ...message, to: 'invalid' })).rejects.toThrow('EMAIL_INPUT');
    await expect(adapter.send({ ...message, idempotencyKey: 'with\nnewline' })).rejects.toThrow(
      'EMAIL_INPUT',
    );
    await expect(
      adapter.send({ ...message, preferenceUrl: 'http://private.example/settings' }),
    ).rejects.toThrow('EMAIL_INPUT');
    expect(
      () => new ResendEmailProvider({ ...config, from: 'Name <sender@example.test>' }),
    ).toThrow('EMAIL_CONFIGURATION');
    expect(transport).not.toHaveBeenCalled();
  });
  it('bounds response bodies and rejects invalid receipts', async () => {
    await expect(resend({ id: 'invalid' }).adapter.send(message)).rejects.toThrow('EMAIL_RESPONSE');
    const adapter = new ResendEmailProvider({
      ...config,
      fetch: async () => new Response('x'.repeat(70_000)),
    });
    await expect(adapter.send(message)).rejects.toThrow('EMAIL_RESPONSE');
  });
});

describe('notification templates', () => {
  it.each(notificationCategories)(
    'renders accessible branded HTML and plain text for %s',
    (category) => {
      const result = renderNotification({
        category,
        organizationName: 'Synthetic workspace',
        appUrl: 'http://127.0.0.1:3000',
        count: 2,
      });
      expect(result.html).toContain('<html lang="en">');
      expect(result.html).toContain('<h1');
      expect(result.html).toContain('THREADSIGNAL');
      expect(result.text).toContain('never submits Reddit comments');
      if (category === 'daily_digest') expect(result.text).toContain('2 opportunities to review.');
      else expect(result.text).not.toContain('2 opportunities');
      expect(result.preferenceUrl).toBe('http://127.0.0.1:3000/app/settings/notifications');
      expect(result.html).toContain('Manage preferences or unsubscribe by category');
    },
  );
  it('escapes untrusted text and validates link destinations', () => {
    const result = renderNotification({
      category: 'welcome',
      organizationName: '<script>unsafe</script>',
      summary: '<img src=x onerror=alert(1)>',
      appUrl: 'https://app.example.test',
    });
    expect(result.html).not.toContain('<script>');
    expect(result.html).not.toContain('<img src=x');
    expect(result.html).toContain('&lt;script&gt;');
    expect(() =>
      renderNotification({
        category: 'welcome',
        organizationName: 'Fixture',
        appUrl: 'https://user:secret@app.example.test',
      }),
    ).toThrow('EMAIL_INPUT');
    expect(() =>
      renderNotification({
        category: 'welcome',
        organizationName: 'Fixture',
        appUrl: 'https://app.example.test',
        actionPath: '//evil.example/link',
      }),
    ).toThrow('EMAIL_INPUT');
    expect(() =>
      renderNotification({
        category: 'welcome',
        organizationName: 'Fixture',
        appUrl: 'https://app.example.test',
        actionPath: '/app\\evil',
      }),
    ).toThrow('EMAIL_INPUT');
  });
  it('contains no invented counters when none are supplied', () => {
    const result = renderNotification({
      category: 'daily_digest',
      organizationName: 'Fixture',
      appUrl: 'https://app.example.test',
    });
    expect(result.text).not.toMatch(/\d+ opportunities/);
    expect(result.text).not.toContain('revenue');
  });
  it.each([
    ['invitation', '2 invitations created.'],
    ['ingestion_complete', '2 pages processed.'],
    ['usage_limit', '2 units used for this metric.'],
  ] as const)('uses the actual count unit for %s', (category, fact) => {
    const result = renderNotification({
      category,
      organizationName: 'Fixture',
      appUrl: 'https://app.example.test',
      count: 2,
    });
    expect(result.text).toContain(fact);
    expect(result.text).not.toContain('You have been invited');
  });
  it('does not claim new opportunities when the current digest is empty', () => {
    const result = renderNotification({
      category: 'daily_digest',
      organizationName: 'Fixture',
      appUrl: 'https://app.example.test',
      count: 0,
    });
    expect(result.text).toContain('0 opportunities to review.');
    expect(result.text).not.toContain('has new opportunities');
  });
  it('renders fractional scores produced by the opportunity pipeline', () => {
    const result = renderNotification({
      category: 'high_score_alert',
      organizationName: 'Fixture',
      appUrl: 'https://app.example.test',
      score: 86.4,
    });
    expect(result.text).toContain('Opportunity score: 86.4/100.');
  });
});

describe('notification wall-clock preferences', () => {
  const input = () => ({
    category: 'high_score_alert' as const,
    preferences: structuredClone(DEFAULT_NOTIFICATION_PREFERENCES),
    timeZone: 'Asia/Kolkata',
    now: new Date('2026-09-19T04:00:00Z'),
    score: 85,
  });
  it('uses the organization timezone including fractional offsets', () => {
    expect(getZonedClock(new Date('2026-09-19T04:00:00Z'), 'Asia/Kolkata')).toEqual({
      date: '2026-09-19',
      time: '09:30',
      minutes: 570,
    });
    expect(notificationScheduleDecision(input())).toMatchObject({ send: true, reason: 'ready' });
  });
  it('respects category disable and minimum score', () => {
    const request = input();
    request.preferences.categories.high_score_alert = false;
    expect(notificationScheduleDecision(request).reason).toBe('disabled');
    expect(notificationScheduleDecision({ ...input(), score: 79 }).reason).toBe('below_score');
    expect(notificationScheduleDecision({ ...input(), score: Number.NaN }).reason).toBe(
      'below_score',
    );
  });
  it('handles quiet hours that cross midnight with exact boundary semantics', () => {
    const quietHours = { enabled: true, start: '22:00', end: '08:00' };
    expect(isQuietHour(new Date('2026-09-19T16:30:00Z'), 'Asia/Kolkata', quietHours)).toBe(true);
    expect(isQuietHour(new Date('2026-09-19T02:29:00Z'), 'Asia/Kolkata', quietHours)).toBe(true);
    expect(isQuietHour(new Date('2026-09-19T02:30:00Z'), 'Asia/Kolkata', quietHours)).toBe(false);
    const request = input();
    request.preferences.quietHours = { enabled: true, start: '09:00', end: '10:00' };
    expect(notificationScheduleDecision(request).reason).toBe('quiet_hours');
  });
  it('requires plan access and digest time, with per-local-date dedupe', () => {
    const request = { ...input(), category: 'daily_digest' as const };
    expect(notificationScheduleDecision(request).reason).toBe('plan_required');
    expect(notificationScheduleDecision({ ...request, dailyDigestAllowed: true }).send).toBe(true);
    expect(
      notificationScheduleDecision({
        ...request,
        dailyDigestAllowed: true,
        now: new Date('2026-09-19T03:29:00Z'),
      }).reason,
    ).toBe('before_digest_time');
    expect(
      notificationScheduleDecision({
        ...request,
        dailyDigestAllowed: true,
        lastDigestLocalDate: '2026-09-19',
      }).reason,
    ).toBe('already_sent');
  });
  it('does not send twice across a repeated DST hour and allows spring-forward catch-up', () => {
    const preferences = structuredClone(DEFAULT_NOTIFICATION_PREFERENCES);
    preferences.digestTime = '01:30';
    const first = notificationScheduleDecision({
      category: 'daily_digest',
      preferences,
      timeZone: 'America/New_York',
      now: new Date('2026-11-01T05:30:00Z'),
      dailyDigestAllowed: true,
    });
    expect(first.send).toBe(true);
    expect(
      notificationScheduleDecision({
        category: 'daily_digest',
        preferences,
        timeZone: 'America/New_York',
        now: new Date('2026-11-01T06:30:00Z'),
        dailyDigestAllowed: true,
        lastDigestLocalDate: first.localDate,
      }).reason,
    ).toBe('already_sent');
    preferences.digestTime = '02:30';
    expect(
      notificationScheduleDecision({
        category: 'daily_digest',
        preferences,
        timeZone: 'America/New_York',
        now: new Date('2026-03-08T07:00:00Z'),
        dailyDigestAllowed: true,
      }).send,
    ).toBe(true);
  });
  it('rejects unknown timezones and invalid clocks with safe errors', () => {
    expect(() => getZonedClock(new Date(), 'Unknown/Zone')).toThrow(EmailProviderError);
    expect(() =>
      isQuietHour(new Date(), 'UTC', { enabled: true, start: '25:00', end: '09:00' }),
    ).toThrow('EMAIL_INPUT');
  });
});
