'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';

import { ArrowLeft, ReceiptText, XCircle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { pushToast } from '@/components/ui/toast';
import { useFinanceListLoad } from '@/features/financeiro/hooks/use-finance-list-load';
import type { TransferDetailResultDTO } from '@alusa/finance';

import { formatCurrency, formatDate } from '../extrato/utils/extrato-formatters';
import { InfoCallout } from '@/components/ui/info-callout';

function sanitizeErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return 'Não foi possível concluir a operação.';
}

function mapCancelTransferErrorMessage(message: string) {
  switch (message) {
    case 'TRANSFER_NAO_CANCELAVEL':
      return 'A transferência já foi concluída ou não pode mais ser cancelada.';
    case 'TRANSFER_SEM_ID_ASAAS':
      return 'A transferência ainda não possui identificador externo para cancelamento.';
    case 'TRANSFER_NAO_ENCONTRADA':
      return 'A transferência não foi encontrada.';
    case 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS':
      return 'A conta financeira ainda não está configurada para cancelar esta transferência.';
    default:
      return message;
  }
}

function canCancelTransfer(status: TransferDetailResultDTO['status']) {
  return status === 'REQUESTED' || status === 'PENDING' || status === 'BLOCKED';
}

async function readJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const json = (await response.json().catch(() => ({}))) as T & { error?: string };

  if (!response.ok) {
    throw new Error(json?.error || `Erro ${response.status}`);
  }

  return json;
}

function mapTransferStatus(status: TransferDetailResultDTO['status']) {
  switch (status) {
    case 'DONE':
      return { label: 'Concluída', badgeStatus: 'CONCLUIDO' as const };
    case 'FAILED':
      return { label: 'Falhou', badgeStatus: 'RECUSADA' as const };
    case 'BLOCKED':
      return { label: 'Bloqueada', badgeStatus: 'RECUSADA' as const };
    case 'PROCESSING':
      return { label: 'Processando', badgeStatus: 'PROCESSANDO' as const };
    case 'CANCELED':
      return { label: 'Cancelada', badgeStatus: 'CANCELADA' as const };
    case 'REQUESTED':
      return { label: 'Solicitada', badgeStatus: 'AGUARDANDO' as const };
    case 'PENDING':
    default:
      return { label: 'Pendente', badgeStatus: 'PENDENTE' as const };
  }
}

function formatTransferOperation(operation: TransferDetailResultDTO['operation']) {
  return operation === 'PIX' ? 'Pix' : 'TED';
}

function formatCurrencyString(value: string | null) {
  if (value === null) return '—';
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return '—';
  return formatCurrency(numericValue);
}

function formatMaybeDate(value: string | null) {
  if (!value) return '—';

  const normalized = value.trim();
  const datePart = normalized.slice(0, 10);

  return /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? formatDate(datePart) : '—';
}

function formatAccountType(value: string | null) {
  if (!value) return null;
  if (value === 'CONTA_CORRENTE') return 'Conta corrente';
  if (value === 'CONTA_POUPANCA') return 'Conta poupança';
  return value;
}

type DetailFieldValue = {
  label: string;
  value: string;
  span?: 'full';
};

function DetailField({ label, value, span }: DetailFieldValue) {
  return (
    <div className={span === 'full' ? 'md:col-span-2 lg:col-span-3' : undefined}>
      <label className="block text-xs text-gray-600 mb-1.5">{label}</label>
      <div className="min-h-[42px] w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 break-words">
        {value}
      </div>
    </div>
  );
}

function buildRecipientFields(data: TransferDetailResultDTO) {
  const items = [
    data.recipient.name ? { label: 'Nome do destinatário', value: data.recipient.name } : null,
    data.recipient.cpfCnpj ? { label: 'CPF/CNPJ', value: data.recipient.cpfCnpj } : null,
    data.recipient.bankName ? { label: 'Banco', value: data.recipient.bankName } : null,
    data.operation === 'PIX' && data.recipient.pixKey ? { label: 'Chave Pix', value: data.recipient.pixKey } : null,
    data.operation === 'TED' && data.recipient.agency ? { label: 'Agência', value: data.recipient.agency } : null,
    data.operation === 'TED' && data.recipient.account
      ? {
          label: 'Conta',
          value: data.recipient.accountDigit
            ? `${data.recipient.account}-${data.recipient.accountDigit}`
            : data.recipient.account,
        }
      : null,
    data.operation === 'TED' && formatAccountType(data.recipient.accountType)
      ? { label: 'Tipo de conta', value: formatAccountType(data.recipient.accountType) as string }
      : null,
  ];

  return items.filter((item): item is DetailFieldValue => item !== null);
}

