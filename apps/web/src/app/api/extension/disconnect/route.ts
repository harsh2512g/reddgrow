import { extensionRoute, disconnectExtension, extensionOptions } from '@/lib/phase5/api';
export const POST = (request: Request) =>
  extensionRoute(request, () => disconnectExtension(request), true);
export const OPTIONS = extensionOptions;
