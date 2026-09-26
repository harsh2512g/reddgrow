import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { CrawlError, normalizeNetworkUrl } from './security.js';

type Node = DefaultTreeAdapterMap['node'];
const omit = new Set([
  'script',
  'style',
  'template',
  'noscript',
  'svg',
  'canvas',
  'form',
  'iframe',
  'object',
]);
const chrome = new Set(['nav', 'header', 'footer']);
const block = new Set([
  'p',
  'div',
  'section',
  'article',
  'li',
  'br',
  'hr',
  'tr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
]);
const clean = (text: string) =>
  text
    .normalize('NFKC')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu, '') // eslint-disable-line no-control-regex
    .replace(/[\t ]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();

export function extractHtml(html: string, url: URL, approvedDomains: readonly string[]) {
  const tree = parse(html);
  let title = '';
  let canonical = url.href;
  const text: string[] = [];
  const links = new Set<string>();
  const stack: { node: Node; inTitle: boolean; muted: boolean }[] = [
    { node: tree, inTitle: false, muted: false },
  ];
  let count = 0;
  while (stack.length) {
    const entry = stack.pop();
    if (!entry) break;
    if (++count > 50_000) throw new CrawlError('response_limit');
    const { node, inTitle } = entry;
    const muted = entry.muted || ('tagName' in node && chrome.has(node.tagName));
    if ('value' in node && node.nodeName === '#text') {
      if (inTitle) title += node.value;
      else if (!muted) text.push(node.value);
      continue;
    }
    if ('tagName' in node) {
      const attrs = new Map(node.attrs.map(({ name, value }) => [name, value]));
      if (
        omit.has(node.tagName) ||
        attrs.has('hidden') ||
        attrs.get('aria-hidden') === 'true' ||
        /(?:display\s*:\s*none|visibility\s*:\s*hidden)/iu.test(attrs.get('style') ?? '')
      )
        continue;
      if (
        node.tagName === 'a' ||
        (node.tagName === 'link' &&
          attrs.get('rel')?.toLowerCase().split(/\s+/u).includes('canonical'))
      ) {
        try {
          const href = attrs.get('href');
          if (href) {
            const target = normalizeNetworkUrl(new URL(href, url).href, approvedDomains);
            if (node.tagName === 'a' && links.size < 1000) links.add(target.href);
            if (node.tagName === 'link' && target.origin === url.origin) canonical = target.href;
          }
        } catch {
          /* Unapproved targets are never fetched or emitted as crawl candidates. */
        }
      }
      if (!muted && block.has(node.tagName)) text.push('\n');
    }
    if ('childNodes' in node) {
      for (let index = node.childNodes.length - 1; index >= 0; index--) {
        const child = node.childNodes[index];
        if (child)
          stack.push({
            node: child,
            inTitle: inTitle || ('tagName' in node && node.tagName === 'title'),
            muted,
          });
      }
    }
  }
  const content = clean(text.join(' '));
  if (!content || content.length > 500_000) throw new CrawlError('response_limit');
  return {
    title: clean(title).slice(0, 300) || url.hostname,
    text: content,
    canonical,
    links: [...links],
  };
}
