import type { Metadata } from 'next';
import { AssinaturasFeature } from '@/features/conta/AssinaturasFeature';

export const metadata: Metadata = {
  title: 'Assinaturas | Minha Conta',
  description: 'Consulte suas assinaturas e formas de pagamento vinculadas.',
};

export default function FormaPagamentoPage() {
  return <AssinaturasFeature />;
}






