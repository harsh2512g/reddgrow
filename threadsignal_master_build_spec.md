# ThreadSignal
## Master Product and Engineering Build Specification

**Document version:** 1.0  
**Date:** 2026-09-07  
**Status:** Implementation-ready MVP specification  
**Primary audience:** Codex / GPT-6 Astra / autonomous coding agents / software engineers  
**Working product name:** ThreadSignal  

> ThreadSignal is a compliance-first Reddit opportunity finder and AI reply assistant for SaaS companies. It discovers high-intent conversations, creates evidence-backed and transparent response drafts, requires the user to publish manually, and measures clicks, signups, and revenue.

---

# 0. Instructions to the coding agent

You are responsible for building the complete production-quality MVP described in this document.

Treat this document as the source of truth. Implement the requirements in order, make sensible engineering decisions where a small detail is missing, and do not reduce the core scope to static mock screens.

## 0.1 Required working behavior

The final system must support this complete flow:

1. A user creates an account and organization.
2. The user creates a brand and enters its website, product details, competitors, audience, and preferred response tone.
3. The system crawls approved pages from the brand website and accepts PDF, Markdown, text, and manual knowledge entries.
4. The user selects subreddits and keywords to monitor.
5. A Reddit provider imports posts into the system.
6. The system scores each post for product relevance, buying intent, freshness, engagement, community-rule fit, and competitor context.
7. High-value posts appear in an opportunity feed.
8. The user opens an opportunity and generates an AI reply.
9. The system verifies product claims against the brand knowledge base and runs a separate compliance check.
10. The user edits and approves the reply.
11. A Chrome extension inserts the approved reply into the Reddit comment box.
12. The user personally clicks Reddit's final submit button.
13. The system tracks outbound clicks and optional signup, lead, purchase, and custom conversion events.
14. The dashboard reports opportunities, replies, clicks, conversions, and attributed revenue.
15. Stripe enforces trial and paid-plan limits.

## 0.2 Non-negotiable product guardrails

Do not implement any of the following:

- Automatic submission of Reddit comments
- Automatic upvotes or downvotes
- Automatic direct messages
- Automatic account creation
- Karma farming or fake account warmup
- Simulated reading, typing delays, fake mistakes, or anti-detection behavior
- Proxy rotation or browser fingerprint evasion
- Multi-account systems designed to hide common control
- Fake customer testimonials or fake personal experiences
- Undisclosed recommendations by company employees or founders
- Scraping Reddit when approved API access is not available
- Training an AI model on Reddit content
- Storage of Reddit passwords
- Claims that the product guarantees Reddit account safety, search ranking, or AI citations

The product may automate research, scoring, drafting, verification, alerts, and analytics. It must not automate the final social action.

## 0.3 Missing third-party credentials must not block development

Build provider interfaces and a complete demo mode.

When Reddit commercial API credentials are unavailable:

- Use `REDDIT_PROVIDER=mock`.
- Load realistic local fixtures.
- Run the full ingestion, scoring, drafting, extension, and analytics flow with mock data.
- Show an admin banner stating that production Reddit ingestion is disabled.
- Do not add an unauthorized scraper as a fallback.

When AI, Stripe, email, or crawling credentials are unavailable:

- Use deterministic local development adapters where reasonable.
- Keep the real provider implementation ready behind environment variables.
- Document how to switch providers.

## 0.4 Engineering quality requirements

The implementation must include:

- Strict TypeScript
- Accessible, responsive UI
- Database migrations
- Row-level security or equivalent tenant isolation
- Runtime input validation
- Structured logging
- Error monitoring hooks
- Unit tests
- Integration tests
- End-to-end tests for the main flow
- Seed/demo data
- `.env.example`
- Local setup instructions
- Production deployment instructions
- Chrome extension build and installation instructions
- No unresolved TODOs in core customer flows
- No secrets committed to the repository

Use the latest stable compatible package versions at implementation time. Do not hardcode an AI model name; configure model identifiers with environment variables.

---

# 1. Product summary

## 1.1 One-sentence idea

ThreadSignal finds people on Reddit who are actively looking for a solution like a customer's product, helps a real company representative write a useful and honest reply, and shows whether the conversation produced traffic or revenue.

## 1.2 Customer problem

SaaS founders and growth teams know that potential customers ask for tools, alternatives, recommendations, and technical solutions on Reddit. However, they struggle to:

- Find relevant posts early
- Separate real purchase intent from general discussion
- Understand each community's rules
- Write a useful reply without sounding like spam
- Avoid unsupported product claims
- Coordinate replies across a team
- Measure whether Reddit participation creates business results

## 1.3 Product solution

ThreadSignal provides:

- Brand onboarding and product understanding
- Website and document knowledge ingestion
- Approved subreddit monitoring
- High-intent opportunity scoring
- Community-rule and promotion-risk analysis
- Evidence-backed AI reply drafts
- Affiliation-disclosure checks
- Manual review and approval
- Manual-posting Chrome extension
- Click and conversion attribution
- Subscription billing and usage limits

## 1.4 Primary differentiation

ThreadSignal is not a mass-commenting tool.

Its value is based on:

1. **Opportunity quality:** Show posts with actual product or purchase intent.
2. **Answer quality:** Use real brand documentation and expose supporting sources.
3. **Transparency:** Require truthful affiliation disclosure when the commenter is connected to the product.
4. **Human control:** Never submit a Reddit comment automatically.
5. **Revenue attribution:** Connect a Reddit opportunity to clicks, signups, leads, purchases, and revenue.

---

# 2. Product goals and non-goals

## 2.1 MVP goals

The MVP must:

- Let one customer go from signup to a working opportunity feed without developer assistance.
- Support one or more brands inside an organization, depending on plan limits.
- Ingest website and uploaded knowledge.
- Monitor selected subreddits through an approved provider or mock provider.
- Score and rank relevant Reddit posts.
- Generate useful, source-backed reply drafts.
- Make compliance and disclosure warnings visible.
- Insert an approved draft through a Chrome extension without submitting it.
- Track outbound clicks and optional conversions.
- Enforce a seven-day trial and paid subscription limits.
- Provide enough demo data for investors, testers, and early customers.

## 2.2 Business goals

Initial target market:

- AI SaaS companies
- Developer tools
- Marketing software
- Ecommerce software
- Design tools
- Productivity tools

Initial pricing target:

- Trial: 7 days
- Solo: USD 29/month
- Growth: USD 79/month

The implementation must keep prices and limits in central configuration so they can change without editing multiple pages.

## 2.3 Non-goals for MVP

Do not include these in version one:

- Full ChatGPT, Gemini, Claude, or Perplexity visibility tracking
- Public API marketplace
- MCP server
- White-label agency portals
- Community moderation product
- Mobile application
- Automated Reddit posting
- Account warmup tools
- Multiple hidden Reddit identities
- Advanced CRM integrations
- Automated lead outreach
- Automated Reddit direct messages
- Automated content creation for new Reddit posts

Design the architecture so AI-visibility monitoring and agency features can be added later, but do not delay the MVP for them.

---

# 3. Users and permissions

## 3.1 User roles

### Owner

- Creates and deletes the organization
- Manages billing
- Invites and removes members
- Manages all brands
- Views all analytics
- Creates extension tokens
- Requests organization deletion/export

### Admin

- Manages brands, knowledge, subreddits, drafts, members, and settings
- Cannot transfer organization ownership
- Cannot delete the organization

### Member

- Views opportunities
- Generates, edits, approves, and uses drafts
- Views analytics
- Cannot manage billing or members

### Viewer

- Read-only access to opportunities, drafts, and analytics

The Solo plan may restrict the organization to one member. The Growth plan may allow five members.

## 3.2 Platform admin

Implement an internal admin role separate from organization roles.

Platform admins can:

- View organization metadata and health
- View job failures
- View provider status
- Pause a misbehaving organization
- Inspect usage counters
- Trigger safe retries
- Review billing webhook status

Platform admins must not casually view customer knowledge or draft content. Any exceptional access must be audited.

---

# 4. Core customer journey

## 4.1 Signup and onboarding

1. User lands on the marketing site.
2. User selects **Start free trial**.
3. User signs in with Google or magic link.
4. User creates an organization.
5. User creates the first brand.
6. User enters brand information.
7. User starts website ingestion.
8. User reviews extracted product information.
9. User adds competitors.
10. User selects suggested subreddits or adds them manually.
11. User selects keywords and opportunity types.
12. User sees a progress screen while initial ingestion and scoring run.
13. User lands on the opportunity feed.

## 4.2 Daily usage

1. User receives a daily email digest.
2. User opens a high-scoring opportunity.
3. User reads the post summary, user need, score explanation, community rules, and promotion risk.
4. User generates a reply.
5. User checks supporting product sources and compliance warnings.
6. User edits and approves the reply.
7. User opens Reddit using the Chrome extension.
8. Extension inserts the reply.
9. User makes final edits and manually submits.
10. User optionally records the resulting comment URL.
11. User reviews clicks and conversions later.

