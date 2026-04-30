import { SaleCompletionFeature } from '@/features/vendas/SaleCompletionFeature';

interface LojaCobrancaPageProps {
  params: {
    id: string;
  };
}

export default function LojaCobrancaPage({ params }: LojaCobrancaPageProps) {
  return <SaleCompletionFeature saleId={params.id} mode="charge" />;
}
