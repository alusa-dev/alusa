'use client';

import { useRouter } from 'next/navigation';
import { AlertCircle } from '@/components/icons/icons';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

const PAYMENT_NOTICE =
  'Os pagamentos do portal são processados diretamente pela secretaria. Solicite a emissão da fatura para concluir o processo com segurança.';

export function PortalCheckoutFeature({ cobrancaId }: { cobrancaId: string }) {
  const router = useRouter();
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-amber-200 p-8 max-w-lg w-full shadow-lg space-y-6">
        <div className="flex flex-col items-center text-center space-y-3">
          <div className="p-4 bg-amber-100 rounded-full">
            <AlertCircle className="h-10 w-10 text-amber-700" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Pagamento direto com a secretaria</h2>
          <p className="text-gray-600">{PAYMENT_NOTICE}</p>
        </div>

        <Alert className="border-amber-200 bg-amber-50">
          <AlertCircle className="h-4 w-4 text-amber-600" />
          <AlertDescription>
            Informe o código da cobrança ({cobrancaId}) para agilizar o atendimento. Nossa equipe financeira confirma o pagamento e atualiza o portal para você.
          </AlertDescription>
        </Alert>
        <div className="flex flex-col gap-3">
          <Button onClick={() => router.push(`/portal/financeiro/${cobrancaId}`)} className="w-full">
            Ver detalhes da cobrança
          </Button>
          <Button variant="outline" onClick={() => router.push('/portal/financeiro')} className="w-full">
            Voltar ao Financeiro
          </Button>
        </div>
      </div>
    </div>
  );
}