---

# 5. Information architecture and application routes

Use Next.js App Router.

## 5.1 Public routes

| Route | Purpose |
|---|---|
| `/` | Marketing homepage |
| `/pricing` | Pricing and limits |
| `/login` | Login and signup |
| `/auth/callback` | Authentication callback |
| `/privacy` | Privacy policy placeholder with required sections |
| `/terms` | Terms placeholder with required sections |
| `/security` | Security and responsible-use overview |
| `/go/[code]` | Tracked redirect endpoint |

## 5.2 Authenticated application routes

| Route | Purpose |
|---|---|
| `/app` | Dashboard overview |
| `/app/onboarding` | Guided setup wizard |
| `/app/opportunities` | Opportunity feed |
| `/app/opportunities/[id]` | Opportunity detail and draft workspace |
| `/app/drafts` | All drafts and review states |
| `/app/knowledge` | Knowledge sources and ingestion status |
| `/app/knowledge/[id]` | Source detail, extracted pages, and chunks |
| `/app/subreddits` | Monitored communities and rules |
| `/app/keywords` | Keywords, exclusions, and intent categories |
| `/app/analytics` | Click, conversion, and revenue analytics |
| `/app/activity` | Audit-friendly activity log |
| `/app/settings/brand` | Current brand settings |
| `/app/settings/persona` | Real commenter role and tone settings |
| `/app/settings/team` | Organization members |
| `/app/settings/integrations` | Extension, conversion API, and email settings |
| `/app/settings/billing` | Subscription and usage |
| `/app/settings/organization` | Organization settings and deletion/export |

## 5.3 Internal routes

| Route | Purpose |
|---|---|
| `/internal/admin` | Platform administration |
| `/internal/admin/jobs` | Job status and retries |
| `/internal/admin/providers` | Provider health |
| `/internal/admin/organizations/[id]` | Safe organization metadata view |

Protect internal routes with platform-admin checks.

---

# 6. UI and visual requirements

## 6.1 Design direction

Create a clean, trustworthy B2B SaaS interface. Do not copy Reddit's visual design and do not present the product as officially affiliated with Reddit.

Use:

- Light-first interface with optional dark mode
- Neutral page background
- White cards
- Dark navy text
- Indigo or violet primary accent
- Green for positive/safe states
- Amber for warnings
- Red only for destructive or blocked states
- Rounded but professional components
- Clear spacing and readable typography

The exact colors must be tokenized in the theme.

## 6.2 Main application shell

Desktop:

- Left navigation sidebar
- Top bar with brand switcher, usage, notifications, and user menu
- Main content area
- Optional right context panel on opportunity detail

Mobile/tablet:

- Collapsible navigation drawer
- Stacked cards
- Sticky primary action where useful
- No horizontal overflow

## 6.3 Required reusable components

- `AppShell`
- `BrandSwitcher`
- `UsageMeter`
- `EmptyState`
- `LoadingSkeleton`
- `ErrorState`
- `ScoreBadge`
- `RiskBadge`
- `OpportunityCard`
- `SourceCitationCard`
- `RuleChecklist`
- `DraftEditor`
- `CompliancePanel`
- `PlanLimitDialog`
- `UpgradeBanner`
- `DateRangePicker`
- `MetricCard`
- `DataTable`
- `ConfirmDialog`
- `CommandSearch`

Use shadcn/ui primitives where appropriate. Maintain WCAG AA color contrast. All keyboard actions must have visible focus states.

---

# 7. Detailed feature requirements

# 7.1 Authentication and organizations

Use Supabase Auth.

Required login methods:

- Google OAuth
- Email magic link

Required behaviors:

- Protected app routes
- Session refresh
- Logout
- Organization creation after first login
- Organization invitation by email
- Role-based authorization
- Server-side authorization for every mutation
- Tenant ID derived from membership, never trusted directly from client input

Organization fields:

- Name
- Slug
- Billing email
- Time zone
- Default currency
- Trial start/end
- Active plan
- Status

# 7.2 Brand onboarding

A brand represents one product or company being monitored.

Required fields:

- Brand name
- Website URL
- Short product description
- Main value proposition
- Target audience
- Primary use cases
- Product category
- Pricing-page URL, optional
- Documentation URL, optional
- Support URL, optional
- Competitors
- Preferred tone
- Reply length preference
- Affiliation disclosure text
- Words or claims to avoid
- Allowed product links
- Countries served

Preferred tone options:

- Helpful and concise
- Technical
- Founder voice
- Product specialist
- Customer-support style
- Custom

Important rule:

A tone profile is not a fake identity. The user must select a real role, such as founder, employee, contractor, or independent consultant.

Onboarding completion must be shown as a percentage and checklist.

# 7.3 Knowledge base

Supported source types:

- Website crawl
- Single webpage
- PDF upload
- Markdown upload
- Plain-text upload
- Manual text entry

Website ingestion requirements:

- Only crawl the customer-provided domain and approved subdomains.
- Default maximum: 30 pages per brand on Solo, 100 on Growth.
- Respect `robots.txt` where applicable.
- Prevent SSRF and private-network access.
- Normalize canonical URLs.
- Ignore login pages, cart pages, query duplicates, and media binaries.
- Prefer product, documentation, pricing, FAQ, use-case, and policy pages.
- Store page title, URL, crawl timestamp, checksum, and extracted text.
- Allow the user to include or exclude pages.
- Re-crawl selected sources manually.

File upload requirements:

- Maximum 10 MB per file for MVP.
- Validate MIME type and extension.
- Reject encrypted or unreadable PDFs with a clear error.
- Extract text server-side.
- Store the original in private object storage.

Chunking and embeddings:

- Split normalized content into approximately 600-900 token chunks.
- Use approximately 100-token overlap.
- Preserve source URL/page number/section heading metadata.
- Generate embeddings using a configurable provider.
- Store vectors in PostgreSQL using pgvector.
- Deduplicate chunks by checksum.
- Re-embed only changed chunks.

Knowledge UI must show:

- Source name and type
- Status: pending, processing, ready, partial, failed
- Last updated
- Number of pages/chunks
- Errors
- Included/excluded state
- Preview of extracted content

# 7.4 Competitors, keywords, and exclusions

Competitors:

- Name
- Domain
- Product aliases
- Common misspellings
- Optional notes

Keyword types:

- Product category terms
- Problem terms
- Recommendation phrases
- Alternative/comparison phrases
- Competitor names
- Technical requirements
- Negative/excluded terms

Examples of intent patterns:

- "best tool for"
- "alternative to"
- "recommend a"
- "has anyone used"
- "which API"
- "looking for software"
- "how do I solve"
- "too expensive"
- "switching from"

The UI must allow:

- Add manually
- Accept AI suggestions
- Pause individual terms
- Add exclusions
- Preview matching mock posts

# 7.5 Subreddit management

The customer may:

- Search approved subreddits
- Add a subreddit manually
- Accept AI/provider suggestions
- Pause monitoring
- Set priority
- Set minimum opportunity score
- Set allowed reply style
- Add internal notes

For each subreddit, store and display:

- Name
- Display title
- Description
- Subscriber count, when available
- NSFW flag
- Active/paused state
- Last sync time
- Rules
- Self-promotion guidance
- Link restrictions
- Account-age/karma notes, when publicly stated by the community
- Product relevance
- Risk level

Rule management:

- Fetch rules through the approved provider.
- Store structured and raw rule text.
- Allow a user to add an internal interpretation.
- Show when rules were last refreshed.
- Refresh daily or on demand.
- Do not claim that automated rule analysis guarantees moderator acceptance.

# 7.6 Reddit provider and ingestion

Create a provider interface:

```ts
interface RedditProvider {
  searchSubreddits(query: string): Promise<SubredditSearchResult[]>;
  getSubreddit(name: string): Promise<SubredditDetails>;
  getSubredditRules(name: string): Promise<SubredditRule[]>;
  listPosts(input: {
    subreddit: string;
    sort: 'new' | 'hot' | 'rising';
    after?: string;
    limit: number;
  }): Promise<RedditPostPage>;
  getPostById(id: string): Promise<RedditPost | null>;
}
```

Implement:

- `MockRedditProvider`
- `OAuthRedditProvider`

Production safety gate:

The OAuth provider must refuse to run in production unless:

```env
REDDIT_COMMERCIAL_APPROVAL_CONFIRMED=true
```

The application must never ask for or store a customer's Reddit password.

Ingestion schedule:

- Default every 10 minutes for active subreddits
- Respect provider rate-limit headers dynamically
- Add jitter to internal polling schedules only for load distribution, not for hiding behavior
- Use idempotent upserts
- Store cursor/checkpoint per subreddit
- Back off on errors
- Pause provider after repeated authorization failures

Minimum imported post fields:

- Provider post ID
- Subreddit
- Permalink
- Title
- Body/self text
- Author display name, only when allowed and needed
- Created timestamp
- Score
- Number of comments
- Upvote ratio, when available
- Flair
- NSFW flag
- Locked/archived state
- Edited state
- Last provider sync
- Raw minimal metadata JSON

