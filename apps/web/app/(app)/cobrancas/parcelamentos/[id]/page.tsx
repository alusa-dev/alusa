'use client';

/**
 * Página: Detalhe do Parcelamento
 *
 * Exibe os dados do parcelamento e a lista completa de parcelas.
 * Inspirado no modelo do Asaas.
 * 
 * Cada parcela tem um link para a página de detalhe de cobrança individual (já existente).
 * Esta página NÃO substitui a página de cobrança, apenas agrega.
 *
 * Domínio: Navegação / Agregação
 */

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft as ArrowLeft, ExternalLink } from '@/components/icons/icons';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge, type StatusType } from '@/components/ui/badge';
import { pushToast } from '@/components/ui/toast';
import { formatFormaPagamentoLabel } from '@/lib/finance/asaas-sync';

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const formatDate = (dateStr: string) => {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('pt-BR');
};

type StatusParcelamento = 'EM_DIA' | 'ATRASADO' | 'QUITADO' | 'CANCELADO';

const statusLabels: Record<StatusParcelamento, string> = {
  EM_DIA: 'Em dia',
  ATRASADO: 'Atrasado',
  QUITADO: 'Quitado',
  CANCELADO: 'Cancelado',
};

const statusColors: Record<StatusParcelamento, string> = {
  EM_DIA: 'bg-blue-100 text-blue-700',
  ATRASADO: 'bg-red-100 text-red-700',
  QUITADO: 'bg-green-100 text-green-700',
  CANCELADO: 'bg-gray-100 text-gray-500',
};

// Mapeamento de status de cobrança para StatusType
const cobrancaStatusMap: Record<string, StatusType> = {
  PENDENTE: 'PENDING',
  PROCESSANDO: 'RECEIVED',
  PAGO: 'CONFIRMED',
  ATRASADO: 'OVERDUE',
  CANCELADO: 'CANCELED',
  ESTORNADO: 'REFUNDED',
  A_VENCER: 'PENDING',
  ESTORNADO_PARCIAL: 'REFUNDED',
};

type Parcela = {
  id: string;
  numero: number;
  valor: number;
  vencimento: string;
  status: string;
  dataPagamento?: string | null;
  invoiceUrl?: string | null;
};

type ParcelamentoDetalhes = {
  id: string;
  cliente: string;
  clienteEmail?: string;
  clienteTelefone?: string;
  valorTotal: number;
  numeroParcelas: number;
  parcelasPagas: number;
  status: StatusParcelamento;
  billingType: string;
  firstDueDate: string;
  matriculaId: string | null;
  contratoId: string | null;
  createdAt: string;
  parcelas: Parcela[];
};

