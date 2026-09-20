import { extensionRoute, exchangeConnection, extensionOptions } from '@/lib/phase5/api';
export const POST = (request: Request) =>
  extensionRoute(request, () => exchangeConnection(request), true);
export const OPTIONS = extensionOptions;
