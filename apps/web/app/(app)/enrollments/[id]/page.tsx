import { MatriculaDetalhesClient } from './MatriculaDetalhesClient';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MatriculaDetalhesClient id={id} />;
}