Retention and deletion:

- Run a deletion refresh at least every 12 hours for stored active opportunities.
- If Reddit content is deleted, purge the title, body, embedded links, and author-identifying data as required.
- Complete deletion sync within 48 hours.
- Keep only non-content operational facts that are legally allowed, such as internal deletion timestamps and aggregate counts.
- Make retention settings configurable.

# 7.7 Opportunity scoring

Every imported post is first filtered by basic conditions:

- Allowed subreddit
- Not NSFW unless explicitly allowed by a future policy; default blocked
- Not locked or archived
- Has enough text to understand
- Not older than the configured maximum age
- Not an exact duplicate

Then calculate these scores from 0 to 100:

1. Semantic product relevance
2. Buying or recommendation intent
3. Freshness
4. Engagement velocity
5. Community-rule fit
6. Competitor or category context

Base formula:

```text
opportunity_score =
  semantic_relevance * 0.30
+ buying_intent * 0.25
+ freshness * 0.15
+ engagement_velocity * 0.10
+ rule_fit * 0.10
+ competitor_context * 0.10
- penalties
```

Default freshness score:

| Post age | Score |
|---|---:|
| 0-1 hour | 100 |
| 1-6 hours | 90 |
| 6-24 hours | 75 |
| 1-3 days | 50 |
| 3-7 days | 25 |
| More than 7 days | 10 |

Default opportunity labels:

| Final score | Label |
|---|---|
| 80-100 | High |
| 60-79 | Medium |
| 40-59 | Low |
| Below 40 | Hidden by default |

Possible penalties:

- Explicit rule against commercial replies: up to 50
- User requests no vendor responses: 40
- Post appears to be satire or a meme: 30
- Product is geographically unavailable: 25
- Post is already answered well and no meaningful new value exists: 15
- Brand cannot actually satisfy a required feature: 50
- Post is likely support for a competitor's existing customer rather than a buying opportunity: 10-30

Hard-block conditions:

- Illegal or disallowed product category
- Harassment or targeting a vulnerable individual
- Community expressly prohibits the planned action
- The draft would require lying about affiliation or experience
- Brand knowledge contradicts the requested feature

Required AI evaluation output:

```json
{
  "summary": "One-sentence summary of the post",
  "user_need": "What the Reddit user is trying to solve",
  "intent_category": "recommendation|alternative|comparison|problem|research|support|other",
  "semantic_relevance": 0,
  "buying_intent": 0,
  "rule_fit": 0,
  "competitor_context": 0,
  "suggested_action": "reply|monitor|ignore|blocked",
  "risk_level": "low|medium|high|blocked",
  "risk_reasons": [],
  "matched_capabilities": [],
  "missing_capabilities": [],
  "reasoning_summary": "Short user-visible explanation without hidden chain of thought"
}
```

Freshness and engagement velocity should be computed deterministically by code. Semantic relevance, intent, rule fit, and capability matching may use AI with structured output.

Save:

- Each component score
- Final score
- Model/provider version
- Input checksum
- Human-readable reason
- Timestamp

Do not expose hidden chain-of-thought. Show a concise scoring explanation.

# 7.8 Opportunity feed

The feed must support:

- Card and compact-table views
- Search
- Filters by brand, subreddit, score, risk, intent, status, competitor, and date
- Sorting by score, freshness, and engagement
- Save
- Dismiss
- Bulk dismiss
- Mark as monitoring
- Generate draft
- Open original post

Opportunity card must show:

- Post title
- Subreddit
- Age
- Truncated post text
- Opportunity score and label
- Buying-intent score
- Risk level
- Intent category
- Competitor mentions
- Why it matches
- Primary actions

Statuses:

- New
- Saved
- Monitoring
- Draft ready
- Approved
- Published manually
- Dismissed
- Archived
- Blocked

Dismissal reasons:

- Not relevant
- Low intent
- Already answered
- Community risk
- Product cannot help
- Duplicate
- Other

Dismissal feedback should improve brand-specific scoring rules but must not be used to train a global model on Reddit content.

# 7.9 Opportunity detail

The page must contain:

## Left/main column

- Post title, text, metadata, and original link
- User-need summary
- Score breakdown
- Suggested response strategy
- Draft editor
- Version history

## Right/context column

- Subreddit rules
- Promotion-risk explanation
- Matched product capabilities
- Missing capabilities
- Competitor context
- Knowledge sources used
- Compliance checklist

Actions:

- Generate draft
- Regenerate with instructions
- Save edit
- Approve
- Reject
- Copy
- Open in extension
- Mark published
- Add resulting comment URL
- Create tracked link

# 7.10 AI draft generation

Draft generation must retrieve relevant brand knowledge before writing.

Default retrieval:

- Top 8 semantically relevant chunks
- Maximum context budget set in configuration
- Prefer current documentation and pricing pages
- Exclude disabled or stale sources
- Include source metadata

Draft requirements:

- Answer the Reddit user's question first.
- Provide useful information even if the brand is not selected.
- Mention the brand only when relevant.
- Disclose affiliation when the selected persona is founder, employee, contractor, agency, or other connected role.
- Never claim to be an independent customer when that is false.
- Never invent product features, pricing, results, customer counts, or personal experience.
- Mention a real limitation when relevant.
- Avoid aggressive sales language.
- Avoid repeated calls to action.
- Avoid unnecessary links.
- Follow subreddit rules.
- Default length: 70-180 words.
- The user can request concise, standard, or detailed length.

Required generation output:

```json
{
  "draft": "Generated reply",
  "strategy": "Short description of the response approach",
  "affiliation_disclosure_included": true,
  "brand_mentioned": true,
  "suggested_link": null,
  "claims": [
    {
      "text": "The product supports batch processing",
      "source_chunk_ids": ["uuid"],
      "confidence": "high"
    }
  ],
  "limitations_mentioned": ["Very compressed source files may still show artifacts"],
  "uncertainties": []
}
```

Regeneration controls:

- Shorter
- More technical
- Less promotional
- No brand mention
- Add disclosure
- Focus on a specified capability
- Custom instruction

Store every generated and edited version.

# 7.11 Claim verification and provenance

Every product-specific factual claim in a draft must be classified as:

- Verified
- Partially supported
- Unsupported
- Contradicted
- General advice

For verified claims, display:

- Source title
- URL or uploaded-file name
- Page/section
- Last updated date
- Supporting excerpt, short only

If a claim is unsupported or contradicted:

- Highlight it in the editor.
- Block approval by default.
- Allow the user to remove it or add a verified internal source.
- Do not allow a simple one-click override for contradicted claims.

Required verification output:

```json
{
  "overall_status": "pass|warning|fail",
  "claims": [
    {
      "claim_text": "string",
      "status": "verified|partial|unsupported|contradicted|general_advice",
      "source_chunk_ids": [],
      "explanation": "Short user-visible explanation"
    }
  ]
}
```

# 7.12 Compliance checker

Run a separate validation step after generation and after any substantial user edit.

Checks:

- Relevance to the original question
- Unsupported claims
- Fake customer experience
- Missing affiliation disclosure
- Excessive promotion
- Misleading comparison
- Disallowed link
- Subreddit rule conflict
- Harassment or manipulation
- Personal data exposure
- Product limitation omitted where important
- User explicitly requested no vendors

Output:

```json
{
  "status": "pass|warning|blocked",
  "checks": [
    {
      "code": "AFFILIATION_DISCLOSURE",
      "status": "pass|warning|fail",
      "message": "Short message",
      "suggested_fix": "Optional correction"
    }
  ],
  "safe_to_approve": true
}
```

Approval rules:

- `pass`: approve normally
- `warning`: require user acknowledgement
- `blocked`: approval disabled until fixed

# 7.13 Persona and disclosure settings

A persona represents the real role of the person who will post.

Fields:

- Display name inside ThreadSignal
- Real role: founder, employee, developer advocate, support, contractor, agency, consultant, other
- Tone
- Technical depth
- Default disclosure text
- Allowed first-person statements
- Prohibited statements

Examples of acceptable disclosure:

- "I am one of the founders of ProductName."
- "I work with the team behind ProductName."
- "I am the developer advocate for ProductName."
- "I consult for ProductName, so this is an affiliated recommendation."

The UI must explain that a persona controls tone, not identity fabrication.

# 7.14 Draft workflow

Draft statuses:

- Generating
- Ready
- Editing
- Warning
- Blocked
- Approved
- Inserted
- Published manually
- Rejected
- Error

Required features:

- Autosave edits
- Character and word count
- Version history
- Diff between AI draft and final edited draft
- Approval timestamp and approver
- Copy button
- Extension handoff
- Rejection reason
- Feedback: useful, too promotional, incorrect, irrelevant, wrong tone, other

# 7.15 Chrome extension

Build a Chrome Manifest V3 extension in `apps/extension`.

## Purpose

