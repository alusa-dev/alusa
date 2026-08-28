'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { cn } from '@/lib/cn';

import {
  CheckCircle,
  ClipboardDocumentCheck,
  Clock,
  DollarSign,
  Edit3,
  Eye,
  Filter,
  Plus,
  RectangleStack,
  Refresh,
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
import { Input } from '@/components/ui/input';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

import {
  adjustInventory,
  listInventoryBalances,
  registerInventoryEntry,
  type InventoryBalanceItem,
} from './services/inventory-service';
import {
  formatInventoryCurrency,
  formatSignedQuantity,
  InventoryMetricCard,
  LabelWithTooltip,
} from './inventory-ui';

const ALERT_LABELS: Record<InventoryBalanceItem['alertState'], string> = {
  OUT: 'Sem estoque',
  LOW: 'Baixo',
  OK: 'Normal',
};

const ALERT_VARIANTS: Record<
  InventoryBalanceItem['alertState'],
  'destructive' | 'warning' | 'success'
> = {
  OUT: 'destructive',
  LOW: 'warning',
  OK: 'success',
};

const ADJUST_REASON_LABELS = {
  COUNT: 'Contagem física',
  LOSS: 'Perda',
  DAMAGE: 'Avaria',
  CORRECTION: 'Correção operacional',
} as const;

function buildItemLabel(item: InventoryBalanceItem): string {
  return item.variantTitle ? `${item.productName} · ${item.variantTitle}` : item.productName;
}

type InventoryVariantGroup = {
  key: string;
  productId: string;
  productName: string;
  variantName: string;
  items: InventoryBalanceItem[];
  onHand: number;
  reserved: number;
  available: number;
  incoming: number;
  inventoryValue: number;
  alertState: InventoryBalanceItem['alertState'];
};

type InventoryAlertFilter = 'ALL' | InventoryBalanceItem['alertState'];

function getVariantAttributes(item: InventoryBalanceItem): Array<{ name: string; value: string }> {
  if (!item.variantId) return [{ name: 'Nenhuma', value: 'Nenhuma' }];
  if (item.variantAttributes?.length) return item.variantAttributes;

  const parts = item.variantTitle?.split('·').map((part) => part.trim()).filter(Boolean) ?? [];
  if (parts.length > 1) {
    return [{ name: parts[0], value: parts.slice(1).join(' · ') }];
  }

  return [{ name: 'Variante', value: item.variantTitle || 'Principal' }];
}

function groupInventoryBalances(items: InventoryBalanceItem[]): InventoryVariantGroup[] {
  const groups = new Map<string, InventoryVariantGroup>();

  items.forEach((item) => {
    const variantName = getVariantAttributes(item)[0]?.name || 'Variante';
    const key = `${item.productId}:${variantName}`;
    const current = groups.get(key);

    if (current) {
      current.items.push(item);
      current.onHand += item.onHand;
      current.reserved += item.reserved;
      current.available += item.available;
      current.incoming += item.incoming;
      current.inventoryValue += item.inventoryValue;
      const threshold = current.items.reduce((sum, entry) => sum + entry.lowStockThreshold, 0);
      current.alertState =
        current.available <= 0 ? 'OUT' : current.available <= threshold ? 'LOW' : 'OK';
      return;
    }

    const threshold = item.lowStockThreshold;
    groups.set(key, {
      key,
      productId: item.productId,
      productName: item.productName,
      variantName,
      items: [item],
      onHand: item.onHand,
      reserved: item.reserved,
      available: item.available,
      incoming: item.incoming,
      inventoryValue: item.inventoryValue,
      alertState: item.available <= 0 ? 'OUT' : item.available <= threshold ? 'LOW' : 'OK',
    });
  });

  return Array.from(groups.values());
}

function normalizeNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function calculateStockSaleValue(item: InventoryBalanceItem): number {
  return item.onHand * (item.price ?? 0);
}

function InventoryProductAutocomplete({
  items,
  value,
  onChange,
  placeholder = 'Pesquise um produto',
}: {
  items: InventoryBalanceItem[];
  value: string;
  onChange: (_value: string) => void;
  placeholder?: string;
}) {
  const selected = items.find((item) => item.inventoryItemKey === value) ?? null;
  const [query, setQuery] = useState(selected ? buildItemLabel(selected) : '');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) setQuery(selected ? buildItemLabel(selected) : '');
  }, [open, selected]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR');
    if (!normalizedQuery) return items.slice(0, 8);
    return items
      .filter((item) => buildItemLabel(item).toLocaleLowerCase('pt-BR').includes(normalizedQuery))
      .slice(0, 8);
  }, [items, query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={query}
            placeholder={placeholder}
            className="h-10 rounded-lg border-slate-200 bg-white pl-10 text-sm shadow-none placeholder:text-slate-400 focus-visible:border-brand-accent focus-visible:ring-brand-accent/20"
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
              if (!event.target.value.trim()) onChange('');
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setOpen(false);
            }}
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls="inventory-product-suggestions"
          />
        </div>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] overflow-hidden p-1"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div id="inventory-product-suggestions" role="listbox" className="max-h-64 overflow-y-auto">
          {filteredItems.length === 0 ? (
            <p className="px-3 py-2 text-sm text-slate-500">Nenhum produto encontrado.</p>
          ) : (
            filteredItems.map((item) => (
              <button
                key={item.inventoryItemKey}
                type="button"
                role="option"
                aria-selected={item.inventoryItemKey === value}
                className={cn(
                  'flex w-full items-center rounded-md px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-purple-50 hover:text-slate-900',
                  item.inventoryItemKey === value && 'bg-purple-50 font-medium text-slate-900',
                )}
                onClick={() => {
                  onChange(item.inventoryItemKey);
                  setQuery(buildItemLabel(item));
                  setOpen(false);
                }}
              >
                {buildItemLabel(item)}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function InventoryFeature() {
  const searchParams = useSearchParams();
  const presetProductId = searchParams.get('productId') || undefined;
  const presetVariantId = searchParams.get('variantId') || undefined;

  const [balances, setBalances] = useState<InventoryBalanceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [alertFilter, setAlertFilter] = useState<InventoryAlertFilter>('ALL');
  const [entryOpen, setEntryOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<InventoryVariantGroup | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [entryForm, setEntryForm] = useState({
    targetKey: '',
    quantity: '1',
    unitCost: '0',
    supplierName: '',
    reason: '',
  });
  const [adjustForm, setAdjustForm] = useState({
    targetKey: '',
    mode: 'SET' as 'SET' | 'DELTA',
    quantity: '0',
    reasonCode: 'COUNT' as keyof typeof ADJUST_REASON_LABELS,
    note: '',
  });

  const selectedEntryTarget = useMemo(
    () => balances.find((item) => item.inventoryItemKey === entryForm.targetKey) ?? null,
    [balances, entryForm.targetKey],
  );
  const selectedAdjustTarget = useMemo(
    () => balances.find((item) => item.inventoryItemKey === adjustForm.targetKey) ?? null,
    [balances, adjustForm.targetKey],
  );

  async function loadData() {
    setLoading(true);
    try {
      const nextBalances = await listInventoryBalances({
        search,
        alertState: alertFilter === 'ALL' ? undefined : alertFilter,
        productId: presetProductId,
        variantId: presetVariantId,
      });

      setBalances(nextBalances);

      setEntryForm((current) => ({
        ...current,
        targetKey: current.targetKey || nextBalances[0]?.inventoryItemKey || '',
      }));
      setAdjustForm((current) => ({
        ...current,
        targetKey: current.targetKey || nextBalances[0]?.inventoryItemKey || '',
        quantity:
          current.quantity !== '0' ? current.quantity : String(nextBalances[0]?.onHand ?? 0),
      }));
    } catch (error) {
      toast.error({ title: 'Erro ao carregar estoque', description: (error as Error).message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, alertFilter, presetProductId, presetVariantId]);

  const totals = useMemo(
    () =>
      balances.reduce(
        (acc, item) => ({
          onHand: acc.onHand + item.onHand,
          reserved: acc.reserved + item.reserved,
          available: acc.available + item.available,
          incoming: acc.incoming + item.incoming,
          value: acc.value + calculateStockSaleValue(item),
        }),
        { onHand: 0, reserved: 0, available: 0, incoming: 0, value: 0 },
      ),
    [balances],
  );
  const groupedBalances = useMemo(() => groupInventoryBalances(balances), [balances]);

  const entryQuantity = normalizeNumber(entryForm.quantity);
  const entryNewBalance = selectedEntryTarget ? selectedEntryTarget.onHand + entryQuantity : 0;
  const adjustQuantity = normalizeNumber(adjustForm.quantity);
  const adjustNewBalance = selectedAdjustTarget
    ? adjustForm.mode === 'SET'
      ? adjustQuantity
      : selectedAdjustTarget.onHand + adjustQuantity
    : 0;
  const adjustChange = selectedAdjustTarget ? adjustNewBalance - selectedAdjustTarget.onHand : 0;

  function openEntryDialog() {
    const target = selectedEntryTarget ?? balances[0];
    setEntryForm((current) => ({
      ...current,
      targetKey: current.targetKey || target?.inventoryItemKey || '',
      quantity: current.quantity || '1',
    }));
    setEntryOpen(true);
  }

  function openAdjustDialog() {
    const target = selectedAdjustTarget ?? balances[0];
    setAdjustForm((current) => ({
      ...current,
      targetKey: current.targetKey || target?.inventoryItemKey || '',
      mode: 'SET',
      quantity: String(target?.onHand ?? 0),
    }));
    setAdjustOpen(true);
  }

  function handleAdjustTargetChange(value: string) {
    const target = balances.find((item) => item.inventoryItemKey === value);
    setAdjustForm((current) => ({
      ...current,
      targetKey: value,
      quantity: current.mode === 'SET' ? String(target?.onHand ?? 0) : current.quantity,
    }));
  }

  function handleAdjustModeChange(value: 'SET' | 'DELTA') {
    setAdjustForm((current) => ({
      ...current,
      mode: value,
      quantity: value === 'SET' ? String(selectedAdjustTarget?.onHand ?? 0) : '0',
    }));
  }

  function openAdjustForItem(item: InventoryBalanceItem) {
    setAdjustForm((current) => ({
      ...current,
      targetKey: item.inventoryItemKey,
      mode: 'SET',
      quantity: String(item.onHand),
    }));
    setSelectedGroup(null);
    setAdjustOpen(true);
  }

  const columns: DataTableColumn<InventoryVariantGroup>[] = [
    {
      id: 'item',
      header: 'Produto',
      width: 'min-w-0 lg:w-[30%]',
      align: 'left',
      render: (item) => (
        <span className="font-medium text-[13px] text-gray-900">{item.productName}</span>
      ),
    },
    {
      id: 'variant',
      header: 'Variante',
      align: 'left',
      width: 'min-w-0 lg:w-[26%]',
      render: (item) => (
        <button
          type="button"
          className="font-medium text-gray-900 transition hover:text-brand-accent"
          onClick={() => setSelectedGroup(item)}
        >
          {item.variantName}
        </button>
      ),
    },
    {
      id: 'onHand',
      header: 'Em estoque',
      align: 'right',
      width: 'lg:w-[14%]',
      render: (item) => item.onHand,
    },
    {
      id: 'available',
      header: 'Disponível',
      align: 'right',
      width: 'lg:w-[14%]',
      render: (item) => item.available,
    },
    {
      id: 'alert',
      header: 'Alerta',
      align: 'center',
      width: 'w-[6rem] lg:w-[12%]',
      render: (item) => (
        <Badge variant={ALERT_VARIANTS[item.alertState]} size="sm">
          {ALERT_LABELS[item.alertState]}
        </Badge>
      ),
    },
    {
      id: 'actions',
      header: 'Ações',
      align: 'right',
      width: 'lg:w-[14%]',
      render: (item) => (
        <button
          type="button"
          className="ml-auto flex size-8 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
          aria-label={`Ver detalhes de ${item.productName} ${item.variantName}`}
          onClick={() => setSelectedGroup(item)}
        >
          <Eye className="size-4" />
        </button>
      ),
    },
  ];

  async function handleRegisterEntry() {
    if (!selectedEntryTarget) {
      toast.warning({ title: 'Item obrigatório', description: 'Selecione um item do estoque.' });
      return;
    }

    setSubmitting(true);
    try {
      await registerInventoryEntry({
        productId: selectedEntryTarget.productId,
        variantId: selectedEntryTarget.variantId,
        quantity: Number(entryForm.quantity),
        unitCost: Number(entryForm.unitCost),
        supplierName: entryForm.supplierName.trim() || null,
        reason: entryForm.reason.trim() || null,
      });
      toast.success({
        title: 'Estoque adicionado',
        description: 'O saldo físico foi atualizado e o movimento ficou registrado.',
      });
      setEntryOpen(false);
      setEntryForm((current) => ({
        ...current,
        quantity: '1',
        unitCost: '0',
        supplierName: '',
        reason: '',
      }));
      await loadData();
    } catch (error) {
      toast.error({ title: 'Falha ao adicionar estoque', description: (error as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAdjustInventory() {
    if (!selectedAdjustTarget) {
      toast.warning({ title: 'Item obrigatório', description: 'Selecione um item do estoque.' });
      return;
    }

    setSubmitting(true);
    try {
      await adjustInventory({
        productId: selectedAdjustTarget.productId,
        variantId: selectedAdjustTarget.variantId,
        mode: adjustForm.mode,
        quantity: Number(adjustForm.quantity),
        reasonCode: adjustForm.reasonCode,
        note: adjustForm.note.trim() || null,
      });
      toast.success({
        title: 'Contagem corrigida',
        description: 'A mudança ficou registrada no histórico de estoque.',
      });
      setAdjustOpen(false);
      await loadData();
    } catch (error) {
      toast.error({ title: 'Falha ao corrigir estoque', description: (error as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <TableLayout
        title="Estoque"
        subtitle="Acompanhe estoque físico, reservas e compras pendentes com histórico automático."
        actions={
          <div className="flex w-full flex-col gap-2 lg:flex-row lg:flex-wrap lg:justify-end">
            <Button
              type="button"
              className="h-10 w-full bg-brand-accent px-4 text-white shadow-none hover:bg-brand-accent/90 lg:w-auto"
              onClick={openEntryDialog}
            >
              <Plus className="mr-2 h-4 w-4" />
              Adicionar estoque
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-10 w-full bg-white px-4 shadow-none lg:w-auto"
              onClick={openAdjustDialog}
            >
              <Refresh className="mr-2 h-4 w-4" />
              Corrigir contagem
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-10 w-full bg-white px-4 shadow-none lg:w-auto"
              asChild
            >
              <Link href="/vendas/estoque/historico">
                <Clock className="mr-2 h-4 w-4" />
                Ver histórico
              </Link>
            </Button>
          </div>
        }
        filtersBar={
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-end">
            <div className="relative w-full lg:w-[400px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-10 pl-9"
                placeholder="Buscar por produto, variante ou SKU"
              />
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant={alertFilter === 'ALL' ? 'outline' : 'default'}
                  className="h-10 w-full whitespace-nowrap px-4 shadow-none lg:w-auto"
                  aria-label="Abrir filtros de estoque"
                >
                  <Filter className="mr-2 h-4 w-4" />
                  Filtro
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 rounded-xl border-slate-200 p-3">
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Filtrar estoque</p>
                    <p className="mt-0.5 text-xs text-slate-500">Escolha uma situação.</p>
                  </div>
                  <div className="space-y-1" role="radiogroup" aria-label="Situação do estoque">
                    {(
                      [
                        ['ALL', 'Todos'],
                        ['LOW', 'Estoque baixo'],
                        ['OUT', 'Sem estoque'],
                      ] as const
                    ).map(([value, label]) => (
                      <PopoverClose key={value} asChild>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={alertFilter === value}
                          className={cn(
                            'flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition-colors',
                            alertFilter === value
                              ? 'bg-brand-accent/10 font-medium text-brand-accent'
                              : 'text-slate-700 hover:bg-slate-50',
                          )}
                          onClick={() => setAlertFilter(value)}
                        >
                          {label}
                        </button>
                      </PopoverClose>
                    ))}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <InventoryMetricCard
            label="Em estoque"
            detail="quantidade física agora"
            value={totals.onHand}
            icon={<RectangleStack className="h-5 w-5" />}
          />
          <InventoryMetricCard
            label="Reservado"
            detail="separado para vendas"
            value={totals.reserved}
            icon={<ClipboardDocumentCheck className="h-5 w-5" />}
          />
          <InventoryMetricCard
            label="Disponível"
            detail="pode ser vendido agora"
            value={totals.available}
            icon={<CheckCircle className="h-5 w-5" />}
          />
          <InventoryMetricCard
            label="Em compra"
            detail="reposição ainda não recebida"
            value={totals.incoming}
            icon={<Plus className="h-5 w-5" />}
          />
          <InventoryMetricCard
            label="Valor em estoque"
            detail="valor total pelo preço de venda"
            value={formatInventoryCurrency(totals.value)}
            icon={<DollarSign className="h-5 w-5" />}
          />
        </div>

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <DataTable
            columns={columns}
            data={groupedBalances}
            rowKey={(item) => item.key}
            loading={loading}
            onRowClick={(group) => setSelectedGroup(group)}
            emptyMessage={
              <div className="px-6 py-12 text-center text-sm text-gray-500">
                Nenhum item de estoque encontrado.
              </div>
            }
            ariaLabel="Tabela de estoque"
          />
        </div>
      </TableLayout>

      <Dialog
        open={!!selectedGroup}
        onOpenChange={(open) => {
          if (!open) setSelectedGroup(null);
        }}
      >
        <DialogContent className="flex max-h-[640px] max-w-4xl flex-col gap-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 max-md:max-h-[calc(100dvh-1rem)]">
          <div className="shrink-0 px-6 pb-0 pt-4">
            <DialogTitle className="text-xl font-semibold text-slate-900">
              Detalhes da variante
            </DialogTitle>
            <DialogDescription className="mt-1 text-sm text-slate-500">
              {selectedGroup?.productName} · {selectedGroup?.variantName}
            </DialogDescription>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-5 pt-3">
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full table-fixed whitespace-nowrap text-sm">
                <colgroup>
                  <col className="w-[28%]" />
                  <col className="w-[20%]" />
                  <col className="w-[18%]" />
                  <col className="w-[24%]" />
                  <col className="w-[10%]" />
                </colgroup>
                <thead className="sticky top-0 z-10 bg-slate-50">
                  <tr className="border-b border-slate-100 text-left">
                    <th className="px-6 py-3 text-xs font-medium text-slate-500">Produto</th>
                    <th className="px-3 py-3 text-xs font-medium text-slate-500">Valor</th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-slate-500">
                      Estoque
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-slate-500">
                      Disponibilidade
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-slate-500">
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {selectedGroup?.items.map((item) => {
                    const attributes = getVariantAttributes(item);
                    const valueAttributes = attributes.slice(1);
                    const valueLabel = valueAttributes.length
                      ? valueAttributes
                          .map((attribute) => `${attribute.name}: ${attribute.value}`)
                          .join(' · ')
                      : attributes[0]?.value ?? item.variantTitle ?? 'Principal';
                    const isOut = item.available <= 0;
                    const isLow = !isOut && item.available <= item.lowStockThreshold;
                    const trackClass = isOut
                      ? 'bg-red-100'
                      : isLow
                        ? 'bg-amber-100'
                        : 'bg-emerald-100';
                    const barClass = isOut
                      ? 'bg-red-500'
                      : isLow
                        ? 'bg-amber-500'
                        : 'bg-emerald-500';
                    const barWidth = isOut ? '0%' : isLow ? '42%' : '100%';

                    return (
                      <tr
                        key={item.id}
                        className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50"
                        onClick={() => openAdjustForItem(item)}
                      >
                        <td className="px-6 py-4 align-middle font-medium text-slate-900">
                          {item.productName} · {selectedGroup.variantName}
                        </td>
                        <td className="px-3 py-4 align-middle text-slate-700">{valueLabel}</td>
                        <td className="px-3 py-4 text-right align-middle">
                          <span className="font-semibold tabular-nums text-slate-900">
                            {item.available} disponível
                          </span>
                        </td>
                        <td className="px-3 py-4 align-middle">
                          <div className={`h-2 w-full rounded-full ${trackClass}`}>
                            <div
                              className={`h-full rounded-full ${barClass}`}
                              style={{ width: barWidth }}
                            />
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right align-middle">
                          <button
                            type="button"
                            className="ml-auto flex size-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                            aria-label={`Ajustar estoque de ${item.productName} ${valueLabel}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              openAdjustForItem(item);
                            }}
                          >
                            <Edit3 className="size-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={entryOpen} onOpenChange={setEntryOpen}>
        <DialogContent
          fullScreenMobile
          className="max-w-2xl gap-0 overflow-hidden bg-slate-50 p-0 max-md:flex max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:flex-col max-md:min-h-0 md:rounded-2xl"
        >
          <DialogHeader className="relative shrink-0 space-y-0 border-b border-slate-200 bg-slate-50 px-4 py-4 text-left max-md:pb-4 max-md:pl-4 max-md:pr-14 max-md:pt-[calc(3rem+env(safe-area-inset-top,0px))] md:px-6 md:py-5">
            <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-accent/40 to-transparent" />
            <DialogTitle className="pr-2 text-lg font-semibold text-slate-900 md:pr-0">
              Adicionar estoque
            </DialogTitle>
            <DialogDescription className="pt-1 text-sm text-slate-600">
              Use quando novos itens chegaram ao estoque.
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden max-md:min-h-0">
            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 max-md:min-h-0 md:px-6 md:py-5">
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-600">Produto</label>
              <InventoryProductAutocomplete
                items={balances}
                value={entryForm.targetKey}
                onChange={(value) => setEntryForm((current) => ({ ...current, targetKey: value }))}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-600">Quantidade recebida</label>
                <Input
                  type="number"
                  className="h-10 rounded-lg border-slate-200 bg-white shadow-none focus-visible:border-brand-accent focus-visible:ring-brand-accent/20"
                  min="1"
                  value={entryForm.quantity}
                  onChange={(event) =>
                    setEntryForm((current) => ({ ...current, quantity: event.target.value }))
                  }
                  placeholder="Ex: 12 unidades"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-600">
                  <LabelWithTooltip tooltip="Valor pago por unidade nesta entrada. Ajuda a calcular o custo médio.">
                    Custo unitário
                  </LabelWithTooltip>
                </label>
                <Input
                  type="number"
                  className="h-10 rounded-lg border-slate-200 bg-white shadow-none focus-visible:border-brand-accent focus-visible:ring-brand-accent/20"
                  min="0"
                  step="0.01"
                  value={entryForm.unitCost}
                  onChange={(event) =>
                    setEntryForm((current) => ({ ...current, unitCost: event.target.value }))
                  }
                  placeholder="Ex: 89,90"
                />
              </div>
            </div>
            {selectedEntryTarget ? (
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-600">
                Saldo atual:{' '}
                <span className="font-semibold text-gray-900">{selectedEntryTarget.onHand}</span>
                {' → '}
                Novo saldo: <span className="font-semibold text-gray-900">{entryNewBalance}</span>
              </div>
            ) : null}
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-600">Fornecedor opcional</label>
              <Input
                value={entryForm.supplierName}
                className="h-10 rounded-lg border-slate-200 bg-white text-sm shadow-none placeholder:text-slate-400 focus-visible:border-brand-accent focus-visible:ring-brand-accent/20"
                onChange={(event) =>
                  setEntryForm((current) => ({ ...current, supplierName: event.target.value }))
                }
                placeholder="Ex: Fornecedor ABC"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-600">Observação opcional</label>
              <Textarea
                rows={3}
                value={entryForm.reason}
                className="min-h-24 rounded-lg border-slate-200 bg-white text-sm shadow-none placeholder:text-slate-400 focus-visible:border-brand-accent focus-visible:ring-brand-accent/20"
                onChange={(event) =>
                  setEntryForm((current) => ({ ...current, reason: event.target.value }))
                }
                placeholder="Ex: compra recebida pela secretaria"
              />
            </div>
            </div>
            <div className="flex shrink-0 flex-col-reverse gap-3 border-t border-slate-200 bg-slate-50 px-4 py-4 md:flex-row md:items-center md:justify-end md:gap-3 md:px-6 md:py-4">
              <Button
                type="button"
                variant="outline"
                className="h-11 min-h-11 w-full border-slate-200 bg-white shadow-none hover:bg-slate-100 md:h-10 md:min-h-0 md:w-auto"
                onClick={() => setEntryOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                disabled={submitting}
                onClick={() => void handleRegisterEntry()}
                className="h-11 min-h-11 w-full bg-brand-accent text-white shadow-none hover:bg-brand-accent/90 md:h-10 md:min-h-0 md:w-auto md:min-w-[180px]"
              >
                Adicionar ao estoque
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent
          fullScreenMobile
          className="max-w-2xl gap-0 overflow-hidden bg-slate-50 p-0 max-md:flex max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:flex-col max-md:min-h-0 md:rounded-2xl"
        >
          <DialogHeader className="relative shrink-0 space-y-0 border-b border-slate-200 bg-slate-50 px-4 py-4 text-left max-md:pb-4 max-md:pl-4 max-md:pr-14 max-md:pt-[calc(3rem+env(safe-area-inset-top,0px))] md:px-6 md:py-5">
            <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-accent/40 to-transparent" />
            <DialogTitle className="pr-2 text-lg font-semibold text-slate-900 md:pr-0">
              Corrigir contagem
            </DialogTitle>
            <DialogDescription className="pt-1 text-sm text-slate-600">
              Use quando o estoque físico contado for diferente do sistema.
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden max-md:min-h-0">
            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 max-md:min-h-0 md:px-6 md:py-5">
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-600">Produto</label>
              <InventoryProductAutocomplete
                items={balances}
                value={adjustForm.targetKey}
                onChange={handleAdjustTargetChange}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-600">
                  <LabelWithTooltip tooltip="Na maioria dos casos, informe a quantidade contada. Use mudança manual somente quando quiser somar ou subtrair uma diferença específica.">
                    Forma de correção
                  </LabelWithTooltip>
                </label>
                <Select value={adjustForm.mode} onValueChange={handleAdjustModeChange}>
                  <SelectTrigger className="h-10 rounded-lg border-slate-200 bg-white shadow-none focus:ring-brand-accent/20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SET">Quantidade contada</SelectItem>
                    <SelectItem value="DELTA">Mudança manual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-600">
                  {adjustForm.mode === 'SET' ? (
                    'Quantidade contada agora'
                  ) : (
                    <LabelWithTooltip tooltip="Mudança é a diferença aplicada ao estoque. Exemplo: -2 reduz duas unidades; +3 adiciona três unidades.">
                      Mudança no estoque
                    </LabelWithTooltip>
                  )}
                </label>
                <Input
                  type="number"
                  className="h-10 rounded-lg border-slate-200 bg-white shadow-none focus-visible:border-brand-accent focus-visible:ring-brand-accent/20"
                  value={adjustForm.quantity}
                  onChange={(event) =>
                    setAdjustForm((current) => ({ ...current, quantity: event.target.value }))
                  }
                  placeholder={adjustForm.mode === 'SET' ? 'Ex: 45' : 'Ex: -2'}
                />
              </div>
            </div>
            {selectedAdjustTarget ? (
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-600">
                Saldo atual:{' '}
                <span className="font-semibold text-gray-900">{selectedAdjustTarget.onHand}</span>
                {' → '}
                Novo saldo: <span className="font-semibold text-gray-900">{adjustNewBalance}</span>
                {' | '}
                Mudança:{' '}
                <span
                  className={
                    adjustChange >= 0
                      ? 'font-semibold text-emerald-700'
                      : 'font-semibold text-red-700'
                  }
                >
                  {formatSignedQuantity(adjustChange)}
                </span>
              </div>
            ) : null}
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-600">Motivo</label>
              <Select
                value={adjustForm.reasonCode}
                onValueChange={(value: keyof typeof ADJUST_REASON_LABELS) =>
                  setAdjustForm((current) => ({ ...current, reasonCode: value }))
                }
              >
                <SelectTrigger className="h-10 rounded-lg border-slate-200 bg-white shadow-none focus:ring-brand-accent/20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ADJUST_REASON_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-600">Observação opcional</label>
              <Textarea
                rows={3}
                value={adjustForm.note}
                className="min-h-24 rounded-lg border-slate-200 bg-white text-sm shadow-none placeholder:text-slate-400 focus-visible:border-brand-accent focus-visible:ring-brand-accent/20"
                onChange={(event) =>
                  setAdjustForm((current) => ({ ...current, note: event.target.value }))
                }
                placeholder="Ex: contagem feita no fechamento do dia"
              />
            </div>
            </div>
            <div className="flex shrink-0 flex-col-reverse gap-3 border-t border-slate-200 bg-slate-50 px-4 py-4 md:flex-row md:items-center md:justify-end md:gap-3 md:px-6 md:py-4">
              <Button
                type="button"
                variant="outline"
                className="h-11 min-h-11 w-full border-slate-200 bg-white shadow-none hover:bg-slate-100 md:h-10 md:min-h-0 md:w-auto"
                onClick={() => setAdjustOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                disabled={submitting}
                onClick={() => void handleAdjustInventory()}
                className="h-11 min-h-11 w-full bg-brand-accent text-white shadow-none hover:bg-brand-accent/90 md:h-10 md:min-h-0 md:w-auto md:min-w-[160px]"
              >
                Salvar correção
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default InventoryFeature;
