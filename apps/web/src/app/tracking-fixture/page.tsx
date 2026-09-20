import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { TrackingFixture } from '@/components/phase6/tracking-fixture';
import { attributionEnabled } from '@/lib/phase6/server';
import { getServerEnv } from '@/lib/env/server';

export const metadata: Metadata = {
  title: 'Local attribution demo',
  robots: { index: false, follow: false },
};
export default async function TrackingFixturePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!attributionEnabled()) notFound();
  const params = await searchParams;
  const parsed = z
    .object({
      brandId: z.uuid(),
      attributionDays: z.coerce.number().int().min(1).max(90).default(30),
    })
    .safeParse(params);
  if (!parsed.success) notFound();
  return <TrackingFixture {...parsed.data} apiOrigin={getServerEnv().NEXT_PUBLIC_APP_URL} />;
}
