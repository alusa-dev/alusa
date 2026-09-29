import { ProductFormFeature } from '@/features/sales/ProductFormFeature';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditarProdutoPage({ params }: Props) {
  const { id } = await params;
  return <ProductFormFeature mode="editar" productId={id} />;
}
