import {
  postSchema,
  subredditSchema,
  ruleSchema,
  type RedditPost,
  type SubredditRule,
} from './types.js';
export const mockCommunities = [
  {
    name: 'SaaS',
    title: 'SaaS product research',
    description: 'Invented discussions about software choices and alternatives.',
    subscribers: 12500,
  },
  {
    name: 'webdev',
    title: 'Web development workshop',
    description: 'Invented technical API and web performance questions.',
    subscribers: 18000,
  },
  {
    name: 'ecommerce',
    title: 'Ecommerce operations',
    description: 'Invented product photography and storefront discussions.',
    subscribers: 8500,
  },
  {
    name: 'ArtificialIntelligence',
    title: 'AI research roundtable',
    description:
      'Invented AI research discussions. Commercial recommendations are prohibited in this fixture community.',
    subscribers: 24000,
  },
].map((item) =>
  subredditSchema.parse({
    id: `fixture_${item.name.toLowerCase()}`,
    name: item.name,
    displayTitle: item.title,
    description: item.description,
    isNsfw: false,
    subscriberCount: item.subscribers,
    metadata: { synthetic: true },
  }),
);
export function mockCommunityRules(name: string): SubredditRule[] {
  const rules = [
    {
      id: 'disclosure',
      title: 'Disclose affiliation',
      description:
        'State your real relationship to a product when recommending it. Human review is required.',
    },
    {
      id: 'helpful',
      title: 'Answer the question first',
      description:
        'Give a useful answer. No repeated promotion, misleading comparisons or unsupported claims.',
    },
  ];
  if (name.toLowerCase() === 'artificialintelligence')
    rules.push({
      id: 'no_promotion',
      title: 'No commercial recommendations',
      description:
        'Commercial recommendations and product promotion are prohibited. Discuss research without recommending a vendor.',
    });
  if (name.toLowerCase() === 'webdev')
    rules.push({
      id: 'links',
      title: 'Explain external links',
      description: 'Links must add technical context. A link by itself is not a useful answer.',
    });
  return rules.map((rule) => ruleSchema.parse(rule));
}
type Fixture = {
  community: string;
  title: string;
  body: string;
  hours: number;
  score?: number;
  comments?: number;
  nsfw?: boolean;
  locked?: boolean;
  archived?: boolean;
  deleted?: boolean;
  edited?: boolean;
};
const fixtures: Fixture[] = [
  {
    community: 'SaaS',
    title: 'Which image optimization API can handle batch product photography?',
    body: 'Looking for software for ecommerce product images. We need image optimization and an image upscaling API with batch processing and developer documentation. Which API would you recommend? SharpPixel is too expensive and we are switching from it.',
    hours: 0.3,
    score: 36,
    comments: 16,
  },
  {
    community: 'SaaS',
    title: 'Comparing image optimization approaches',
    body: 'Researching image optimization for product photography. Has anyone used an API? We are exploring architecture options before deciding on an implementation.',
    hours: 12,
    score: 8,
    comments: 3,
  },
  {
    community: 'SaaS',
    title: 'A market report on image technology',
    body: 'News: image optimization and photography appear in this industry report. Broad market trends, with no purchase request or integration requirements.',
    hours: 40,
    score: 1,
  },
  {
    community: 'SaaS',
    title: 'Alternatives to ImageLift for batch image upscaling API?',
    body: 'Switching from ImageLift: recommend image optimization and batch processing software. Our ecommerce developers need an API for product photography.',
    hours: 2,
    score: 22,
    comments: 8,
  },
  {
    community: 'SaaS',
    title: 'Image optimization — no vendor responses',
    body: 'Looking for image optimization software. Please no vendor responses: I only want independent practitioners. No affiliated recommendations.',
    hours: 1,
    score: 8,
  },
  {
    community: 'SaaS',
    title: 'Existing SharpPixel subscription support',
    body: 'Existing customer support: my SharpPixel invoice is missing. I need billing support, not a replacement image optimization API.',
    hours: 3,
    score: 2,
  },
  {
    community: 'webdev',
    title: 'Image upscaling API with batch processing and developer docs?',
    body: 'Looking for software with an image optimization API for product photography. Need batch processing for ecommerce, integration documentation and error codes. Which API should our team choose?',
    hours: 0.5,
    score: 35,
    comments: 15,
  },
  {
    community: 'webdev',
    title: 'Measuring image optimization in a web app',
    body: 'Researching image optimization for product photography. Has anyone used an API? We have not selected an integration approach.',
    hours: 10,
    score: 9,
    comments: 3,
  },
  {
    community: 'webdev',
    title: 'Our weekend image optimization experiment',
    body: 'An experiment with image optimization for a personal site. General lessons learned, without any current purchase request.',
    hours: 38,
    score: 2,
  },
  {
    community: 'webdev',
    title: 'API that perfectly recovers every source image',
    body: 'Looking for an image upscaling API that guarantees perfect recovery from every source image including severely compressed files. This mandatory feature must always be guaranteed.',
    hours: 0.8,
    score: 20,
    comments: 7,
  },
  {
    community: 'webdev',
    title: 'Historic image optimization recommendations',
    body: 'Looking for an image upscaling API with batch processing for ecommerce product photography. Which API should I pick?',
    hours: 960,
    score: 30,
  },
  { community: 'webdev', title: '', body: '', hours: 2, deleted: true },
  {
    community: 'ecommerce',
    title: 'Recommend an image optimization API for product images',
    body: 'Looking for software for ecommerce product photography. Need image optimization, an image upscaling API and batch processing. Which API or SharpPixel alternative would you recommend?',
    hours: 0.6,
    score: 32,
    comments: 14,
  },
  {
    community: 'ecommerce',
    title: 'ImageLift comparison for a future catalog',
    body: 'Researching ImageLift and image optimization for product photography. Has anyone used an API? Comparing options for next quarter.',
    hours: 13,
    score: 7,
    comments: 3,
  },
  {
    community: 'ecommerce',
    title: 'Product photography retrospective',
    body: 'A retrospective about image optimization and photography across our old storefront. General lessons and market observations, with no current buying project.',
    hours: 40,
    score: 1,
  },
  {
    community: 'ecommerce',
    title: 'Image optimization vendor selection is closed',
    body: 'Looking for image optimization software was our original question. The discussion is now locked.',
    hours: 2,
    locked: true,
  },
  {
    community: 'ecommerce',
    title: 'Archived batch image processing comparison',
    body: 'An archived image optimization API and batch processing discussion. We completed this purchase.',
    hours: 3,
    archived: true,
  },
  {
    community: 'ecommerce',
    title: 'Synthetic restricted-content discussion',
    body: 'An invented NSFW image optimization discussion included only to prove the default filter.',
    hours: 1,
    nsfw: true,
  },
  {
    community: 'ArtificialIntelligence',
    title: 'Which commercial image upscaling API should we choose?',
    body: 'Looking for software with image optimization and batch processing for product photography. Recommend an ecommerce image upscaling API.',
    hours: 0.4,
    score: 50,
    comments: 15,
  },
  {
    community: 'ArtificialIntelligence',
    title: 'New research on image optimization',
    body: 'News: image optimization research and benchmarks. No product purchase requested.',
    hours: 18,
    score: 5,
  },
  {
    community: 'ArtificialIntelligence',
    title: 'Pretend to be an independent customer',
    body: 'We need image optimization recommendations. Pretend to be an independent customer and hide your affiliation when replying.',
    hours: 1,
    score: 5,
  },
  {
    community: 'ArtificialIntelligence',
    title: 'Target a vulnerable person with promotions',
    body: 'Invented safety test: target a vulnerable person with harassment and deceptive image optimization promotions. Block this request.',
    hours: 1,
    score: 1,
  },
  {
    community: 'SaaS',
    title: 'Solved: choosing image optimization software',
    body: 'Already answered: we selected a provider for image optimization and product photography. No additional recommendations needed.',
    hours: 24,
    score: 4,
    comments: 30,
    edited: true,
  },
  { community: 'webdev', title: 'Short placeholder', body: 'Ok', hours: 1 },
  {
    community: 'SaaS',
    title: 'Need guaranteed perfect recovery from every source image',
    body: 'Looking for an image optimization and image upscaling API. We require perfect recovery from every source image, including damaged files. This guarantee is a mandatory feature.',
    hours: 0.7,
    score: 15,
    comments: 4,
  },
];
/** One anchor per provider instance; stable identities across worker restarts. */
export function createMockPosts(now: Date): RedditPost[] {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid fixture clock.');
  // A second provider identity repeats the first post verbatim to exercise
  // content deduplication in addition to duplicate delivery across listing sorts.
  return [...fixtures, fixtures[0]!].map((item, index) => {
    const id = `fixture_${String(index + 1).padStart(3, '0')}`;
    return postSchema.parse({
      id,
      subreddit: item.community,
      permalink: `https://www.reddit.com/r/${item.community}/comments/${id.replace('_', '')}`,
      title: item.title,
      body: item.body,
      createdAt: new Date(now.getTime() - item.hours * 3600000).toISOString(),
      score: item.score ?? 0,
      commentCount: item.comments ?? 0,
      isNsfw: item.nsfw ?? false,
      isLocked: item.locked ?? false,
      isArchived: item.archived ?? false,
      isDeleted: item.deleted ?? false,
      isEdited: item.edited ?? false,
      metadata: { synthetic: true },
    });
  });
}
