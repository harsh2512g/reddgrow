import type { z } from 'zod';
import {
  trackingLinkSchema,
  conversionKeyRecordSchema,
  trackingSettingsSchema,
} from '@/lib/phase6/schema';

export {
  trackingLinkSchema as trackingLinkRecordSchema,
  conversionKeyRecordSchema,
  trackingSettingsSchema as trackingSettingsRecordSchema,
};
export type TrackingLinkRecord = z.infer<typeof trackingLinkSchema>;
export type ConversionKeyRecord = z.infer<typeof conversionKeyRecordSchema>;
export type TrackingSettingsRecord = z.infer<typeof trackingSettingsSchema>;
