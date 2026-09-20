import { signalRoute, listOpportunities } from '@/lib/phase3/api';
export const GET = (request: Request) => signalRoute(() => listOpportunities(request));