The extension helps a logged-in ThreadSignal user insert an approved draft into a Reddit comment editor. It must not submit the comment.

## Required permissions

Use the smallest permissions possible:

- `storage`
- `activeTab`
- `scripting`, only if required by implementation
- Host permissions for supported Reddit domains and the ThreadSignal API domain

Do not request browsing-history or unrelated host access.

## Authentication

Use a one-time connection flow:

1. User opens ThreadSignal web settings.
2. User clicks **Connect Chrome extension**.
3. Server creates a short-lived one-time code.
4. User enters or passes the code to the extension.
5. Extension exchanges it for a revocable extension session token.
6. Store token in Chrome extension storage.
7. User can revoke all extension sessions in web settings.

Do not expose Supabase service keys to the extension.

## Extension UI

Use a side panel or injected floating panel containing:

- Current Reddit post identification
- Matching ThreadSignal opportunity
- Score and risk
- Community-rule warnings
- Approved draft
- Evidence summary
- Edit box
- Copy button
- Insert into comment box button
- Open ThreadSignal detail button
- Mark as published button

## Insert behavior

- Detect a supported Reddit comment composer.
- Insert text only after a user click.
- Trigger appropriate input events so the editor recognizes the content.
- Never click the Reddit submit button.
- Never submit forms.
- Never simulate typing to appear human.
- Show a clear message: "Review the text, then submit it yourself on Reddit."
- If DOM insertion fails, provide a copy-to-clipboard fallback.

## Post-publish flow

After the user submits manually, the extension may:

- Ask the user to click **I published this**.
- Attempt to read the resulting comment URL only after a direct user action.
- Send the URL to ThreadSignal.

Do not monitor unrelated browsing activity.

## Extension acceptance criteria

- Connect/revoke works.
- Current Reddit URL normalizes correctly.
- Matching opportunity appears.
- Approved draft can be edited locally.
- Insert works on the supported desktop Reddit interface.
- Reddit submit is never clicked by extension code.
- Copy fallback works.
- Logout clears extension credentials.

# 7.16 Tracking links

ThreadSignal creates short tracked links for a brand's approved domains.

Example:

```text
https://app.threadsignal.example/go/AbC123
```

Redirect behavior:

1. Look up active tracking link.
2. Validate destination against the brand's allowed domains.
3. Append configured UTM values without overwriting customer-specified values unless explicitly selected.
4. Record a privacy-respecting click event.
5. Respond with a fast 302 or 307 redirect.

Default UTM values:

```text
utm_source=reddit
utm_medium=community
utm_campaign=threadsignal
utm_content=<opportunity_id>
```

Privacy:

- Do not store raw IP addresses.
- If abuse prevention requires an IP-derived identifier, store a rotating salted hash.
- Store a coarse country only when lawful and available.
- Respect consent requirements for customer-side conversion scripts.

# 7.17 Conversion tracking

Support two methods.

## A. Browser tracking snippet

Customer installs a small script on their site and calls:

```js
window.threadSignal.track('signup', {
  value: 0,
  currency: 'USD',
  externalId: 'optional-deduplication-id'
});
```

Supported events:

- `signup`
- `lead`
- `trial_started`
- `purchase`
- `custom`

The click ID should be carried through a first-party query parameter or cookie, subject to consent.

## B. Server-to-server events API

```http
POST /api/v1/conversions
Authorization: Bearer <brand_conversion_api_key>
Content-Type: application/json
```

Example body:

```json
{
  "clickId": "uuid",
  "event": "purchase",
  "externalId": "order_123",
  "value": 99,
  "currency": "USD",
  "occurredAt": "2026-09-07T12:00:00Z",
  "metadata": {
    "plan": "pro"
  }
}
```

Requirements:

- Hash API keys at rest.
- Show a key only once after creation.
- Support key rotation and revocation.
- Deduplicate by organization/brand/event/external ID.
- Verify currency and non-negative value.
- Rate-limit public ingestion endpoints.

# 7.18 Analytics

Dashboard overview metrics:

- Opportunities found
- High-intent opportunities
- Drafts generated
- Draft approval rate
- Published replies, manually recorded
- Clicks
- Unique clicks
- Signups
- Leads
- Purchases
- Attributed revenue
- Click-to-signup conversion rate
- Signup-to-purchase conversion rate

Breakdowns:

- By brand
- By subreddit
- By intent category
- By competitor
- By opportunity
- By date
- By final draft style

Charts:

- Opportunities over time
- Funnel: opportunities -> drafts -> published -> clicks -> signups -> purchases
- Attributed revenue over time
- Top-performing subreddits
- Top-performing opportunities

Do not imply causal certainty. Label revenue as "attributed" based on the selected attribution method.

Default attribution window:

- 30 days after tracked click

Make the window configurable at organization level.

# 7.19 Notifications

MVP email notifications:

- Welcome email
- Ingestion complete
- Ingestion failed
- Daily opportunity digest
- High-score opportunity alert
- Trial ending
- Usage limit reached
- Payment failed

Notification settings:

- Email enabled/disabled by category
- Digest time in organization timezone
- Minimum score for immediate alert
- Quiet hours

Use Resend or another provider behind an adapter.

Slack is out of scope for the first release but leave an integration interface.

# 7.20 Billing and subscriptions

Use Stripe Checkout and Stripe Billing Portal.

## Plans

Centralize this configuration in one package/file and mirror it in the database.

### Trial

- 7 days
- 1 organization
- 1 brand
- 3 monitored subreddits
- 20 opportunities retained during trial
- 10 AI drafts
- 1 member
- Click tracking enabled
- No card required by default

### Solo - USD 29/month

- 1 brand
- 10 monitored subreddits
- 100 scored opportunities/month
- 60 AI drafts/month
- 1 member
- Daily digest
- Click and conversion tracking

### Growth - USD 79/month

- 3 brands
- 40 monitored subreddits total
- 500 scored opportunities/month
- 300 AI drafts/month
- 5 members
- Faster monitoring schedule when provider terms allow
- Advanced analytics
- Conversion API

Annual billing may be added but is not required for the first milestone.

## Billing requirements

- Checkout session creation
- Billing portal
- Webhook signature verification
- Idempotent event processing
- Subscription status synchronization
- Trial expiration handling
- Grace period for payment failures
- Usage meters
- Upgrade prompts
- Plan-limit enforcement in server logic
- No reliance on client-only checks

Plan-limit behavior:

- Never delete existing customer data immediately when a plan is downgraded.
- Prevent new usage above limits.
- Provide a clear upgrade or cleanup path.

# 7.21 Activity and audit log

Record important actions:

- Brand created/updated/deleted
- Knowledge source added/removed/re-crawled
- Subreddit added/paused
- Opportunity dismissed/saved
- Draft generated/edited/approved/rejected
- Extension connected/revoked
- Reply marked published
- Tracking link created/revoked
- Conversion key created/revoked
- Member invited/removed/role changed
- Subscription changed
- Organization export/deletion requested
- Platform-admin exceptional access

Audit entries include:

- Organization
- Actor
- Action
- Target type and ID
- Timestamp
- Safe metadata

Do not put access tokens, full document contents, or sensitive secrets into logs.

---

# 8. AI system design

# 8.1 Provider abstraction

Create an AI interface that supports at least:

- Structured text generation
- Embeddings
- Optional fallback model

Configuration:

```env
AI_PROVIDER=openai
AI_FAST_MODEL=<configured-model>
AI_SMART_MODEL=<configured-model>
AI_EMBEDDING_MODEL=<configured-model>
AI_MAX_RETRIES=2
```

Do not hardcode a model identifier.

# 8.2 AI tasks

Separate tasks and prompts:

1. Brand information extraction
2. Keyword suggestion
3. Subreddit suggestion explanation
4. Opportunity evaluation
5. Draft generation
6. Claim extraction
7. Claim verification
8. Compliance validation
9. Short opportunity summary

Use structured-output schemas validated with Zod.

# 8.3 Prompt template: opportunity evaluator

System behavior:

```text
You evaluate whether a public community post is a genuine opportunity for a specific product.
Be conservative. A high score requires both strong product relevance and a real user need.
Do not reward spam potential. Consider community rules, disclosure requirements, missing product capabilities, and whether a useful response is possible.
Return only the required structured result.
```

Inputs:

- Brand summary
- Product capabilities
- Product limitations
- Countries served
- Competitors and aliases
- Post title/body/metadata
- Subreddit rules
- Deterministic freshness and engagement values

# 8.4 Prompt template: draft generator

System behavior:

```text
Write a useful response to the community post.
Answer the user's question before mentioning the product.
Use only verified product information supplied in the context.
Never invent personal experience, customer results, features, pricing, or affiliations.
When the commenter is affiliated with the product, include a clear natural disclosure.
Follow the supplied community rules.
Use a calm, helpful tone and avoid sales language.
Mention relevant limitations.
Return the required structured result with claim-to-source mappings.
```

# 8.5 Prompt template: compliance validator

System behavior:

