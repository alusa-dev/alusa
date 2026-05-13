import type { Metadata } from 'next';
import { SentryExampleClient } from './SentryExampleClient';

/** Mesmo comportamento do wizard Sentry: rota pública para o passo Verify (DSN opcional até você configurar na Vercel). */
export const metadata: Metadata = {
  title: 'Verificação Sentry',
  robots: { index: false, follow: false },
};

export default function SentryExamplePage() {
  return <SentryExampleClient />;
}
