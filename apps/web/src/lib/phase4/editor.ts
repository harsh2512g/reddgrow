/** Versioned editor transitions keep late save/poll responses from replacing newer text. */
export type EditorState = {
  text: string;
  savedText: string;
  version: number;
  revision: number;
  pending: { text: string; revision: number; version: number } | null;
  error: string | null;
  conflict: boolean;
};
export type EditorEvent =
  | { type: 'edit'; text: string }
  | { type: 'saving' }
  | { type: 'saved'; version: number }
  | { type: 'failed'; message: string; conflict: boolean }
  | { type: 'remote'; text: string; version: number }
  | { type: 'reload'; text: string; version: number }
  | { type: 'retry' };
export function createEditor(text: string, version: number): EditorState {
  return {
    text,
    savedText: text,
    version,
    revision: 0,
    pending: null,
    error: null,
    conflict: false,
  };
}
export const editorDirty = (state: EditorState) => state.text !== state.savedText;
export const editorLocked = (state: EditorState) =>
  editorDirty(state) || Boolean(state.pending) || state.conflict;
export function editorReducer(state: EditorState, event: EditorEvent): EditorState {
  switch (event.type) {
    case 'edit':
      return {
        ...state,
        text: event.text,
        revision: state.revision + 1,
        error: state.conflict ? state.error : null,
      };
    case 'saving':
      return state.pending || state.conflict || !editorDirty(state)
        ? state
        : {
            ...state,
            pending: { text: state.text, revision: state.revision, version: state.version },
            error: null,
          };
    case 'saved':
      return !state.pending || event.version < state.version
        ? state
        : {
            ...state,
            version: event.version,
            savedText: state.pending.text,
            pending: null,
            error: null,
          };
    case 'failed':
      return { ...state, pending: null, error: event.message, conflict: event.conflict };
    case 'remote':
      if (event.version < state.version || state.pending) return state;
      if (editorDirty(state))
        return event.version > state.version
          ? {
              ...state,
              conflict: true,
              error:
                'This draft changed in another session. Keep your text, then load the latest version before saving again.',
            }
          : state;
      return { ...state, text: event.text, savedText: event.text, version: event.version };
    case 'reload':
      return createEditor(event.text, event.version);
    case 'retry':
      return { ...state, error: null };
  }
}
export function wordCount(text: string) {
  return text.trim().match(/\S+/g)?.length ?? 0;
}
export function changedText(before: string, after: string) {
  // Bounded prefix/suffix diff is linear even for the maximum draft length.
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix])
    prefix++;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix++;
  return {
    prefix: after.slice(0, prefix),
    removed: before.slice(prefix, before.length - suffix),
    added: after.slice(prefix, after.length - suffix),
    suffix: suffix ? after.slice(-suffix) : '',
  };
}
