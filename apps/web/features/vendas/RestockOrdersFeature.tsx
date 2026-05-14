'use client';

import { useEffect, useMemo, useState } from 'react';
import { RestockOrderStatus } from '@prisma/client';

import {
  Calendar,
  CheckCircle,
  ClipboardDocumentCheck,
  Plus,
  Search,
} from '@/components/icons/icons';
import DataTable, { type DataTableColumn } from '@/components/layout/DataTable';
import TableLayout from '@/components/layout/TableLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

import { listInventoryBalances, type InventoryBalanceItem } from './services/inventory-service';
import {
  cancelRestockOrder,
  createRestockOrder,
  listRestockOrders,
  receiveRestockOrder,
  type RestockOrder,
} from './services/restock-service';
import {
  formatInventoryCurrency,
  formatInventoryDate,
  InventoryMetricCard,
  LabelWithTooltip,
  RESTOCK_STATUS_BADGE_VARIANTS,
  RESTOCK_STATUS_LABELS,
} from './inventory-ui';

function toDateString(value: Date | undefined): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

function buildItemLabel(item: InventoryBalanceItem): string {
  return item.variantTitle ? `${item.productName} · ${item.variantTitle}` : item.productName;
}

function formatOrderItems(order: RestockOrder): string {
  const labels = order.items
    .slice(0, 2)
    .map((item) =>
      item.variantTitle ? `${item.productName} · ${item.variantTitle}` : item.productName,
    );
  const extra = order.items.length > 2 ? ` +${order.items.length - 2}` : '';
  return labels.length > 0 ? `${labels.join(', ')}${extra}` : 'Sem itens';
}

function countExpected(order: RestockOrder): number {
  return order.items.reduce((sum, item) => sum + item.quantityExpected, 0);
}

function countReceived(order: RestockOrder): number {
  return order.items.reduce((sum, item) => sum + item.quantityReceived, 0);
}

function estimateOrderValue(order: RestockOrder): number {
  return order.items.reduce(
    (sum, item) => sum + item.quantityExpected * Number(item.estimatedUnitCost ?? 0),
    0,
  );
}

type DraftRestockItem = {
  targetKey: string;
  quantity: string;
  unitCost: string;
};

