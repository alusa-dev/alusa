import type { Metadata } from 'next';
import { PricingPage } from '@/features/site/components/pricing/PricingPage';
import { siteMetadata } from '@/features/site/lib/metadata';

export const metadata: Metadata = {
  title: 'Planos e preços',
  description: 'Conheça o plano completo da Alusa, veja os valores por quantidade de alunos e simule a mensalidade da sua escola.',
  alternates: { canonical: `${siteMetadata.url}/precos` },
};

export default function PricesPage() {
  return <PricingPage />;
}
