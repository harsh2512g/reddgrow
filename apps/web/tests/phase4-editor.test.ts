import { describe, expect, it } from 'vitest';
import {
  changedText,
  createEditor,
  editorDirty,
  editorLocked,
  editorReducer,
  wordCount,
} from '../src/lib/phase4/editor';
describe('versioned draft editor', () => {
  it('retains typing made while an earlier autosave is in flight', () => {
    let state = editorReducer(createEditor('Original', 1), { type: 'edit', text: 'First edit' });
    state = editorReducer(state, { type: 'saving' });
    state = editorReducer(state, { type: 'edit', text: 'Newer edit' });
    state = editorReducer(state, { type: 'saved', version: 2 });
    expect(state).toMatchObject({
      text: 'Newer edit',
      savedText: 'First edit',
      version: 2,
      pending: null,
    });
    expect(editorLocked(state)).toBe(true);
    state = editorReducer(state, { type: 'saving' });
    expect(state.pending?.version).toBe(2);
    state = editorReducer(state, { type: 'saved', version: 3 });
    expect(editorDirty(state)).toBe(false);
  });
  it('refuses duplicate saves and stale polling responses', () => {
    const saving = editorReducer(
      editorReducer(createEditor('Original', 3), { type: 'edit', text: 'Edit' }),
      { type: 'saving' },
    );
    expect(editorReducer(saving, { type: 'saving' })).toBe(saving);
    expect(editorReducer(saving, { type: 'remote', text: 'Late', version: 2 })).toBe(saving);
    expect(editorReducer(saving, { type: 'remote', text: 'Other session', version: 4 })).toBe(
      saving,
    );
  });
  it('preserves local text when another session advances the version', () => {
    const edited = editorReducer(createEditor('Original', 1), { type: 'edit', text: 'Unsaved' });
    const conflicted = editorReducer(edited, { type: 'remote', text: 'Other session', version: 2 });
    expect(conflicted).toMatchObject({ text: 'Unsaved', version: 1, conflict: true });
    expect(editorLocked(conflicted)).toBe(true);
    expect(editorReducer(conflicted, { type: 'saving' }).pending).toBeNull();
    expect(
      editorReducer(conflicted, { type: 'reload', text: 'Other session', version: 2 }),
    ).toEqual(createEditor('Other session', 2));
  });
  it('keeps failed edits recoverable and rejects unsolicited save completions', () => {
    const clean = createEditor('Original', 1);
    expect(editorReducer(clean, { type: 'saved', version: 2 })).toBe(clean);
    const edited = editorReducer(clean, { type: 'edit', text: 'Unsaved' });
    const failed = editorReducer(edited, {
      type: 'failed',
      message: 'Connection lost',
      conflict: false,
    });
    expect(failed.text).toBe('Unsaved');
    expect(editorDirty(failed)).toBe(true);
  });
  it('compares versions without HTML interpretation or unbounded diff algorithms', () => {
    expect(changedText('A useful reply.', 'A better reply.')).toEqual({
      prefix: 'A ',
      removed: 'useful',
      added: 'better',
      suffix: ' reply.',
    });
    expect(changedText('same', 'same')).toEqual({
      prefix: 'same',
      removed: '',
      added: '',
      suffix: '',
    });
    expect(wordCount(' One\n two  three ')).toBe(3);
  });
});
