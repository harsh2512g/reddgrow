'use client';

import { unstable_rethrow } from 'next/navigation';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowRight, Inbox, Mail } from 'lucide-react';
import { Button } from '@threadsignal/ui';
import { FormField, ResultNotice } from './primitives';
import type { ActionResult, FormAction } from './types';
import { LocalAccountHelp } from './local-account-help';

const loginSchema = z.object({ email: z.email('Enter a valid email address.').max(254) });

export function LoginForm({
  action,
  googleHref,
  googleNext = '/app',
  initialError,
  localInboxHref,
}: {
  action: FormAction;
  googleHref?: string;
  googleNext?: string;
  initialError?: string;
  localInboxHref?: string;
}) {
  const [result, setResult] = useState<ActionResult | null>(
    initialError ? { status: 'error', message: initialError } : null,
  );
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    getValues,
  } = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '' },
  });

  if (result?.status === 'success')
    return (
      <div className="space-y-6">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-violet-50 text-primary">
          <Inbox size={27} />
        </span>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Check your inbox.</h2>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            We sent a sign-in link to{' '}
            <strong className="font-medium text-foreground">{getValues('email')}</strong>. Open it
            in this browser to continue.
          </p>
        </div>
        <ResultNotice result={result} />
        {localInboxHref && (
          <div className="space-y-3">
            <p className="text-sm leading-6 text-muted-foreground">
              This is a local development email. Find it in the local inbox below, not your regular
              email inbox.
            </p>
            <Button asChild>
              <a href={localInboxHref} target="_blank" rel="noreferrer">
                Open local inbox <ArrowRight size={16} />
              </a>
            </Button>
          </div>
        )}
        <button
          type="button"
          className="block text-sm font-semibold text-primary"
          onClick={() => setResult(null)}
        >
          Use a different email
        </button>
      </div>
    );

  return (
    <div className="space-y-6">
      {localInboxHref && <LocalAccountHelp />}
      <div>
        {googleHref ? (
          <form action={googleHref} method="post">
            <input type="hidden" name="next" value={googleNext} />
            <Button type="submit" variant="outline" className="w-full">
              <GoogleMark /> Continue with Google
            </Button>
          </form>
        ) : (
          <>
            <Button type="button" variant="outline" disabled className="w-full">
              <GoogleMark /> Continue with Google
            </Button>
            <p className="mt-2 text-center text-xs leading-5 text-muted-foreground">
              Google sign-in is not connected in this local workspace.
            </p>
          </>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or continue with email
        <span className="h-px flex-1 bg-border" />
      </div>
      <form
        noValidate
        className="space-y-5"
        onSubmit={handleSubmit(async (values) => {
          setResult(null);
          const data = new FormData();
          data.set('email', values.email);
          try {
            setResult(await action(data));
          } catch (error) {
            unstable_rethrow(error);
            setResult({
              status: 'error',
              message: 'We could not send your link. Please try again.',
            });
          }
        })}
      >
        <FormField label="Email address" id="login-email" error={errors.email?.message}>
          <div className="relative">
            <Mail
              aria-hidden="true"
              size={17}
              className="pointer-events-none absolute left-3.5 top-3.5 text-muted-foreground"
            />
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              className="field-input pl-11"
              placeholder="you@yourcompany.com"
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? 'login-email-error' : undefined}
              {...register('email')}
            />
          </div>
        </FormField>
        <ResultNotice result={result} />
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? 'Sending your link…' : 'Send magic link'}
          <ArrowRight size={16} />
        </Button>
        <p className="text-center text-xs leading-5 text-muted-foreground">
          No password to remember. Just a secure link to your inbox.
        </p>
      </form>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18">
      <path
        fill="currentColor"
        d="M19.4 10.2c0-.7-.1-1.4-.2-2.1H10v3.8h5.3a4.5 4.5 0 0 1-2 3v2.5h3.2c1.9-1.7 2.9-4.1 2.9-7.2ZM10 20c2.7 0 5-0.9 6.6-2.5l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.9-1.8-5.7-4.2H1v2.6A10 10 0 0 0 10 20ZM4.3 11.8a6 6 0 0 1 0-3.6V5.6H1a10 10 0 0 0 0 8.8l3.3-2.6ZM10 4c1.5 0 2.8.5 3.8 1.5l2.8-2.8A9.6 9.6 0 0 0 10 0a10 10 0 0 0-9 5.6l3.3 2.6C5.1 5.8 7.4 4 10 4Z"
      />
    </svg>
  );
}
