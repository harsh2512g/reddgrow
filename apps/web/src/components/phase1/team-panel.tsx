'use client';

import { unstable_rethrow } from 'next/navigation';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { MailPlus, UserRound, X } from 'lucide-react';
import { Button } from '@threadsignal/ui';
import { FormField, PermissionNotice, ResultNotice } from './primitives';
import { InvitationLink } from './invitation-panel';
import type { ActionResult, FormAction, Invitation, Member } from './types';

const invitationSchema = z.object({
  email: z.email('Enter a valid email address.').max(254),
  role: z.enum(['admin', 'member', 'viewer']),
});

export function TeamPanel({
  members,
  invitations,
  canManage,
  inviteAction,
  updateRoleAction,
  removeMemberAction,
  revokeInvitationAction,
  memberLimit,
}: {
  members: Member[];
  invitations: Invitation[];
  canManage: boolean;
  inviteAction: FormAction;
  updateRoleAction: FormAction;
  removeMemberAction: FormAction;
  revokeInvitationAction: FormAction;
  memberLimit: number;
}) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof invitationSchema>>({
    resolver: zodResolver(invitationSchema),
    defaultValues: { email: '', role: 'member' },
  });
  const atLimit = members.length + invitations.length >= memberLimit;
  async function runAction(action: FormAction, fields: Record<string, string>, key: string) {
    setBusy(key);
    setResult(null);
    const data = new FormData();
    Object.entries(fields).forEach(([name, value]) => data.set(name, value));
    try {
      setResult(await action(data));
    } catch (error) {
      unstable_rethrow(error);
      setResult({
        status: 'error',
        message: 'The team change could not be completed. Please try again.',
      });
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="space-y-6">
      {!canManage && <PermissionNotice />}
      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-5">
          <div>
            <h2 className="font-semibold">People in your workspace</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              One team. A clear role for everyone.
            </p>
          </div>
          <span className="status-pill">
            {members.length} of {memberLimit} seats
          </span>
        </div>
        <ul className="divide-y divide-border">
          {members.map((member) => (
            <li key={member.id} className="flex flex-wrap items-center gap-4 p-5 sm:px-6">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-primary">
                <UserRound aria-hidden="true" size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="break-all text-sm font-semibold">
                  {member.email}
                  {member.isCurrentUser && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">You</span>
                  )}
                </p>
                <p className="mt-1 text-xs capitalize text-muted-foreground">
                  {member.role === 'owner' ? 'Workspace owner' : `${member.role} access`}
                </p>
              </div>
              {canManage && member.role !== 'owner' && !member.isCurrentUser ? (
                <div className="flex items-center gap-2">
                  <label className="sr-only" htmlFor={`role-${member.id}`}>
                    Role for {member.email}
                  </label>
                  <select
                    id={`role-${member.id}`}
                    className="field-input min-h-9 w-28 py-1.5 text-xs"
                    value={member.role}
                    disabled={busy !== null}
                    onChange={(event) =>
                      void runAction(
                        updateRoleAction,
                        { memberId: member.id, role: event.target.value },
                        member.id,
                      )
                    }
                  >
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy !== null}
                    aria-label={`Remove ${member.email}`}
                    onClick={() => {
                      if (window.confirm(`Remove ${member.email} from this organization?`))
                        void runAction(removeMemberAction, { memberId: member.id }, member.id);
                    }}
                  >
                    <X size={16} />
                  </Button>
                </div>
              ) : (
                <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium capitalize">
                  {member.role}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
      <ResultNotice result={result} />
      {result?.invitationUrl && <InvitationLink url={result.invitationUrl} />}{' '}
      {canManage && (
        <section className="panel p-6">
          <div className="mb-6 flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-primary">
              <MailPlus size={20} />
            </span>
            <div>
              <h2 className="font-semibold">Make room for a useful perspective.</h2>
              <p className="mt-1 text-xs leading-6 text-muted-foreground">
                Invite a teammate with just the access they need.
              </p>
            </div>
          </div>
          {atLimit ? (
            <div
              className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-warning"
              role="status"
            >
              All {memberLimit} seat{memberLimit === 1 ? ' is' : 's are'} allocated, including
              pending invitations. Remove an invitation or review your plan before inviting someone
              else.
            </div>
          ) : (
            <form
              noValidate
              className="grid items-start gap-4 sm:grid-cols-[1fr_150px_auto]"
              onSubmit={handleSubmit(async (values) => {
                const data = new FormData();
                data.set('email', values.email);
                data.set('role', values.role);
                try {
                  const response = await inviteAction(data);
                  setResult(response);
                  if (response.status === 'success') reset();
                } catch (error) {
                  unstable_rethrow(error);
                  setResult({
                    status: 'error',
                    message: 'The invitation could not be sent. Please try again.',
                  });
                }
              })}
            >
              <FormField label="Email address" id="invite-email" error={errors.email?.message}>
                <input
                  id="invite-email"
                  className="field-input"
                  type="email"
                  autoComplete="email"
                  placeholder="teammate@company.com"
                  aria-invalid={Boolean(errors.email)}
                  {...register('email')}
                />
              </FormField>
              <FormField label="Role" id="invite-role">
                <select id="invite-role" className="field-input" {...register('role')}>
                  <option value="admin">Admin</option>
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                </select>
              </FormField>
              <Button type="submit" className="sm:mt-7" disabled={isSubmitting}>
                {isSubmitting ? 'Inviting…' : 'Send invitation'}
              </Button>
            </form>
          )}
        </section>
      )}
      <section className="panel p-6">
        <h2 className="font-semibold">Pending invitations</h2>
        {invitations.length === 0 ? (
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            You’re all caught up. There are no outstanding invitations.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {invitations.map((invitation) => (
              <li
                key={invitation.id}
                className="flex flex-wrap items-center justify-between gap-3 py-4"
              >
                <div className="min-w-0">
                  <p className="break-all text-sm font-medium">{invitation.email}</p>
                  <p className="mt-1 text-xs capitalize text-muted-foreground">
                    {invitation.role} · Expires{' '}
                    {new Date(invitation.expiresAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      timeZone: 'UTC',
                    })}
                  </p>
                </div>
                {canManage && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() =>
                      void runAction(
                        revokeInvitationAction,
                        { invitationId: invitation.id },
                        invitation.id,
                      )
                    }
                  >
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Owner', 'Billing, members, settings, and organization control.'],
          ['Admin', 'Team and workspace settings, without ownership control.'],
          ['Member', 'Participate in supported product workflows.'],
          ['Viewer', 'Read-only access to the workspace.'],
        ].map(([role, description]) => (
          <div key={role} className="border-t border-border pt-4">
            <p className="text-xs font-semibold">{role}</p>
            <p className="mt-2 text-xs leading-6 text-muted-foreground">{description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
