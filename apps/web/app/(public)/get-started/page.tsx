import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ExpertContactForm } from '@/features/site/components/contact/ExpertContactForm';
import { siteMetadata } from '@/features/site/lib/metadata';

export const metadata: Metadata = {
  title: 'Teste grátis',
  description: 'Converse com a equipe Alusa sobre gestão educacional para sua escola ou instituição de ensino.',
  alternates: { canonical: `${siteMetadata.url}/get-started` },
};

export default function ExpertContactPage() {
  return (
    <article className="site-pricing expert-contact-page">
      <section className="pricing-hero">
        <div className="pricing-container">
          <h1>Fale com um especialista sobre a Alusa.</h1>
          <p className="pricing-hero-intro">
            Conte um pouco sobre a sua escola. Nossa equipe entrará em contato para entender como podemos ajudar.
          </p>
        </div>
      </section>
      <section className="pricing-section">
        <Suspense fallback={<div className="mx-auto mb-20 h-[34rem] max-w-2xl animate-pulse rounded-3xl border border-black/10 bg-white/60" aria-label="Carregando formulário" />}>
          <ExpertContactForm />
        </Suspense>
      </section>
    </article>
  );
}
