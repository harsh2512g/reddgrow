import { billingRoute, checkout } from '@/lib/phase7/api';
export const runtime = 'nodejs';
export const POST = (request: Request) => billingRoute(() => checkout(request));