function buildTransferInfoFields(data: TransferDetailResultDTO) {
  const items = [
    { label: 'Operação', value: formatTransferOperation(data.operation) },
    { label: 'Valor solicitado', value: formatCurrencyString(data.amount) },
    { label: 'Taxa', value: formatCurrencyString(data.feeAmount) },
    { label: 'Valor líquido', value: formatCurrencyString(data.netAmount) },
    { label: 'Solicitada em', value: formatMaybeDate(data.createdAt) },
    data.transferDate ? { label: 'Data da transferência', value: formatMaybeDate(data.transferDate) } : null,
    data.scheduleDate ? { label: 'Agendada para', value: formatMaybeDate(data.scheduleDate) } : null,
    data.description ? { label: 'Descrição', value: data.description, span: 'full' as const } : null,
    data.endToEndIdentifier ? { label: 'ID da transação (E2E)', value: data.endToEndIdentifier, span: 'full' as const } : null,
  ];

  return items.filter((item): item is DetailFieldValue => item !== null);
}

function DetailSkeleton() {
  return (
    <div className="w-full min-w-0 px-4 py-6 pb-8">
      <div className="mb-8 space-y-5">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-10 w-80" />
      </div>
      <div className="space-y-6">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  );
}

export function ContaTransferDetailPage({ transferId }: { transferId: string }) {
  const [data, setData] = useState<TransferDetailResultDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [canceling, setCanceling] = useState(false);

  const status = useMemo(() => (data ? mapTransferStatus(data.status) : null), [data]);
  const transferInfoFields = useMemo(() => (data ? buildTransferInfoFields(data) : []), [data]);
  const recipientFields = useMemo(() => (data ? buildRecipientFields(data) : []), [data]);
  const allowCancel = Boolean(data && canCancelTransfer(data.status));
  const isTransferFinal =
    data?.status === 'DONE' || data?.status === 'FAILED' || data?.status === 'CANCELED';

  const { isInitialLoading, refresh } = useFinanceListLoad(
    async ({ signal }) => {
      setError(null);
      const response = await fetch(`/api/finance/transfers/${transferId}`, {
        cache: 'no-store',
        signal,
      });
      const json = (await response.json().catch(() => ({}))) as {
        data?: TransferDetailResultDTO;
        error?: string;
      };

      if (!response.ok || !json.data) {
        throw new Error(json.error || `Erro ${response.status}`);
      }

      setData(json.data);
    },
    {
      resetKey: transferId,
      liveRefreshEnabled: Boolean(data) && !canceling && !isTransferFinal,
      liveRefresh: { dashboard: false, portal: false, localRefresh: true },
      intervalMs: 30_000,
      minIntervalMs: 10_000,
    },
  );

  async function handleCancelTransfer() {
    if (!data) return;

    setCanceling(true);
    try {
      await readJson(`/api/finance/transfers/${data.id}/cancel`, {
        method: 'POST',
      });

      pushToast({
        title: 'Transferência cancelada',
        description: 'A solicitação foi cancelada e a tela foi atualizada com o estado oficial retornado.',
        variant: 'success',
      });

      setCancelDialogOpen(false);
      await refresh();
    } catch (nextError) {
      pushToast({
        title: 'Não foi possível cancelar a transferência',
        description: mapCancelTransferErrorMessage(sanitizeErrorMessage(nextError)),
        variant: 'error',
      });
    } finally {
      setCanceling(false);
    }
  }

  if (isInitialLoading) {
    return <DetailSkeleton />;
  }

  if (!data || error) {
    return (
      <div className="w-full min-w-0 px-4 py-6 pb-8">
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-6 py-5">
          <p className="text-sm font-semibold text-rose-900">Não foi possível carregar a transferência</p>
          <p className="mt-1 text-sm text-rose-700">
            {error === 'TRANSFER_NAO_ENCONTRADA'
              ? 'A transferência solicitada não foi encontrada para esta conta.'
              : 'Recarregue os dados para consultar o estado oficial e o comprovante da transferência.'}
          </p>
          <div className="mt-4 flex gap-3">
            <Button asChild variant="outline">
              <Link href="/financeiro/conta">Voltar para saldo</Link>
            </Button>
            <Button onClick={() => window.location.reload()}>Tentar novamente</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 px-4 py-6 pb-8">
      <div className="mb-8">
        <Link
          href="/financeiro/conta"
          className="mb-5 inline-flex items-center gap-2 text-sm text-gray-600 transition-colors hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </Link>

        <div className="flex items-start justify-between gap-6">
          <div className="flex-1">
            <h1 className="text-3xl font-bold leading-tight text-gray-900">Detalhes da transferência</h1>
            <p className="mt-2 text-sm font-mono text-gray-600">ID: {data.id}</p>
          </div>

          <div className="flex items-center gap-3">
            {allowCancel ? (
              <Button
                type="button"
                onClick={() => setCancelDialogOpen(true)}
                className="h-10 px-4 bg-red-600 text-white hover:bg-red-700"
              >
                <XCircle className="mr-2 h-4 w-4" />
                Cancelar transferência
              </Button>
            ) : (
              <Button
                asChild
                disabled={!data.transactionReceiptUrl}
                className="h-10 px-4 bg-brand-accent text-white hover:bg-brand-accent/90 disabled:bg-brand-accent/40"
              >
                <a href={data.transactionReceiptUrl ?? '#'} target="_blank" rel="noreferrer noopener">
                  <ReceiptText className="mr-2 h-4 w-4" />
                  Ver comprovante
                </a>
              </Button>
            )}
          </div>
        </div>
      </div>

      {data.failReason ? (
        <InfoCallout variant="warning" size="md" showIcon={false} className="mb-5">
          <p className="font-semibold">Motivo da falha</p>
          <p className="mt-1">{data.failReason}</p>
        </InfoCallout>
      ) : null}

      <div className="space-y-6">
        <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="px-6 py-5 border-b border-gray-100">
            <h2 className="text-xl font-semibold text-gray-900">Informações da transferência</h2>
            <p className="mt-1 text-sm text-gray-600">Dados financeiros e situação atual da transferência.</p>
          </div>

          <div className="px-6 py-6">
            <div className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2 lg:grid-cols-3">
              <div>
                <p className="mb-2 text-sm font-medium text-gray-500">Situação</p>
                {status ? <Badge status={status.badgeStatus}>{status.label}</Badge> : null}
              </div>
              {transferInfoFields.map((field) => (
                <DetailField key={field.label} label={field.label} value={field.value} span={field.span} />
              ))}
              <DetailField
                label="Comprovante"
                value={data.transactionReceiptUrl ? 'Disponível para visualização' : 'Ainda indisponível'}
              />
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="px-6 py-5 border-b border-gray-100">
            <h2 className="text-xl font-semibold text-gray-900">Informações do destinatário</h2>
            <p className="mt-1 text-sm text-gray-600">Dados relevantes para identificar a conta de destino.</p>
          </div>

          <div className="px-6 py-6">
            <div className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2 lg:grid-cols-3">
              {recipientFields.map((field) => (
                <DetailField key={field.label} label={field.label} value={field.value} span={field.span} />
              ))}
            </div>
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={cancelDialogOpen}
        onOpenChange={setCancelDialogOpen}
        title="Cancelar transferência?"
        description="Fluxo afetado: matrícula - plano - cobrança - pagamento. O cancelamento só é permitido enquanto a transferência ainda não chegou a estado terminal, preservando auditoria e reprocessamento seguro."
        confirmText="Cancelar transferência"
        cancelText="Voltar"
        variant="destructive"
        loading={canceling}
        onConfirm={() => {
          void handleCancelTransfer();
        }}
      />
    </div>
  );
}