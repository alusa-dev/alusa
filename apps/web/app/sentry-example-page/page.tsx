import { notFound } from 'next/navigation';
import { SentryExampleClient } from './SentryExampleClient';

/** Mesmo URL público do projeto javascript-nextjs (org alusa) — precisa estar em env na Vercel. */
function hasSentryDsnConfigured(): boolean {
  const candidate = process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN;
  return typeof candidate === 'string' && candidate.startsWith('https://');
}

function isExamplePageEnabled(): boolean {
  if (process.env.NODE_ENV === 'development') return true;
  if (process.env.NEXT_PUBLIC_SENTRY_EXAMPLE_PAGE === '1') return true;
  return hasSentryDsnConfigured();
}

export default function SentryExamplePage() {
  if (!isExamplePageEnabled()) {
    notFound();
  }

  return <SentryExampleClient />;
}
