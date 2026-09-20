import { attributionRoute, readAnalytics } from '@/lib/phase6/api';
export const GET = (request: Request) => attributionRoute(() => readAnalytics(request, 'summary'));
