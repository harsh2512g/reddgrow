import { extensionRoute, revokeConnections } from '@/lib/phase5/api';
export const POST = (request: Request) => extensionRoute(request, () => revokeConnections(request));
