import { SaleCompletionFeature } from '@/features/vendas/SaleCompletionFeature';

export default async function LojaCobrancaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SaleCompletionFeature saleId={id} mode="charge" />;
}
