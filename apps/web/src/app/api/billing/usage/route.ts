import { billingRoute, readUsage } from '@/lib/phase7/api';
export const runtime = 'nodejs';
export const GET = (request: Request) => billingRoute(() => readUsage(request));
