import { attributionRoute, revokeConversionKey } from '@/lib/phase6/api';
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return attributionRoute(() => revokeConversionKey(request, id));
}
