import { draftRoute, getDrafts } from '@/lib/phase4/api';
export const GET = (request: Request) => draftRoute(() => getDrafts(request));
