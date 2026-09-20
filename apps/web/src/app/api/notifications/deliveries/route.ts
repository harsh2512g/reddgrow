import { billingRoute, notificationDeliveries } from '@/lib/phase7/api';
export const runtime = 'nodejs';
export const GET = (request: Request) => billingRoute(() => notificationDeliveries(request));