export default function ParcelamentoDetalhePage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [parcelamento, setParcelamento] = useState<ParcelamentoDetalhes | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/finance/installments/${params.id}`, {
        cache: 'no-store',
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error?.message || 'Erro ao carregar parcelamento');
      }

      const data = await res.json();
      setParcelamento(data.data);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido';
      setError(errorMessage);
      pushToast({
        title: 'Erro',
        description: errorMessage,
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="container mx-auto py-6 px-4 max-w-5xl">
        <div className="flex items-center gap-4 mb-6">
          <Skeleton className="h-10 w-10" />
          <Skeleton className="h-8 w-64" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="px-6 py-4 border-b">
            <Skeleton className="h-6 w-32" />
          </div>
          {[...Array(5)].map((_, i) => (
            <div key={i} className="px-6 py-3 border-b">
              <div className="grid grid-cols-12 gap-4">
                <Skeleton className="col-span-1 h-4" />
                <Skeleton className="col-span-3 h-4" />
                <Skeleton className="col-span-3 h-4" />
                <Skeleton className="col-span-3 h-4" />
                <Skeleton className="col-span-2 h-4" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error || !parcelamento) {
    return (
      <div className="container mx-auto py-6 px-4 max-w-5xl">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push('/cobrancas/parcelamentos')}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-[22px] font-semibold text-gray-900">Parcelamento</h1>
        </div>
        <div className="bg-white rounded-xl border p-12 text-center mt-6">
          <p className="text-gray-500">{error || 'Parcelamento não encontrado'}</p>
          <Button
            className="mt-4"
            onClick={() => router.push('/cobrancas/parcelamentos')}
          >
            Voltar para lista
          </Button>
        </div>
      </div>
    );
  }

  const safePaid = Math.min(parcelamento.parcelasPagas, parcelamento.numeroParcelas);
  const progressPercent = parcelamento.numeroParcelas > 0
    ? Math.min(100, (safePaid / parcelamento.numeroParcelas) * 100)
    : 0;

  return (
    <div className="container mx-auto py-6 px-4 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push('/cobrancas/parcelamentos')}
            className="h-10 w-10"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-[22px] md:text-[24px] font-semibold tracking-tight text-gray-900">
              Parcelamento
            </h1>
            <p className="text-[13px] text-gray-500">{parcelamento.cliente}</p>
          </div>
        </div>
      </div>
      {/* KPIs Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="flex flex-col justify-center rounded-2xl bg-[#f2eeff] px-6 py-4">
          <p className="text-[13px] font-normal tracking-wide text-[#2D004A] mb-1">
            Valor Total
          </p>
          <p className="text-3xl leading-none font-medium text-[#2D004A]">
            {formatCurrency(parcelamento.valorTotal)}
          </p>
        </div>
        <div className="flex flex-col justify-center rounded-2xl bg-[#f2eeff] px-6 py-4">
          <p className="text-[13px] font-normal tracking-wide text-[#2D004A] mb-1">
            Progresso
          </p>
          <p className="text-3xl leading-none font-medium text-[#2D004A]">
            {Math.round(progressPercent)}%
          </p>
        </div>
        <div className="flex flex-col justify-center rounded-2xl bg-[#f2eeff] px-6 py-4">
          <p className="text-[13px] font-normal tracking-wide text-[#2D004A] mb-1">
            Parcelas Pagas
          </p>
          <p className="text-3xl leading-none font-medium text-[#2D004A]">
            {safePaid} de {parcelamento.numeroParcelas}
          </p>
        </div>
      </div>

      {/* Informações Detalhadas */}
      <div className="bg-white rounded-xl border p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-6">Detalhes do Parcelamento</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1">
              Forma de Pagamento
            </p>
            <p className="text-sm font-medium text-gray-900">
              {formatFormaPagamentoLabel(parcelamento.billingType)}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1">
              Primeiro Vencimento
            </p>
            <p className="text-sm font-medium text-gray-900">
              {formatDate(parcelamento.firstDueDate)}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1">
              Status Atual
            </p>
            <Badge
              status={parcelamento.status === 'QUITADO' ? 'PAGO' : parcelamento.status === 'ATRASADO' ? 'ATRASADO' : 'PENDING'}
            />
          </div>
        </div>
      </div>

      {/* Lista de Parcelas */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-900">
            Parcelas
          </h2>
        </div>

        {/* Cabeçalho da tabela */}
        <div className="px-6 py-3 border-b bg-gray-50">
          <div className="grid grid-cols-12 gap-4 text-[11px] font-medium text-gray-500 uppercase tracking-wider">
            <div className="col-span-1 text-center">#</div>
            <div className="col-span-3">Valor</div>
            <div className="col-span-3">Vencimento</div>
            <div className="col-span-2">Pagamento</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-1 text-center">Ver</div>
          </div>
        </div>

        {/* Linhas */}
        <div className="divide-y">
          {parcelamento.parcelas.map((parcela) => {
            const isOverdue =
              ['PENDENTE', 'A_VENCER'].includes(parcela.status) &&
              new Date(parcela.vencimento) < new Date();

            return (
              <div
                key={parcela.id}
                className="px-6 py-3 hover:bg-gray-50 transition-colors bg-white"
              >
                <div className="grid grid-cols-12 gap-4 items-center">
                  {/* Número da Parcela */}
                  <div className="col-span-1 text-center">
                    <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-gray-100 text-[12px] font-medium text-gray-700">
                      {parcela.numero}
                    </span>
                  </div>

                  {/* Valor */}
                  <div className="col-span-3 text-[13px] text-gray-900 font-semibold">
                    {formatCurrency(parcela.valor)}
                  </div>

                  {/* Vencimento */}
                  <div className="col-span-3">
                    <span
                      className={`text-[13px] ${isOverdue ? 'text-red-600 font-medium' : 'text-gray-700'}`}
                    >
                      {formatDate(parcela.vencimento)}
                    </span>
                  </div>

                  {/* Data de Pagamento */}
                  <div className="col-span-2 text-[13px] text-gray-500">
                    {parcela.dataPagamento ? formatDate(parcela.dataPagamento) : '-'}
                  </div>

                  {/* Status */}
                  <div className="col-span-2">
                    <Badge status={cobrancaStatusMap[parcela.status] ?? 'PENDING'} size="sm" />
                  </div>

                  {/* Link para Detalhe da cobrança - ocultar para parcelas virtuais */}
                  <div className="col-span-1 flex justify-center">
                    {!parcela.id.startsWith('virtual-') ? (
                      <Link
                        href={`/cobrancas/${parcela.id}`}
                        className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                        title="Abrir detalhes da cobrança"
                      >
                        <ExternalLink className="h-4 w-4 text-gray-500" />
                      </Link>
                    ) : (
                      <span className="p-2 text-gray-300" title="Aguardando sincronização">
                        <ExternalLink className="h-4 w-4" />
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Links relacionados */}
      <div className="flex gap-3 mt-8">
        {parcelamento.matriculaId && (
          <Button
            variant="outline"
            onClick={() => router.push(`/matriculas/${parcelamento.matriculaId}`)}
            className="text-[13px]"
          >
            Ver Matrícula
          </Button>
        )}
        {parcelamento.contratoId && (
          <Button
            variant="outline"
            onClick={() => router.push(`/contratos/${parcelamento.contratoId}`)}
            className="text-[13px]"
          >
            Ver Contrato
          </Button>
        )}
      </div>
    </div>
  );
}
