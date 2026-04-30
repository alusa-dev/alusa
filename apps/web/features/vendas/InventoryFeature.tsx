'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import {
  CheckCircle,
  ClipboardDocumentCheck,
  Clock,
  DollarSign,
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

function normalizeNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function InventoryFeature() {
  const searchParams = useSearchParams();
  const presetProductId = searchParams.get('productId') || undefined;
  const presetVariantId = searchParams.get('variantId') || undefined;

  const [balances, setBalances] = useState<InventoryBalanceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
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
        lowOnly,
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
  }, [search, lowOnly, presetProductId, presetVariantId]);

  const totals = useMemo(
    () =>
      balances.reduce(
        (acc, item) => ({
          onHand: acc.onHand + item.onHand,
          reserved: acc.reserved + item.reserved,
          available: acc.available + item.available,
          incoming: acc.incoming + item.incoming,
          value: acc.value + item.inventoryValue,
        }),
        { onHand: 0, reserved: 0, available: 0, incoming: 0, value: 0 },
      ),
    [balances],
  );

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

  const columns: DataTableColumn<InventoryBalanceItem>[] = [
    {
      id: 'item',
      header: 'Produto',
      width: 'w-[34%]',
      align: 'left',
      noWrap: false,
      render: (item) => (
        <div className="min-w-0 space-y-1">
          <div className="font-normal text-[13px] text-gray-900">{buildItemLabel(item)}</div>
          <div className="text-xs text-gray-500">
            {item.sku ? `SKU ${item.sku}` : 'Sem SKU'}
            {item.categoryName ? ` · ${item.categoryName}` : ''}
          </div>
        </div>
      ),
    },
    {
      id: 'onHand',
      header: 'Em estoque',
      align: 'right',
      width: 'w-[10%]',
      render: (item) => item.onHand,
    },
    {
      id: 'reserved',
      header: 'Reservado',
      align: 'right',
      width: 'w-[10%]',
      render: (item) => item.reserved,
    },
    {
      id: 'available',
      header: 'Disponível',
      align: 'right',
      width: 'w-[10%]',
      render: (item) => item.available,
    },
    {
      id: 'incoming',
      header: 'Em compra',
      align: 'right',
      width: 'w-[10%]',
      render: (item) => item.incoming,
    },
    {
      id: 'alert',
      header: 'Alerta',
      align: 'center',
      width: 'w-[10%]',
      render: (item) => (
        <Badge variant={ALERT_VARIANTS[item.alertState]} size="sm">
          {ALERT_LABELS[item.alertState]}
        </Badge>
      ),
    },
    {
      id: 'value',
      header: 'Valor em estoque',
      align: 'right',
      width: 'w-[16%]',
      render: (item) => formatInventoryCurrency(item.inventoryValue),
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
          <>
            <Button
              type="button"
              className="h-10 bg-brand-accent px-4 text-white shadow-none hover:bg-brand-accent/90"
              onClick={openEntryDialog}
            >
              <Plus className="mr-2 h-4 w-4" />
              Adicionar estoque
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-10 bg-white px-4 shadow-none"
              onClick={openAdjustDialog}
            >
              <Refresh className="mr-2 h-4 w-4" />
              Corrigir contagem
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-10 bg-white px-4 shadow-none"
              asChild
            >
              <Link href="/vendas/estoque/historico">
                <Clock className="mr-2 h-4 w-4" />
                Ver histórico
              </Link>
            </Button>
          </>
        }
        filtersBar={
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-end">
            <div className="relative w-full md:w-[340px] lg:w-[400px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-10 pl-9"
                placeholder="Buscar por produto, variante ou SKU"
              />
            </div>
            <Button
              type="button"
              variant={lowOnly ? 'default' : 'outline'}
              className="h-10 whitespace-nowrap px-4 shadow-none"
              onClick={() => setLowOnly((current) => !current)}
            >
              <Filter className="mr-2 h-4 w-4" />
              {lowOnly ? 'Exibindo baixo estoque' : 'Filtrar baixo estoque'}
            </Button>
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
            detail="estimativa por custo médio"
            value={formatInventoryCurrency(totals.value)}
            icon={<DollarSign className="h-5 w-5" />}
          />
        </div>

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <DataTable
            columns={columns}
            data={balances}
            rowKey={(item) => item.id}
            loading={loading}
            emptyMessage={
              <div className="px-6 py-12 text-center text-sm text-gray-500">
                Nenhum item de estoque encontrado.
              </div>
            }
            ariaLabel="Tabela de estoque"
          />
        </div>
      </TableLayout>

      <Dialog open={entryOpen} onOpenChange={setEntryOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar estoque</DialogTitle>
            <DialogDescription>Use quando novos itens chegaram ao estoque.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-500">Produto</label>
              <Select
                value={entryForm.targetKey}
                onValueChange={(value) =>
                  setEntryForm((current) => ({ ...current, targetKey: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um produto" />
                </SelectTrigger>
                <SelectContent>
                  {balances.map((item) => (
                    <SelectItem key={item.inventoryItemKey} value={item.inventoryItemKey}>
                      {buildItemLabel(item)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-500">Quantidade recebida</label>
                <Input
                  type="number"
                  min="1"
                  value={entryForm.quantity}
                  onChange={(event) =>
                    setEntryForm((current) => ({ ...current, quantity: event.target.value }))
                  }
                  placeholder="Ex: 12 unidades"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-500">
                  <LabelWithTooltip tooltip="Valor pago por unidade nesta entrada. Ajuda a calcular o custo médio.">
                    Custo unitário
                  </LabelWithTooltip>
                </label>
                <Input
                  type="number"
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
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                Saldo atual:{' '}
                <span className="font-semibold text-gray-900">{selectedEntryTarget.onHand}</span>
                {' → '}
                Novo saldo: <span className="font-semibold text-gray-900">{entryNewBalance}</span>
              </div>
            ) : null}
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-500">Fornecedor opcional</label>
              <Input
                value={entryForm.supplierName}
                onChange={(event) =>
                  setEntryForm((current) => ({ ...current, supplierName: event.target.value }))
                }
                placeholder="Ex: Fornecedor ABC"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-500">Observação opcional</label>
              <Textarea
                rows={3}
                value={entryForm.reason}
                onChange={(event) =>
                  setEntryForm((current) => ({ ...current, reason: event.target.value }))
                }
                placeholder="Ex: compra recebida pela secretaria"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEntryOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={submitting}
              onClick={() => void handleRegisterEntry()}
              className="bg-brand-accent text-white hover:bg-brand-accent/90"
            >
              Adicionar ao estoque
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Corrigir contagem</DialogTitle>
            <DialogDescription>
              Use quando o estoque físico contado for diferente do sistema.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-500">Produto</label>
              <Select value={adjustForm.targetKey} onValueChange={handleAdjustTargetChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um produto" />
                </SelectTrigger>
                <SelectContent>
                  {balances.map((item) => (
                    <SelectItem key={item.inventoryItemKey} value={item.inventoryItemKey}>
                      {buildItemLabel(item)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-500">
                  <LabelWithTooltip tooltip="Na maioria dos casos, informe a quantidade contada. Use mudança manual somente quando quiser somar ou subtrair uma diferença específica.">
                    Forma de correção
                  </LabelWithTooltip>
                </label>
                <Select value={adjustForm.mode} onValueChange={handleAdjustModeChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SET">Quantidade contada</SelectItem>
                    <SelectItem value="DELTA">Mudança manual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-500">
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
                  value={adjustForm.quantity}
                  onChange={(event) =>
                    setAdjustForm((current) => ({ ...current, quantity: event.target.value }))
                  }
                  placeholder={adjustForm.mode === 'SET' ? 'Ex: 45' : 'Ex: -2'}
                />
              </div>
            </div>
            {selectedAdjustTarget ? (
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
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
              <label className="text-xs font-medium text-gray-500">Motivo</label>
              <Select
                value={adjustForm.reasonCode}
                onValueChange={(value: keyof typeof ADJUST_REASON_LABELS) =>
                  setAdjustForm((current) => ({ ...current, reasonCode: value }))
                }
              >
                <SelectTrigger>
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
              <label className="text-xs font-medium text-gray-500">Observação opcional</label>
              <Textarea
                rows={3}
                value={adjustForm.note}
                onChange={(event) =>
                  setAdjustForm((current) => ({ ...current, note: event.target.value }))
                }
                placeholder="Ex: contagem feita no fechamento do dia"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={submitting}
              onClick={() => void handleAdjustInventory()}
              className="bg-brand-accent text-white hover:bg-brand-accent/90"
            >
              Salvar correção
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default InventoryFeature;
