'use client';

import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { MatriculaCreatedPayload } from '@/features/cadastro/matriculas/services/matriculas-service';
import { toast } from '@/components/ui/toast';
import { CustomToast } from '@/components/ui/toast';

interface MatriculaWizardSuccessProps {
  payload: MatriculaCreatedPayload;
  onCreateAnother: () => void;
  onGoToList: () => void;
}

export function MatriculaWizardSuccess({
  payload,
  onCreateAnother,
  onGoToList,
}: MatriculaWizardSuccessProps) {
  const invoiceUrl = payload.asaasSync?.taxa?.invoiceUrl ?? null;

  const formatter = useMemo(
    () => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }),
    [],
  );

  const handleCopy = async () => {
    if (!invoiceUrl) return;
    try {
      await navigator.clipboard.writeText(invoiceUrl);
      toast.custom((t) => (
        <CustomToast
          variant="success"
          title="Link copiado"
          description="O link de pagamento do Asaas foi copiado para a área de transferência."
          onClose={() => toast.dismiss(t)}
        />
      ));
    } catch (error) {
      const message = (error as Error).message || 'Não foi possível copiar o link.';
      toast.custom((t) => (
        <CustomToast
          variant="error"
          title="Falha ao copiar"
          description={message}
          onClose={() => toast.dismiss(t)}
        />
      ));
    }
  };

  return (
    <Card className="border border-emerald-200 bg-emerald-50/50">
      <CardHeader>
        <CardTitle className="text-2xl font-semibold text-emerald-800">
          Matrícula criada com sucesso!
        </CardTitle>
        <p className="text-sm text-emerald-700">
          Envie o link de pagamento do Asaas para o responsável confirmar o pagamento da taxa.
        </p>
      </CardHeader>
      <CardContent className="space-y-6 text-sm text-emerald-900">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-emerald-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-emerald-500">
              Identificação da matrícula
            </p>
            <div className="mt-2 space-y-2 text-sm">
              <p>Matrícula #{payload.matricula.id}</p>
              <p>
                Aluno ID: <span className="font-semibold">{payload.matricula.alunoId}</span>
              </p>
              {payload.responsavelFinanceiro && (
                <p>
                  Responsável:{' '}
                  <span className="font-semibold">{payload.responsavelFinanceiro.nome}</span>
                </p>
              )}
              <p className="text-xs text-emerald-600">
                Plano vinculado: {payload.matricula.planoId}
              </p>
            </div>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-emerald-500">
              Cobranças geradas
            </p>
            <div className="mt-2 space-y-1 text-sm">
              <p>
                Taxa de matrícula:{' '}
                <span className="font-semibold">{formatter.format(payload.preco.taxa)}</span>
              </p>
              <p>
                Mensalidade inicial:{' '}
                <span className="font-semibold">
                  {formatter.format(payload.preco.planoLiquido)}
                </span>
              </p>
              <p className="text-xs text-emerald-600">
                Primeiro vencimento:{' '}
                {new Date(payload.primeiroVencimento).toLocaleDateString('pt-BR')}
              </p>
            </div>
          </div>
        </div>

        {invoiceUrl ? (
          <div className="rounded-xl border border-emerald-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-emerald-500">Link de pagamento (Asaas)</p>
            <div className="mt-2 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="flex-1">
                <p className="font-mono text-sm text-emerald-800 break-all">{invoiceUrl}</p>
              </div>
              <Button type="button" variant="outline" onClick={handleCopy} className="mt-2 md:mt-0">
                Copiar link
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-emerald-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-emerald-700">
              {payload.matricula.taxaIsenta
                ? 'Esta matrícula foi marcada como isenta de taxa.'
                : 'Nenhum link de pagamento foi retornado. Você pode gerar a segunda via na tela de detalhes da matrícula.'}
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          <Button
            type="button"
            variant="outline"
            className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
            onClick={onCreateAnother}
          >
            Registrar outra matrícula
          </Button>
          <Button
            type="button"
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            onClick={onGoToList}
          >
            Ir para a lista de matrículas
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
