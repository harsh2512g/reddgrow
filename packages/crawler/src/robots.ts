import { CrawlError } from './security.js';

type Rule = { pattern: string; allow: boolean };
type Group = { agents: string[]; rules: Rule[]; delay: number };
export type RobotsPolicy = { rules: Rule[]; delayMs: number };
export const CRAWLER_PRODUCT_TOKEN = 'ThreadSignalKnowledgeBot';
export const CRAWLER_USER_AGENT = `${CRAWLER_PRODUCT_TOKEN}/1.0 (customer-approved knowledge ingestion)`;

/** RFC 9309 group selection, merged matching groups, longest match and allow on ties. */
export function parseRobots(text: string): RobotsPolicy {
  const groups: Group[] = [];
  let current: Group | undefined;
  let directives = false;
  let count = 0;
  for (const raw of text.replace(/^\uFEFF/u, '').split(/\r?\n/u)) {
    const line = raw.split('#', 1)[0]?.trim() ?? '';
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === 'user-agent') {
      if (!current || directives) {
        current = { agents: [], rules: [], delay: 0 };
        groups.push(current);
        directives = false;
      }
      current.agents.push(value.toLowerCase());
    } else if (current && ['allow', 'disallow', 'crawl-delay'].includes(field)) {
      directives = true;
      if (++count > 2000 || value.length > 1024) throw new CrawlError('robots_unavailable');
      if (field === 'crawl-delay') {
        const seconds = Number(value);
        if (value && Number.isFinite(seconds) && seconds >= 0)
          current.delay = Math.max(current.delay, seconds * 1000);
      } else if (value.startsWith('/')) {
        current.rules.push({ pattern: normalizeOctets(value), allow: field === 'allow' });
      }
    }
    if (groups.length > 1000 || (current?.agents.length ?? 0) > 1000)
      throw new CrawlError('robots_unavailable');
  }
  const token = CRAWLER_PRODUCT_TOKEN.toLowerCase();
  const specific = groups.filter((group) => group.agents.includes(token));
  const selected = specific.length
    ? specific
    : groups.filter((group) => group.agents.includes('*'));
  return {
    rules: selected.flatMap((group) => group.rules),
    delayMs: Math.max(0, ...selected.map((group) => group.delay)),
  };
}

function normalizeOctets(value: string): string {
  return value
    .replace(/[^\x00-\x7f]/gu, (character) => encodeURIComponent(character)) // eslint-disable-line no-control-regex
    .replace(/%([0-9a-f]{2})/giu, (whole: string, hex: string) => {
      const character = String.fromCharCode(Number.parseInt(hex, 16));
      return /[a-z0-9._~-]/iu.test(character) ? character : whole.toUpperCase();
    });
}

/** Wildcard matching without attacker-controlled regular expressions/backtracking. */
function matches(pattern: string, path: string): boolean {
  const terminal = pattern.endsWith('$');
  const parts = (terminal ? pattern.slice(0, -1) : pattern).split('*');
  const first = parts.shift() ?? '';
  if (!path.startsWith(first)) return false;
  let position = first.length;
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index] ?? '';
    if (terminal && index === parts.length - 1) {
      return path.endsWith(part) && path.length - part.length >= position;
    }
    const found = path.indexOf(part, position);
    if (found < 0) return false;
    position = found + part.length;
  }
  return !terminal || position === path.length;
}

export function robotsAllows(policy: RobotsPolicy, pathname: string): boolean {
  let longest = -1;
  let allowed = true;
  const path = normalizeOctets(pathname);
  for (const rule of policy.rules) {
    if (!matches(rule.pattern, path)) continue;
    const specificity = Buffer.byteLength(rule.pattern.replace(/[*$]/gu, ''));
    if (specificity > longest || (specificity === longest && rule.allow)) {
      longest = specificity;
      allowed = rule.allow;
    }
  }
  return allowed;
}
