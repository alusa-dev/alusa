import { SaleDetailsFeature } from '@/features/vendas/SaleDetailsFeature';

interface LojaVendaDetalhesPageProps {
  params: {
    id: string;
  };
}

export default function LojaVendaDetalhesPage({ params }: LojaVendaDetalhesPageProps) {
  return <SaleDetailsFeature saleId={params.id} />;
}
