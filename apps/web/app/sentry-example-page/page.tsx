import { notFound } from 'next/navigation';
import { SentryExampleClient } from './SentryExampleClient';

function isExamplePageEnabled(): boolean {
  if (process.env.NODE_ENV === 'development') return true;
  return process.env.NEXT_PUBLIC_SENTRY_EXAMPLE_PAGE === '1';
}

export default function SentryExamplePage() {
  if (!isExamplePageEnabled()) {
    notFound();
  }

  return <SentryExampleClient />;
}
