'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';

import type { StoreSaleDTO } from '@alusa/finance';
import { canRequestFinancialRefund } from '@/features/finance/shared/refund-permission';

import { Button } from '@/components/ui/button';
import { ChevronLeft, MoreVertical } from '@/components/icons/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';

import { formatMarginPercent } from './pricing-utils';
import {
  BILLING_TYPE_LABELS,
  cancelSale,
  CHARGE_STATUS_LABELS,
  formatCurrencyBRL,
  formatDateBR,
  formatSaleNumber,
  fulfillSale,
  getSale,
  INVENTORY_STATUS_LABELS,
  returnSaleItems,
  requestSaleRefund,
  retrySaleCharge,
  SALE_FINALIZATION_LABELS,
  SALE_PAYMENT_METHOD_LABELS,
  SALE_STATUS_LABELS,
} from './services/sales-service';

interface SaleDetailsFeatureProps {
  saleId: string;
}

const LABEL_CLASS = 'text-xs font-medium text-slate-500';

function ReceiptRow({
  label,
  value,
  emphasis = false,
  total = false,
  nowrap = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  total?: boolean;
  nowrap?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-4 py-1.5">
      <dt className={`${LABEL_CLASS} min-w-0 flex-1 break-words ${total ? 'text-sm font-semibold text-slate-700' : ''}`}>{label}</dt>
      <dd className={`min-w-0 break-words text-right ${nowrap ? 'shrink-0 whitespace-nowrap' : ''} ${total ? 'text-lg font-semibold text-slate-900' : emphasis ? 'text-sm font-semibold text-slate-900' : 'text-sm text-slate-700'}`}>
        {value}
      </dd>
    </div>
  );
}

function ReceiptSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-dashed border-slate-300 py-4 first:border-t-0 first:pt-0">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {children}
    </section>
  );
}

function canCancelSale(sale: StoreSaleDTO): boolean {
  if (sale.baseStatus === 'CANCELADA') return false;
  if (sale.installmentPlan?.charges.some((charge) => charge.status === 'PAID')) return false;
  if (!sale.charge) return true;
  return sale.charge.status !== 'PAID';
}

function getBillingTypeLabel(value: string | null | undefined): string {
  if (!value) return '—';
  return BILLING_TYPE_LABELS[value as keyof typeof BILLING_TYPE_LABELS] ?? value;
}

function getChargeStatusLabel(value: string | null | undefined): string {
  if (!value) return '—';
  return CHARGE_STATUS_LABELS[value] ?? value;
}

