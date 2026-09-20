import { signalRoute, findCommunities } from '@/lib/phase3/api';
export const GET = (request: Request) => signalRoute(() => findCommunities(request));