```text
Review the draft independently.
Identify unsupported claims, deceptive identity language, missing affiliation disclosure, excessive promotion, rule conflicts, privacy issues, or irrelevant content.
Do not approve a draft merely because another model generated it.
Return a pass, warning, or blocked result with short fix suggestions.
```

# 8.6 Cost controls

- Cache results by normalized input checksum.
- Do not re-embed unchanged content.
- Use the fast model for classification and summaries.
- Use the smart model for draft generation and ambiguous verification.
- Set maximum token budgets.
- Enforce per-plan AI usage.
- Track cost estimates by organization and task.
- Disable runaway retries.
- Add circuit breakers when a provider is failing.

# 8.7 Feedback

Store user feedback but do not train a model on Reddit content.

Permitted personalization methods:

- Brand-specific prompt preferences
- Approved phrase examples supplied by the customer
- Re-ranking based on that customer's dismissals and approvals
- Tone settings
- Rule-based weight adjustments

---

# 9. Technical architecture

# 9.1 Required stack

Use a pnpm monorepo with Turborepo.

Frontend and API:

- Next.js App Router
- React
- TypeScript with strict mode
- Tailwind CSS
- shadcn/ui
- Zod
- React Hook Form

Auth, database, and storage:

- Supabase Auth
- Supabase PostgreSQL
- pgvector extension
- Supabase private storage or S3-compatible storage
- SQL migrations and generated database types
- No Prisma

Background processing:

- Node.js worker service
- BullMQ
- Redis

External providers:

- Configurable AI provider, default OpenAI-compatible implementation
- Stripe
- Resend-compatible email provider
- Reddit provider abstraction
- Website crawler abstraction

Observability:

- Pino structured logs
- Sentry-compatible error reporting
- OpenTelemetry-ready tracing hooks
- PostHog-compatible product analytics, optional by environment

Testing:

- Vitest
- Testing Library
- Playwright

# 9.2 Monorepo structure

```text
threadsignal/
  apps/
    web/
      app/
      components/
      lib/
      public/
      tests/
    worker/
      src/
        jobs/
        queues/
        providers/
        index.ts
    extension/
      src/
        background/
        content/
        sidepanel/
        shared/
      manifest.json
  packages/
    ai/
    analytics/
    config/
    database/
    email/
    reddit/
    shared/
    tracking/
    ui/
  supabase/
    migrations/
    seed.sql
    config.toml
  fixtures/
    reddit/
    knowledge/
  docs/
    architecture.md
    api.md
    deployment.md
    extension.md
    responsible-use.md
  scripts/
  docker-compose.yml
  turbo.json
  pnpm-workspace.yaml
  package.json
  .env.example
  README.md
```

# 9.3 Deployment target

Recommended:

- Web: Vercel
- Worker: Railway, Fly.io, Render, or AWS container service
- Database/Auth/Storage: Supabase
- Redis: managed Redis
- Extension: Chrome Web Store after review

The local development environment must work without paid infrastructure.

# 9.4 Local development

Provide scripts for:

```bash
pnpm install
pnpm services:start
pnpm db:reset
pnpm seed
pnpm dev
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm extension:build
```

`pnpm services:start` should start required local services or clearly call Supabase CLI and Docker Compose.

Local demo must default to:

```env
REDDIT_PROVIDER=mock
AI_PROVIDER=mock
EMAIL_PROVIDER=console
BILLING_PROVIDER=mock
```

A second documented profile should enable real providers.

---

# 10. Database design

Use UUID primary keys, `timestamptz`, and soft deletion where useful. All organization-owned tables must include `organization_id` directly or be securely reachable through a parent relation.

# 10.1 Core tables

## `profiles`

- `id uuid primary key` matching Supabase user ID
- `full_name text`
- `avatar_url text`
- `is_platform_admin boolean default false`
- `created_at timestamptz`
- `updated_at timestamptz`

## `organizations`

- `id uuid primary key`
- `name text not null`
- `slug text unique not null`
- `billing_email text`
- `timezone text default 'UTC'`
- `default_currency text default 'USD'`
- `status text`
- `trial_started_at timestamptz`
- `trial_ends_at timestamptz`
- `created_at`
- `updated_at`
- `deleted_at`

## `organization_members`

- `organization_id uuid`
- `user_id uuid`
- `role text`
- `invited_by uuid`
- `joined_at timestamptz`
- unique `(organization_id, user_id)`

## `organization_invitations`

- `id uuid`
- `organization_id uuid`
- `email text`
- `role text`
- `token_hash text`
- `expires_at timestamptz`
- `accepted_at timestamptz`
- `created_by uuid`

# 10.2 Brand tables

## `brands`

- `id uuid`
- `organization_id uuid`
- `name text`
- `slug text`
- `website_url text`
- `description text`
- `value_proposition text`
- `target_audience text`
- `use_cases jsonb`
- `category text`
- `pricing_url text`
- `docs_url text`
- `support_url text`
- `tone text`
- `reply_length text`
- `disclosure_text text`
- `avoid_claims jsonb`
- `allowed_domains jsonb`
- `countries_served jsonb`
- `status text`
- `onboarding_completed_at timestamptz`
- `created_at`
- `updated_at`
- unique `(organization_id, slug)`

## `brand_competitors`

- `id uuid`
- `organization_id uuid`
- `brand_id uuid`
- `name text`
- `domain text`
- `aliases jsonb`
- `notes text`
- `created_at`
- `updated_at`

## `brand_personas`

- `id uuid`
- `organization_id uuid`
- `brand_id uuid`
- `name text`
- `real_role text`
- `tone text`
- `technical_depth text`
- `default_disclosure text`
- `allowed_first_person_statements jsonb`
- `prohibited_statements jsonb`
- `is_default boolean`
- `created_at`
- `updated_at`

## `brand_keywords`

- `id uuid`
- `organization_id uuid`
- `brand_id uuid`
- `value text`
- `kind text`
- `is_exclusion boolean`
- `status text`
- `source text`
- `created_at`

# 10.3 Knowledge tables

## `knowledge_sources`

- `id uuid`
- `organization_id uuid`
- `brand_id uuid`
- `type text`
- `name text`
- `source_url text`
- `storage_path text`
- `status text`
- `checksum text`
- `metadata jsonb`
- `last_ingested_at timestamptz`
- `error_message text`
- `created_at`
- `updated_at`
- `deleted_at`

## `knowledge_documents`

A website source may create many page documents.

- `id uuid`
- `organization_id uuid`
- `brand_id uuid`
- `source_id uuid`
- `title text`
- `canonical_url text`
- `section text`
- `content text`
- `checksum text`
- `is_included boolean default true`
- `published_at timestamptz`
- `fetched_at timestamptz`
- `metadata jsonb`
- `created_at`
- `updated_at`

## `knowledge_chunks`

- `id uuid`
- `organization_id uuid`
- `brand_id uuid`
- `source_id uuid`
- `document_id uuid`
- `chunk_index integer`
- `content text`
- `token_count integer`
- `embedding vector(<configured_dimension>)`
- `checksum text`
- `metadata jsonb`
- `created_at`
- unique `(document_id, chunk_index, checksum)`

Create an approximate-nearest-neighbor index appropriate for pgvector.

# 10.4 Subreddit and Reddit content tables

## `subreddits`

Shared provider metadata where legally appropriate.

- `id uuid`
- `provider text`
- `provider_id text`
- `name text unique`
- `display_name text`
- `description text`
- `subscriber_count bigint`
- `is_nsfw boolean`
- `metadata jsonb`
- `last_synced_at timestamptz`

## `brand_subreddits`

- `id uuid`
- `organization_id uuid`
- `brand_id uuid`
- `subreddit_id uuid`
- `status text`
- `priority integer`
- `minimum_score integer`
- `risk_level text`
- `internal_notes text`
- `monitor_new boolean`
- `monitor_hot boolean`
- `monitor_rising boolean`
- `created_at`
- `updated_at`
- unique `(brand_id, subreddit_id)`

## `subreddit_rules`

- `id uuid`
- `subreddit_id uuid`
- `provider_rule_id text`
- `title text`
- `description text`
- `kind text`
- `applies_to text`
- `raw_data jsonb`
- `last_synced_at timestamptz`

## `reddit_sync_checkpoints`

- `id uuid`
- `subreddit_id uuid`
- `sort text`
- `cursor text`
- `last_success_at timestamptz`
- `last_error_at timestamptz`
- `consecutive_errors integer`
- unique `(subreddit_id, sort)`

## `reddit_posts`

- `id uuid`
- `provider text`
- `provider_post_id text`
- `subreddit_id uuid`
- `permalink text`
- `title text`
- `body text`
- `author_name text`
- `created_at_provider timestamptz`
- `score integer`
- `num_comments integer`
- `upvote_ratio numeric`
- `flair text`
- `is_nsfw boolean`
- `is_locked boolean`
- `is_archived boolean`
- `is_edited boolean`
- `is_deleted boolean`
- `raw_metadata jsonb`
- `last_synced_at timestamptz`
- `purged_at timestamptz`
- `created_at`
- `updated_at`
- unique `(provider, provider_post_id)`