export function SaleDetailsFeature({ saleId }: SaleDetailsFeatureProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const sessionRole = (session?.user as { role?: string } | undefined)?.role;
  const canRequestRefund = canRequestFinancialRefund(sessionRole);
  const [sale, setSale] = useState<StoreSaleDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saleToCancel, setSaleToCancel] = useState<StoreSaleDTO | null>(null);
  const [saleToReturn, setSaleToReturn] = useState<StoreSaleDTO | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const [returnQuantities, setReturnQuantities] = useState<Record<string, string>>({});
  const [cancelling, setCancelling] = useState(false);
  const [fulfilling, setFulfilling] = useState(false);
  const [returning, setReturning] = useState(false);
  const [retryingCharge, setRetryingCharge] = useState(false);
  const [refundActionId, setRefundActionId] = useState<string | null>(null);
  const returnRequestIdRef = useRef<string | null>(null);

  const refreshSale = useCallback(async () => {
    const data = await getSale(saleId);
    setSale(data);
  }, [saleId]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getSale(saleId);
        if (active) setSale(data);
      } catch (loadError) {
        const message = (loadError as Error).message;
        if (active) setError(message);
        toast.error({ title: 'Erro ao carregar venda', description: message });
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [saleId]);

  const waitingForFinancialState = Boolean(
    sale && (sale.charge?.asaasPaymentId || sale.installmentPlan?.charges.some((charge) => charge.asaasPaymentId)) &&
    sale.receiptFinancials?.realizationStatus !== 'COMPLETE' &&
    sale.receiptFinancials?.realizationStatus !== 'SUPPRESSED',
  );
  useLiveRefresh(() => refreshSale(), { enabled: waitingForFinancialState, intervalMs: 30_000 });

  const returnableItems = useMemo(() => {
    if (!saleToReturn) return [];
    return saleToReturn.items.map((item) => ({
      ...item,
      remaining: Math.max(item.quantity - item.returnedQuantity, 0),
    }));
  }, [saleToReturn]);

  const handleRefundAction = async (returnId: string, retryDenied: boolean) => {
    setRefundActionId(returnId);
    try {
      const updated = await requestSaleRefund(saleId, returnId, retryDenied ? 'RETRY_DENIED' : 'REQUEST');
      setSale(updated);
      toast.success({
        title: retryDenied ? 'Nova tentativa de estorno registrada' : 'Estorno solicitado',
        description: 'A situação financeira será atualizada após confirmação do provedor.',
      });
    } catch (refundError) {
      toast.error({ title: 'Não foi possível solicitar o estorno', description: (refundError as Error).message });
    } finally {
      setRefundActionId(null);
    }
  };

  const handleCancel = async () => {
    if (!saleToCancel) return;
    if (cancelReason.trim().length < 3) {
      toast.warning({
        title: 'Motivo obrigatório',
        description: 'Explique rapidamente o motivo do cancelamento.',
      });
      return;
    }

    setCancelling(true);
    try {
      const updated = await cancelSale(saleToCancel.id, cancelReason.trim());
      setSale(updated);
      setSaleToCancel(null);
      setCancelReason('');
      toast.success({
        title: `Venda ${formatSaleNumber(updated.saleNumber)} cancelada`,
        description: 'Estoque devolvido e auditoria registrada sem duplicidade.',
      });
    } catch (cancelError) {
      toast.error({ title: 'Falha ao cancelar', description: (cancelError as Error).message });
    } finally {
      setCancelling(false);
    }
  };

  const handleFulfill = async () => {
    if (!sale) return;

    setFulfilling(true);
    try {
      const updated = await fulfillSale(sale.id);
      setSale(updated);
      toast.success({
        title: `Reserva ${formatSaleNumber(updated.saleNumber)} cumprida`,
        description: 'A reserva virou saída física no estoque.',
      });
    } catch (fulfillError) {
      toast.error({
        title: 'Falha ao cumprir reserva',
        description: (fulfillError as Error).message,
      });
    } finally {
      setFulfilling(false);
    }
  };

  const handleRetryCharge = async () => {
    if (!sale) return;
    setRetryingCharge(true);
    try {
      const updated = await retrySaleCharge(sale.id);
      setSale(updated);
      toast.success({ title: 'Cobrança retentada', description: 'A venda foi atualizada com o estado local da cobrança.' });
    } catch (retryError) {
      toast.error({ title: 'Não foi possível retentar a cobrança', description: (retryError as Error).message });
    } finally {
      setRetryingCharge(false);
    }
  };

  const handleOpenReturnDialog = () => {
    if (!sale) return;
    returnRequestIdRef.current = crypto.randomUUID();
    setSaleToReturn(sale);
    setReturnQuantities(
      Object.fromEntries(
        sale.items.map((item) => [
          item.id,
          String(Math.max(item.quantity - item.returnedQuantity, 0)),
        ]),
      ),
    );
  };

  const handleSubmitReturn = async () => {
    if (!saleToReturn) return;

    const items = returnableItems
      .map((item) => ({
        saleItemId: item.id,
        quantity: Number(returnQuantities[item.id] ?? 0),
        remaining: item.remaining,
      }))
      .filter((item) => item.quantity > 0);

    if (items.length === 0) {
      toast.warning({
        title: 'Itens obrigatórios',
        description: 'Informe pelo menos uma quantidade para devolução.',
      });
      return;
    }

    if (items.some((item) => item.quantity > item.remaining)) {
      toast.warning({
        title: 'Quantidade inválida',
        description: 'A devolução não pode ser maior que a quantidade em aberto.',
      });
      return;
    }

    setReturning(true);
    try {
      const updated = await returnSaleItems(saleToReturn.id, {
        requestId: returnRequestIdRef.current ?? (returnRequestIdRef.current = crypto.randomUUID()),
        reason: returnReason.trim() || undefined,
        items: items.map(({ saleItemId, quantity }) => ({ saleItemId, quantity })),
      });
      setSale(updated);
      setSaleToReturn(null);
      returnRequestIdRef.current = null;
      setReturnReason('');
      setReturnQuantities({});
      toast.success({
        title: `Devolução registrada em ${formatSaleNumber(updated.saleNumber)}`,
        description: 'Estoque retornado e auditoria atualizada.',
      });
    } catch (returnError) {
      toast.error({
        title: 'Falha ao registrar devolução',
        description: (returnError as Error).message,
      });
    } finally {
      setReturning(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-4xl min-w-0 px-4 py-6">
        <Skeleton className="mb-4 h-5 w-20" />
        <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-6">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-40" />
          {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-16" />)}
        </div>
        <Skeleton className="mt-4 h-12 w-full" />
      </div>
    );
  }

  if (error || !sale) {
    return (
      <div className="mx-auto w-full max-w-4xl min-w-0 px-4 py-6">
        <button onClick={() => router.push('/sales/history')} className="mb-6 text-sm text-gray-600 hover:text-gray-900">Voltar</button>
        <div className="rounded-xl border border-gray-200 bg-white px-6 py-12 text-center">
          <h2 className="mb-2 text-xl font-semibold text-gray-900">Erro ao carregar venda</h2>
          <p className="text-sm text-gray-600">{error || 'A venda solicitada não foi encontrada ou não está acessível no momento.'}</p>
        </div>
      </div>
    );
  }

  const canReturn =
    sale.inventoryStatus !== 'RESERVED' &&
    sale.inventoryStatus !== 'CANCELED' &&
    sale.items.some((item) => item.quantity - item.returnedQuantity > 0);
  const linkedStudentName = sale.customer.alunoName ?? sale.matricula?.alunoName;
  const receiptFinancials = sale.receiptFinancials ?? null;
  const hasAsaasPayment = Boolean(
    sale.charge?.asaasPaymentId || sale.installmentPlan?.charges.some((charge) => charge.asaasPaymentId),
  );
  const netProfitRaw = receiptFinancials?.profitAfterRecordedFees;
  const netProfit = typeof netProfitRaw === 'number' && Number.isFinite(netProfitRaw)
    ? netProfitRaw
    : null;
  const netMarginRaw = receiptFinancials?.marginAfterRecordedFees;
  const netMargin = typeof netMarginRaw === 'number' && Number.isFinite(netMarginRaw)
    ? netMarginRaw
    : null;
  const processingFeeRaw = receiptFinancials?.processingFeeRecorded;
  const processingFeeValue = typeof processingFeeRaw === 'number' && Number.isFinite(processingFeeRaw)
    ? processingFeeRaw
    : null;
  const anticipationFeeRecordedRaw = receiptFinancials?.anticipationFeeRecorded;
  const anticipationFeeRecorded = typeof anticipationFeeRecordedRaw === 'number' && Number.isFinite(anticipationFeeRecordedRaw)
    ? anticipationFeeRecordedRaw
    : null;
  const processingFeeLabel = processingFeeValue === null
    ? 'Aguardando confirmação das tarifas'
    : `${formatCurrencyBRL(processingFeeValue)}${receiptFinancials?.processingFeeComplete ? '' : ' · parcial'}`;
  const anticipationFeeLabel = receiptFinancials?.anticipationStatus === 'PENDING'
    ? 'Aguardando antecipação'
    : receiptFinancials?.anticipationStatus === 'CREDITED'
      ? anticipationFeeRecorded === null
        ? 'Não disponível'
        : formatCurrencyBRL(anticipationFeeRecorded)
      : receiptFinancials?.anticipationStatus === 'NOT_ANTICIPATED'
        ? 'Não houve antecipação'
        : receiptFinancials?.anticipationStatus === 'UNKNOWN' || receiptFinancials?.anticipationStatus === 'UNAVAILABLE'
          ? 'Aguardando confirmação'
          : 'Dados incompletos';
  const financialStateLabel = receiptFinancials?.realizationStatus === 'COMPLETE'
    ? 'Liquidada'
    : receiptFinancials?.realizationStatus === 'SUPPRESSED'
      ? 'Indisponível após estorno/devolução'
      : (receiptFinancials?.pendingChargeCount ?? 0) > 0
        ? 'Aguardando pagamento'
        : receiptFinancials?.anticipationStatus === 'PENDING'
          ? 'Aguardando antecipação'
          : (receiptFinancials?.awaitingCreditChargeCount ?? 0) > 0
            ? 'Aguardando liquidação'
            : receiptFinancials?.additionalFeesComplete === false
              ? 'Aguardando taxas adicionais do Asaas'
            : 'Dados incompletos';
  const netProfitUnavailableLabel =
    receiptFinancials?.realizationStatus === 'SUPPRESSED'
      ? 'Indisponível após devolução ou estorno'
      : (receiptFinancials?.pendingChargeCount ?? 0) > 0
        ? 'Aguardando confirmação do pagamento'
        : receiptFinancials?.anticipationStatus === 'PENDING'
          ? 'Aguardando liquidação da antecipação'
          : (receiptFinancials?.awaitingCreditChargeCount ?? 0) > 0
            ? 'Aguardando liquidação'
            : receiptFinancials?.anticipationStatus === 'UNKNOWN'
              ? 'Aguardando confirmação sobre antecipação'
              : receiptFinancials?.additionalFeesComplete === false
                ? 'Aguardando sincronização completa das taxas do Asaas'
            : 'Aguardando dados completos de custos e taxas';
  const pendingAdditionalFees = receiptFinancials?.additionalFeesRecorded == null
    ? 'Aguardando confirmação'
    : formatCurrencyBRL(receiptFinancials.additionalFeesRecorded);
  const navigation = new Map<
    string,
    { label: string; external?: boolean; group: 'documents' | 'returns' }
  >();
  if (sale.finalizationType === 'RECEBIMENTO_PRESENCIAL') {
    navigation.set(`/sales/${sale.id}/receipt`, { label: 'Comprovante', group: 'documents' });
  }
  if (sale.installmentPlan) {
    navigation.set(`/charges/installments/${sale.installmentPlan.id}`, {
      label: 'Ver parcelamento',
      group: 'documents',
    });
  }
  if (sale.charge && !sale.installmentPlan) {
    navigation.set(`/charges/${sale.charge.id}`, {
      label: 'Abrir cobrança',
      group: 'documents',
    });
  }
  if (sale.charge?.invoiceUrl) {
    navigation.set(sale.charge.invoiceUrl, {
      label: 'Abrir fatura',
      external: true,
      group: 'documents',
    });
  }
  sale.returns.forEach((saleReturn, index) => {
    if (saleReturn.refundRequestUrl) {
      navigation.set(saleReturn.refundRequestUrl, {
        label: `Ação do pagador no Asaas · devolução ${index + 1}`,
        external: true,
        group: 'returns',
      });
    }
  });
  const documentLinks = [...navigation.entries()].filter(([, item]) => item.group === 'documents');
  const payerLinks = [...navigation.entries()].filter(([, item]) => item.group === 'returns');
  const refundActions = canRequestRefund
    ? sale.returns.flatMap((saleReturn, index) => {
        const canRequestThisRefund =
          saleReturn.refundStatus === 'NOT_REQUESTED' ||
          (saleReturn.refundStatus === 'DENIED' &&
            saleReturn.attempts.length > 0 &&
            saleReturn.attempts.every((attempt) => attempt.status === 'DENIED'));
        return canRequestThisRefund ? [{ saleReturn, index }] : [];
      })
    : [];
  const hasSaleOperations = sale.chargeProvisioningPending || sale.inventoryStatus === 'RESERVED';
  const hasReturnActions = canReturn || refundActions.length > 0 || payerLinks.length > 0;
  const hasActionsBeforeCancel = documentLinks.length > 0 || hasSaleOperations || hasReturnActions;

  return (
    <div className="mx-auto w-full max-w-4xl min-w-0 px-4 py-6 pb-8">
      <div className="mb-2">
        <Button
          type="button"
          variant="ghost"
          className="h-auto gap-2 rounded-md px-1 py-1 text-sm font-normal text-slate-600 hover:bg-transparent hover:text-slate-600 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          onClick={() => router.push('/sales/history')}
        >
          <ChevronLeft className="size-4" />
          Voltar
        </Button>
      </div>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-slate-900">Detalhes da venda</h1>
          <p className="mt-1 text-sm text-slate-500">
            {formatSaleNumber(sale.saleNumber)} · {formatDateBR(sale.createdAt)}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-9 shrink-0 rounded-lg text-slate-600 hover:bg-transparent hover:text-slate-600 focus-visible:bg-transparent focus-visible:text-slate-600"
              aria-label="Ações da venda"
            >
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="max-h-[min(70vh,32rem)] w-[min(18rem,calc(100vw-2rem))] overflow-y-auto whitespace-normal"
          >
            {documentLinks.length > 0 ? (
              <>
                {documentLinks.map(([href, item]) => (
                  <DropdownMenuItem key={href} asChild className="whitespace-normal">
                    {item.external ? (
                      <a href={href} target="_blank" rel="noreferrer">
                        {item.label}
                      </a>
                    ) : (
                      <Link href={href}>{item.label}</Link>
                    )}
                  </DropdownMenuItem>
                ))}
              </>
            ) : null}
            {hasSaleOperations ? (
              <>
                {documentLinks.length > 0 ? <DropdownMenuSeparator /> : null}
                {sale.chargeProvisioningPending ? (
                  <DropdownMenuItem
                    disabled={retryingCharge}
                    onSelect={() => void handleRetryCharge()}
                  >
                    {retryingCharge ? 'Retentando cobrança...' : 'Retentar cobrança'}
                  </DropdownMenuItem>
                ) : null}
                {sale.inventoryStatus === 'RESERVED' ? (
                  <DropdownMenuItem disabled={fulfilling} onSelect={() => void handleFulfill()}>
                    {fulfilling ? 'Cumprindo...' : 'Cumprir reserva'}
                  </DropdownMenuItem>
                ) : null}
              </>
            ) : null}
            {hasReturnActions ? (
              <>
                {(documentLinks.length > 0 || hasSaleOperations) ? <DropdownMenuSeparator /> : null}
                {payerLinks.map(([href, item]) => (
                  <DropdownMenuItem key={href} asChild className="whitespace-normal">
                    <a href={href} target="_blank" rel="noreferrer">
                      {item.label}
                    </a>
                  </DropdownMenuItem>
                ))}
                {canReturn ? (
                  <DropdownMenuItem
                    className="text-red-700 data-[highlighted]:text-red-800"
                    disabled={returning}
                    onSelect={handleOpenReturnDialog}
                  >
                    Registrar devolução
                  </DropdownMenuItem>
                ) : null}
                {refundActions.map(({ saleReturn, index }) => (
                  <DropdownMenuItem
                    key={saleReturn.id}
                    disabled={refundActionId !== null}
                    onSelect={() =>
                      void handleRefundAction(
                        saleReturn.id,
                        saleReturn.refundStatus === 'DENIED',
                      )
                    }
                    className="whitespace-normal"
                  >
                    {refundActionId === saleReturn.id
                      ? 'Processando...'
                      : `${saleReturn.refundStatus === 'DENIED' ? 'Tentar estorno novamente' : 'Solicitar estorno'} · devolução ${index + 1}`}
                  </DropdownMenuItem>
                ))}
              </>
            ) : null}
            {canCancelSale(sale) ? (
              <>
                {hasActionsBeforeCancel ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem
                  className="text-red-700 data-[highlighted]:text-red-800"
                  disabled={cancelling}
                  onSelect={() => setSaleToCancel(sale)}
                >
                  Cancelar venda
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <article className="min-w-0 overflow-x-hidden rounded-xl bg-gray-50 px-5 py-5 sm:px-7">
        {sale.cancelReason ? (
          <p className="mb-4 rounded-md bg-amber-100/70 px-3 py-2 text-sm text-amber-900">
            <strong>Cancelamento:</strong> {sale.cancelReason}
          </p>
        ) : null}
        <ReceiptSection title="Venda e cliente">
          <dl className="divide-y divide-slate-200/70">
            <ReceiptRow
              label={sale.customer.type === 'RESPONSAVEL' ? 'Responsável' : 'Cliente'}
              value={sale.customer.type === 'RESPONSAVEL'
                ? sale.customer.responsavelName ?? sale.customer.displayName
                : sale.customer.displayName}
              emphasis
            />
            {sale.customer.type === 'RESPONSAVEL'
              ? linkedStudentName && linkedStudentName !== (sale.customer.responsavelName ?? sale.customer.displayName)
                ? <ReceiptRow label="Aluno vinculado" value={linkedStudentName} />
                : null
              : sale.customer.alunoName && sale.customer.alunoName !== sale.customer.displayName
                ? <ReceiptRow label="Aluno" value={sale.customer.alunoName} />
                : null}
            {sale.customer.type !== 'RESPONSAVEL' && sale.customer.responsavelName && sale.customer.responsavelName !== sale.customer.displayName
              ? <ReceiptRow label="Responsável" value={sale.customer.responsavelName} />
              : null}
            {sale.customer.phone ?? sale.customer.walkInPhone ? <ReceiptRow label="Telefone" value={sale.customer.phone ?? sale.customer.walkInPhone ?? ''} /> : null}
            <ReceiptRow label="Situação da venda" value={SALE_STATUS_LABELS[sale.status]} />
            {hasAsaasPayment ? <ReceiptRow label="Liquidação financeira" value={financialStateLabel} /> : null}
            <ReceiptRow label="Finalização" value={SALE_FINALIZATION_LABELS[sale.finalizationType]} />
            {sale.paymentMethod ? <ReceiptRow label="Pagamento" value={SALE_PAYMENT_METHOD_LABELS[sale.paymentMethod]} /> : null}
            <ReceiptRow label="Estoque" value={INVENTORY_STATUS_LABELS[sale.inventoryStatus]} />
          </dl>
        </ReceiptSection>

        <ReceiptSection title="Itens">
          <div className="space-y-3">
            {sale.items.map((item) => (
              <div key={item.id} className="border-b border-dashed border-slate-300 px-1 py-2.5 last:border-b-0">
                <div className="flex justify-between gap-4 text-sm font-medium text-slate-800">
                  <span className="min-w-0 break-words">{item.productName}</span>
                  <span className="shrink-0 whitespace-nowrap tabular-nums">{formatCurrencyBRL(item.subtotal)}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {item.quantity} × {formatCurrencyBRL(item.unitPrice)}
                  {item.returnedQuantity > 0 ? ` · Devolvida: ${item.returnedQuantity}` : ''}
                </p>
              </div>
            ))}
          </div>
        </ReceiptSection>

        <ReceiptSection title="Totais">
          <dl className="divide-y divide-slate-200/70">
            <ReceiptRow label="Subtotal" value={formatCurrencyBRL(sale.subtotal)} nowrap />
            <ReceiptRow label="Desconto" value={formatCurrencyBRL(sale.discount)} nowrap />
            <ReceiptRow label="Total" value={formatCurrencyBRL(sale.total)} total nowrap />
            {!hasAsaasPayment && sale.amountReceived != null ? <ReceiptRow label="Recebido" value={formatCurrencyBRL(sale.amountReceived)} nowrap /> : null}
            {!hasAsaasPayment && sale.changeGiven != null && sale.changeGiven > 0 ? <ReceiptRow label="Troco" value={formatCurrencyBRL(sale.changeGiven)} nowrap /> : null}
            {hasAsaasPayment ? (
              <ReceiptRow
                label="Lucro líquido"
                value={netProfit !== null ? formatCurrencyBRL(netProfit) : netProfitUnavailableLabel}
                emphasis={netProfit !== null}
                nowrap
              />
            ) : null}
            {hasAsaasPayment && netMargin !== null ? (
              <ReceiptRow
                label="Margem líquida"
                value={formatMarginPercent(netMargin)}
                emphasis
                nowrap
              />
            ) : null}
            {hasAsaasPayment ? (
              <ReceiptRow label="Taxa de operação Asaas" value={processingFeeLabel} nowrap />
            ) : null}
            {hasAsaasPayment ? (
              <ReceiptRow
                label="Taxa de antecipação"
                value={anticipationFeeLabel}
                nowrap
              />
            ) : null}
            {hasAsaasPayment && ((receiptFinancials?.additionalFees.length ?? 0) > 0 || receiptFinancials?.additionalFeesRecorded != null) ? (
              <ReceiptRow label="Outras taxas registradas" value={pendingAdditionalFees} nowrap />
            ) : null}
            {!hasAsaasPayment && sale.totalCost != null ? <ReceiptRow label="Custo dos produtos" value={formatCurrencyBRL(sale.totalCost)} nowrap /> : null}
            {!hasAsaasPayment && sale.grossProfit != null ? <ReceiptRow label="Lucro bruto" value={formatCurrencyBRL(sale.grossProfit)} nowrap /> : null}
            {!hasAsaasPayment && sale.grossMargin != null ? <ReceiptRow label="Margem bruta" value={formatMarginPercent(sale.grossMargin)} nowrap /> : null}
          </dl>
        </ReceiptSection>

        <ReceiptSection title="Cobrança e parcelas">
          {sale.installmentPlan ? (
            <>
              <dl className="mb-3 divide-y divide-slate-200/70">
                <ReceiptRow
                  label="Parcelamento"
                  value={`${sale.installmentPlan.installmentCount}x · ${getChargeStatusLabel(sale.installmentPlan.status)}`}
                />
                <ReceiptRow
                  label="Forma"
                  value={getBillingTypeLabel(sale.installmentPlan.billingType)}
                />
              </dl>
              {sale.installmentPlan.charges.length > 0 ? (
                <div>
                  {sale.installmentPlan.charges.map((charge, index) => (
                    <div
                      key={charge.id}
                      className="border-b border-dashed border-slate-300 px-1 py-2 last:border-b-0"
                    >
                      <div className="flex justify-between gap-3 text-sm">
                        <span>
                          Parcela {index + 1}/{sale.installmentPlan?.installmentCount}
                        </span>
                        <strong className="shrink-0 whitespace-nowrap tabular-nums">
                          {formatCurrencyBRL(charge.value ?? 0)}
                        </strong>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        Vencimento {formatDateBR(charge.dueDate)} · {getChargeStatusLabel(charge.status)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500">
                  Parcelas aguardando sincronização do serviço financeiro.
                </p>
              )}
            </>
          ) : sale.charge ? (
            <dl className="divide-y divide-slate-200/70">
              <ReceiptRow label="Status" value={getChargeStatusLabel(sale.charge.status)} />
              <ReceiptRow label="Vencimento" value={formatDateBR(sale.charge.dueDate)} />
              <ReceiptRow label="Forma" value={getBillingTypeLabel(sale.charge.billingType)} />
              <ReceiptRow label="Valor" value={formatCurrencyBRL(sale.charge.value ?? 0)} />
            </dl>
          ) : (
            <p className="text-sm text-slate-500">Sem cobrança vinculada.</p>
          )}
        </ReceiptSection>

        {sale.returns.length > 0 ? (
          <ReceiptSection title="Devoluções e situação financeira">
            <div>
              {sale.returns.map((saleReturn, index) => (
                <div
                  key={saleReturn.id}
                  className="border-b border-dashed border-slate-300 px-1 py-2.5 text-sm last:border-b-0"
                >
                  <p className="font-medium text-slate-800">
                    Devolução {index + 1} · {formatDateBR(saleReturn.createdAt)}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    Solicitado {formatCurrencyBRL(saleReturn.refundRequestedAmount)} ·{' '}
                    {saleReturn.refundStatus === 'MANUAL_REFUND_REQUIRED'
                      ? 'Registrar estorno no financeiro'
                      : saleReturn.refundStatus.replaceAll('_', ' ')}
                  </p>
                  {saleReturn.refundIssue ? (
                    <p className="mt-1 text-xs text-slate-500">
                      Observação: {saleReturn.refundIssue}
                    </p>
                  ) : null}
                  {saleReturn.refundStatus === 'NEEDS_RECONCILIATION' ? (
                    <p className="mt-1 text-xs text-amber-800">
                      Aguardando reconciliação financeira. Uma nova solicitação automática está bloqueada.
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </ReceiptSection>
        ) : null}

        <ReceiptSection title="Auditoria">
          <dl className="divide-y divide-slate-200/70">
            <ReceiptRow label="Operador" value={sale.operator.name} />
            <ReceiptRow label="Criada em" value={formatDateBR(sale.createdAt)} />
            {sale.updatedAt !== sale.createdAt ? (
              <ReceiptRow label="Atualizada em" value={formatDateBR(sale.updatedAt)} />
            ) : null}
          </dl>
        </ReceiptSection>
      </article>



      <Dialog
        open={Boolean(saleToCancel)}
        onOpenChange={(open) => {
          if (!open && !cancelling) {
            setSaleToCancel(null);
            setCancelReason('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {saleToCancel
                ? `Cancelar ${formatSaleNumber(saleToCancel.saleNumber)}`
                : 'Cancelar venda'}
            </DialogTitle>
            <DialogDescription>
              O cancelamento devolve o estoque e interrompe a cobrança vinculada quando ela ainda
              estiver aberta.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-900">Motivo do cancelamento</p>
            <Textarea
              rows={4}
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              placeholder="Escreva um motivo breve para registrar o cancelamento."
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              disabled={cancelling}
              onClick={() => {
                if (!cancelling) {
                  setSaleToCancel(null);
                  setCancelReason('');
                }
              }}
            >
              Voltar
            </Button>
            <Button
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={cancelling}
              onClick={() => void handleCancel()}
            >
              {cancelling ? 'Cancelando...' : 'Confirmar cancelamento'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(saleToReturn)}
        onOpenChange={(open) => {
          if (!open && !returning) {
            setSaleToReturn(null);
            returnRequestIdRef.current = null;
            setReturnReason('');
            setReturnQuantities({});
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {saleToReturn
                ? `Registrar devolução em ${formatSaleNumber(saleToReturn.saleNumber)}`
                : 'Registrar devolução'}
            </DialogTitle>
            <DialogDescription>
              Informe as quantidades devolvidas por item para gerar o movimento compensatório no
              estoque.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {returnableItems.map((item) => (
              <div
                key={item.id}
                className="grid gap-3 rounded-xl border border-gray-200 p-3 md:grid-cols-[1fr,120px]"
              >
                <div>
                  <div className="font-medium text-gray-900">{item.productName}</div>
                  <div className="text-xs text-gray-500">
                    Vendido: {item.quantity} · Já devolvido: {item.returnedQuantity} · Aberto:{' '}
                    {item.remaining}
                  </div>
                </div>
                <Input
                  type="number"
                  min="0"
                  max={item.remaining}
                  value={returnQuantities[item.id] ?? '0'}
                  onChange={(event) =>
                    setReturnQuantities((current) => ({
                      ...current,
                      [item.id]: event.target.value,
                    }))
                  }
                />
              </div>
            ))}

            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-900">Motivo</p>
              <Textarea
                rows={3}
                value={returnReason}
                onChange={(event) => setReturnReason(event.target.value)}
                placeholder="Escreva um motivo breve para a devolução."
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              disabled={returning}
              onClick={() => {
                if (!returning) {
                  setSaleToReturn(null);
                  setReturnReason('');
                  setReturnQuantities({});
                }
              }}
            >
              Voltar
            </Button>
            <Button
              className="bg-brand-accent text-white hover:bg-brand-accent/90"
              disabled={returning}
              onClick={() => void handleSubmitReturn()}
            >
              {returning ? 'Registrando...' : 'Confirmar devolução'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
