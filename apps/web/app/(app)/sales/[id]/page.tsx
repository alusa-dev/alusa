import { SaleDetailsFeature } from '@/features/sales/SaleDetailsFeature';

export default async function LojaVendaDetalhesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SaleDetailsFeature saleId={id} />;
}
