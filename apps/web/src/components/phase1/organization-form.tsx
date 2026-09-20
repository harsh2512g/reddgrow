'use client';

import { unstable_rethrow } from 'next/navigation';

import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowRight, Check, ShieldCheck } from 'lucide-react';
import { Button } from '@threadsignal/ui';
import { FormField, PermissionNotice, ResultNotice, responsibleUseNotice } from './primitives';
import type { ActionResult, FormAction, OrganizationValues } from './types';

const organizationSchema = z.object({
  name: z.string().trim().min(2, 'Use at least 2 characters.').max(80),
  slug: z
    .string()
    .min(3, 'Use at least 3 characters.')
    .max(48)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers, and single hyphens.'),
  billingEmail: z.union([z.email('Enter a valid billing email.').max(254), z.literal('')]),
  timezone: z
    .string()
    .min(1, 'Choose your time zone.')
    .refine((value) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, 'Enter a valid time zone, such as Asia/Kolkata.'),
  currency: z.string().regex(/^[A-Z]{3}$/, 'Use a three-letter currency code, such as USD.'),
  responsibleUse: z.boolean(),
});

type OrganizationFields = z.infer<typeof organizationSchema>;
const timezones = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
];

export function OrganizationForm({
  action,
  mode,
  defaultValues,
  canEdit = true,
  canEditBilling = true,
  footer,
}: {
  action: FormAction;
  mode: 'create' | 'edit';
  defaultValues?: OrganizationValues;
  canEdit?: boolean;
  canEditBilling?: boolean;
  footer?: ReactNode;
}) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<OrganizationFields>({
    resolver: zodResolver(organizationSchema),
    defaultValues: {
      name: '',
      slug: '',
      billingEmail: '',
      timezone: 'UTC',
      currency: 'USD',
      responsibleUse: mode === 'edit',
      ...defaultValues,
    },
  });
  const name = register('name');

  return (
    <div>
      {!canEdit && <PermissionNotice />}
      <form
        noValidate
        onSubmit={handleSubmit(async (values) => {
          if (canEditBilling && !values.billingEmail) {
            setError('billingEmail', { message: 'Enter a valid billing email.' });
            return;
          }
          if (mode === 'create' && !values.responsibleUse) {
            setError('responsibleUse', {
              message: 'Please accept the responsible-use commitment to continue.',
            });
            return;
          }
          setResult(null);
          const data = new FormData();
          for (const [key, value] of Object.entries(values)) data.set(key, String(value));
          try {
            setResult(await action(data));
          } catch (error) {
            unstable_rethrow(error);
            setResult({
              status: 'error',
              message: 'Your changes could not be saved. Please try again.',
            });
          }
        })}
        className="space-y-7"
      >
        <fieldset disabled={!canEdit || isSubmitting} className="space-y-6">
          <div className="grid gap-6 sm:grid-cols-2">
            <FormField
              label="Organization name"
              id="organization-name"
              error={errors.name?.message}
            >
              <input
                id="organization-name"
                className="field-input"
                autoComplete="organization"
                placeholder="Your company"
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? 'organization-name-error' : undefined}
                {...name}
                onChange={(event) => {
                  const oldSlug = getValues('name')
                    .toLowerCase()
                    .trim()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-|-$/g, '');
                  const shouldSuggest =
                    mode === 'create' && (!getValues('slug') || getValues('slug') === oldSlug);
                  void name.onChange(event);
                  if (shouldSuggest)
                    setValue(
                      'slug',
                      event.target.value
                        .toLowerCase()
                        .trim()
                        .replace(/[^a-z0-9]+/g, '-')
                        .replace(/^-|-$/g, '')
                        .slice(0, 48),
                    );
                }}
              />
            </FormField>
            <FormField
              label="Workspace slug"
              id="organization-slug"
              error={errors.slug?.message}
              hint={
                mode === 'edit'
                  ? 'Workspace identifiers cannot be changed after creation.'
                  : 'A unique, readable name for your workspace.'
              }
            >
              <input
                id="organization-slug"
                readOnly={mode === 'edit'}
                className="field-input"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="your-company"
                aria-invalid={Boolean(errors.slug)}
                aria-describedby={
                  errors.slug ? 'organization-slug-error' : 'organization-slug-hint'
                }
                {...register('slug')}
              />
            </FormField>
          </div>
          <FormField
            label="Billing email"
            id="organization-billing-email"
            error={errors.billingEmail?.message}
            hint={
              canEditBilling
                ? 'Used for subscription and organization notices.'
                : 'Only the organization owner can update the billing email.'
            }
          >
            <input
              id="organization-billing-email"
              className="field-input"
              readOnly={!canEditBilling}
              type="email"
              autoComplete="email"
              placeholder="billing@yourcompany.com"
              aria-invalid={Boolean(errors.billingEmail)}
              aria-describedby={
                errors.billingEmail
                  ? 'organization-billing-email-error'
                  : 'organization-billing-email-hint'
              }
              {...register('billingEmail')}
            />
          </FormField>
          <div className="grid gap-6 sm:grid-cols-2">
            <FormField
              label="Time zone"
              id="organization-timezone"
              error={errors.timezone?.message}
            >
              <input
                id="organization-timezone"
                className="field-input"
                list="organization-timezones"
                aria-invalid={Boolean(errors.timezone)}
                {...register('timezone')}
              />
              <datalist id="organization-timezones">
                {timezones.map((zone) => (
                  <option key={zone} value={zone} />
                ))}
              </datalist>
            </FormField>
            <FormField
              label="Default currency"
              id="organization-currency"
              error={errors.currency?.message}
            >
              <select id="organization-currency" className="field-input" {...register('currency')}>
                {['USD', 'EUR', 'GBP', 'INR', 'AUD', 'CAD', 'JPY', 'SGD'].map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
          {mode === 'create' && (
            <div className="rounded-2xl border border-violet-200 bg-violet-50/60 p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                <ShieldCheck size={18} /> A good conversation starts with trust.
              </div>
              <p className="mt-3 text-xs leading-6 text-muted-foreground">{responsibleUseNotice}</p>
              <label
                className="mt-5 flex cursor-pointer items-start gap-3 text-sm font-medium"
                htmlFor="responsible-use"
              >
                <input
                  id="responsible-use"
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                  aria-invalid={Boolean(errors.responsibleUse)}
                  aria-describedby={errors.responsibleUse ? 'responsible-use-error' : undefined}
                  {...register('responsibleUse')}
                />
                I agree to participate responsibly and publish replies manually.
              </label>
              {errors.responsibleUse && (
                <p id="responsible-use-error" role="alert" className="mt-2 text-xs text-red-700">
                  {errors.responsibleUse.message}
                </p>
              )}
            </div>
          )}
        </fieldset>
        <ResultNotice result={result} />
        {canEdit && (
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6">
            <p className="text-xs text-muted-foreground">
              {mode === 'create'
                ? '7-day trial · No card required'
                : 'Changes apply to this organization only.'}
            </p>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : mode === 'create' ? 'Create workspace' : 'Save changes'}
              {mode === 'create' ? <ArrowRight size={16} /> : <Check size={16} />}
            </Button>
          </div>
        )}
        {footer}
      </form>
    </div>
  );
}

