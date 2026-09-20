import type { User } from '@supabase/supabase-js';
import { z } from 'zod';

const verifiedIdentitySchema = z.object({
  id: z.uuid(),
  email: z.email(),
  email_confirmed_at: z.iso.datetime({ offset: true }),
  is_anonymous: z.literal(false).optional(),
});

/** The input must be auth.getUser() output, which validates the token with Supabase Auth. */
export function verifiedUser(result: { data: { user: User | null }; error: unknown }): User | null {
  if (result.error || !verifiedIdentitySchema.safeParse(result.data.user).success) return null;
  return result.data.user;
}