After deletion/purge, sensitive content fields must be nulled or replaced with a non-content tombstone.

# 10.5 Opportunity and draft tables

## `opportunities`

- `id uuid`
- `organization_id uuid`
- `brand_id uuid`
- `reddit_post_id uuid`
- `status text`
- `summary text`
- `user_need text`
- `intent_category text`
- `semantic_relevance numeric`
- `buying_intent numeric`
- `freshness numeric`
- `engagement_velocity numeric`
- `rule_fit numeric`
- `competitor_context numeric`
- `penalty_score numeric`
- `final_score numeric`
- `risk_level text`
- `risk_reasons jsonb`
- `matched_capabilities jsonb`
- `missing_capabilities jsonb`
- `matched_competitor_ids jsonb`
- `reasoning_summary text`
- `model_metadata jsonb`
- `evaluated_at timestamptz`
- `dismissed_reason text`
- `created_at`
- `updated_at`
- unique `(brand_id, reddit_post_id)`

## `drafts`

- `id uuid`
- `organization_id uuid`
- `brand_id uuid`
- `opportunity_id uuid`
- `persona_id uuid`
- `status text`
- `current_content text`
- `strategy text`
- `brand_mentioned boolean`
- `disclosure_included boolean`
- `suggested_link text`
- `generation_metadata jsonb`
- `compliance_status text`
- `approved_by uuid`
- `approved_at timestamptz`
- `inserted_at timestamptz`
- `published_at timestamptz`
- `published_comment_url text`
- `created_by uuid`
- `created_at`
- `updated_at`

## `draft_versions`

- `id uuid`
- `organization_id uuid`
- `draft_id uuid`
- `version integer`
- `content text`
- `source text` (`ai`, `user`, `system_fix`)
- `instruction text`
- `created_by uuid`
- `created_at`
- unique `(draft_id, version)`

## `draft_claims`

- `id uuid`
- `organization_id uuid`
- `draft_id uuid`
- `draft_version_id uuid`
- `claim_text text`
- `status text`
- `confidence text`
- `explanation text`
- `source_chunk_ids uuid[]`
- `created_at`

## `draft_compliance_checks`

- `id uuid`
- `organization_id uuid`
- `draft_id uuid`
- `draft_version_id uuid`
- `status text`
- `checks jsonb`
- `model_metadata jsonb`
- `created_at`

## `draft_feedback`

- `id uuid`
- `organization_id uuid`
- `brand_id uuid`
- `opportunity_id uuid`
- `draft_id uuid`
- `user_id uuid`
- `rating text`
- `reason text`
- `notes text`
- `created_at`

# 10.6 Tracking and analytics tables

## `tracking_links`

- `id uuid`
- `organization_id uuid`
- `brand_id uuid`
- `opportunity_id uuid`
- `draft_id uuid`
- `code text unique`
- `destination_url text`
- `utm_config jsonb`
- `status text`
- `created_by uuid`
- `created_at`
- `revoked_at timestamptz`

## `tracking_clicks`

- `id uuid`
- `organization_id uuid`
- `brand_id uuid`
- `tracking_link_id uuid`
- `occurred_at timestamptz`
- `anonymous_visitor_id text`
- `ip_hash text`
- `country_code text`
- `referrer text`
- `user_agent_family text`
- `metadata jsonb`

## `conversion_api_keys`

- `id uuid`
- `organization_id uuid`
- `brand_id uuid`
- `name text`
- `key_prefix text`
- `key_hash text`
- `last_used_at timestamptz`
- `created_by uuid`
- `created_at`
- `revoked_at timestamptz`

## `conversion_events`

- `id uuid`
- `organization_id uuid`
- `brand_id uuid`
- `tracking_click_id uuid`
- `tracking_link_id uuid`
- `event_type text`
- `external_id text`
- `value numeric`
- `currency text`
- `occurred_at timestamptz`
- `metadata jsonb`
- `created_at`
- unique nullable deduplication index on `(brand_id, event_type, external_id)` where external ID is not null

# 10.7 Billing, usage, extension, and operations tables

## `subscriptions`

- `id uuid`
- `organization_id uuid unique`
- `provider text`
- `provider_customer_id text`
- `provider_subscription_id text`
- `plan_key text`
- `status text`
- `current_period_start timestamptz`
- `current_period_end timestamptz`
- `cancel_at_period_end boolean`
- `created_at`
- `updated_at`

## `usage_counters`

- `id uuid`
- `organization_id uuid`
- `metric text`
- `period_start date`
- `period_end date`
- `quantity bigint`
- `updated_at timestamptz`
- unique `(organization_id, metric, period_start, period_end)`

## `extension_connection_codes`

- `id uuid`
- `organization_id uuid`
- `user_id uuid`
- `code_hash text`
- `expires_at timestamptz`
- `consumed_at timestamptz`
- `created_at`

## `extension_sessions`

- `id uuid`
- `organization_id uuid`
- `user_id uuid`
- `token_hash text`
- `name text`
- `last_used_at timestamptz`
- `expires_at timestamptz`
- `revoked_at timestamptz`
- `created_at`

## `notification_preferences`

- `id uuid`
- `organization_id uuid`
- `user_id uuid`
- `daily_digest boolean`
- `high_score_alert boolean`
- `minimum_score integer`
- `digest_time time`
- `quiet_hours jsonb`
- `created_at`
- `updated_at`

## `notification_deliveries`

- `id uuid`
- `organization_id uuid`
- `user_id uuid`
- `type text`
- `provider text`
- `status text`
- `provider_message_id text`
- `error_message text`
- `created_at`
- `sent_at timestamptz`

## `job_runs`

- `id uuid`
- `organization_id uuid nullable`
- `job_name text`
- `job_key text`
- `status text`
- `attempt integer`
- `started_at timestamptz`
- `finished_at timestamptz`
- `error_code text`
- `error_message text`
- `metadata jsonb`

## `audit_logs`

- `id uuid`
- `organization_id uuid nullable`
- `actor_user_id uuid nullable`
- `actor_type text`
- `action text`
- `target_type text`
- `target_id uuid nullable`
- `metadata jsonb`
- `created_at timestamptz`

# 10.8 Row-level security

Required rules:

- Users can read organization-owned rows only if they have active membership.
- Mutations require both membership and sufficient role.
- Viewers cannot mutate.
- Billing data is owner-only except basic plan display.
- Service-role access is limited to server and worker environments.
- Public tracking and conversion endpoints use narrowly scoped server logic, not direct database access from browser clients.
- Platform-admin access is server-checked and audited.

Add RLS tests for cross-tenant isolation.

---

# 11. API contract

Use JSON APIs under `/api` and `/api/v1`. Validate every request and response shape.

# 11.1 Brands

```http
GET    /api/brands
POST   /api/brands
GET    /api/brands/:brandId
PATCH  /api/brands/:brandId
DELETE /api/brands/:brandId
```

# 11.2 Knowledge

```http
GET    /api/brands/:brandId/knowledge
POST   /api/brands/:brandId/knowledge/website
POST   /api/brands/:brandId/knowledge/url
POST   /api/brands/:brandId/knowledge/upload
POST   /api/brands/:brandId/knowledge/manual
GET    /api/knowledge/:sourceId
POST   /api/knowledge/:sourceId/reingest
PATCH  /api/knowledge/documents/:documentId
DELETE /api/knowledge/:sourceId
```

# 11.3 Subreddits and keywords

```http
GET    /api/subreddits/search?q=
GET    /api/brands/:brandId/subreddits
POST   /api/brands/:brandId/subreddits
PATCH  /api/brand-subreddits/:id
DELETE /api/brand-subreddits/:id
POST   /api/brand-subreddits/:id/refresh-rules

GET    /api/brands/:brandId/keywords
POST   /api/brands/:brandId/keywords
PATCH  /api/keywords/:id
DELETE /api/keywords/:id
POST   /api/brands/:brandId/keywords/suggest
```

# 11.4 Opportunities

```http
GET   /api/opportunities
GET   /api/opportunities/:id
PATCH /api/opportunities/:id/status
POST  /api/opportunities/:id/dismiss
POST  /api/opportunities/:id/save
POST  /api/opportunities/:id/rescore
```

Query parameters:

- `brandId`
- `status`
- `intent`
- `risk`
- `minimumScore`
- `subreddit`
- `competitorId`
- `from`
- `to`
- `sort`
- `cursor`

Use cursor pagination.

# 11.5 Drafts

```http
POST  /api/opportunities/:id/drafts
GET   /api/drafts
GET   /api/drafts/:id
PATCH /api/drafts/:id
POST  /api/drafts/:id/regenerate
POST  /api/drafts/:id/verify
POST  /api/drafts/:id/approve
POST  /api/drafts/:id/reject
POST  /api/drafts/:id/mark-inserted
POST  /api/drafts/:id/mark-published
```

