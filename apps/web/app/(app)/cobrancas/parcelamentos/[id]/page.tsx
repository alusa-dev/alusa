import { ParcelamentoDetalheClient } from './ParcelamentoDetalheClient';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ParcelamentoDetalheClient id={id} />;
}
