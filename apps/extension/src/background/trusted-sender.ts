/**
 * Accept only the packaged reply studio document, never content-script senders.
 * An extension page opened in its own tab is the same trusted packaged document.
 */
export function isTrustedPanelSender(
  sender: { id?: string | undefined; url?: string | undefined; origin?: string | undefined },
  runtimeId: string,
): boolean {
  const origin = `chrome-extension://${runtimeId}`;
  return (
    sender.id === runtimeId &&
    sender.url === `${origin}/sidepanel/index.html` &&
    (!sender.origin || sender.origin === origin)
  );
}
