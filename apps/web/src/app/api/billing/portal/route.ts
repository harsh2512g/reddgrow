import { billingRoute, portal } from '@/lib/phase7/api';
export const runtime = 'nodejs';
export const POST = (request: Request) => billingRoute(() => portal(request));
