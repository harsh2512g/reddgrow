'use client';

import Link from 'next/link';
import { useState } from 'react';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Bell, Clock3, Mail, Moon, Save } from 'lucide-react';
import { Button } from '@threadsignal/ui';
import { draftRequest, draftMessage } from '@/lib/phase4/client';
import { FormField, ResultNotice } from '../phase1/primitives';
import type { ActionResult } from '../phase1/types';
import {
  notificationCategoryLabels,
  notificationPreferencesSchema,
  type NotificationPreferences,
  type NotificationSettingsProps,
} from './types';

const categoryHints: Record<keyof NotificationPreferences['categories'], string> = {
  welcome: 'A short introduction when you join the workspace.',
  invitation: 'Workspace invitation updates for your account.',
  ingestion_complete: 'Know when new product knowledge is ready to use.',
  ingestion_failed: 'Get a prompt when a knowledge source needs attention.',
  daily_digest: 'A daily summary of relevant opportunities.',
  high_score_alert: 'Hear about opportunities at or above your chosen score.',
  trial_ending: 'A reminder before the trial finishes.',
  usage_limit: 'A notice when a workspace allowance is reached.',
  payment_failed: 'A prompt when the subscription needs payment attention.',
  subscription_changed: 'Plan, cancellation, and renewal updates.',
};

