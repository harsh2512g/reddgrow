import { describe, expect, it } from 'vitest';
import { isTrustedPanelSender } from '../src/background/trusted-sender';

const id = 'ennpniajellhdhhblnbpoakkbhacfonk';
const origin = `chrome-extension://${id}`;
describe('packaged panel message boundary', () => {
  it('accepts only its exact packaged panel URL and runtime identity', () => {
    expect(isTrustedPanelSender({ id, url: `${origin}/sidepanel/index.html`, origin }, id)).toBe(
      true,
    );
    expect(isTrustedPanelSender({ id, url: `${origin}/sidepanel/index.html` }, id)).toBe(true);
  });
  it.each([
    { id, url: 'https://www.reddit.com/r/SaaS/comments/demo/thread/' },
    { id, url: `${origin}/sidepanel/index.html?untrusted=1` },
    { id, url: `${origin}/sidepanel/other.html` },
    { id: 'other', url: `${origin}/sidepanel/index.html` },
    { id, url: `${origin}/sidepanel/index.html`, origin: 'https://example.com' },
    {},
  ])('rejects page, other-extension, and malformed senders', (sender) => {
    expect(isTrustedPanelSender(sender, id)).toBe(false);
  });
});
