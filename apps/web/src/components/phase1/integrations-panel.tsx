import { Bot, CreditCard, Database, Mail, MessageSquare, ShieldCheck } from 'lucide-react';
import { responsibleUseNotice } from './primitives';

export function IntegrationsPanel({
  supabaseMode,
}: {
  supabaseMode: 'local' | 'personal-development';
}) {
  const hosted = supabaseMode === 'personal-development';
  const providers = [
    {
      name: 'Supabase authentication and database',
      mode: hosted ? 'Hosted dev' : 'Local',
      icon: Database,
      text: hosted
        ? 'Accounts and workspace data use your personal Supabase development project.'
        : 'Accounts and workspace data use the project’s local Supabase service.',
    },
    {
      name: 'Reddit',
      mode: 'Mock',
      icon: MessageSquare,
      text: 'Synthetic public-conversation fixtures. Production Reddit ingestion is disabled.',
    },
    {
      name: 'AI assistance',
      mode: 'Mock',
      icon: Bot,
      text: 'Deterministic local responses. No real AI account or API key is used.',
    },
    {
      name: 'Email',
      mode: 'Console',
      icon: Mail,
      text: hosted
        ? 'Application notices use console delivery. Sign-in emails are handled by your Supabase project’s Auth settings.'
        : 'Application notices use console delivery. Sign-in links arrive in the local authentication inbox.',
    },
    {
      name: 'Billing',
      mode: 'Mock',
      icon: CreditCard,
      text: 'Trial and plan records only. No payment method or real charge is connected.',
    },
    {
      name: 'Knowledge crawler',
      mode: 'Fixture',
      icon: Database,
      text: 'Local fixture sources. Website ingestion becomes available with brand setup.',
    },
  ];
  return (
    <div className="space-y-7">
      <div
        className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm leading-6 text-warning"
        role="status"
      >
        {hosted
          ? 'This workspace uses your personal Supabase development project. Reddit and AI use mock providers, and real payments are disabled.'
          : 'This is a local workspace. Production Reddit ingestion is disabled, and no external provider account is connected.'}
      </div>
      <section className="panel overflow-hidden">
        <div className="border-b border-border px-6 py-5">
          <h2 className="font-semibold">Provider connections</h2>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Clear boundaries. No hidden connections.
          </p>
        </div>
        <ul className="divide-y divide-border">
          {providers.map(({ name, mode, icon: Icon, text }) => (
            <li key={name} className="flex items-start gap-4 p-6">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/50 text-muted-foreground">
                <Icon aria-hidden="true" size={19} />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold">{name}</h3>
                <p className="mt-2 text-xs leading-6 text-muted-foreground">{text}</p>
              </div>
              <span className="status-pill shrink-0">{mode}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="rounded-2xl border border-violet-200 bg-violet-50/50 p-6">
        <h2 className="flex items-center gap-2 font-semibold">
          <ShieldCheck size={19} className="text-primary" /> Our shared responsibility
        </h2>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-muted-foreground">
          {responsibleUseNotice}
        </p>
        <p className="mt-4 text-xs leading-6 text-muted-foreground">
          No Reddit passwords, automatic posting, voting, or hidden account networks. ThreadSignal
          is independent and is not affiliated with Reddit.
        </p>
      </section>
    </div>
  );
}
