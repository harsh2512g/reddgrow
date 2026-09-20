import { attributionRoute, updateTrackingSettings } from '@/lib/phase6/api';
export const PATCH = (request: Request) => attributionRoute(() => updateTrackingSettings(request));
