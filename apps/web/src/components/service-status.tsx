'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@threadsignal/ui';
import { readinessSchema, type Readiness } from '@/lib/health/schema';
import { Icon } from './icon';

type State = { status: 'loading' } | { status: 'failed' } | { status: 'loaded'; data: Readiness };

export function ServiceStatus() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const active = useRef<AbortController | null>(null);

  const check = useCallback(async (): Promise<State | null> => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const timeout = setTimeout(() => controller.abort(), 8_000);
    controller.signal.addEventListener('abort', () => clearTimeout(timeout), { once: true });
    try {
      const response = await fetch('/api/health/ready', {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (response.status !== 200 && response.status !== 503)
        throw new Error('Health check unavailable');
      const data = readinessSchema.parse(await response.json());
      return active.current === controller ? { status: 'loaded', data } : null;
    } catch {
      return active.current === controller ? { status: 'failed' } : null;
    } finally {
      clearTimeout(timeout);
    }
  }, []);

  useEffect(() => {
    void check().then((result) => {
      if (result) setState(result);
    });
    return () => {
      const controller = active.current;
      active.current = null;
      controller?.abort();
    };
  }, [check]);

  return (
    <section
      className="rounded-xl border border-border bg-white p-5"
      aria-labelledby="services-heading"
    >
      <div className="flex items-center gap-2">
        <Icon name="activity" className="text-primary" />
        <h2 id="services-heading" className="text-sm font-semibold">
          Local services
        </h2>
      </div>
      <div aria-live="polite" aria-busy={state.status === 'loading'} className="mt-5">
        {state.status === 'loading' && (
          <p className="text-xs leading-6 text-muted-foreground">Checking local services…</p>
        )}
        {state.status === 'failed' && (
          <p className="text-xs leading-6 text-warning">
            The service check could not finish. Try again once the local app is available.
          </p>
        )}
        {state.status === 'loaded' && (
          <>
            <p
              className={`text-xs font-medium ${state.data.status === 'ready' ? 'text-positive' : 'text-warning'}`}
            >
              {state.data.status === 'ready'
                ? 'All local dependencies are ready'
                : 'Local services need attention'}
            </p>
            <dl className="mt-4 space-y-3">
              {Object.entries(state.data.checks).map(([name, value]) => (
                <div className="flex items-center justify-between gap-3 text-xs" key={name}>
                  <dt className="capitalize text-muted-foreground">
                    {name === 'database' ? 'Database' : 'Redis queue'}
                  </dt>
                  <dd
                    className={
                      value === 'ready' ? 'font-medium text-positive' : 'font-medium text-warning'
                    }
                  >
                    {value === 'ready'
                      ? 'Ready'
                      : value === 'unconfigured'
                        ? 'Not configured'
                        : 'Unavailable'}
                  </dd>
                </div>
              ))}
            </dl>
            {state.data.status !== 'ready' && (
              <p className="mt-4 text-xs leading-6 text-muted-foreground">
                Start the project’s local services using the setup instructions, then check again.
              </p>
            )}
          </>
        )}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-5 w-full"
        disabled={state.status === 'loading'}
        onClick={() => {
          setState({ status: 'loading' });
          void check().then((result) => {
            if (result) setState(result);
          });
        }}
      >
        Check again
      </Button>
    </section>
  );
}
