import 'server-only';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { Database } from '@threadsignal/database';
import { redirect } from 'next/navigation';
import { createServerSupabase } from './server';
import { safeNextPath } from './policy';
import { verifiedUser } from './session';

export async function getOptionalUser(): Promise<User | null> {
  try {
    const supabase = await createServerSupabase();
    return verifiedUser(await supabase.auth.getUser());
  } catch {
    return null;
  }
}

/** Server and RLS operations receive a server-verified user, never a decoded cookie alone. */
export async function requireUser(
  next = '/app',
): Promise<{ user: User; supabase: SupabaseClient<Database> }> {
  let supabase: SupabaseClient<Database>;
  let user: User | null;
  try {
    supabase = await createServerSupabase();
    user = verifiedUser(await supabase.auth.getUser());
  } catch {
    redirect(`/login?error=service_unavailable&next=${encodeURIComponent(safeNextPath(next))}`);
  }
  if (!user) redirect(`/login?next=${encodeURIComponent(safeNextPath(next))}`);
  return { user, supabase };
}

export const requireSession = requireUser;

/** Kept only until all Phase 0 callers are migrated; no anonymous /app bypass remains. */
export const requireLocalPreview = requireUser;
