import '../shared/validation-runtime';
import { configurePanel } from './configure-panel';
import { ExtensionApi } from './api';
import { ExtensionController, chromePlatform } from './controller';
import { isTrustedPanelSender } from './trusted-sender';

const controller = new ExtensionController(
  chromePlatform(),
  new ExtensionApi(fetch, chrome.runtime.id),
);

// Messages are accepted exclusively from this extension's own side panel.
// No externally_connectable manifest entry or external message listener exists.
chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (!isTrustedPanelSender(sender, chrome.runtime.id)) {
    respond({ ok: false, error: { code: 'FORBIDDEN', message: 'This action is not permitted.' } });
    return false;
  }
  void controller.dispatch(message).then(respond);
  return true;
});

void configurePanel(chrome.sidePanel).catch(() => {
  console.error('ThreadSignal could not enable its side panel. Reload the extension to retry.');
});
