import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginForm } from '../src/components/phase1/login-form';
import { OrganizationForm } from '../src/components/phase1/organization-form';
import { TeamPanel } from '../src/components/phase1/team-panel';
import { InvitationPanel } from '../src/components/phase1/invitation-panel';
import type { ActionResult, FormAction } from '../src/components/phase1/types';

const google = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/auth/google-client', () => ({ googleSignInDestination: google }));
beforeEach(() => {
  google.mockReset();
});

const success: ActionResult = { status: 'success', message: 'Saved successfully.' };
const organization = {
  name: 'Thoughtful Studio',
  slug: 'thoughtful-studio',
  billingEmail: 'owner@example.test',
  timezone: 'Asia/Kolkata',
  currency: 'USD',
};
function action() {
  return vi.fn<FormAction>().mockResolvedValue(success);
}

const team = {
  members: [
    { id: 'owner-1', email: 'owner@example.test', role: 'owner' as const, isCurrentUser: true },
  ],
  invitations: [],
  inviteAction: action(),
  updateRoleAction: action(),
  removeMemberAction: action(),
  revokeInvitationAction: action(),
};

describe('Phase 1 forms', () => {
  it('shows Google pending and retryable failures on the login screen without leaking provider details', async () => {
    let reject: ((error: Error) => void) | undefined;
    google.mockImplementation(
      () =>
        new Promise<string>((_, failure) => {
          reject = failure;
        }),
    );
    render(
      <LoginForm
        action={action()}
        googleSupabaseOrigin="https://abcdefghijklmnopqrst.supabase.co"
        googleNext="/app/settings/team"
      />,
    );
    const button = screen.getByRole('button', { name: 'Continue with Google' });
    expect(button.closest('form')).toBeNull();
    await userEvent.click(button);
    expect(screen.getByRole('button', { name: 'Connecting to Google…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send magic link' })).toBeDisabled();
    expect(google).toHaveBeenCalledWith(
      '/app/settings/team',
      'https://abcdefghijklmnopqrst.supabase.co',
    );
    reject?.(new Error('private provider details'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Google sign-in is temporarily unavailable',
    );
    expect(screen.queryByText('private provider details')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
  });
  it('validates an email before dispatching a magic link and explains the unavailable provider', async () => {
    const submit = action();
    render(<LoginForm action={submit} />);
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Email address'), 'bad-email');
    await userEvent.click(screen.getByRole('button', { name: 'Send magic link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid email address.');
    expect(submit).not.toHaveBeenCalled();
  });

  it('shows inbox success and sends only the entered email', async () => {
    const submit = action();
    render(<LoginForm action={submit} localInboxHref="http://127.0.0.1:54324" />);
    await userEvent.type(screen.getByLabelText('Email address'), 'reader@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Send magic link' }));
    expect(await screen.findByRole('heading', { name: 'Check your inbox.' })).toBeInTheDocument();
    expect(submit.mock.calls[0]?.[0].get('email')).toBe('reader@example.test');
    expect(screen.getByRole('link', { name: 'Open local inbox' })).toHaveAttribute(
      'href',
      'http://127.0.0.1:54324',
    );
  });

  it('requires responsible-use acceptance before creating a workspace', async () => {
    const submit = action();
    render(<OrganizationForm action={submit} mode="create" defaultValues={organization} />);
    await userEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please accept the responsible-use commitment',
    );
    expect(submit).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit.mock.calls[0]?.[0].get('responsibleUse')).toBe('true');
  });

  it('preserves billing visibility while restricting edits by role', () => {
    render(
      <OrganizationForm
        action={action()}
        mode="edit"
        defaultValues={organization}
        canEditBilling={false}
      />,
    );
    expect(screen.getByLabelText('Billing email')).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });

  it('shows a fully read-only organization for viewers', () => {
    render(
      <OrganizationForm
        action={action()}
        mode="edit"
        defaultValues={organization}
        canEdit={false}
      />,
    );
    expect(screen.getByLabelText('Organization name')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('read-only');
  });

  it('explains a seat limit and never offers edits to the owner role', () => {
    render(<TeamPanel {...team} memberLimit={1} canManage />);
    expect(screen.getByRole('status')).toHaveTextContent('All 1 seat is allocated');
    expect(screen.queryByRole('button', { name: 'Send invitation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('shows invitation failures as retryable errors', async () => {
    const submit = vi.fn<FormAction>().mockRejectedValue(new Error('Internal secret details'));
    render(<InvitationPanel action={submit} />);
    await userEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This invitation could not be accepted',
    );
    expect(screen.queryByText('Internal secret details')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept invitation' })).toBeEnabled();
  });
});
