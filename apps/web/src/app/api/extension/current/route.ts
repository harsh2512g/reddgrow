import { extensionRoute, currentConversation, extensionOptions } from '@/lib/phase5/api';
export const GET = (request: Request) =>
  extensionRoute(request, () => currentConversation(request), true);
export const OPTIONS = extensionOptions;