export function DataRequestPanel({
  action,
  canManage,
}: {
  action: FormAction;
  canManage: boolean;
}) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <section className="panel mt-6 p-6 sm:p-7">
      <h2 className="text-lg font-semibold tracking-tight">Your organization, your data.</h2>
      <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
        Request an export or deletion review. Requests are recorded for follow-up; submitting a
        request does not immediately delete data.
      </p>
      {!canManage ? (
        <p className="mt-4 text-xs text-muted-foreground">
          Only the organization owner can submit these requests.
        </p>
      ) : (
        <form
          className="mt-5 space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setPending(true);
            const data = new FormData(event.currentTarget);
            try {
              setResult(await action(data));
            } catch (error) {
              unstable_rethrow(error);
              setResult({
                status: 'error',
                message: 'The request could not be recorded. Please try again.',
              });
            } finally {
              setPending(false);
            }
          }}
        >
          <label htmlFor="request-type" className="sr-only">
            Request type
          </label>
          <div className="flex flex-wrap gap-3">
            <select name="type" id="request-type" className="field-input sm:max-w-xs">
              <option value="export">Request a data export</option>
              <option value="deletion">Request a deletion review</option>
            </select>
            <Button type="submit" variant="outline" disabled={pending}>
              {pending ? 'Recording…' : 'Record request'}
            </Button>
          </div>
        </form>
      )}
      <div className="mt-4">
        <ResultNotice result={result} />
      </div>
    </section>
  );
}
