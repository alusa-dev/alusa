'use client';

import type { StoreSaleDTO } from '@alusa/finance';

import { ExternalLink, Receipt, WalletCards } from '@/components/icons/icons';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

import { SaleStatusBadge } from './SaleStatusBadge';
import { formatMarginPercent } from '../pricing-utils';
import {
  BILLING_TYPE_LABELS,
  CHARGE_STATUS_LABELS,
  formatCurrencyBRL,
  formatDateBR,
  formatSaleNumber,
  INVENTORY_STATUS_LABELS,
  SALE_FINALIZATION_LABELS,
  SALE_PAYMENT_METHOD_LABELS,
} from '../services/sales-service';

interface SaleDetailSheetProps {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  sale: StoreSaleDTO | null;
  onCancel: (_sale: StoreSaleDTO) => void;
  onFulfill?: (_sale: StoreSaleDTO) => void;
  onReturn?: (_sale: StoreSaleDTO) => void;
  cancelling?: boolean;
  fulfilling?: boolean;
  returning?: boolean;
}

function canCancelSale(sale: StoreSaleDTO): boolean {
  if (sale.baseStatus === 'CANCELADA') return false;
  if (sale.installmentPlan?.charges.some((charge) => charge.status === 'PAID')) return false;
  if (!sale.charge) return true;
  return sale.charge.status !== 'PAID';
}

