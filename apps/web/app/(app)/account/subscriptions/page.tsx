import type { Metadata } from 'next';
import { SubscriptionsFeature } from '@/features/account/billing-methods/SubscriptionsFeature';

export const metadata: Metadata = {
  title: 'Assinaturas | Minha Conta',
  description: 'Consulte as assinaturas e formas de pagamento vinculadas à sua conta.',
};

export default function AssinaturasPage() {
  return <SubscriptionsFeature />;
}