Generation requests must accept an idempotency key.

# 11.6 Tracking and conversions

```http
POST /api/tracking-links
GET  /api/tracking-links
POST /api/tracking-links/:id/revoke
GET  /go/:code
POST /api/v1/conversions
POST /api/v1/browser-events
```

# 11.7 Analytics

```http
GET /api/analytics/summary
GET /api/analytics/funnel
GET /api/analytics/timeseries
GET /api/analytics/subreddits
GET /api/analytics/opportunities
```

# 11.8 Billing

```http
POST /api/billing/checkout
POST /api/billing/portal
POST /api/billing/webhook
GET  /api/billing/subscription
GET  /api/billing/usage
```

# 11.9 Extension

```http
POST /api/extension/connection-code
POST /api/extension/exchange
POST /api/extension/revoke
GET  /api/extension/current?redditUrl=
PATCH /api/extension/drafts/:id
POST /api/extension/drafts/:id/inserted
POST /api/extension/drafts/:id/published
```

Extension API responses must not expose unrelated organization data.

# 11.10 Standard error format

```json
{
  "error": {
    "code": "PLAN_LIMIT_REACHED",
    "message": "You have used all AI drafts for this billing period.",
    "details": {
      "metric": "ai_drafts",
      "limit": 60,
      "used": 60
    },
    "requestId": "uuid"
  }
}
```

---

# 12. Background jobs and queues

Use separate BullMQ queues with idempotent job keys.

Required queues/jobs:

## Knowledge

- `crawl-website`
- `extract-file`
- `normalize-document`
- `chunk-document`
- `embed-chunks`
- `refresh-knowledge-source`

## Reddit

- `sync-subreddit-posts`
- `refresh-subreddit-rules`
- `refresh-reddit-post`
- `purge-deleted-reddit-content`

## Opportunities

- `evaluate-post-for-brand`
- `rescore-opportunity`
- `expire-old-opportunities`

## Drafts

- `generate-draft`
- `verify-draft-claims`
- `check-draft-compliance`

## Notifications

- `send-daily-digest`
- `send-high-score-alert`
- `send-lifecycle-email`

## Billing and maintenance

- `sync-subscription`
- `reset-usage-period`
- `cleanup-expired-extension-sessions`
- `cleanup-expired-invitations`
- `aggregate-analytics`

Job requirements:

- Idempotent behavior
- Exponential backoff
- Maximum attempts by job type
- Dead-letter visibility in admin
- Structured logs with job ID
- Safe manual retry
- Provider circuit breakers
- Concurrency limits
- Organization usage checks before paid operations

---

# 13. Security, privacy, and responsible-use requirements

# 13.1 Reddit data access

Production Reddit monitoring is allowed only after appropriate approval and commercial permission for the intended use.

Implementation requirements:

- OAuth authentication
- Truthful, descriptive User-Agent
- Dynamic rate-limit handling
- No rate-limit circumvention
- No unapproved scraping fallback
- Deletion synchronization
- Minimal storage
- No model training on Reddit content
- Provider feature flag and kill switch

# 13.2 Web crawler security

Prevent SSRF:

- Resolve and validate hostnames before fetch.
- Block localhost, private, link-local, metadata, and reserved IP ranges.
- Revalidate after redirects.
- Limit redirects.
- Limit content length and request duration.
- Restrict protocols to HTTP/HTTPS.
- Crawl only approved domains.

# 13.3 Application security

- Secure cookies
- CSRF protection where relevant
- Strict CORS
- Content Security Policy
- Rate limiting
- Login abuse protection
- File validation
- Signed upload URLs
- Encryption in transit
- Managed encryption at rest
- Secret rotation support
- Dependency vulnerability checks
- No sensitive data in client bundles
- No service-role key in browser or extension

# 13.4 Tenant isolation

- RLS for all organization-owned data
- Server authorization on every operation
- Cross-tenant automated tests
- Cache keys include organization and brand
- Queue payloads contain IDs, not full secrets

# 13.5 Privacy controls

Provide:

- Organization data export request
- Organization deletion request
- Member removal
- Extension-session revocation
- Conversion-key rotation
- Tracking-link revocation
- Configurable tracking consent text
- Data-retention documentation

Do not store raw IP addresses.

# 13.6 Responsible-use notice

Display during onboarding and in settings:

```text
ThreadSignal helps you discover public conversations and prepare replies. You are responsible for following community rules and disclosing your relationship with any product you recommend. ThreadSignal does not automatically publish comments and cannot guarantee that a community or moderator will accept a reply.
```

Require acceptance before the first draft is approved.

---

# 14. Marketing site content

# 14.1 Homepage

Hero heading:

> Find Reddit conversations that are ready to become customers.

Subheading:

> Monitor high-intent discussions, create evidence-backed replies from your product documentation, and track clicks and revenue. You always review and publish manually.

Primary CTA:

> Start free trial

Secondary CTA:

> View demo

Required homepage sections:

1. Hero
2. Social-proof placeholder that hides until real proof exists
3. Three-step workflow
4. Opportunity-scoring example
5. Evidence-backed drafting example
6. Manual-posting and responsible-use section
7. Conversion analytics section
8. Feature comparison
9. Pricing
10. FAQ
11. Final CTA

Do not use fabricated customer logos, testimonials, counts, or revenue claims.

# 14.2 Pricing page

Display Trial, Solo, and Growth.

Clearly explain:

- Opportunity limit
- Draft limit
- Brand limit
- Subreddit limit
- Member limit
- Conversion tracking
- Trial period
- What happens at a limit

# 14.3 Security/responsible-use page

Explain:

- Manual final submission
- No Reddit passwords stored
- No voting automation
- No hidden account network
- Data-minimization and deletion approach
- Affiliation disclosure
- Customer responsibility for community rules

---

# 15. Demo mode and seed data

Create a polished demo organization.

## Demo brand

Name: `ClarityScale AI`  
Website: local fixture site  
Product: image optimization and upscaling API  
Audience: ecommerce teams and developers  
Competitors: `SharpPixel`, `ImageLift`  
Role/persona: `Product engineer`  
Disclosure: `I work with the team behind ClarityScale AI.`

## Mock subreddits

- `r/SaaS`
- `r/webdev`
- `r/ecommerce`
- `r/ArtificialIntelligence`

## Mock posts

Include at least 20 posts across:

- High-intent recommendation
- Competitor alternative
- Technical API requirement
- Low-intent news discussion
- Explicit no-vendor request
- Community with no self-promotion rule
- Product feature mismatch
- Old post
- Duplicate post
- Deleted post

At least one complete demo flow must show:

- Score 90+
- Generated draft
- Verified claim citations
- Affiliation disclosure
- Compliance pass
- Tracked link
- Click
- Signup
- Purchase of USD 99

Provide a demo login or documented local seed credentials.

---

# 16. Testing requirements

# 16.1 Unit tests

At minimum test:

- Opportunity score calculation
- Freshness scoring
- Penalties and hard blocks
- Plan-limit checks
- URL normalization
- Destination-domain validation
- UTM merging
- Conversion deduplication
- API-key hashing/verification
- Extension-token hashing/verification
- Role authorization
- Claim-status mapping

# 16.2 Integration tests

Test:

- Brand creation and RLS
- Website fixture ingestion
- Chunk creation and retrieval
- Mock Reddit ingestion
- Opportunity creation
- Draft generation with mock AI
- Compliance pass/warning/blocked flows
- Stripe webhook idempotency with fixtures
- Tracking redirect and event creation
- Conversion API authentication
- Deleted-content purge

# 16.3 End-to-end tests

Required Playwright journeys:

## Journey A: onboarding

1. Sign in
2. Create organization
3. Create brand
4. Add website fixture
5. Add subreddit
6. Complete onboarding
7. Reach opportunity feed

## Journey B: opportunity to approved draft

1. Open high-score opportunity
2. Generate draft
3. View sources
4. Edit text
5. Run verification
6. Approve

## Journey C: tracking

1. Create tracked link
2. Visit redirect
3. Record signup
4. Record purchase
5. Verify analytics funnel and revenue

## Journey D: plan limit

1. Reach AI-draft limit
2. Confirm next generation is blocked server-side
3. Confirm upgrade dialog appears

## Journey E: tenant isolation

1. Create two organizations
2. Attempt cross-organization access
3. Confirm denial at database and API levels

# 16.4 Extension tests

- URL normalization
- Connection-code exchange
- Token revocation
- Opportunity lookup
- Draft edit
- Composer insertion adapter
- Copy fallback
- Proof that no code path clicks submit

Where browser automation cannot fully test the live Reddit DOM, create fixture pages that imitate the required editor interfaces and document manual QA steps.

# 16.5 Quality gates

CI must fail on:

- Type errors
- Lint errors
- Test failures
- Migration validation failures
- Build failure
- Secret scanning findings

---

# 17. Accessibility and performance

Accessibility:

