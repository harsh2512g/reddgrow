import '../shared/validation-runtime';
import { createPanel } from './panel';

createPanel({
  document,
  send: (message) => chrome.runtime.sendMessage(message),
  clipboard: (text) => navigator.clipboard.writeText(text),
  confirm: (message) => window.confirm(message),
  version: chrome.runtime.getManifest().version,
});
