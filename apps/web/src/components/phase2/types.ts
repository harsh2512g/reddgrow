import type { z } from 'zod';
import type { brandSchema, documentSchema, searchResultSchema } from '@threadsignal/knowledge';

export type Brand = z.infer<typeof brandSchema>;
export type KnowledgeDocument = z.infer<typeof documentSchema>;
export type SearchResult = z.infer<typeof searchResultSchema>;
