import { z } from 'zod';

export const extractionFieldSchema = z.enum([
  'description',
  'value_proposition',
  'target_audience',
  'category',
  'use_cases',
  'keywords',
  'avoid_claims',
]);
export const extractionLabels: Record<z.infer<typeof extractionFieldSchema>, string> = {
  description: 'Product description',
  value_proposition: 'Value proposition',
  target_audience: 'Target audience',
  category: 'Product category',
  use_cases: 'Use cases',
  keywords: 'Product vocabulary',
  avoid_claims: 'Claims and limitations to avoid',
};
export const extractionResultSchema = z
  .object({
    suggestions: z
      .array(
        z
          .object({
            field: extractionFieldSchema,
            value: z.union([
              z.string().min(2).max(2000),
              z.array(z.string().min(1).max(200)).min(1).max(30),
            ]),
            citations: z
              .array(
                z.object({ document_id: z.uuid(), quote: z.string().min(10).max(500) }).strict(),
              )
              .min(1)
              .max(3),
          })
          .strict(),
      )
      .max(7),
  })
  .strict();
export const extractionPreviewSchema = extractionResultSchema.extend({
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  provider: z.enum(['mock', 'openai']),
  documents: z
    .array(z.object({ id: z.uuid(), source_id: z.uuid(), title: z.string().max(500) }))
    .max(8),
  limited: z.boolean(),
});
export type ExtractionPreview = z.infer<typeof extractionPreviewSchema>;
export type ExtractionSuggestion = ExtractionPreview['suggestions'][number];

export const extractionProofSchema = z
  .object({ checksum: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