export function RestockOrdersFeature() {
  const [orders, setOrders] = useState<RestockOrder[]>([]);
  const [targets, setTargets] = useState<InventoryBalanceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<RestockOrderStatus | 'TODOS'>('TODOS');
  const [createOpen, setCreateOpen] = useState(false);
  const [receiveOrder, setReceiveOrder] = useState<RestockOrder | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [supplierName, setSupplierName] = useState('');
  const [expectedAt, setExpectedAt] = useState<Date | undefined>(undefined);
  const [notes, setNotes] = useState('');
  const [draftItems, setDraftItems] = useState<DraftRestockItem[]>([
    { targetKey: '', quantity: '1', unitCost: '0' },
  ]);
  const [receiptValues, setReceiptValues] = useState<Record<string, string>>({});

  async function loadData() {
    setLoading(true);
    try {
      const [nextOrders, nextTargets] = await Promise.all([
        listRestockOrders({
          search,
          status,
        }),
        listInventoryBalances({
          includeInactive: false,
        }),
      ]);
      setOrders(nextOrders);
      setTargets(nextTargets);
      setDraftItems((current) =>
        current.map((item, index) => ({
          ...item,
          targetKey:
            item.targetKey ||
            nextTargets[index]?.inventoryItemKey ||
            nextTargets[0]?.inventoryItemKey ||
            '',
        })),
      );
    } catch (error) {
      toast.error({ title: 'Erro ao carregar reposições', description: (error as Error).message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, status]);

  function openCreateDialog() {
    setDraftItems((current) =>
      current.length > 0
        ? current.map((item) => ({
            ...item,
            targetKey: item.targetKey || targets[0]?.inventoryItemKey || '',
          }))
        : [{ targetKey: targets[0]?.inventoryItemKey || '', quantity: '1', unitCost: '0' }],
    );
    setCreateOpen(true);
  }

  const columns: DataTableColumn<RestockOrder>[] = [
    {
      id: 'supplier',
      header: 'Reposição',
      width: 'w-[34%]',
      align: 'left',
      noWrap: false,
      render: (order) => (
        <div className="min-w-0 space-y-1">
          <div className="font-normal text-[13px] text-gray-900">
            {order.supplierName || 'Sem fornecedor'}
          </div>
          <div className="text-xs text-gray-500">{formatOrderItems(order)}</div>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      align: 'center',
      width: 'w-[14%]',
      render: (order) => (
        <Badge variant={RESTOCK_STATUS_BADGE_VARIANTS[order.status]} size="sm">
          {RESTOCK_STATUS_LABELS[order.status]}
        </Badge>
      ),
    },
    {
      id: 'expectedAt',
      header: 'Previsão',
      align: 'center',
      width: 'w-[14%]',
      render: (order) => formatInventoryDate(order.expectedAt),
    },
    {
      id: 'received',
      header: 'Recebido',
      align: 'center',
      width: 'w-[14%]',
      render: (order) => `${countReceived(order)}/${countExpected(order)}`,
    },
    {
      id: 'value',
      header: 'Estimado',
      align: 'right',
      width: 'w-[14%]',
      render: (order) => formatInventoryCurrency(estimateOrderValue(order)),
    },
    {
      id: 'actions',
      header: '',
      align: 'right',
      width: 'w-[10%]',
      render: (order) => (
        <div className="flex items-center justify-end gap-2">
          {order.status !== 'RECEBIDO' && order.status !== 'CANCELADO' ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => {
                setReceiveOrder(order);
                setReceiptValues(
                  Object.fromEntries(
                    order.items
                      .filter((item) => item.quantityPending > 0)
                      .map((item) => [item.id, String(item.quantityPending)]),
                  ),
                );
              }}
            >
              Receber
            </Button>
          ) : null}
          {order.status !== 'CANCELADO' && order.status !== 'RECEBIDO' ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-red-700 hover:bg-red-50 hover:text-red-800"
              onClick={async () => {
                try {
                  const updated = await cancelRestockOrder(order.id, 'Cancelada pela operação');
                  setOrders((current) =>
                    current.map((item) => (item.id === updated.id ? updated : item)),
                  );
                  toast.success({
                    title: 'Reposição cancelada',
                    description: 'Os itens pendentes foram removidos de “em compra”.',
                  });
                } catch (error) {
                  toast.error({
                    title: 'Falha ao cancelar',
                    description: (error as Error).message,
                  });
                }
              }}
            >
              Cancelar
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  async function handleCreateOrder() {
    setSubmitting(true);
    try {
      const items = draftItems.map((item) => {
        const target = targets.find((targetItem) => targetItem.inventoryItemKey === item.targetKey);
        if (!target) {
          throw new Error('Selecione um produto válido para a reposição.');
        }
        return {
          productId: target.productId,
          variantId: target.variantId,
          quantity: Number(item.quantity),
          unitCost: Number(item.unitCost),
        };
      });

      const created = await createRestockOrder({
        supplierName: supplierName.trim() || null,
        expectedAt: toDateString(expectedAt),
        notes: notes.trim() || null,
        items,
      });

      toast.success({
        title: 'Reposição criada',
        description: 'A quantidade pendente já aparece como “em compra”.',
      });
      setOrders((current) => [created, ...current]);
      setCreateOpen(false);
      setSupplierName('');
      setExpectedAt(undefined);
      setNotes('');
      setDraftItems([
        { targetKey: targets[0]?.inventoryItemKey || '', quantity: '1', unitCost: '0' },
      ]);
      await loadData();
    } catch (error) {
      toast.error({ title: 'Falha ao criar reposição', description: (error as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReceiveOrder() {
    if (!receiveOrder) return;

    setSubmitting(true);
    try {
      const items = receiveOrder.items
        .map((item) => ({
          itemId: item.id,
          quantityReceived: Number(receiptValues[item.id] ?? 0),
        }))
        .filter((item) => item.quantityReceived > 0);

      if (items.length === 0) {
        throw new Error('Informe ao menos um item recebido.');
      }

      const updated = await receiveRestockOrder(receiveOrder.id, { items });
      setOrders((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setReceiveOrder(null);
      toast.success({
        title: 'Recebimento registrado',
        description: 'O estoque físico foi atualizado e a pendência reduzida.',
      });
      await loadData();
    } catch (error) {
      toast.error({ title: 'Falha ao receber reposição', description: (error as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  const totalIncoming = useMemo(
    () =>
      orders
        .filter((order) => order.status !== 'CANCELADO')
        .reduce(
          (sum, order) =>
            sum + order.items.reduce((inner, item) => inner + item.quantityPending, 0),
          0,
        ),
    [orders],
  );

  const openOrders = useMemo(
    () =>
      orders.filter((order) => order.status !== 'RECEBIDO' && order.status !== 'CANCELADO').length,
    [orders],
  );

  const partialOrders = useMemo(
    () => orders.filter((order) => order.status === 'RECEBIDO_PARCIAL').length,
    [orders],
  );

  return (
    <>
      <TableLayout
        title="Reposições"
        subtitle="Planeje compras antes da chegada e receba parcialmente sem misturar com o estoque físico."
        actions={
          <Button
            type="button"
            className="h-10 bg-brand-accent px-4 text-white shadow-none hover:bg-brand-accent/90"
            onClick={openCreateDialog}
          >
            <Plus className="mr-2 h-4 w-4" />
            Nova reposição
          </Button>
        }
        filtersBar={
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-end">
            <div className="relative w-full md:w-[420px] lg:w-[520px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-10 pl-9"
                placeholder="Buscar por fornecedor ou produto"
              />
            </div>
            <Select
              value={status}
              onValueChange={(value: RestockOrderStatus | 'TODOS') => setStatus(value)}
            >
              <SelectTrigger className="h-10 w-full md:w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TODOS">Todos os status</SelectItem>
                {Object.values(RestockOrderStatus).map((value) => (
                  <SelectItem key={value} value={value}>
                    {RESTOCK_STATUS_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <InventoryMetricCard
            label="Reposições abertas"
            detail="compras ainda não concluídas"
            value={openOrders}
            icon={<ClipboardDocumentCheck className="h-5 w-5" />}
          />
          <InventoryMetricCard
            label="Itens pendentes"
            detail="quantidade ainda em compra"
            value={totalIncoming}
            icon={<Calendar className="h-5 w-5" />}
          />
          <InventoryMetricCard
            label="Recebidas parcialmente"
            detail="compras com saldo pendente"
            value={partialOrders}
            icon={<CheckCircle className="h-5 w-5" />}
          />
        </div>

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <DataTable
            columns={columns}
            data={orders}
            rowKey={(item) => item.id}
            loading={loading}
            emptyMessage={
              <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    Você ainda não tem reposições em aberto.
                  </p>
                  <p className="mt-1 text-sm text-gray-500">
                    Use reposições para planejar compras antes dos produtos chegarem ao estoque.
                  </p>
                </div>
                <Button
                  type="button"
                  className="h-10 bg-brand-accent px-4 text-white hover:bg-brand-accent/90"
                  onClick={openCreateDialog}
                >
                  Criar primeira reposição
                </Button>
              </div>
            }
            ariaLabel="Tabela de reposições"
          />
        </div>
      </TableLayout>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent
          fullScreenMobile
          className="max-w-2xl gap-0 overflow-hidden bg-slate-50 p-0 max-md:flex max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:flex-col max-md:min-h-0 md:rounded-2xl"
        >
          <DialogHeader className="relative shrink-0 space-y-0 border-b border-slate-200 bg-slate-50 px-4 py-4 text-left max-md:pb-4 max-md:pl-4 max-md:pr-14 max-md:pt-[calc(3rem+env(safe-area-inset-top,0px))] md:px-6 md:py-5">
            <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-accent/40 to-transparent" />
            <DialogTitle className="pr-2 text-lg font-semibold text-slate-900 md:pr-0">
              Nova reposição
            </DialogTitle>
            <DialogDescription className="pt-1 text-sm text-slate-600">
              Use quando fez ou planejou uma compra que ainda pode chegar depois.
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden max-md:min-h-0">
            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 max-md:min-h-0 md:px-6 md:py-5">
              <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-500">Fornecedor opcional</label>
                <Input
                  value={supplierName}
                  onChange={(event) => setSupplierName(event.target.value)}
                  placeholder="Ex: Fornecedor ABC"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-500">
                  <LabelWithTooltip tooltip="Data estimada para os itens chegarem fisicamente.">
                    Previsão de chegada
                  </LabelWithTooltip>
                </label>
                <DatePicker value={expectedAt} onChange={setExpectedAt} variant="input" />
              </div>
              </div>
              <div className="space-y-2">
              <label className="text-xs font-medium text-gray-500">Observação opcional</label>
              <Textarea
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Ex: pedido feito por WhatsApp"
              />
              </div>
              <div className="space-y-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
                Produtos da reposição
                <LabelWithTooltip tooltip="Essas quantidades aparecem como “em compra” até serem recebidas.">
                  <span className="sr-only">Ajuda sobre produtos da reposição</span>
                </LabelWithTooltip>
              </div>
              {draftItems.map((item, index) => (
                <div
                  key={`${index}-${item.targetKey}`}
                  className="grid gap-3 rounded-xl border border-gray-200 p-3 md:grid-cols-[1fr,130px,140px,88px]"
                >
                  <Select
                    value={item.targetKey}
                    onValueChange={(value) =>
                      setDraftItems((current) =>
                        current.map((draft, draftIndex) =>
                          draftIndex === index ? { ...draft, targetKey: value } : draft,
                        ),
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o produto" />
                    </SelectTrigger>
                    <SelectContent>
                      {targets.map((target) => (
                        <SelectItem key={target.inventoryItemKey} value={target.inventoryItemKey}>
                          {buildItemLabel(target)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    min="1"
                    value={item.quantity}
                    onChange={(event) =>
                      setDraftItems((current) =>
                        current.map((draft, draftIndex) =>
                          draftIndex === index ? { ...draft, quantity: event.target.value } : draft,
                        ),
                      )
                    }
                    placeholder="Quantidade"
                  />
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.unitCost}
                    onChange={(event) =>
                      setDraftItems((current) =>
                        current.map((draft, draftIndex) =>
                          draftIndex === index ? { ...draft, unitCost: event.target.value } : draft,
                        ),
                      )
                    }
                    placeholder="Custo unit."
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={draftItems.length === 1}
                    onClick={() =>
                      setDraftItems((current) =>
                        current.filter((_, draftIndex) => draftIndex !== index),
                      )
                    }
                  >
                    Remover
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setDraftItems((current) => [
                    ...current,
                    { targetKey: targets[0]?.inventoryItemKey || '', quantity: '1', unitCost: '0' },
                  ])
                }
              >
                Adicionar produto
              </Button>
              </div>
            </div>
            <div className="flex shrink-0 flex-col-reverse gap-3 border-t border-slate-200 bg-slate-50 px-4 py-4 md:flex-row md:items-center md:justify-end md:gap-3 md:px-6 md:py-4">
              <Button
                type="button"
                variant="outline"
                className="h-11 min-h-11 w-full border-slate-200 bg-white shadow-none hover:bg-slate-100 md:h-10 md:min-h-0 md:w-auto"
                onClick={() => setCreateOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                disabled={submitting}
                onClick={() => void handleCreateOrder()}
                className="h-11 min-h-11 w-full bg-brand-accent text-white shadow-none hover:bg-brand-accent/90 md:h-10 md:min-h-0 md:w-auto md:min-w-[180px]"
              >
                Criar reposição
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(receiveOrder)} onOpenChange={(open) => !open && setReceiveOrder(null)}>
        <DialogContent
          fullScreenMobile
          className="max-w-2xl gap-0 overflow-hidden bg-slate-50 p-0 max-md:flex max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:flex-col max-md:min-h-0 md:rounded-2xl"
        >
          <DialogHeader className="relative shrink-0 space-y-0 border-b border-slate-200 bg-slate-50 px-4 py-4 text-left max-md:pb-4 max-md:pl-4 max-md:pr-14 max-md:pt-[calc(3rem+env(safe-area-inset-top,0px))] md:px-6 md:py-5">
            <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-accent/40 to-transparent" />
            <DialogTitle className="pr-2 text-lg font-semibold text-slate-900 md:pr-0">
              Receber reposição
            </DialogTitle>
            <DialogDescription className="pt-1 text-sm text-slate-600">
              Informe apenas o que chegou fisicamente agora. Recebimentos parciais continuam
              pendentes para depois.
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden max-md:min-h-0">
            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 max-md:min-h-0 md:px-6 md:py-5">
              {receiveOrder?.items
                .filter((item) => item.quantityPending > 0)
                .map((item) => (
                  <div
                    key={item.id}
                    className="grid gap-3 rounded-xl border border-gray-200 p-3 md:grid-cols-[1fr,150px,150px]"
                  >
                    <div>
                      <div className="font-normal text-[13px] text-gray-900">
                        {item.productName}
                        {item.variantTitle ? ` · ${item.variantTitle}` : ''}
                      </div>
                      <div className="text-xs text-gray-500">Pendente: {item.quantityPending}</div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-gray-500">Recebido agora</label>
                      <Input
                        type="number"
                        min="0"
                        max={item.quantityPending}
                        value={receiptValues[item.id] ?? '0'}
                        onChange={(event) =>
                          setReceiptValues((current) => ({
                            ...current,
                            [item.id]: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1 text-sm text-gray-500">
                      <span className="block text-xs font-medium text-gray-500">Custo estimado</span>
                      <span>{formatInventoryCurrency(Number(item.estimatedUnitCost ?? 0))}</span>
                    </div>
                  </div>
                ))}
            </div>
            <div className="flex shrink-0 flex-col-reverse gap-3 border-t border-slate-200 bg-slate-50 px-4 py-4 md:flex-row md:items-center md:justify-end md:gap-3 md:px-6 md:py-4">
              <Button
                type="button"
                variant="outline"
                className="h-11 min-h-11 w-full border-slate-200 bg-white shadow-none hover:bg-slate-100 md:h-10 md:min-h-0 md:w-auto"
                onClick={() => setReceiveOrder(null)}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                disabled={submitting}
                onClick={() => void handleReceiveOrder()}
                className="h-11 min-h-11 w-full bg-brand-accent text-white shadow-none hover:bg-brand-accent/90 md:h-10 md:min-h-0 md:w-auto md:min-w-[200px]"
              >
                <CheckCircle className="mr-2 h-4 w-4" />
                Confirmar recebimento
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default RestockOrdersFeature;
