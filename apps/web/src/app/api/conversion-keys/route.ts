import { attributionRoute, createConversionKey, listConversionKeys } from '@/lib/phase6/api';
export const runtime = 'nodejs';
export const GET = (request: Request) => attributionRoute(() => listConversionKeys(request));
export const POST = (request: Request) => attributionRoute(() => createConversionKey(request));
