
import { ContratoPublicoFeature } from '@/features/contratos/public/ContratoPublicoFeature';

export default function PublicoContratoPage({ params }: { params: { token: string } }) {
  return <ContratoPublicoFeature token={params.token} />;
}
