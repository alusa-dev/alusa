import { SaleCompletionFeature } from '@/features/vendas/SaleCompletionFeature';

interface LojaComprovantePageProps {
  params: {
    id: string;
  };
}

export default function LojaComprovantePage({ params }: LojaComprovantePageProps) {
  return <SaleCompletionFeature saleId={params.id} mode="receipt" />;
}