- Semantic HTML
- Keyboard navigation
- Visible focus
- Accessible labels
- ARIA only where needed
- Screen-reader announcements for async status
- Color is never the only status signal
- Reduced-motion support

Performance targets for normal broadband:

- Marketing LCP under 2.5 seconds where practical
- App route interaction available quickly with skeletons
- Paginate large feeds
- Avoid loading full Reddit bodies for every feed card
- Stream or defer non-critical dashboard data
- Redirect endpoint should be very fast
- Background jobs must not run inside normal web requests when they can be queued

---

# 18. Observability and operations

Required:

- Request ID for API requests
- Job ID for worker logs
- Organization ID in safe structured context
- Provider latency and error counters
- Queue depth metrics
- AI task usage and estimated cost
- Reddit rate-limit remaining/reset monitoring
- Crawl success/failure metrics
- Draft generation pass/warning/block rates
- Tracking redirect latency
- Stripe webhook failure alert

Health endpoints:

```http
GET /api/health
GET /api/health/ready
```

Worker health must include:

- Redis connection
- Database connection
- Queue processing heartbeat

Do not expose secrets or internal stack traces publicly.

---

# 19. Environment variables

Create a complete `.env.example` containing at least:

```env
NODE_ENV=development
NEXT_PUBLIC_APP_URL=http://localhost:3000
PRODUCT_NAME=ThreadSignal

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=

REDIS_URL=redis://localhost:6379

REDDIT_PROVIDER=mock
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=
REDDIT_USER_AGENT=web:threadsignal:v0.1.0 (by /u/your_contact_username)
REDDIT_COMMERCIAL_APPROVAL_CONFIRMED=false

AI_PROVIDER=mock
OPENAI_API_KEY=
AI_FAST_MODEL=
AI_SMART_MODEL=
AI_EMBEDDING_MODEL=
AI_MAX_RETRIES=2

CRAWLER_PROVIDER=simple
FIRECRAWL_API_KEY=

EMAIL_PROVIDER=console
RESEND_API_KEY=
EMAIL_FROM=ThreadSignal <notifications@example.com>

BILLING_PROVIDER=mock
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_SOLO_PRICE_ID=
STRIPE_GROWTH_PRICE_ID=

SENTRY_DSN=
NEXT_PUBLIC_SENTRY_DSN=
POSTHOG_KEY=
NEXT_PUBLIC_POSTHOG_KEY=

TRACKING_HASH_SALT=
CONVERSION_COOKIE_NAME=ts_click_id
DEFAULT_ATTRIBUTION_DAYS=30

EXTENSION_TOKEN_SECRET=
EXTENSION_ALLOWED_ORIGINS=chrome-extension://replace-after-build

STORAGE_BUCKET_KNOWLEDGE=knowledge-private
MAX_UPLOAD_MB=10
MAX_SOLO_CRAWL_PAGES=30
MAX_GROWTH_CRAWL_PAGES=100
```

Validate environment variables at startup with Zod. Fail fast for required production variables.

---

# 20. Implementation phases

The coding agent should implement in this order.

# Phase 0: repository foundation

Deliver:

- Monorepo
- Shared config
- Strict TypeScript
- Lint/format/test/build scripts
- Supabase local configuration
- Redis local configuration
- CI workflow
- Environment validation
- Basic app shell

Acceptance:

- `pnpm install`, `pnpm services:start`, and `pnpm dev` work.
- All quality commands pass.

# Phase 1: auth, organization, and billing skeleton

Deliver:

- Login
- Organization onboarding
- Membership roles
- RLS
- Trial record
- Central plan configuration
- Settings shell

Acceptance:

- Two organizations cannot access one another.
- Owner/member/viewer permissions work.

# Phase 2: brand and knowledge base

Deliver:

- Brand onboarding
- Website fixture crawler
- File upload
- Extraction
- Chunking
- Embeddings/mock embeddings
- Knowledge UI

Acceptance:

- A user can ingest the demo website and search its knowledge.

# Phase 3: subreddit and opportunity pipeline

Deliver:

- Reddit provider interface
- Mock provider
- OAuth provider skeleton/implementation
- Subreddit management
- Rules
- Scheduled ingestion
- Scoring
- Opportunity feed/detail

Acceptance:

- Mock posts become scored opportunities automatically.
- High, medium, low, and blocked examples display correctly.

# Phase 4: AI drafting and verification

Deliver:

- Retrieval
- Structured draft generation
- Claim extraction/provenance
- Compliance checker
- Draft editor
- Versions
- Approve/reject flow

Acceptance:

- High-intent demo opportunity produces a source-backed, disclosed draft.
- Unsupported claims block approval.

# Phase 5: Chrome extension

Deliver:

- MV3 extension
- Connection flow
- Side panel
- Opportunity lookup
- Draft editing
- Insert action
- Copy fallback
- Revocation

Acceptance:

- Extension inserts a draft into the fixture Reddit composer.
- Automated test/manual inspection confirms it never submits.

# Phase 6: attribution and analytics

Deliver:

- Tracking links
- Fast redirects
- Click events
- Browser tracking snippet
- Conversion API
- Funnel/revenue dashboard

Acceptance:

- Demo click, signup, and USD 99 purchase appear in analytics.

# Phase 7: real billing and notifications

Deliver:

- Stripe checkout/portal/webhooks
- Usage enforcement
- Upgrade UI
- Daily digest
- High-score email
- Trial/payment lifecycle messages

Acceptance:

- Test-mode Stripe subscription changes plan limits.
- Usage is enforced server-side.

# Phase 8: hardening and launch readiness

Deliver:

- Deletion sync
- Security review
- Rate limits
- Admin job view
- Observability
- Accessibility pass
- Production deployment docs
- Chrome packaging docs

Acceptance:

- All tests and quality gates pass.
- Responsible-use guardrails are verified.

---

# 21. Definition of done

The MVP is done only when all of these are true:

- A new user can complete onboarding.
- A brand can ingest website and file knowledge.
- Mock Reddit data produces real scored opportunities.
- Approved Reddit API integration is configurable without changing product code.
- Opportunity score details are visible.
- AI drafts use retrieved knowledge.
- Product claims show supporting sources.
- Unsupported or deceptive claims are blocked.
- Affiliation disclosure is enforced for connected roles.
- The user can edit and approve a draft.
- The Chrome extension inserts but never submits the reply.
- Clicks and conversions appear in analytics.
- Trial and paid limits work.
- Cross-tenant access is blocked.
- Deleted Reddit content can be purged.
- Main flows have automated tests.
- Local demo setup is documented and reliable.
- Production deployment is documented.
- No core screen is only a placeholder.
- No fake testimonials or metrics exist on the marketing site.

---

# 22. Required final delivery from the coding agent

At completion, provide:

1. The complete repository.
2. A concise implementation summary.
3. Exact local setup commands.
4. Demo account instructions.
5. Environment-variable instructions.
6. Database migration instructions.
7. Worker deployment instructions.
8. Web deployment instructions.
9. Chrome extension build and manual installation instructions.
10. Stripe test setup instructions.
11. How to switch from mock Reddit to approved OAuth Reddit provider.
12. Test results for lint, typecheck, unit, integration, E2E, and build.
13. Known limitations that are genuinely outside MVP scope.
14. A list of all responsible-use guardrails and where each is enforced in code.

Do not describe an unfinished feature as complete. If a third-party credential prevents live verification, keep the adapter implemented, test it with mocks, and clearly label the unverified external step.

---

# 23. Future roadmap after MVP

These features may be considered only after the core product has paying, retained users.

## Phase 2 product ideas

- Slack opportunity approvals
- HubSpot/Pipedrive conversion sync
- Agency client workspaces
- White-label reports
- Public read-only client dashboards
- Better per-brand learning from feedback
- A/B testing reply style, without duplicate posting
- More community platforms with approved APIs
- AI-search visibility tracking using permitted data sources
- Competitor share-of-voice analysis
- Scheduled executive reports
- Public API and webhooks
- MCP server

Do not implement these before the MVP definition of done.

---

# 24. Policy references to re-check before production launch

Platform terms can change. Re-read the current official sources before enabling production Reddit ingestion.

- Reddit Developer Terms: https://redditinc.com/policies/developer-terms
- Reddit Data API Terms: https://redditinc.com/policies/data-api-terms
- Reddit Data API technical guidance: https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki
- Reddit developer-platform and data-access guidance: https://support.reddithelp.com/hc/en-us/articles/14945211791892-Developer-Platform-Accessing-Reddit-Data

The application must use the latest approved terms and access conditions rather than relying only on values written in this document.

---

# 25. Final product statement

Build ThreadSignal as:

> A compliance-first Reddit lead-opportunity platform for SaaS companies. It learns a product from verified company sources, identifies high-intent public conversations, creates transparent and evidence-backed reply drafts, requires a real person to review and publish manually, and reports the clicks, signups, purchases, and attributed revenue created by those conversations.

That statement, the non-negotiable guardrails, and the end-to-end flow in section 0 are the highest-priority requirements in this specification.
