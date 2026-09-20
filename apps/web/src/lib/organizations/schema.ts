import { z } from 'zod';
import { organizationRoleSchema, planKeySchema } from '@threadsignal/config';

export const organizationInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .min(3)
    .max(48)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  billingEmail: z.union([z.email().max(254), z.literal('')]),
  timezone: z
    .string()
    .min(1)
    .max(80)
    .refine((value) => {
      try {
        return !/^[+-]/.test(
          new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone,
        );
      } catch {
        return false;
      }
    })
    .transform(
      (value) => new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone,
    ),
  currency: z.string().regex(/^[A-Z]{3}$/),
});
export const organizationSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  timezone: z.string(),
  default_currency: z.string(),
  status: z.string(),
  trial_started_at: z.string(),
  trial_ends_at: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});
export const membershipSchema = z.object({
  organization_id: z.uuid(),
  role: organizationRoleSchema,
});
export const planSchema = z.object({
  plan_key: planKeySchema,
  status: z.string(),
  trial_ends_at: z.string().nullable(),
  seat_limit: z.number(),
  seats_used: z.number(),
  seats_reserved: z.number(),
});
export const memberSchema = z.object({
  user_id: z.uuid(),
  role: organizationRoleSchema,
  full_name: z.string().nullable(),
  email: z.string().nullable(),
  avatar_url: z.string().nullable(),
  joined_at: z.string(),
});
export const invitationSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: organizationRoleSchema,
  expires_at: z.string(),
});
export const inviteInputSchema = z.object({
  email: z
    .string()
    .trim()
    .max(254)
    .pipe(z.email())
    .transform((value) => value.toLowerCase()),
  role: z.enum(['admin', 'member', 'viewer']),
});
export const memberInputSchema = z.object({
  memberId: z.uuid(),
  role: z.enum(['admin', 'member', 'viewer']),
});
export const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/);

export function actionFailure(error: unknown): { status: 'error'; message: string } {
  const code =
    error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
  const messages: Record<string, string> = {
    FORBIDDEN: 'Your role does not allow this change.',
    BILLING_OWNER_ONLY: 'Only the owner can change billing details.',
    OWNERSHIP_OWNER_ONLY: 'Only the owner can manage ownership.',
    SEAT_LIMIT: 'Your plan has no available seats. Pending invitations reserve seats too.',
    TRIAL_EXPIRED:
      'Your trial has ended. Your data is retained, but new allocation is unavailable.',
    PLAN_INACTIVE: 'This plan is inactive. Your existing data is retained.',
    ORGANIZATION_LIMIT: 'Your account already owns a workspace. Switch to it to continue.',
    INVITATION_PENDING: 'An active invitation already exists for this email.',
    INVITATION_INVALID: 'This invitation is expired, unavailable, or belongs to a different email.',
    ALREADY_MEMBER: 'This person is already a member.',
    LAST_OWNER: 'The workspace must retain its owner.',
    MEMBER_NOT_FOUND: 'This member is no longer available.',
    INVALID_TIMEZONE: 'Choose a valid time zone.',
    EMAIL_NOT_VERIFIED: 'Verify your email before creating or joining a workspace.',
  };
  if (error instanceof z.ZodError)
    return { status: 'error', message: 'Check the form fields and try again.' };
  if (error && typeof error === 'object' && 'code' in error && error.code === '23505')
    return { status: 'error', message: 'That workspace slug or invitation is already in use.' };
  return {
    status: 'error',
    message: messages[code] ?? 'The change could not be completed. Please try again.',
  };
}
