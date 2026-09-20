// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { insertApprovedText } from '../src/content/insert-composer';

const text = 'I work with the team behind ClarityScale AI. Review the source before deciding.';

function visible(element: HTMLElement) {
  const rect = new DOMRect(0, 0, 100, 60);
  vi.spyOn(element, 'getClientRects').mockReturnValue({
    0: rect,
    length: 1,
    item: (index) => (index === 0 ? rect : null),
    [Symbol.iterator]: () => [rect][Symbol.iterator](),
  });
  return element;
}

function textarea() {
  const node = document.createElement('textarea');
  node.name = 'text';
  document.body.append(node);
  return visible(node) as HTMLTextAreaElement;
}

beforeEach(() => {
  document.body.replaceChildren();
});
afterEach(() => vi.restoreAllMocks());

describe('explicit approved composer insertion', () => {
  it('inserts once into a textarea with input/change events and never submits or clicks', () => {
    const form = document.createElement('form');
    const composer = textarea();
    const button = document.createElement('button');
    button.type = 'submit';
    form.append(composer, button);
    document.body.append(form);
    const input = vi.fn();
    const change = vi.fn();
    composer.addEventListener('input', input);
    composer.addEventListener('change', change);
    const click = vi.spyOn(HTMLElement.prototype, 'click');
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit');
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit');
    const key = vi.fn();
    form.addEventListener('keydown', key);
    expect(insertApprovedText(text, location.href)).toEqual({ ok: true, adapter: 'textarea' });
    expect(composer.value).toBe(text);
    expect(input).toHaveBeenCalledOnce();
    expect(change).toHaveBeenCalledOnce();
    expect(click).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(requestSubmit).not.toHaveBeenCalled();
    expect(key).not.toHaveBeenCalled();
  });

  it('inserts literal text into the supported lexical desktop editor', () => {
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    editor.setAttribute('role', 'textbox');
    editor.setAttribute('data-lexical-editor', 'true');
    document.body.append(visible(editor));
    expect(insertApprovedText('<img src=x onerror=alert(1)>', location.href)).toEqual({
      ok: true,
      adapter: 'contenteditable',
    });
    expect(editor.querySelector('img')).toBeNull();
    expect(editor.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('supports an open shadow-root composer with composed events', () => {
    const host = document.createElement('shreddit-composer');
    const shadow = host.attachShadow({ mode: 'open' });
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    editor.setAttribute('role', 'textbox');
    shadow.append(visible(editor));
    document.body.append(host);
    const listener = vi.fn();
    document.addEventListener('input', listener, { once: true });
    expect(insertApprovedText(text, location.href)).toEqual({
      ok: true,
      adapter: 'contenteditable',
    });
    expect(listener).toHaveBeenCalledOnce();
  });

  it('fails closed on ambiguous composers without touching either', () => {
    const first = textarea();
    const second = textarea();
    expect(insertApprovedText(text, location.href)).toEqual({
      ok: false,
      reason: 'AMBIGUOUS_COMPOSER',
    });
    expect(first.value).toBe('');
    expect(second.value).toBe('');
  });

  it('preserves existing text including whitespace', () => {
    const composer = textarea();
    composer.value = ' ';
    expect(insertApprovedText(text, location.href)).toEqual({
      ok: false,
      reason: 'COMPOSER_NOT_EMPTY',
    });
    expect(composer.value).toBe(' ');
  });

  it.each(['hidden', 'disabled', 'readOnly'] as const)('refuses a %s composer', (property) => {
    const composer = textarea();
    composer[property] = true;
    expect(insertApprovedText(text, location.href)).toEqual({
      ok: false,
      reason: 'COMPOSER_NOT_FOUND',
    });
    expect(composer.value).toBe('');
  });

  it('refuses hidden ancestors including a hidden shadow host', () => {
    const host = document.createElement('shreddit-composer');
    host.hidden = true;
    const shadow = host.attachShadow({ mode: 'open' });
    const editor = document.createElement('textarea');
    editor.name = 'text';
    shadow.append(visible(editor));
    document.body.append(host);
    expect(insertApprovedText(text, location.href)).toEqual({
      ok: false,
      reason: 'COMPOSER_NOT_FOUND',
    });
  });

  it('does not fall back to an unknown editable surface', () => {
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    document.body.append(visible(editor));
    expect(insertApprovedText(text, location.href)).toEqual({
      ok: false,
      reason: 'COMPOSER_NOT_FOUND',
    });
    expect(editor.textContent).toBe('');
  });

  it('refuses changed pages and invalid or excessive text before any mutation', () => {
    const composer = textarea();
    expect(insertApprovedText(text, 'https://www.reddit.com/r/SaaS/comments/other/title/')).toEqual(
      {
        ok: false,
        reason: 'PAGE_CHANGED',
      },
    );
    for (const invalid of ['', ' ', 'x'.repeat(12_001)]) {
      expect(insertApprovedText(invalid, location.href)).toEqual({
        ok: false,
        reason: 'INVALID_TEXT',
      });
    }
    expect(composer.value).toBe('');
  });
});
