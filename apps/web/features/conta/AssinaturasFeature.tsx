'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { AlertCircle } from '@/components/icons/icons';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge, type StatusType } from '@/components/ui/badge';
import { maskCpf } from '@alusa/lib/client';
import type { ContaFormaPagamentoResultDTO as AssinaturasPayload } from '@/features/conta/dtos';

const formaPagamentoLabels: Record<string, string> = {
  BOLETO: 'Boleto bancário',
  PIX: 'Pix',
  CARTAO_CREDITO: 'Cartão de crédito',
  DINHEIRO: 'Dinheiro',
  INDEFINIDO: 'Definir com a secretaria',
};

const ALLOWED_ROLES = new Set(['RESPONSAVEL', 'ALUNO']);

export function AssinaturasFeature() {
  const { data: session, status } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const isAuthorized = role ? ALLOWED_ROLES.has(role) : false;

  const [payload, setPayload] = useState<AssinaturasPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!isAuthorized) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      try {
        await fetch('/api/conta/forma-pagamento/sync', { method: 'POST' });
      } catch (syncError) {
        console.warn('Falha ao sincronizar assinaturas:', syncError);
      }

      const response = await fetch('/api/conta/forma-pagamento');
      if (!response.ok) {
        throw new Error('Não foi possível carregar as assinaturas.');
      }

      const data: AssinaturasPayload = await response.json();
      setPayload(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro inesperado ao carregar as assinaturas.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [isAuthorized]);

  useEffect(() => {
    if (!isAuthorized) {
      if (status !== 'loading') {
        setLoading(false);
      }
      return;
    }

    loadData();
  }, [isAuthorized, loadData, status]);

  const totalAssinaturas = payload?.assinaturas.length ?? 0;

  const formatChargeDate = (value?: string): string | null => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed.toLocaleDateString('pt-BR');
  };

  const renderAssinaturasTable = () => {
    if (!payload) {
      return null;
    }

    return (
      <div className="overflow-auto rounded-lg border border-gray-200 bg-white">
        <div className="sticky top-0 z-10 border-b border-gray-200 bg-gray-50 px-6 py-2">
          <div className="grid grid-cols-12 gap-4 text-xs font-medium text-gray-600">
            <div className="col-span-3 text-left">Aluno</div>
            <div className="col-span-2 text-left">CPF</div>
            <div className="col-span-2 text-left">Forma de pagamento</div>
            <div className="col-span-3 text-left">Plano</div>
            <div className="col-span-2 text-center">Status</div>
          </div>
        </div>

        <div className="divide-y">
          {payload.assinaturas.length === 0 ? (
            <div className="px-6 py-10 text-center text-gray-500">
              Nenhuma assinatura ativa vinculada a este usuário.
            </div>
          ) : (
            payload.assinaturas.map((assinatura) => {
              const nextCharge = assinatura.proximaCobranca
                ? formatChargeDate(assinatura.proximaCobranca.vencimento)
                : null;

              return (
                <div
                  key={assinatura.id}
                  className="px-6 py-3 transition-colors duration-150 hover:bg-gray-50"
                >
                  <div className="grid grid-cols-12 items-center gap-4">
                    <div className="col-span-3 text-sm text-gray-900">
                      <span className="font-medium text-gray-900 truncate block">
                        {assinatura.aluno}
                      </span>
                    </div>
                    <div className="col-span-2 text-sm text-gray-700">
                      {assinatura.cpf ? maskCpf(assinatura.cpf) : '-'}
                    </div>
                    <div className="col-span-2 text-sm text-gray-900">
                      {formaPagamentoLabels[assinatura.formaPagamento] ?? assinatura.formaPagamento}
                    </div>
                    <div className="col-span-3 text-sm text-gray-900">
                      <span>{assinatura.plano}</span>
                      {nextCharge && (
                        <span className="block text-xs text-gray-500">
                          Próxima cobrança: {nextCharge}
                        </span>
                      )}
                    </div>
                    <div className="col-span-2 flex justify-center">
                      <Badge status={assinatura.status as StatusType} size="sm" />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  };

  const header = (
    <div>
      <h2 className="text-xl md:text-2xl font-medium tracking-tight text-gray-900">Assinaturas</h2>
      <p className="mt-1 text-sm text-gray-600">
        Consulte as matrículas ativas e o método de pagamento definido para cada aluno.
      </p>
    </div>
  );

  const pageShellClasses = 'rounded-lg bg-white p-6 space-y-6';

  if (!isAuthorized) {
    return (
      <section className={pageShellClasses}>
        {header}
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Apenas responsáveis e alunos podem visualizar as assinaturas vinculadas. Em caso de dúvidas, procure a secretaria.
          </AlertDescription>
        </Alert>
      </section>
    );
  }

  if (loading) {
    return (
      <section className={pageShellClasses}>
        {header}
        <div className="space-y-3">
          <Skeleton className="h-10 w-40" />
          <div className="overflow-hidden rounded-lg border border-gray-100">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className={pageShellClasses}>
        {header}
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </section>
    );
  }

  if (!payload) {
    return (
      <section className={pageShellClasses}>
        {header}
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Não encontramos assinaturas vinculadas a este usuário. Caso acredite ser um erro, fale com a secretaria.
          </AlertDescription>
        </Alert>
      </section>
    );
  }

  return (
    <section className={pageShellClasses}>
      {header}

      <div className="mt-2">
        <p className="mb-2 text-[12px] text-gray-500">
          Total de assinaturas:{' '}
          <span className="font-medium text-gray-700">{totalAssinaturas}</span>
        </p>
        {renderAssinaturasTable()}
      </div>

      <Alert className="border-amber-200 bg-amber-50">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 flex-shrink-0 text-amber-600" />
          <AlertDescription className="text-sm text-amber-900">
            Precisa atualizar forma de pagamento ou plano? Procure diretamente a secretaria para garantir a atualização correta.
          </AlertDescription>
        </div>
      </Alert>
    </section>
  );
}
