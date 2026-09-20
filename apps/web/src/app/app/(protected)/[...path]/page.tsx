import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/require-session';
export default async function ProtectedWorkspaceRoute() {
  await requireUser();
  notFound();
}
