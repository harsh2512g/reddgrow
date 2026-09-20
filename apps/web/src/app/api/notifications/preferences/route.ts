import { billingRoute, notificationPreferences } from '@/lib/phase7/api';
export const runtime = 'nodejs';
export const GET = (request: Request) => billingRoute(() => notificationPreferences(request));
export const PATCH = (request: Request) => billingRoute(() => notificationPreferences(request));
