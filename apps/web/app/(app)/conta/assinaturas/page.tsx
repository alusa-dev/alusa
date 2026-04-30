import type { Metadata } from 'next';
import { AssinaturasFeature } from '@/features/conta/AssinaturasFeature';

export const metadata: Metadata = {
  title: 'Assinaturas | Minha Conta',
  description: 'Consulte as assinaturas e formas de pagamento vinculadas à sua conta.',
};

export default function AssinaturasPage() {
  return <AssinaturasFeature />;
}