export function SaleDetailSheet({
  open,
  onOpenChange,
  sale,
  onCancel,
  onFulfill,
  onReturn,
  cancelling = false,
  fulfilling = false,
  returning = false,
}: SaleDetailSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl">
        {sale ? (
          <div className="flex h-full flex-col">
            <SheetHeader>
              <div className="flex items-start justify-between gap-4 pr-10">
                <div className="space-y-1">
                  <SheetTitle>{formatSaleNumber(sale.saleNumber)}</SheetTitle>
                  <SheetDescription>
                    {sale.customer.displayName} · {formatDateBR(sale.createdAt)}
                  </SheetDescription>
                </div>
                <SaleStatusBadge status={sale.status} />
              </div>
            </SheetHeader>

            <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
              <section className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Cliente
                  </p>
                  <p className="text-sm font-semibold text-slate-900">
                    {sale.customer.displayName}
                  </p>
                  {sale.customer.alunoName ? (
                    <p className="text-sm text-slate-600">Aluno: {sale.customer.alunoName}</p>
                  ) : null}
                  {sale.customer.responsavelName ? (
                    <p className="text-sm text-slate-600">
                      Responsável: {sale.customer.responsavelName}
                    </p>
                  ) : null}
                  {sale.customer.walkInPhone ? (
                    <p className="text-sm text-slate-600">Telefone: {sale.customer.walkInPhone}</p>
                  ) : null}
                </div>

                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Finalização
                  </p>
                  <p className="text-sm font-semibold text-slate-900">
                    {SALE_FINALIZATION_LABELS[sale.finalizationType]}
                  </p>
                  <p className="text-sm text-slate-600">
                    Estoque: {INVENTORY_STATUS_LABELS[sale.inventoryStatus]}
                  </p>
                  {sale.paymentMethod ? (
                    <p className="text-sm text-slate-600">
                      Método: {SALE_PAYMENT_METHOD_LABELS[sale.paymentMethod]}
                    </p>
                  ) : null}
                  {sale.matricula ? (
                    <p className="text-sm text-slate-600">
                      Matrícula: {sale.matricula.alunoName}
                      {sale.matricula.planoLabel ? ` · ${sale.matricula.planoLabel}` : ''}
                    </p>
                  ) : null}
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white">
                <div className="border-b border-slate-100 px-4 py-3">
                  <h3 className="text-sm font-semibold text-slate-900">Itens</h3>
                </div>
                <div className="divide-y divide-slate-100">
                  {sale.items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
                    >
                      <div>
                        <p className="font-medium text-slate-900">{item.productName}</p>
                        <p className="text-slate-500">
                          Quantidade: {item.quantity}
                          {item.returnedQuantity > 0
                            ? ` · Devolvida: ${item.returnedQuantity}`
                            : ''}
                        </p>
                        {item.totalCostAtSale != null && item.grossProfitAtSale != null ? (
                          <p className="text-xs text-slate-500">
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
                      <div className="text-right">
                        <p className="font-medium text-slate-900">
                          {formatCurrencyBRL(item.subtotal)}
                        </p>
                        <p className="text-slate-500">{formatCurrencyBRL(item.unitPrice)} un.</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Resumo financeiro
                  </p>
                  <div className="mt-3 space-y-2 text-sm text-slate-600">
                    <div className="flex items-center justify-between">
                      <span>Subtotal</span>
                      <span>{formatCurrencyBRL(sale.subtotal)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Desconto</span>
                      <span>{formatCurrencyBRL(sale.discount)}</span>
                    </div>
                    <div className="flex items-center justify-between text-base font-semibold text-slate-900">
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
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Cobrança vinculada
                  </p>
                  {sale.installmentPlan ? (
                    <div className="mt-3 space-y-3 text-sm text-slate-600">
                      <div className="flex items-center justify-between">
                        <span>Parcelamento</span>
                        <span className="font-medium text-slate-900">
                          {sale.installmentPlan.installmentCount}x ·{' '}
                          {CHARGE_STATUS_LABELS[sale.installmentPlan.status] ??
                            sale.installmentPlan.status}
                        </span>
                      </div>
                      {sale.installmentPlan.charges.length > 0 ? (
                        sale.installmentPlan.charges.slice(0, 4).map((charge, index) => (
                          <div
                            key={charge.id}
                            className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span>
                                Parcela {index + 1}/{sale.installmentPlan?.installmentCount}
                              </span>
                              <span className="font-medium text-slate-900">
                                {formatCurrencyBRL(charge.value ?? 0)}
                              </span>
                            </div>
                            <div className="mt-1 flex items-center justify-between gap-3 text-xs text-slate-500">
                              <span>{formatDateBR(charge.dueDate)}</span>
                              <span>{CHARGE_STATUS_LABELS[charge.status] ?? charge.status}</span>
                            </div>
                            {charge.invoiceUrl ? (
                              <Button asChild variant="outline" className="mt-2 h-8 w-full text-xs">
                                <a href={charge.invoiceUrl} target="_blank" rel="noreferrer">
                                  <ExternalLink className="mr-2 h-3.5 w-3.5" /> Abrir parcela
                                </a>
                              </Button>
                            ) : null}
                          </div>
                        ))
                      ) : (
                        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">
                          Parcelas aguardando sincronização do serviço financeiro.
                        </p>
                      )}
                      {sale.installmentPlan.charges.length > 4 ? (
                        <p className="text-xs text-slate-500">
                          +{sale.installmentPlan.charges.length - 4} parcela(s) no detalhe da
                          cobrança.
                        </p>
                      ) : null}
                    </div>
                  ) : sale.charge ? (
                    <div className="mt-3 space-y-2 text-sm text-slate-600">
                      <div className="flex items-center justify-between">
                        <span>Status</span>
                        <span className="font-medium text-slate-900">
                          {CHARGE_STATUS_LABELS[sale.charge.status] ?? sale.charge.status}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Vencimento</span>
                        <span>{formatDateBR(sale.charge.dueDate)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Forma</span>
                        <span>
                          {sale.charge.billingType
                            ? (BILLING_TYPE_LABELS[
                                sale.charge.billingType as keyof typeof BILLING_TYPE_LABELS
                              ] ?? sale.charge.billingType)
                            : '—'}
                        </span>
                      </div>
                      {sale.charge.invoiceUrl ? (
                        <div className="pt-2">
                          <Button asChild variant="outline" className="w-full justify-center">
                            <a href={sale.charge.invoiceUrl} target="_blank" rel="noreferrer">
                              <ExternalLink className="mr-2 h-4 w-4" /> Abrir cobrança
                            </a>
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">
                      Sem cobrança vinculada.
                    </div>
                  )}
                </div>
              </section>

              {sale.cancelReason ? (
                <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  <p className="font-medium">Cancelamento registrado</p>
                  <p className="mt-1">Motivo: {sale.cancelReason}</p>
                </section>
              ) : null}

              <section className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                    <Receipt className="h-4 w-4" /> Auditoria
                  </div>
                  <div className="mt-3 space-y-2 text-sm text-slate-600">
                    <p>Operador: {sale.operator.name}</p>
                    <p>Criada em: {formatDateBR(sale.createdAt)}</p>
                    {sale.updatedAt !== sale.createdAt ? (
                      <p>Atualizada em: {formatDateBR(sale.updatedAt)}</p>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                    <WalletCards className="h-4 w-4" /> Fluxo afetado
                  </div>
                  <p className="mt-3 text-sm text-slate-600">
                    Loja → cobrança → pagamento → estoque
                  </p>
                </div>
              </section>
            </div>

            <div className="border-t border-slate-100 px-6 py-4">
              <div className="flex justify-end gap-3">
                {sale.charge?.invoiceUrl ? (
                  <Button asChild variant="outline">
                    <a href={sale.charge.invoiceUrl} target="_blank" rel="noreferrer">
                      Abrir cobrança
                    </a>
                  </Button>
                ) : null}
                {canCancelSale(sale) ? (
                  <Button
                    variant="outline"
                    className="border-red-200 text-red-700 hover:bg-red-50"
                    disabled={cancelling}
                    onClick={() => onCancel(sale)}
                  >
                    {cancelling ? 'Cancelando...' : 'Cancelar venda'}
                  </Button>
                ) : null}
                {sale.inventoryStatus === 'RESERVED' && onFulfill ? (
                  <Button variant="outline" disabled={fulfilling} onClick={() => onFulfill(sale)}>
                    {fulfilling ? 'Cumprindo...' : 'Cumprir reserva'}
                  </Button>
                ) : null}
                {sale.inventoryStatus !== 'RESERVED' &&
                sale.inventoryStatus !== 'CANCELED' &&
                onReturn ? (
                  <Button variant="outline" disabled={returning} onClick={() => onReturn(sale)}>
                    {returning ? 'Registrando...' : 'Registrar devolução'}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
