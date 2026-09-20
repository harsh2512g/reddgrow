import { createThreadSignalSnippet, type ThreadSignalSnippet } from './browser.js';

declare global {
  interface Window {
    threadSignal?: ThreadSignalSnippet;
  }
}

if (!window.threadSignal) {
  window.threadSignal = createThreadSignalSnippet({
    locationHref: () => window.location.href,
    replaceUrl: (url) => window.history.replaceState(window.history.state, '', url),
    readCookie: () => document.cookie,
    writeCookie: (value) => {
      document.cookie = value;
    },
    privacySignal: () =>
      navigator.doNotTrack === '1' ||
      (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true,
    fetch: window.fetch.bind(window),
    now: () => Date.now(),
    randomUUID: () => crypto.randomUUID(),
  });
}
