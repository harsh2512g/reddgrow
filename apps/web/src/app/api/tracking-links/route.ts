import { attributionRoute, createTrackingLink, listTrackingLinks } from '@/lib/phase6/api';
export const runtime = 'nodejs';
export const GET = (request: Request) => attributionRoute(() => listTrackingLinks(request));
export const POST = (request: Request) => attributionRoute(() => createTrackingLink(request));
