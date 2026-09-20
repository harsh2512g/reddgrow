'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requestMagicLink, signOut } from '@/lib/auth/actions';
import { safeAuthError } from '@/lib/auth/errors';

export async function loginAction(
  data: FormData,
): Promise<{ status: 'success' | 'error'; message: string }> {
  try {
    const next = data.get('next');
    const result = await requestMagicLink(
      { email: data.get('email'), ...(next ? { next } : {}) },
      await headers(),
    );
    return { status: 'success', message: result.message };
  } catch (error) {
    return { status: 'error', message: safeAuthError(error).message };
  }
}

export async function logoutAction(): Promise<{ status: 'success' | 'error'; message: string }> {
  try {
    await signOut(await headers());
  } catch (error) {
    return { status: 'error', message: safeAuthError(error).message };
  }
  redirect('/login');
}
