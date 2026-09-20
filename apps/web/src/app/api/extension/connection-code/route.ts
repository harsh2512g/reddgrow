import { extensionRoute, createConnection } from '@/lib/phase5/api';
export const POST = (request: Request) => extensionRoute(request, () => createConnection(request));
