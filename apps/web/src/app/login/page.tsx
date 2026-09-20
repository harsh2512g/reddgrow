import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthFrame } from '@/components/phase1/auth-frame';
import { LoginForm } from '@/components/phase1/login-form';
import { getOptionalUser } from '@/lib/auth/require-session';
import { safeNextPath } from '@/lib/auth/policy';
import { getServerEnv } from '@/lib/env/server';
import { loginAction } from './actions';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Welcome in' };
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  if (await getOptionalUser()) redirect(next);
  const env = getServerEnv();
  async function signIn(data: FormData) {
    'use server';
    data.set('next', next);
    return loginAction(data);
  }
  return (
    <AuthFrame>
      <LoginForm
        action={signIn}
        {...(params.error
          ? {
              initialError:
                params.error === 'service_unavailable'
                  ? 'Sign-in is temporarily unavailable. Please try again shortly.'
                  : 'The sign-in link could not be verified. Request a new link and open it in this browser.',
            }
          : {})}
        {...(env.GOOGLE_AUTH_ENABLED && process.env.THREADSIGNAL_LOCAL !== '1'
          ? { googleHref: '/api/auth/google', googleNext: next }
          : {})}
        {...(process.env.THREADSIGNAL_LOCAL === '1' &&
        env.THREADSIGNAL_SUPABASE_MODE !== 'personal-development'
          ? { localInboxHref: 'http://127.0.0.1:54324' }
          : {})}
      />
    </AuthFrame>
  );
}
