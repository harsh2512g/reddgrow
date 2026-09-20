import { extensionRoute, listConnections } from '@/lib/phase5/api';
export const GET = (request: Request) => extensionRoute(request, () => listConnections(request));
