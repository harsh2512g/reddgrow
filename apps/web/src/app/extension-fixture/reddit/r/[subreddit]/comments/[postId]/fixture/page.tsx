import { notFound } from 'next/navigation';
import { localDraftsEnabled } from '@/lib/phase4/server';
import { DiscussionFixture } from '@/components/phase5/discussion-fixture';
export default async function ExtensionFixture({
  params,
}: {
  params: Promise<{ subreddit: string; postId: string }>;
}) {
  const { subreddit, postId } = await params;
  if (
    !localDraftsEnabled() ||
    !/^[A-Za-z0-9_]{2,21}$/.test(subreddit) ||
    !/^fixture_[A-Za-z0-9_]{1,30}$/.test(postId)
  )
    notFound();
  return <DiscussionFixture subreddit={subreddit} postId={postId} />;
}
