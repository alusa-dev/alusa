'use client';

/**
 * Página: Detalhe da Assinatura
 *
 * Exibe dados da assinatura + lista de cobranças geradas (filhas).
 * Espelha o modelo do Asaas.
 *
 * Domínio: Navegação
 */

import { useEffect, useState, useCallback } from 'react';
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

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const formatDate = (dateStr: string | null) =>
  dateStr ? new Date(dateStr).toLocaleDateString('pt-BR') : '—';

// Mapear status de Subscription para StatusType
const subscriptionStatusMap: Record<string, StatusType> = {
  REQUESTED: 'PENDING',
  ACTIVE: 'CONFIRMED',
  INACTIVE: 'CANCELED',
  EXPIRED: 'OVERDUE',
  DELETED: 'CANCELED',
  FAILED: 'REFUNDED',
};

// Mapear status de Cobrança para StatusType
const cobrancaStatusMap: Record<StatusCobranca, StatusType> = {
  PENDENTE: 'PENDING',
  PROCESSANDO: 'RECEIVED',
  PAGO: 'CONFIRMED',
  ATRASADO: 'OVERDUE',
  CANCELADO: 'CANCELED',
  CANCELAMENTO_PENDENTE: 'PENDING',
  ESTORNADO: 'REFUNDED',
  A_VENCER: 'PENDING',
  ESTORNADO_PARCIAL: 'REFUNDED',
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

export default function AssinaturaDetalhePage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [assinatura, setAssinatura] = useState<AssinaturaDetalhes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [studentsDialogOpen, setStudentsDialogOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/finance/subscriptions/${params.id}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Erro ao carregar assinatura');
      }
      const payload = await res.json();
      setAssinatura(payload.data);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Erro desconhecido';
      setError(errMsg);
      pushToast({ title: 'Erro', description: errMsg, variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Loading state
  if (loading) {
    return (
      <div className="container mx-auto py-6 px-4 max-w-5xl">
        <Skeleton className="h-10 w-32 mb-5" />
        <div className="space-y-6">
          <div className="bg-white rounded-xl border p-6">
            <Skeleton className="h-8 w-64 mb-4" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              {[1, 2, 3, 4].map((i) => (
                <div key={i}>
                  <Skeleton className="h-4 w-20 mb-2" />
                  <Skeleton className="h-6 w-32" />
                </div>
              ))}
            </div>
          </div>
          <div className="bg-white rounded-xl border p-6">
            <Skeleton className="h-6 w-48 mb-4" />
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
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
      <div className="container mx-auto py-6 px-4 max-w-5xl">
        <button
          onClick={() => router.back()}
          className="mb-8 flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </button>
        <div className="bg-white rounded-xl border p-12 text-center">
          <div className="text-4xl mb-4">⚠️</div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Erro ao carregar assinatura</h2>
          <p className="text-gray-600 mb-6">{error || 'Assinatura não encontrada'}</p>
          <div className="flex justify-center gap-3">
            <Button variant="outline" onClick={() => router.back()}>
              Voltar
            </Button>
            <Button onClick={load}>Tentar novamente</Button>
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

  return (
    <div className="container mx-auto py-6 px-4 max-w-5xl">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => router.back()}
          className="mb-4 flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </button>

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Detalhes da Assinatura</h1>
            <p className="text-sm text-gray-500 mt-1">
              {assinatura.description ?? assinatura.cycleLabel}
            </p>
          </div>
        </div>
      </div>
      {/* Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="flex flex-col justify-center rounded-2xl bg-[#f2eeff] px-6 py-4">
          <p className="text-[13px] font-normal tracking-wide text-[#2D004A] mb-1">
            Cobranças Geradas
          </p>
          <p className="text-3xl leading-none font-medium text-[#2D004A]">
            {assinatura.totalCobrancas}
          </p>
        </div>
        <div className="flex flex-col justify-center rounded-2xl bg-[#f2eeff] px-6 py-4">
          <p className="text-[13px] font-normal tracking-wide text-[#2D004A] mb-1">
            Cobranças Pagas
          </p>
          <p className="text-3xl leading-none font-medium text-[#2D004A]">
            {assinatura.cobrancasPagas}
          </p>
        </div>
        <div className="flex flex-col justify-center rounded-2xl bg-[#f2eeff] px-6 py-4">
          <p className="text-[13px] font-normal tracking-wide text-[#2D004A] mb-1">
            Valor Recebido
          </p>
          <p className="text-3xl leading-none font-medium text-[#2D004A]">
            {formatCurrency(assinatura.valorRecebido)}
          </p>
        </div>
      </div>

      {/* Card Dados da Assinatura */}
      <div className="bg-white rounded-xl border shadow-sm mb-6">
        <div className="px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-900">Dados da Assinatura</h2>
        </div>
        <div className="px-6 py-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
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
            <div className="mt-5 pt-4 border-t flex flex-wrap gap-3">
              {assinatura.matriculaId && (
                <Link
                  href={`/matriculas/${assinatura.matriculaId}`}
                  className="text-sm text-brand-accent hover:underline flex items-center gap-1"
                >
                  Ver matrícula
                  <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
                </Link>
              )}
              {assinatura.contratoId && (
                <Link
                  href={`/contratos/${assinatura.contratoId}`}
                  className="text-sm text-brand-accent hover:underline flex items-center gap-1"
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
      <div className="bg-white rounded-xl border shadow-sm">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Cobranças Geradas</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Todas as cobranças vinculadas a esta assinatura
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <ClockIcon className="h-4 w-4" />
            Ordenado por vencimento (mais recente primeiro)
          </div>
        </div>

        {assinatura.cobrancas.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-500">
            <div className="text-4xl mb-3">📋</div>
            <p className="text-sm">Nenhuma cobrança gerada ainda</p>
            <p className="text-xs text-gray-400 mt-1">
              As cobranças serão criadas conforme o ciclo da assinatura
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {/* Header */}
            <div className="bg-gray-50 px-6 py-3">
              <div className="grid grid-cols-12 gap-4 text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                <div className="col-span-1 text-center">#</div>
                <div className="col-span-3">Vencimento</div>
                <div className="col-span-3 text-center">Valor</div>
                <div className="col-span-3 text-center">Status</div>
                <div className="col-span-2 text-center">Ações</div>
              </div>
            </div>

            {/* Rows */}
            {assinatura.cobrancas.map((cobranca) => {
              const isAtrasado =
                cobranca.status !== 'PAGO' &&
                cobranca.status !== 'CANCELADO' &&
                new Date(cobranca.vencimento) < new Date();

              return (
                <div
                  key={cobranca.id}
                  className="px-6 py-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="grid grid-cols-12 gap-4 items-center">
                    {/* Número */}
                    <div className="col-span-1 text-center">
                      <span className="text-xs font-medium text-gray-400">
                        {cobranca.numero}
                      </span>
                    </div>

                    {/* Vencimento */}
                    <div className="col-span-3">
                      <div
                        className={`text-sm ${isAtrasado ? 'text-red-600 font-medium' : 'text-gray-900'}`}
                      >
                        {formatDate(cobranca.vencimento)}
                      </div>
                      {cobranca.dataPagamento && (
                        <div className="text-xs text-green-600">
                          Pago em {formatDate(cobranca.dataPagamento)}
                        </div>
                      )}
                    </div>

                    {/* Valor */}
                    <div className="col-span-3 text-center">
                      <div className="text-sm font-semibold text-gray-900">
                        {formatCurrency(cobranca.valor)}
                      </div>
                    </div>

                    {/* Status */}
                    <div className="col-span-3 flex justify-center">
                      <Badge status={cobrancaStatusMap[cobranca.status] ?? 'PENDING'} size="sm" />
                    </div>

                    {/* Ações */}
                    <div className="col-span-2 flex justify-center">
                      <Link
                        href={`/cobrancas/${cobranca.id}`}
                        className="text-sm text-brand-accent hover:underline flex items-center gap-1"
                      >
                        Abrir
                        <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

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
