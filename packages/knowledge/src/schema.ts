import { z } from 'zod';

export const EMBEDDING_DIMENSIONS = 512;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_LENGTH = 500_000;
export const publicWebsite = z
  .url()
  .max(2048)
  .refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      !url.search &&
      /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(url.hostname) &&
      !/^(?:\d+\.){3}\d+$/.test(url.hostname) &&
      !/(?:^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname)
    );
  }, 'Use an HTTPS public website URL without credentials or query parameters.');
const optionalWebsite = z.union([z.literal(''), publicWebsite]).default('');
const list = z.array(z.string().trim().min(1).max(200)).max(30).default([]);
export const brandInputSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    website_url: publicWebsite,
    description: z.string().trim().min(10).max(2000),
    value_proposition: z.string().trim().min(10).max(2000),
    target_audience: z.string().trim().min(3).max(1000),
    use_cases: list,
    category: z.string().trim().min(2).max(100),
    pricing_url: optionalWebsite,
    docs_url: optionalWebsite,
    support_url: optionalWebsite,
    tone: z.enum([
      'Helpful and concise',
      'Technical',
      'Founder voice',
      'Product specialist',
      'Customer-support style',
      'Custom',
    ]),
    custom_tone: z.string().max(500).default(''),
    reply_length: z.enum(['concise', 'standard', 'detailed']).default('standard'),
    real_role: z.enum([
      'founder',
      'employee',
      'developer advocate',
      'support',
      'contractor',
      'agency',
      'consultant',
      'other',
    ]),
    disclosure_text: z.string().trim().min(10).max(500),
    avoid_claims: list,
    allowed_links: z.array(publicWebsite).max(20).default([]),
    countries: list,
    competitors: z
      .array(
        z.object({
          name: z.string().trim().min(2).max(100),
          domain: publicWebsite,
          aliases: list,
          notes: z.string().trim().max(2000).default(''),
        }),
      )
      .max(20)
      .default([]),
    keywords: list,
    exclusions: list,
  })
  .superRefine((value, ctx) => {
    if (value.tone === 'Custom' && !value.custom_tone.trim())
      ctx.addIssue({
        code: 'custom',
        path: ['custom_tone'],
        message: 'Describe your custom tone.',
      });
    const host = URL.canParse(value.website_url) ? new URL(value.website_url).hostname : '';
    if (value.allowed_links.some((link) => !URL.canParse(link) || new URL(link).hostname !== host))
      ctx.addIssue({
        code: 'custom',
        path: ['allowed_links'],
        message: 'Product links must use your approved website domain.',
      });
  });
export type BrandInput = z.infer<typeof brandInputSchema>;
export const demoBrand: BrandInput = {
  name: 'ClarityScale AI',
  website_url: 'https://clarityscale.example',
  description: 'Image optimization and upscaling API for ecommerce teams and developers.',
  value_proposition: 'Optimize product images and integrate batch upscaling into your application.',
  target_audience: 'Ecommerce teams and API developers',
  use_cases: ['Product photography', 'Batch image optimization'],
  category: 'Image processing API',
  pricing_url: 'https://clarityscale.example/pricing',
  docs_url: 'https://clarityscale.example/docs',
  support_url: 'https://clarityscale.example/support',
  tone: 'Technical',
  custom_tone: '',
  reply_length: 'standard',
  real_role: 'employee',
  disclosure_text: 'I work with the team behind ClarityScale AI.',
  avoid_claims: ['Perfect recovery from every source image'],
  allowed_links: ['https://clarityscale.example/docs'],
  countries: ['Worldwide'],
  competitors: [
    { name: 'SharpPixel', domain: 'https://sharppixel.example', aliases: [], notes: '' },
    { name: 'ImageLift', domain: 'https://imagelift.example', aliases: [], notes: '' },
  ],
  keywords: ['image optimization', 'image upscaling API', 'batch processing'],
  exclusions: ['no vendor responses'],
};
export const brandSchema = z.object({
  id: z.uuid(),
  organization_id: z.uuid(),
  name: z.string(),
  website_url: z.string(),
  profile: brandInputSchema,
  status: z.enum(['active', 'archived']),
  created_at: z.string(),
});
export const sourceSchema = z.object({
  id: z.uuid(),
  organization_id: z.uuid(),
  brand_id: z.uuid(),
  name: z.string(),
  type: z.enum(['website', 'webpage', 'file', 'manual']),
  status: z.enum(['pending', 'processing', 'ready', 'partial', 'failed', 'deleting']),
  source_url: z.string().nullable(),
  storage_path: z.string().nullable(),
  filename: z.string().nullable(),
  mime_type: z.string().nullable(),
  error_code: z.string().nullable(),
  page_count: z.number(),
  chunk_count: z.number(),
  generation: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
  last_ingested_at: z.string().nullable(),
  deleted_at: z.string().nullable(),
});
export type KnowledgeSource = z.infer<typeof sourceSchema>;
export const sourceInputSchema = z
  .object({
    name: z.string().trim().min(2).max(150),
    type: z.enum(['website', 'webpage', 'manual', 'file']),
    pages: z.array(publicWebsite).max(100).default([]),
    text: z.string().max(MAX_TEXT_LENGTH).default(''),
    filename: z.string().max(150).default(''),
    mime_type: z.string().max(100).default(''),
    storage_path: z.string().max(250).default(''),
  })
  .superRefine((v, c) => {
    if (v.type === 'manual' && v.text.trim().length < 20)
      c.addIssue({
        code: 'custom',
        path: ['text'],
        message: 'Add at least 20 characters of useful knowledge.',
      });
    if (
      ['website', 'webpage'].includes(v.type) &&
      (!v.pages.length || (v.type === 'webpage' && v.pages.length !== 1))
    )
      c.addIssue({
        code: 'custom',
        path: ['pages'],
        message: 'Select the approved pages to ingest.',
      });
  });
export const searchResultSchema = z.object({
  id: z.uuid(),
  source_id: z.uuid(),
  document_id: z.uuid(),
  title: z.string(),
  source_url: z.string().nullable(),
  page_number: z.number().nullable(),
  content: z.string(),
  score: z.number(),
});
export const documentSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  canonical_url: z.string().nullable(),
  page_number: z.number().nullable(),
  content: z.string(),
  is_included: z.boolean(),
  checksum: z.string(),
});
export type Brand = z.infer<typeof brandSchema>;
export type KnowledgeDocument = z.infer<typeof documentSchema>;
export type SearchResult = z.infer<typeof searchResultSchema>;
