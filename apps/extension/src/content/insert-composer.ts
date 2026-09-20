export type ComposerResult =
  | { ok: true; adapter: 'textarea' | 'contenteditable' }
  | {
      ok: false;
      reason:
        | 'PAGE_CHANGED'
        | 'INVALID_TEXT'
        | 'COMPOSER_NOT_FOUND'
        | 'AMBIGUOUS_COMPOSER'
        | 'COMPOSER_NOT_EMPTY'
        | 'INSERTION_FAILED';
    };

/**
 * Self-contained because Chrome serializes this function into an ISOLATED world.
 * The only page mutations are composer text and input/change events. No click,
 * keyboard, focus, submit, network, or background DOM observation is available.
 */
export function insertApprovedText(text: string, expectedUrl: string): ComposerResult {
  if (location.href !== expectedUrl) return { ok: false, reason: 'PAGE_CHANGED' };
  if (typeof text !== 'string' || text.trim().length === 0 || text.length > 12_000) {
    return { ok: false, reason: 'INVALID_TEXT' };
  }
  const roots: (Document | ShadowRoot)[] = [document];
  const composers: (HTMLTextAreaElement | HTMLElement)[] = [];
  const seen = new Set<Element>();
  for (let index = 0; index < roots.length && index < 30; index += 1) {
    const root = roots[index];
    if (!root) continue;
    for (const host of root.querySelectorAll(
      'shreddit-composer, reddit-comment-composer, reddit-textarea, faceplate-textarea-input',
    )) {
      if (host.shadowRoot && !roots.includes(host.shadowRoot)) roots.push(host.shadowRoot);
    }
    const selector = [
      'textarea[name="text"]',
      '[contenteditable="true"][role="textbox"][data-lexical-editor="true"]',
      '.public-DraftEditor-content[contenteditable="true"]',
      'shreddit-composer [contenteditable="true"][role="textbox"]',
      ...(root instanceof ShadowRoot && root.host.localName === 'shreddit-composer'
        ? ['[contenteditable="true"][role="textbox"]']
        : []),
    ].join(',');
    for (const candidate of root.querySelectorAll(selector)) {
      if (!(candidate instanceof HTMLElement) || seen.has(candidate)) continue;
      seen.add(candidate);
      if (candidate instanceof HTMLTextAreaElement && (candidate.disabled || candidate.readOnly)) {
        continue;
      }
      let visible = true;
      let ancestor: HTMLElement | null = candidate;
      while (ancestor) {
        const style = getComputedStyle(ancestor);
        if (
          ancestor.hidden ||
          ancestor.inert ||
          ancestor.getAttribute('aria-hidden') === 'true' ||
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.visibility === 'collapse' ||
          style.opacity === '0'
        ) {
          visible = false;
          break;
        }
        const parent: HTMLElement | null = ancestor.parentElement;
        const scope: Node = ancestor.getRootNode();
        ancestor = parent ?? (scope instanceof ShadowRoot ? (scope.host as HTMLElement) : null);
      }
      if (!visible || candidate.getClientRects().length === 0) continue;
      if (candidate.getAttribute('aria-disabled') === 'true') continue;
      composers.push(candidate);
    }
  }
  if (composers.length === 0) return { ok: false, reason: 'COMPOSER_NOT_FOUND' };
  if (composers.length !== 1) return { ok: false, reason: 'AMBIGUOUS_COMPOSER' };
  const composer = composers[0];
  if (!composer) return { ok: false, reason: 'COMPOSER_NOT_FOUND' };
  const isTextarea = composer instanceof HTMLTextAreaElement;
  if ((isTextarea ? composer.value : (composer.textContent ?? '')).length !== 0) {
    return { ok: false, reason: 'COMPOSER_NOT_EMPTY' };
  }
  // Recheck immediately before mutation, including same-document navigation.
  if (location.href !== expectedUrl) return { ok: false, reason: 'PAGE_CHANGED' };
  try {
    if (isTextarea) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (!setter) return { ok: false, reason: 'INSERTION_FAILED' };
      setter.call(composer, text);
    } else {
      composer.textContent = text;
    }
    composer.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: 'insertText',
        data: text,
      }),
    );
    composer.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    if ((isTextarea ? composer.value : composer.textContent) !== text) {
      return { ok: false, reason: 'INSERTION_FAILED' };
    }
    return { ok: true, adapter: isTextarea ? 'textarea' : 'contenteditable' };
  } catch {
    return { ok: false, reason: 'INSERTION_FAILED' };
  }
}
