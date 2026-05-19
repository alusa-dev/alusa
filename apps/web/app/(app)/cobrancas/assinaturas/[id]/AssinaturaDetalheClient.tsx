'use client';

/**
 * Página: Detalhe da Assinatura
 *
 * Exibe dados da assinatura + lista de cobranças geradas (filhas).
 * Espelha o modelo do Asaas.
 *
 * Domínio: Navegação
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { pushToast } from '@/components/ui/toast';
import { Badge, type StatusType } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ChevronLeft as ArrowLeft } from '@/components/icons/icons';
import {
  ArrowTopRightOnSquareIcon,
  CalendarDaysIcon,
  CreditCardIcon,
  UserIcon,
  BanknotesIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';
import type { StatusCobranca } from '@prisma/client';
import { formatFormaPagamentoLabel } from '@/lib/finance/asaas-sync';
import { AsaasSeal } from '@/components/shared/AsaasSeal';
import { useFinanceListLoad } from '@/features/financeiro/hooks/use-finance-list-load';

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const formatDate = (dateStr: string | null) =>
  dateStr ? new Date(dateStr).toLocaleDateString('pt-BR') : '—';

// Mapear status de Cobrança para StatusType
const cobrancaStatusMap: Record<StatusCobranca, StatusType> = {
  PENDENTE: 'PENDENTE',
  A_VENCER: 'A_VENCER',
  PROCESSANDO: 'PROCESSANDO',
  PAGO: 'PAGO',
  ATRASADO: 'ATRASADO',
  CANCELADO: 'CANCELADO',
  CANCELAMENTO_PENDENTE: 'CANCELAMENTO_PENDENTE',
  ESTORNADO: 'ESTORNADO',
  ESTORNADO_PARCIAL: 'ESTORNADO_PARCIAL',
};

type CobrancaFilha = {
  id: string;
  numero: number;
  valor: number;
  vencimento: string;
  status: StatusCobranca;
  dataPagamento: string | null;
  asaasPaymentId: string | null;
};

type AssinaturaDetalhes = {
  id: string;
  asaasSubscriptionId: string | null;
  clienteNome: string;
  clienteEmail: string | undefined;
  clienteTelefone: string | undefined;
  alunoNome: string;
  alunoId: string;
  familyStudents?: Array<{
    id: string;
    nome: string;
    matriculaId: string;
  }>;
  valor: number;
  cycle: string;
  cycleLabel: string;
  billingType: string;
  description: string | null;
  nextDueDate: string | null;
  status: string;
  statusLabel: string;
  matriculaId: string;
  contratoId: string;
  createdAt: string;
  cobrancas: CobrancaFilha[];
  totalCobrancas: number;
  cobrancasPagas: number;
  valorRecebido: number;
};

export function AssinaturaDetalheClient({ id }: { id: string }) {
  const router = useRouter();
  const [assinatura, setAssinatura] = useState<AssinaturaDetalhes | null>(null);
  const [studentsDialogOpen, setStudentsDialogOpen] = useState(false);

  const { isInitialLoading, error, refresh } = useFinanceListLoad(
    async ({ signal }) => {
      const res = await fetch(`/api/finance/subscriptions/${id}`, {
        cache: 'no-store',
        signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Erro ao carregar assinatura');
      }
      const payload = await res.json();
      setAssinatura(payload.data);
    },
    {
      resetKey: id,
      liveRefresh: { dashboard: true, cobrancaQueries: true, localRefresh: true },
      intervalMs: 20_000,
      minIntervalMs: 5_000,
    },
  );

  if (isInitialLoading) {
    return (
      <div className="container mx-auto max-w-5xl min-w-0 overflow-x-hidden px-3 py-4 sm:px-4 sm:py-6">
        <Skeleton className="mb-4 h-10 w-32 sm:mb-5" />
        <div className="space-y-4 sm:space-y-6">
          <div className="rounded-xl border bg-white p-4 sm:p-6">
            <Skeleton className="mb-4 h-8 w-3/4 max-w-md" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <div key={i}>
                  <Skeleton className="mb-2 h-4 w-24" />
                  <Skeleton className="h-8 w-20" />
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border bg-white p-4 sm:p-6">
            <Skeleton className="mb-4 h-6 w-48" />
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !assinatura) {
    return (
      <div className="container mx-auto max-w-5xl min-w-0 overflow-x-hidden px-3 py-4 sm:px-4 sm:py-6">
        <button
          type="button"
          onClick={() => router.back()}
          className="mb-6 flex min-h-11 items-center gap-2 rounded-md px-1 text-sm text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 sm:mb-8"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" />
          Voltar
        </button>
        <div className="rounded-xl border bg-white px-4 py-12 text-center sm:px-12">
          <div className="text-4xl mb-4">⚠️</div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Erro ao carregar assinatura</h2>
          <p className="text-gray-600 mb-6">{error || 'Assinatura não encontrada'}</p>
          <div className="flex flex-col justify-center gap-2 sm:flex-row sm:gap-3">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => router.back()}>
              Voltar
            </Button>
            <Button className="w-full sm:w-auto" onClick={() => void refresh()}>
              Tentar novamente
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const familyStudents = assinatura.familyStudents ?? [];
  const isFamilySubscription = familyStudents.length > 0;
  const studentNamesLabel = isFamilySubscription
    ? familyStudents.map((student) => student.nome).join(', ')
    : assinatura.alunoNome;

  const subtitlePrimary = assinatura.description ?? assinatura.cycleLabel;
  const subtitleSecondary =
    studentNamesLabel && subtitlePrimary !== studentNamesLabel ? studentNamesLabel : null;

  return (
    <div className="container mx-auto max-w-5xl min-w-0 overflow-x-hidden px-3 py-4 pb-8 sm:px-4 sm:py-6">
      {/* Header */}
      <div className="mb-5 sm:mb-6">
        <button
          type="button"
          onClick={() => router.back()}
          className="mb-4 flex min-h-11 items-center gap-2 rounded-md px-1 text-sm text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 sm:mb-5"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" />
          Voltar
        </button>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
          <div className="min-w-0 flex-1">
            <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-gray-900 md:text-2xl md:font-bold">
              Detalhes da Assinatura
            </h1>
            <p className="mt-1 text-sm leading-snug text-gray-600">{subtitlePrimary}</p>
            {subtitleSecondary ? (
              <p className="mt-1 text-sm leading-snug text-gray-500">{subtitleSecondary}</p>
            ) : null}
          </div>
          <div className="hidden shrink-0 justify-start lg:flex lg:justify-end lg:pt-0.5">
            <AsaasSeal variant="negativo-preto" />
          </div>
        </div>
      </div>
      {/* Metrics Cards */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-3 sm:mb-6">
        <div className="flex flex-col justify-center rounded-2xl bg-[#f2eeff] px-4 py-3 sm:px-6 sm:py-4">
          <p className="text-[13px] font-normal tracking-wide text-[#2D004A] mb-1">
            Cobranças Geradas
          </p>
          <p className="text-3xl leading-none font-medium text-[#2D004A]">
            {assinatura.totalCobrancas}
          </p>
        </div>
        <div className="flex flex-col justify-center rounded-2xl bg-[#f2eeff] px-4 py-3 sm:px-6 sm:py-4">
          <p className="text-[13px] font-normal tracking-wide text-[#2D004A] mb-1">
            Cobranças Pagas
          </p>
          <p className="text-3xl leading-none font-medium text-[#2D004A]">
            {assinatura.cobrancasPagas}
          </p>
        </div>
        <div className="flex flex-col justify-center rounded-2xl bg-[#f2eeff] px-4 py-3 sm:px-6 sm:py-4">
          <p className="text-[13px] font-normal tracking-wide text-[#2D004A] mb-1">
            Valor Recebido
          </p>
          <p className="text-3xl leading-none font-medium text-[#2D004A]">
            {formatCurrency(assinatura.valorRecebido)}
          </p>
        </div>
      </div>

      {/* Card Dados da Assinatura */}
      <div className="mb-5 rounded-xl border border-gray-200 bg-white shadow-sm sm:mb-6">
        <div className="border-b border-gray-100 px-4 py-3 sm:px-6 sm:py-4">
          <h2 className="text-base font-semibold text-gray-900 sm:text-lg">Dados da Assinatura</h2>
        </div>
        <div className="px-4 py-4 sm:px-6 sm:py-5">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6 lg:grid-cols-4">
            {/* Aluno */}
            <div>
              <div className="flex items-center gap-2 text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                <UserIcon className="h-4 w-4" />
                {isFamilySubscription ? 'Alunos' : 'Aluno'}
              </div>
              {isFamilySubscription ? (
                <button
                  type="button"
                  onClick={() => setStudentsDialogOpen(true)}
                  className="group inline-flex max-w-full items-center gap-1 text-left text-sm font-medium text-gray-900 transition-colors hover:text-brand-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/30 rounded-md"
                  title={studentNamesLabel}
                >
                  <span className="truncate">{studentNamesLabel}</span>
                  <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5 shrink-0 text-gray-400 transition-colors group-hover:text-brand-accent" />
                </button>
              ) : (
                <div className="text-sm font-medium text-gray-900">{assinatura.alunoNome}</div>
              )}
            </div>

            {/* Valor */}
            <div>
              <div className="flex items-center gap-2 text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                <BanknotesIcon className="h-4 w-4" />
                Valor
              </div>
              <div className="text-sm font-semibold text-gray-900">
                {formatCurrency(assinatura.valor)}
              </div>
              <div className="text-xs text-gray-500">{assinatura.cycleLabel}</div>
            </div>

            {/* Forma de Pagamento */}
            <div>
              <div className="flex items-center gap-2 text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                <CreditCardIcon className="h-4 w-4" />
                Forma de Pagamento
              </div>
              <div className="text-sm text-gray-900">
                {formatFormaPagamentoLabel(assinatura.billingType)}
              </div>
            </div>

            {/* Próximo Vencimento */}
            <div>
              <div className="flex items-center gap-2 text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                <CalendarDaysIcon className="h-4 w-4" />
                Próximo Vencimento
              </div>
              <div className="text-sm text-gray-900">{formatDate(assinatura.nextDueDate)}</div>
            </div>
          </div>

          {/* Links */}
          {(assinatura.matriculaId || assinatura.contratoId) && (
            <div className="mt-5 flex flex-col gap-2 border-t border-gray-100 pt-4 sm:flex-row sm:flex-wrap sm:gap-4">
              {assinatura.matriculaId && (
                <Link
                  href={`/matriculas/${assinatura.matriculaId}`}
                  className="inline-flex min-h-10 w-full items-center justify-center gap-1 rounded-lg border border-brand-accent/20 px-3 text-sm text-brand-accent transition-colors hover:bg-brand-accent/5 sm:w-auto sm:justify-start sm:border-0 sm:px-0"
                >
                  Ver matrícula
                  <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
                </Link>
              )}
              {assinatura.contratoId && (
                <Link
                  href={`/contratos/${assinatura.contratoId}`}
                  className="inline-flex min-h-10 w-full items-center justify-center gap-1 rounded-lg border border-brand-accent/20 px-3 text-sm text-brand-accent transition-colors hover:bg-brand-accent/5 sm:w-auto sm:justify-start sm:border-0 sm:px-0"
                >
                  Ver contrato
                  <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Tabela de Cobranças Geradas */}
      <div className="min-w-0 rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-gray-100 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:px-6 sm:py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900 sm:text-lg">Cobranças Geradas</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              Todas as cobranças vinculadas a esta assinatura
            </p>
          </div>
          <div className="flex shrink-0 items-start gap-2 text-left text-xs text-gray-500 sm:max-w-[min(100%,280px)] sm:text-right">
            <ClockIcon className="mt-0.5 h-4 w-4 shrink-0 sm:mt-0" />
            <span>Ordenado por vencimento (mais recente primeiro)</span>
          </div>
        </div>

        {assinatura.cobrancas.length === 0 ? (
          <div className="px-4 py-12 text-center text-gray-500 sm:px-6">
            <div className="text-4xl mb-3">📋</div>
            <p className="text-sm">Nenhuma cobrança gerada ainda</p>
            <p className="text-xs text-gray-400 mt-1">
              As cobranças serão criadas conforme o ciclo da assinatura
            </p>
          </div>
        ) : (
          <div className="min-w-0 divide-y divide-gray-100">
            {/* Header desktop */}
            <div className="hidden bg-gray-50 px-6 py-3 lg:block">
              <div className="grid grid-cols-12 gap-4 text-[11px] font-medium uppercase tracking-wider text-gray-500">
                <div className="col-span-1 text-center">#</div>
                <div className="col-span-3">Vencimento</div>
                <div className="col-span-3 text-center">Valor</div>
                <div className="col-span-3 text-center">Status</div>
                <div className="col-span-2 text-center">Ações</div>
              </div>
            </div>

            {assinatura.cobrancas.map((cobranca) => {
              const isAtrasado =
                cobranca.status !== 'PAGO' &&
                cobranca.status !== 'CANCELADO' &&
                new Date(cobranca.vencimento) < new Date();

              return (
                <div key={cobranca.id} className="min-w-0 transition-colors hover:bg-gray-50/80">
                  {/* Mobile */}
                  <div className="flex min-w-0 gap-2 px-4 py-3 sm:px-5 lg:hidden">
                    <div className="min-w-0 flex-1 overflow-hidden">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="text-xs font-medium text-gray-400">#{cobranca.numero}</span>
                        <span
                          className={`text-[13px] font-medium tabular-nums ${isAtrasado ? 'text-red-600' : 'text-gray-900'}`}
                        >
                          {formatDate(cobranca.vencimento)}
                        </span>
                      </div>
                      {cobranca.dataPagamento && (
                        <div className="mt-0.5 text-[11px] text-green-600">
                          Pago em {formatDate(cobranca.dataPagamento)}
                        </div>
                      )}
                      <div className="mt-2 text-[13px] font-semibold text-gray-900">
                        {formatCurrency(cobranca.valor)}
                      </div>
                    </div>
                    <div className="flex w-[4.5rem] shrink-0 flex-col items-end gap-2 self-stretch sm:w-24">
                      <Badge
                        status={cobrancaStatusMap[cobranca.status] ?? 'PENDING'}
                        size="sm"
                        className="max-w-full whitespace-normal px-2 text-center text-[10px] leading-snug"
                      />
                      <Link
                        href={`/cobrancas/${cobranca.id}`}
                        className="mt-auto inline-flex items-center gap-1 text-xs font-medium text-brand-accent hover:underline"
                      >
                        Abrir
                        <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5 shrink-0" />
                      </Link>
                    </div>
                  </div>

                  {/* Desktop */}
                  <div className="hidden px-6 py-3 lg:block">
                    <div className="grid grid-cols-12 items-center gap-4">
                      <div className="col-span-1 text-center">
                        <span className="text-xs font-medium text-gray-400">{cobranca.numero}</span>
                      </div>
                      <div className="col-span-3">
                        <div
                          className={`text-sm ${isAtrasado ? 'font-medium text-red-600' : 'text-gray-900'}`}
                        >
                          {formatDate(cobranca.vencimento)}
                        </div>
                        {cobranca.dataPagamento && (
                          <div className="text-xs text-green-600">
                            Pago em {formatDate(cobranca.dataPagamento)}
                          </div>
                        )}
                      </div>
                      <div className="col-span-3 text-center">
                        <div className="text-sm font-semibold text-gray-900">
                          {formatCurrency(cobranca.valor)}
                        </div>
                      </div>
                      <div className="col-span-3 flex justify-center">
                        <Badge status={cobrancaStatusMap[cobranca.status] ?? 'PENDING'} size="sm" />
                      </div>
                      <div className="col-span-2 flex justify-center">
                        <Link
                          href={`/cobrancas/${cobranca.id}`}
                          className="flex items-center gap-1 text-sm text-brand-accent hover:underline"
                        >
                          Abrir
                          <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <footer className="mt-8 flex min-w-0 max-w-full flex-col items-center border-t border-gray-100 pt-8 lg:hidden">
        <AsaasSeal variant="negativo-preto" />
      </footer>

      {isFamilySubscription && (
        <Dialog open={studentsDialogOpen} onOpenChange={setStudentsDialogOpen}>
          <DialogContent className="max-w-lg overflow-hidden rounded-2xl p-0">
            <DialogHeader className="border-b border-gray-100 px-6 py-5">
              <DialogTitle className="text-lg font-semibold text-gray-900">
                Alunos da assinatura familiar
              </DialogTitle>
              <p className="text-sm text-gray-500">
                {familyStudents.length} aluno{familyStudents.length === 1 ? '' : 's'} vinculado{familyStudents.length === 1 ? '' : 's'} a esta cobrança recorrente.
              </p>
            </DialogHeader>

            <div className="divide-y divide-gray-100">
              {familyStudents.map((student) => (
                <div key={student.matriculaId} className="flex items-center justify-between gap-4 px-6 py-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">{student.nome}</p>
                    <p className="mt-0.5 text-xs text-gray-500">Matrícula vinculada ao plano familiar</p>
                  </div>
                  <Link
                    href={`/matriculas/${student.matriculaId}`}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-brand-accent/20 text-brand-accent transition-colors hover:bg-brand-accent hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/30"
                    title={`Ver matrícula de ${student.nome}`}
                    aria-label={`Ver matrícula de ${student.nome}`}
                  >
                    <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                  </Link>
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
