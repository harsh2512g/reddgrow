import { signalRoute, bulkDismiss } from '@/lib/phase3/api';
export const POST = (request: Request) => signalRoute(() => bulkDismiss(request));
