import type { Metadata } from 'next';
import { SubscriptionsFeature } from '@/features/account/billing-methods/SubscriptionsFeature';

export const metadata: Metadata = {
  title: 'Assinaturas | Minha Conta',
  description: 'Consulte suas assinaturas e formas de pagamento vinculadas.',
};

export default function FormaPagamentoPage() {
  return <SubscriptionsFeature />;
}






