import { billingRoute, readSubscription } from '@/lib/phase7/api';
export const runtime = 'nodejs';
export const GET = (request: Request) => billingRoute(() => readSubscription(request));
