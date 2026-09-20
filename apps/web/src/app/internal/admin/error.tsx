'use client';
import { ErrorState } from '@threadsignal/ui';
export default function OperationsError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ErrorState onRetry={retry} />;
}
