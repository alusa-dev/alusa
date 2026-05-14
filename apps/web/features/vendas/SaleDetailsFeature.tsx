'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import type { StoreSaleDTO } from '@alusa/finance';

import {
  ChevronLeft as ArrowLeft,
  ExternalLink,
  Receipt,
  WalletCards,
} from '@/components/icons/icons';
import { Button } from '@/components/ui/button';
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

import { SaleStatusBadge } from './components/SaleStatusBadge';
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
  SALE_FINALIZATION_LABELS,
  SALE_PAYMENT_METHOD_LABELS,
} from './services/sales-service';

interface SaleDetailsFeatureProps {
  saleId: string;
}

const CARD_CLASS = 'rounded-xl border border-gray-200 bg-white shadow-sm';
const CARD_HEADER_CLASS = 'border-b border-gray-100 px-6 py-5';
const LABEL_CLASS = 'text-xs font-medium uppercase tracking-wide text-gray-500';

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

    return () => {
      active = false;
    };
  }, [saleId]);

  const returnableItems = useMemo(() => {
    if (!saleToReturn) return [];
    return saleToReturn.items.map((item) => ({
      ...item,
      remaining: Math.max(item.quantity - item.returnedQuantity, 0),
    }));
  }, [saleToReturn]);

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

  const handleOpenReturnDialog = () => {
    if (!sale) return;
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
        reason: returnReason.trim() || undefined,
        items: items.map(({ saleItemId, quantity }) => ({ saleItemId, quantity })),
      });
      setSale(updated);
      setSaleToReturn(null);
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
      <div className="w-full min-w-0 px-4 py-6">
        <Skeleton className="mb-5 h-10 w-28" />
        <div className="mb-8 flex items-start justify-between gap-6">
          <div className="flex-1">
            <Skeleton className="mb-3 h-9 w-80" />
            <Skeleton className="h-5 w-96" />
          </div>
          <Skeleton className="h-9 w-24" />
        </div>
        <div className="space-y-6">
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
          <div className="grid gap-6 lg:grid-cols-2">
            <Skeleton className="h-56 rounded-xl" />
            <Skeleton className="h-56 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !sale) {
    return (
      <div className="w-full min-w-0 px-4 py-6">
        <button
          onClick={() => router.push('/vendas/historico')}
          className="mb-8 flex items-center gap-2 text-sm text-gray-600 transition-colors hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </button>

        <div className={CARD_CLASS}>
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <h2 className="mb-2 text-2xl font-bold text-gray-900">Erro ao carregar venda</h2>
            <p className="mb-8 max-w-md text-base text-gray-600">
              {error || 'A venda solicitada não foi encontrada ou não está acessível no momento.'}
            </p>
            <Button onClick={() => router.push('/vendas/historico')}>Voltar para histórico</Button>
          </div>
        </div>
      </div>
    );
  }

  const canReturn =
    sale.inventoryStatus !== 'RESERVED' &&
    sale.inventoryStatus !== 'CANCELED' &&
    sale.items.some((item) => item.quantity - item.returnedQuantity > 0);

  return (
    <div className="w-full min-w-0 px-4 py-6 pb-8">
      <div className="mb-8">
        <button
          onClick={() => router.push('/vendas/historico')}
          className="mb-5 flex items-center gap-2 text-sm text-gray-600 transition-colors hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </button>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <h1 className="text-3xl font-bold leading-tight text-gray-900">Detalhes da Venda</h1>
            <p className="mt-2 text-sm text-gray-600">
              {formatSaleNumber(sale.saleNumber)} · {sale.customer.displayName} ·{' '}
              {formatDateBR(sale.createdAt)}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <SaleStatusBadge status={sale.status} />
            {sale.finalizationType === 'RECEBIMENTO_PRESENCIAL' ? (
              <Button asChild variant="outline" className="h-10 border-gray-300 text-gray-700">
                <Link href={`/vendas/${sale.id}/comprovante`}>
                  <Receipt className="mr-2 h-4 w-4" />
                  Comprovante
                </Link>
              </Button>
            ) : null}
            {sale.installmentPlan ? (
              <Button asChild variant="outline" className="h-10 border-gray-300 text-gray-700">
                <Link href={`/cobrancas/parcelamentos/${sale.installmentPlan.id}`}>
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Ver parcelamento
                </Link>
              </Button>
            ) : sale.charge ? (
              <Button asChild variant="outline" className="h-10 border-gray-300 text-gray-700">
                <Link href={`/cobrancas/${sale.charge.id}`}>
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Abrir cobrança
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {sale.cancelReason ? (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-medium">Cancelamento registrado:</span> {sale.cancelReason}
        </div>
      ) : null}

      <div className="space-y-6">
        <section className={CARD_CLASS}>
          <div className={CARD_HEADER_CLASS}>
            <h2 className="text-xl font-semibold text-gray-900">Informações da Venda</h2>
            <p className="mt-1 text-sm text-gray-600">Cliente, finalização e situação do estoque</p>
          </div>

          <div className="grid grid-cols-1 gap-x-8 gap-y-6 px-6 py-6 md:grid-cols-2 lg:grid-cols-3">
            <div>
              <p className={LABEL_CLASS}>Situação</p>
              <div className="mt-2">
                <SaleStatusBadge status={sale.status} />
              </div>
            </div>
            <div>
              <p className={LABEL_CLASS}>Cliente</p>
              <p className="mt-2 text-sm font-semibold text-gray-900">
                {sale.customer.displayName}
              </p>
              {sale.customer.alunoName ? (
                <p className="mt-1 text-sm text-gray-600">Aluno: {sale.customer.alunoName}</p>
              ) : null}
              {sale.customer.responsavelName ? (
                <p className="mt-1 text-sm text-gray-600">
                  Responsável: {sale.customer.responsavelName}
                </p>
              ) : null}
              {sale.customer.walkInPhone ? (
                <p className="mt-1 text-sm text-gray-600">Telefone: {sale.customer.walkInPhone}</p>
              ) : null}
            </div>
            <div>
              <p className={LABEL_CLASS}>Finalização</p>
              <p className="mt-2 text-sm font-semibold text-gray-900">
                {SALE_FINALIZATION_LABELS[sale.finalizationType]}
              </p>
              {sale.paymentMethod ? (
                <p className="mt-1 text-sm text-gray-600">
                  Método: {SALE_PAYMENT_METHOD_LABELS[sale.paymentMethod]}
                </p>
              ) : null}
            </div>
            <div>
              <p className={LABEL_CLASS}>Estoque</p>
              <p className="mt-2 text-sm font-semibold text-gray-900">
                {INVENTORY_STATUS_LABELS[sale.inventoryStatus]}
              </p>
            </div>
            <div>
              <p className={LABEL_CLASS}>Operador</p>
              <p className="mt-2 text-sm font-semibold text-gray-900">{sale.operator.name}</p>
            </div>
            <div>
              <p className={LABEL_CLASS}>Atualização</p>
              <p className="mt-2 text-sm font-semibold text-gray-900">
                {formatDateBR(sale.updatedAt)}
              </p>
            </div>
          </div>
        </section>

        <section className={CARD_CLASS}>
          <div className={CARD_HEADER_CLASS}>
            <h2 className="text-xl font-semibold text-gray-900">Itens da Venda</h2>
            <p className="mt-1 text-sm text-gray-600">Produtos, quantidades, valores e margem</p>
          </div>

          <div className="divide-y divide-gray-100">
            {sale.items.map((item) => (
              <div key={item.id} className="grid gap-4 px-6 py-4 text-sm md:grid-cols-[1fr,180px]">
                <div>
                  <p className="font-semibold text-gray-900">{item.productName}</p>
                  <p className="mt-1 text-gray-600">
                    Quantidade: {item.quantity}
                    {item.returnedQuantity > 0 ? ` · Devolvida: ${item.returnedQuantity}` : ''}
                  </p>
                  {item.totalCostAtSale != null && item.grossProfitAtSale != null ? (
                    <p className="mt-1 text-xs text-gray-500">
                      Custo: {formatCurrencyBRL(item.totalCostAtSale)} · Lucro:{' '}
                      <span
                        className={
                          item.grossProfitAtSale >= 0 ? 'text-emerald-700' : 'text-red-700'
                        }
                      >
                        {formatCurrencyBRL(item.grossProfitAtSale)}
                      </span>
                      {item.marginAtSale != null
                        ? ` · ${formatMarginPercent(item.marginAtSale)}`
                        : ''}
                    </p>
                  ) : null}
                </div>
                <div className="text-left md:text-right">
                  <p className="font-semibold text-gray-900">{formatCurrencyBRL(item.subtotal)}</p>
                  <p className="mt-1 text-gray-500">{formatCurrencyBRL(item.unitPrice)} un.</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className={CARD_CLASS}>
            <div className={CARD_HEADER_CLASS}>
              <h2 className="text-xl font-semibold text-gray-900">Resumo Financeiro</h2>
              <p className="mt-1 text-sm text-gray-600">Totais, desconto, custo e lucro</p>
            </div>
            <div className="space-y-3 px-6 py-6 text-sm text-gray-600">
              <div className="flex items-center justify-between">
                <span>Subtotal</span>
                <span>{formatCurrencyBRL(sale.subtotal)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Desconto</span>
                <span>{formatCurrencyBRL(sale.discount)}</span>
              </div>
              <div className="flex items-center justify-between border-t border-gray-100 pt-3 text-base font-semibold text-gray-900">
                <span>Total</span>
                <span>{formatCurrencyBRL(sale.total)}</span>
              </div>
              {sale.totalCost != null ? (
                <div className="flex items-center justify-between">
                  <span>Custo</span>
                  <span>{formatCurrencyBRL(sale.totalCost)}</span>
                </div>
              ) : null}
              {sale.grossProfit != null ? (
                <div className="flex items-center justify-between">
                  <span>Lucro bruto</span>
                  <span
                    className={
                      sale.grossProfit >= 0
                        ? 'font-medium text-emerald-700'
                        : 'font-medium text-red-700'
                    }
                  >
                    {formatCurrencyBRL(sale.grossProfit)}
                  </span>
                </div>
              ) : null}
              {sale.grossMargin != null ? (
                <div className="flex items-center justify-between">
                  <span>Margem</span>
                  <span>{formatMarginPercent(sale.grossMargin)}</span>
                </div>
              ) : null}
              {sale.amountReceived != null ? (
                <div className="flex items-center justify-between">
                  <span>Recebido</span>
                  <span>{formatCurrencyBRL(sale.amountReceived)}</span>
                </div>
              ) : null}
              {sale.changeGiven != null && sale.changeGiven > 0 ? (
                <div className="flex items-center justify-between">
                  <span>Troco</span>
                  <span>{formatCurrencyBRL(sale.changeGiven)}</span>
                </div>
              ) : null}
            </div>
          </section>

          <section className={CARD_CLASS}>
            <div className={CARD_HEADER_CLASS}>
              <h2 className="text-xl font-semibold text-gray-900">Cobrança Vinculada</h2>
              <p className="mt-1 text-sm text-gray-600">Status, vencimento e links oficiais</p>
            </div>
            <div className="px-6 py-6">
              {sale.installmentPlan ? (
                <div className="space-y-4 text-sm text-gray-600">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div>
                      <p className={LABEL_CLASS}>Parcelamento</p>
                      <p className="mt-2 font-semibold text-gray-900">
                        {sale.installmentPlan.installmentCount}x
                      </p>
                    </div>
                    <div>
                      <p className={LABEL_CLASS}>Status</p>
                      <p className="mt-2 font-semibold text-gray-900">
                        {getChargeStatusLabel(sale.installmentPlan.status)}
                      </p>
                    </div>
                    <div>
                      <p className={LABEL_CLASS}>Forma</p>
                      <p className="mt-2 font-semibold text-gray-900">
                        {getBillingTypeLabel(sale.installmentPlan.billingType)}
                      </p>
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-lg border border-gray-200">
                    <div className="grid grid-cols-12 gap-3 bg-gray-50 px-4 py-3 text-xs font-medium uppercase tracking-wide text-gray-500">
                      <div className="col-span-3">Parcela</div>
                      <div className="col-span-3">Valor</div>
                      <div className="col-span-3">Vencimento</div>
                      <div className="col-span-3 text-right">Ações</div>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {sale.installmentPlan.charges.length > 0 ? (
                        sale.installmentPlan.charges.map((charge, index) => (
                          <div
                            key={charge.id}
                            className="grid grid-cols-12 items-center gap-3 px-4 py-3"
                          >
                            <div className="col-span-3 text-sm font-medium text-gray-900">
                              {index + 1}/{sale.installmentPlan?.installmentCount}
                            </div>
                            <div className="col-span-3 text-sm text-gray-700">
                              {formatCurrencyBRL(charge.value ?? 0)}
                            </div>
                            <div className="col-span-3 text-sm text-gray-700">
                              {formatDateBR(charge.dueDate)}
                              <span className="mt-0.5 block text-xs text-gray-500">
                                {getChargeStatusLabel(charge.status)}
                              </span>
                            </div>
                            <div className="col-span-3 flex justify-end gap-2">
                              <Button asChild size="sm" variant="outline" className="h-8">
                                <Link href={`/cobrancas/${charge.id}`}>
                                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                                  Detalhes
                                </Link>
                              </Button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="px-4 py-5 text-sm text-gray-500">
                          Parcelas aguardando sincronização do serviço financeiro.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : sale.charge ? (
                <div className="space-y-4 text-sm text-gray-600">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div>
                      <p className={LABEL_CLASS}>Status</p>
                      <p className="mt-2 font-semibold text-gray-900">
                        {getChargeStatusLabel(sale.charge.status)}
                      </p>
                    </div>
                    <div>
                      <p className={LABEL_CLASS}>Vencimento</p>
                      <p className="mt-2 font-semibold text-gray-900">
                        {formatDateBR(sale.charge.dueDate)}
                      </p>
                    </div>
                    <div>
                      <p className={LABEL_CLASS}>Forma</p>
                      <p className="mt-2 font-semibold text-gray-900">
                        {getBillingTypeLabel(sale.charge.billingType)}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3 pt-2">
                    <Button asChild variant="outline">
                      <Link href={`/cobrancas/${sale.charge.id}`}>
                        <ExternalLink className="mr-2 h-4 w-4" />
                        Abrir detalhes
                      </Link>
                    </Button>
                    {sale.charge.invoiceUrl ? (
                      <Button asChild variant="outline">
                        <a href={sale.charge.invoiceUrl} target="_blank" rel="noreferrer">
                          <ExternalLink className="mr-2 h-4 w-4" />
                          Abrir fatura
                        </a>
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
                  Sem cobrança vinculada.
                </div>
              )}
            </div>
          </section>
        </div>

        <section className={CARD_CLASS}>
          <div className="grid gap-6 px-6 py-6 md:grid-cols-2">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                <Receipt className="h-4 w-4" />
                Auditoria
              </div>
              <div className="mt-3 space-y-2 text-sm text-gray-600">
                <p>Operador: {sale.operator.name}</p>
                <p>Criada em: {formatDateBR(sale.createdAt)}</p>
                {sale.updatedAt !== sale.createdAt ? (
                  <p>Atualizada em: {formatDateBR(sale.updatedAt)}</p>
                ) : null}
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                <WalletCards className="h-4 w-4" />
                Fluxo afetado
              </div>
              <p className="mt-3 text-sm text-gray-600">Loja → cobrança → pagamento → estoque</p>
            </div>
          </div>
        </section>

        <div className="flex flex-wrap justify-end gap-3">
          {canCancelSale(sale) ? (
            <Button
              variant="outline"
              className="border-red-200 text-red-700 hover:bg-red-50"
              disabled={cancelling}
              onClick={() => setSaleToCancel(sale)}
            >
              Cancelar venda
            </Button>
          ) : null}
          {sale.inventoryStatus === 'RESERVED' ? (
            <Button variant="outline" disabled={fulfilling} onClick={() => void handleFulfill()}>
              {fulfilling ? 'Cumprindo...' : 'Cumprir reserva'}
            </Button>
          ) : null}
          {canReturn ? (
            <Button variant="outline" disabled={returning} onClick={handleOpenReturnDialog}>
              Registrar devolução
            </Button>
          ) : null}
        </div>
      </div>

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
