import { CobrancaDetalhesClient } from './CobrancaDetalhesClient';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CobrancaDetalhesClient id={id} />;
}
