import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { connection } from 'next/server';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'ThreadSignal — useful conversations, thoughtful replies',
    template: '%s | ThreadSignal',
  },
  description:
    'A compliance-first workspace for discovering relevant Reddit conversations and preparing evidence-backed replies. You always review and publish manually.',
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Nonces must be rendered per request, never cached in a static HTML shell.
  await connection();
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full font-sans">
        <a
          className="sr-only fixed left-4 top-4 z-50 rounded-lg bg-white px-4 py-3 font-semibold shadow-lg focus:not-sr-only"
          href="#main-content"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