export function NotificationSettings(props: NotificationSettingsProps) {
  if (!props.enabled || !props.preferences)
    return (
      <section className="panel p-8">
        <h2 className="text-xl font-semibold">Notification preferences are not available yet.</h2>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          The workspace database needs the notification migration before preferences can be saved.
        </p>
      </section>
    );
  return <PreferencesForm {...props} preferences={props.preferences} />;
}
function PreferencesForm(
  props: NotificationSettingsProps & { preferences: NotificationPreferences },
) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const form = useForm<NotificationPreferences>({
    resolver: zodResolver(notificationPreferencesSchema),
    defaultValues: props.preferences,
  });
  const busy = form.formState.isSubmitting;
  const errors = form.formState.errors;
  async function save(values: NotificationPreferences) {
    setResult(null);
    try {
      const response = await draftRequest(
        '/api/notifications/preferences',
        z.object({ preferences: notificationPreferencesSchema }),
        props.organization.id,
        {
          method: 'PATCH',
          body: JSON.stringify(values),
        },
      );
      form.reset(response.preferences);
      setResult({
        status: 'success',
        message: 'Your notification preferences have been saved for this workspace.',
      });
    } catch (issue) {
      setResult({ status: 'error', message: draftMessage(issue) });
    }
  }
  return (
    <form className="space-y-6" onSubmit={form.handleSubmit(save)} noValidate>
      <section className="relative overflow-hidden rounded-[26px] border border-violet-200 bg-[#f1eff8] p-6 sm:p-8">
        <div
          aria-hidden
          className="absolute -right-10 -top-10 h-48 w-48 rounded-full border-[24px] border-white/50"
        />
        <div className="relative max-w-2xl">
          <span className="inline-flex rounded-2xl bg-white p-3 text-primary">
            <Bell size={23} />
          </span>
          <h2 className="mt-5 text-xl font-semibold">Useful signals. On your schedule.</h2>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            These preferences belong to you in {props.organization.name}. Each teammate chooses
            their own notifications.
          </p>
          {props.consoleMode && (
            <p className="mt-4 flex items-start gap-2 text-xs leading-6 text-primary">
              <Mail size={15} className="mt-1 shrink-0" />
              Development email is recorded by the console provider. These notifications do not send
              real emails.
            </p>
          )}
        </div>
      </section>
      <ResultNotice result={result} />
      <fieldset disabled={busy} className="panel p-6 sm:p-8">
        <legend className="sr-only">Notification categories</legend>
        <h2 className="text-lg font-semibold">Choose what reaches you</h2>
        <p className="mt-2 text-xs leading-6 text-muted-foreground">
          Plan and delivery checks still apply. You can update these choices at any time.
        </p>
        <div className="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {Object.entries(notificationCategoryLabels).map(([key, label]) => {
            const category = key as keyof NotificationPreferences['categories'];
            const locked = category === 'daily_digest' && !props.dailyDigestAvailable;
            return (
              <div key={category} className="rounded-xl border border-border bg-white p-4">
                <label
                  className={`flex items-start gap-3 ${locked ? 'text-muted-foreground' : 'cursor-pointer'}`}
                >
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-primary"
                    aria-describedby={`category-${category}-hint`}
                    {...form.register(`categories.${category}`)}
                    disabled={busy || locked}
                  />
                  <span>
                    <span className="text-sm font-semibold">{label}</span>
                    <span
                      id={`category-${category}-hint`}
                      className="mt-1 block text-xs leading-6 text-muted-foreground"
                    >
                      {categoryHints[category]}
                    </span>
                  </span>
                </label>
                {locked && (
                  <p className="ml-7 mt-2 text-xs leading-5 text-primary">
                    Available on Solo and Growth. Your preference is retained.{' '}
                    <Link
                      href="/app/settings/billing"
                      className="font-semibold underline underline-offset-2"
                    >
                      Compare plans
                    </Link>
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </fieldset>
      <fieldset disabled={busy} className="panel p-6 sm:p-8">
        <legend className="sr-only">Delivery schedule</legend>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Clock3 size={19} className="text-primary" /> Make room for focus
        </h2>
        <p className="mt-2 text-xs leading-6 text-muted-foreground">
          Times use your organization’s timezone: <strong>{props.preferences.timezone}</strong>.{' '}
          <Link
            className="font-semibold text-primary underline underline-offset-2"
            href="/app/settings/organization"
          >
            Organization settings
          </Link>
        </p>
        <input type="hidden" {...form.register('timezone')} />
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <FormField
            label="Daily digest time"
            id="digest-time"
            error={errors.digest_time?.message}
            hint="Delivery is available on Solo and Growth."
          >
            <input
              id="digest-time"
              type="time"
              className="field-input"
              aria-invalid={Boolean(errors.digest_time)}
              aria-describedby={errors.digest_time ? 'digest-time-error' : 'digest-time-hint'}
              {...form.register('digest_time')}
            />
          </FormField>
          <FormField
            label="Minimum opportunity score"
            id="minimum-score"
            error={errors.minimum_score?.message}
            hint="High-score alerts include opportunities at or above this score (0–100)."
          >
            <input
              id="minimum-score"
              type="number"
              min={0}
              max={100}
              step={1}
              className="field-input"
              aria-invalid={Boolean(errors.minimum_score)}
              aria-describedby={errors.minimum_score ? 'minimum-score-error' : 'minimum-score-hint'}
              {...form.register('minimum_score', { valueAsNumber: true })}
            />
          </FormField>
        </div>
        <div className="mt-7 rounded-2xl bg-[#f8f7fb] p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Moon size={16} className="text-primary" /> Quiet hours
          </h3>
          <p className="mt-2 text-xs leading-6 text-muted-foreground">
            Routine notifications wait until quiet hours finish. An overnight window such as
            22:00–08:00 is supported. Clear both fields to turn quiet hours off.
          </p>
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <FormField
              label="Quiet hours start"
              id="quiet-start"
              error={errors.quiet_start?.message}
            >
              <input
                id="quiet-start"
                type="time"
                className="field-input"
                aria-invalid={Boolean(errors.quiet_start)}
                {...form.register('quiet_start', { setValueAs: (value: string) => value || null })}
              />
            </FormField>
            <FormField label="Quiet hours end" id="quiet-end" error={errors.quiet_end?.message}>
              <input
                id="quiet-end"
                type="time"
                className="field-input"
                aria-invalid={Boolean(errors.quiet_end)}
                aria-describedby={errors.quiet_end ? 'quiet-end-error' : undefined}
                {...form.register('quiet_end', { setValueAs: (value: string) => value || null })}
              />
            </FormField>
          </div>
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          {form.formState.isDirty
            ? 'You have unsaved changes.'
            : 'Your saved preferences are shown above.'}
        </p>
        <Button type="submit" disabled={busy}>
          <Save size={15} />
          {busy ? 'Saving preferences…' : 'Save preferences'}
        </Button>
      </div>
    </form>
  );
}
