'use client';

import { useEffect, useState, useRef } from 'react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { InfoCallout } from '@/components/ui/info-callout';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ChevronDown,
  ChevronUp,
  DollarSign,
  Edit3,
  Eye,
  MoreVertical,
  Loader2,
  Plus,
  Trash2,
} from '@/components/icons/icons';
import { calculatePricingMetrics, formatMarginPercent } from '../../pricing-utils';
import {
  formatVariantDisplayName,
  groupProductVariants,
  getVariantAttributeEntries,
  needsVariantGeneration,
  type ProductOptionDTO,
  type ProductVariantDTO,
} from '../../services/product-variant-service';
import {
  listProductOptions,
  createProductOption,
  deleteProductOption,
  addOptionValue,
  deleteOptionValue,
  listProductVariants,
  generateProductVariants,
  bulkUpdateProductVariants,
  updateProductVariant,
  deleteProductVariant,
} from '../../services/product-variant-service';

interface Props {
  productId: string;
  productName?: string;
  defaultPrice?: number;
  onHasVariantsChange?: (_hasVariants: boolean) => void;
}

interface VariantEditForm {
  sku: string;
  price: string;
  averageCost: string;
  lowStockThreshold: string;
  isActive: boolean;
}

type DeleteRequest =
  | { type: 'option'; optionId: string; label: string }
  | { type: 'value'; optionId: string; valueId: string; label: string };

const inputSm =
  'h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30';
const inputMd =
  'h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30';
const labelClass = 'text-xs font-medium text-slate-600';
const metricCardClass = 'rounded-xl border border-slate-200 bg-slate-50 px-3 py-3';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function maskCurrencyInput(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  return (Number(digits) / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function parseCurrencyInput(value: string): number {
  if (!value.trim()) return 0;
  const parsed = Number(value.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrencyInputValue(value: number | null | undefined): string {
  return value == null ? '' : value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function ProductVariantsTab({
  productId,
  productName,
  defaultPrice = 0,
  onHasVariantsChange,
}: Props) {
  const [options, setOptions] = useState<ProductOptionDTO[]>([]);
  const [variants, setVariants] = useState<ProductVariantDTO[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<ReturnType<typeof groupProductVariants>[number] | null>(null);
  const [bulkPricingGroup, setBulkPricingGroup] = useState<ReturnType<typeof groupProductVariants>[number] | null>(null);
  const [bulkPricingForm, setBulkPricingForm] = useState({ price: '', averageCost: '' });
  const [savingBulkPricing, setSavingBulkPricing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New option input
  const [newOptionName, setNewOptionName] = useState('');
  const [addingOption, setAddingOption] = useState(false);

  // New value inputs per option
  const [newValueInputs, setNewValueInputs] = useState<Record<string, string>>({});

  // Variant editing state
  const [editingVariant, setEditingVariant] = useState<ProductVariantDTO | null>(null);
  const [variantForm, setVariantForm] = useState<VariantEditForm>({
    sku: '',
    price: '',
    averageCost: '0',
    lowStockThreshold: '0',
    isActive: true,
  });
  const [confirmExitOpen, setConfirmExitOpen] = useState(false);
  const [deleteRequest, setDeleteRequest] = useState<DeleteRequest | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [savingVariant, setSavingVariant] = useState<string | null>(null);

  // Track open option panels
  const [openOptions, setOpenOptions] = useState<Record<string, boolean>>({});

  const hasMounted = useRef(false);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  useEffect(() => {
    onHasVariantsChange?.(variants.length > 0);
  }, [onHasVariantsChange, variants.length]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [opts, vars] = await Promise.all([
        listProductOptions(productId),
        listProductVariants(productId),
      ]);
      setOptions(opts);
      setVariants(vars);

      // Older versions generated cartesian combinations. Also fill values
      // added after the last generation. Normalize these records
      // automatically when they are safe to replace.
      if (needsVariantGeneration(opts, vars)) {
        try {
          const normalized = await generateProductVariants(productId);
          setVariants(normalized);
        } catch (normalizationError) {
          setError((normalizationError as Error).message);
        }
      }

      if (!hasMounted.current) {
        const initial: Record<string, boolean> = {};
        opts.forEach((o) => {
          initial[o.id] = true;
        });
        setOpenOptions(initial);
        hasMounted.current = true;
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAddOption() {
    if (!newOptionName.trim()) return;
    setAddingOption(true);
    setError(null);
    try {
      const option = await createProductOption(productId, newOptionName.trim());
      setOptions((prev) => [...prev, option]);
      setOpenOptions((prev) => ({ ...prev, [option.id]: true }));
      setNewOptionName('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAddingOption(false);
    }
  }

  function requestDeleteOption(optionId: string) {
    const option = options.find((item) => item.id === optionId);
    if (!option) return;
    setDeleteRequest({ type: 'option', optionId, label: option.name });
  }

  function requestDeleteValue(optionId: string, valueId: string) {
    const option = options.find((item) => item.id === optionId);
    const value = option?.values.find((item) => item.id === valueId);
    if (!option || !value) return;
    setDeleteRequest({ type: 'value', optionId, valueId, label: `${option.name}: ${value.value}` });
  }

  async function handleDeleteOption(optionId: string) {
    setError(null);
    try {
      await deleteProductOption(productId, optionId);
      const newOptions = options.filter((o) => o.id !== optionId);
      setOptions(newOptions);
      if (newOptions.length > 0 && newOptions.every((o) => o.values.length > 0)) {
        await handleGenerate();
      }
    } catch (e) {
      setError((e as Error).message);
      throw e;
    }
  }

  async function handleAddValue(optionId: string) {
    const value = newValueInputs[optionId]?.trim();
    if (!value) return;

    const option = options.find((item) => item.id === optionId);
    const alreadyExists = option?.values.some(
      (item) => item.value.trim().toLocaleLowerCase() === value.toLocaleLowerCase(),
    );
    if (alreadyExists) {
      setError(`O valor “${value}” já foi cadastrado nesta variante.`);
      return;
    }

    setError(null);
    try {
      const val = await addOptionValue(productId, optionId, value);
      const newOptions = options.map((o) =>
        o.id === optionId ? { ...o, values: [...o.values, val] } : o,
      );
      setOptions(newOptions);
      setNewValueInputs((prev) => ({ ...prev, [optionId]: '' }));
      if (newOptions.every((o) => o.values.length > 0)) {
        await handleGenerate();
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleDeleteValue(optionId: string, valueId: string) {
    setError(null);
    try {
      await deleteOptionValue(productId, optionId, valueId);
      const newOptions = options.map((o) =>
        o.id === optionId ? { ...o, values: o.values.filter((v) => v.id !== valueId) } : o,
      );
      setOptions(newOptions);
      if (newOptions.every((o) => o.values.length > 0)) {
        await handleGenerate();
      }
    } catch (e) {
      setError((e as Error).message);
      throw e;
    }
  }

  async function confirmDeleteRequest() {
    if (!deleteRequest) return;
    setDeleting(true);
    try {
      if (deleteRequest.type === 'option') {
        await handleDeleteOption(deleteRequest.optionId);
      } else {
        await handleDeleteValue(deleteRequest.optionId, deleteRequest.valueId);
      }
      setDeleteRequest(null);
    } finally {
      setDeleting(false);
    }
  }

  async function handleGenerate() {
    setError(null);
    try {
      const vars = await generateProductVariants(productId);
      setVariants(vars);
    } catch (e) {
      setError((e as Error).message);
      throw e;
    }
  }

  function openVariantEditor(variant: ProductVariantDTO) {
    const nextForm = {
      sku: variant.sku ?? '',
      price: String((variant.price ?? defaultPrice) || ''),
      averageCost: String(variant.averageCost ?? 0),
      lowStockThreshold: String(variant.lowStockThreshold ?? 0),
      isActive: variant.isActive,
    };
    setEditingVariant(variant);
    setVariantForm(nextForm);
    setConfirmExitOpen(false);
    setError(null);
  }

  function requestCloseVariantEditor() {
    if (!editingVariant || isSavingEditingVariant) return;
    setConfirmExitOpen(true);
  }

  function patchVariantForm(field: keyof VariantEditForm, value: string | boolean) {
    setVariantForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSaveEditingVariant() {
    if (!editingVariant) return;

    const price = Number(variantForm.price);
    const averageCost = Number(variantForm.averageCost);
    const lowStockThreshold = Number(variantForm.lowStockThreshold);

    if (!variantForm.price.trim() || Number.isNaN(price) || price <= 0) {
      setError('Informe um preço de venda válido para a variante.');
      return;
    }

    if (!variantForm.averageCost.trim() || Number.isNaN(averageCost) || averageCost < 0) {
      setError('Informe um custo válido para a variante.');
      return;
    }

    if (Number.isNaN(lowStockThreshold) || lowStockThreshold < 0) {
      setError('Informe um alerta de estoque válido para a variante.');
      return;
    }

    setSavingVariant(editingVariant.id);
    setError(null);
    try {
      const updated = await updateProductVariant(productId, editingVariant.id, {
        sku: variantForm.sku.trim() || null,
        price,
        averageCost,
        lowStockThreshold,
        isActive: variantForm.isActive,
      });
      setVariants((prev) => prev.map((v) => (v.id === editingVariant.id ? updated : v)));
      setEditingVariant(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingVariant(null);
    }
  }

  async function handleDeleteVariant(variantId: string) {
    setError(null);
    try {
      await deleteProductVariant(productId, variantId);
      setVariants((prev) => prev.filter((v) => v.id !== variantId));
      if (editingVariant?.id === variantId) setEditingVariant(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function openBulkPricing(group: ReturnType<typeof groupProductVariants>[number]) {
    const firstWithPrice = group.variants.find((variant) => variant.price != null);
    const firstWithCost = group.variants.find((variant) => variant.averageCost > 0);
    setBulkPricingForm({
      price: firstWithPrice?.price != null
        ? formatCurrencyInputValue(firstWithPrice.price)
        : formatCurrencyInputValue(defaultPrice),
      averageCost: firstWithCost ? formatCurrencyInputValue(firstWithCost.averageCost) : '',
    });
    setSelectedGroup(null);
    setBulkPricingGroup(group);
    setError(null);
  }

  async function handleBulkPricing() {
    if (!bulkPricingGroup) return;
    const price = parseCurrencyInput(bulkPricingForm.price);
    const averageCost = parseCurrencyInput(bulkPricingForm.averageCost);
    if (!bulkPricingForm.price.trim() || !Number.isFinite(price) || price <= 0) {
      setError('Informe um preço de venda válido.');
      return;
    }
    if (!bulkPricingForm.averageCost.trim() || !Number.isFinite(averageCost) || averageCost < 0) {
      setError('Informe um custo válido.');
      return;
    }

    setSavingBulkPricing(true);
    setError(null);
    try {
      const updated = await bulkUpdateProductVariants(
        productId,
        bulkPricingGroup.variants.map((variant) => variant.id),
        { price, averageCost },
      );
      setVariants(updated);
      setBulkPricingGroup(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingBulkPricing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-slate-400" />
      </div>
    );
  }

  const editingPrice = Number(variantForm.price) || 0;
  const editingAverageCost = Number(variantForm.averageCost) || 0;
  const editingPricing = editingVariant
    ? calculatePricingMetrics(editingPrice, editingAverageCost)
    : null;
  const bulkPrice = parseCurrencyInput(bulkPricingForm.price);
  const bulkAverageCost = parseCurrencyInput(bulkPricingForm.averageCost);
  const bulkPricing = calculatePricingMetrics(bulkPrice, bulkAverageCost);
  const isSavingEditingVariant = savingVariant === editingVariant?.id;
  const optionOrder = options.map((option) => option.name);
  const variantGroups = groupProductVariants(variants, optionOrder);

  function getAvailabilityState(available: number, threshold: number) {
    if (available <= 0) {
      return { label: '', width: '0%', track: 'bg-red-100', bar: 'bg-red-500' };
    }

    if (available <= threshold) {
      return { label: 'Estoque baixo', width: '42%', track: 'bg-amber-100', bar: 'bg-amber-500' };
    }

    return { label: 'Disponível', width: '100%', track: 'bg-emerald-100', bar: 'bg-emerald-500' };
  }

  return (
    <div className="space-y-5">
      {error && !editingVariant && (
        <InfoCallout variant="warning" size="sm" showIcon title="Não foi possível concluir">
          {error}
        </InfoCallout>
      )}

      {/* Atributos */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-5 space-y-4">
        <header>
          <h3 className="text-sm font-semibold text-slate-800">Variantes e valores</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Cadastre uma variante como Rosa ou Tamanho e adicione os valores correspondentes, como
            31 ou 32.
          </p>
        </header>

        {options.map((option) => (
          <div
            key={option.id}
            className="rounded-xl border border-slate-200 bg-white overflow-hidden"
          >
            {/* Attribute header */}
            <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-100">
              <button
                type="button"
                className="flex items-center gap-2 flex-1 text-left"
                onClick={() =>
                  setOpenOptions((prev) => ({ ...prev, [option.id]: !prev[option.id] }))
                }
              >
                <span className="text-sm font-medium text-slate-800">{option.name}</span>
                {openOptions[option.id] ? (
                  <ChevronUp className="size-3.5 text-slate-400" />
                ) : (
                  <ChevronDown className="size-3.5 text-slate-400" />
                )}
              </button>
              <button
                type="button"
                onClick={() => requestDeleteOption(option.id)}
                className="flex size-6 items-center justify-center rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 transition"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>

            {openOptions[option.id] && (
              <div className="px-4 py-3 space-y-3">
                {/* Chips de valores */}
                <div className="flex flex-wrap gap-2">
                  {option.values.map((v) => (
                    <span
                      key={v.id}
                      className="inline-flex items-center gap-1 rounded-full bg-[#A94DFF]/10 px-2.5 py-1 text-xs font-medium text-[#7C3AED]"
                    >
                      {v.value}
                      <button
                        type="button"
                        onClick={() => requestDeleteValue(option.id, v.id)}
                        className="ml-0.5 hover:text-red-500 transition"
                        aria-label={`Remover ${v.value}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {option.values.length === 0 && (
                    <span className="text-xs text-slate-400">Nenhum valor adicionado</span>
                  )}
                </div>

                {/* Input novo valor */}
                <div className="flex items-center gap-2">
                  <Input
                    value={newValueInputs[option.id] ?? ''}
                    onChange={(e) =>
                      setNewValueInputs((prev) => ({ ...prev, [option.id]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleAddValue(option.id);
                      }
                    }}
                    placeholder="Adicionar valor..."
                    className={cn(inputSm, 'flex-1')}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 px-3 text-xs"
                    onClick={() => void handleAddValue(option.id)}
                    disabled={!newValueInputs[option.id]?.trim()}
                  >
                    <Plus className="size-3 mr-1" /> Adicionar
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Add new option */}
        <div className="flex items-center gap-2">
          <Input
            value={newOptionName}
            onChange={(e) => setNewOptionName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleAddOption();
              }
            }}
            placeholder="Nome da variante (ex.: Rosa, Tamanho)"
            className={cn(inputSm, 'flex-1')}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 px-3 text-xs"
            onClick={() => void handleAddOption()}
            disabled={addingOption || !newOptionName.trim()}
          >
            {addingOption ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Plus className="size-3 mr-1" />
            )}
            Nova variante
          </Button>
        </div>
      </div>

      {/* Tabela de variantes */}
      {variants.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 overflow-hidden">
          <div className="border-b border-slate-200 px-5 py-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">
                Variantes{' '}
                <span className="ml-1 text-xs font-normal text-slate-400">({variants.length})</span>
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Cada linha representa uma variante. Clique para ver os valores e o estoque
                individual.
              </p>
            </div>
          </div>
          <div className="overflow-hidden">
            <table className="w-full table-fixed whitespace-nowrap text-sm">
              <colgroup>
                <col className="w-[36%]" />
                <col className="w-[28%]" />
                <col className="w-[24%]" />
                <col className="w-[12%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-slate-200 bg-slate-100">
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Nome
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Variante
                  </th>
                  <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Estoque
                  </th>
                  <th className="whitespace-nowrap px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody>
                {variantGroups.map((group) => {
                  return (
                    <tr
                      key={group.key}
                      className="cursor-pointer border-b border-slate-100 bg-white last:border-0 hover:bg-slate-50"
                      onClick={() => setSelectedGroup(group)}
                    >
                      <td className="px-4 py-4 align-middle">
                        <span className="font-semibold text-slate-900">
                          {productName || 'Produto'}
                        </span>
                      </td>
                      <td className="px-4 py-4 align-middle">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-900">{group.value}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-right align-middle">
                        <div className="font-semibold tabular-nums text-slate-900">
                          {group.available} disponível
                        </div>
                      </td>
                      <td className="px-4 py-4 text-right align-middle">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className="ml-auto flex size-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                              onClick={(event) => event.stopPropagation()}
                              aria-label={`Ações de ${productName} ${group.value}`}
                            >
                              <MoreVertical className="size-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            className="w-52"
                            onClick={(event) => event.stopPropagation()}
                            onPointerDown={(event) => event.stopPropagation()}
                          >
                            <DropdownMenuItem
                              onSelect={() => openBulkPricing(group)}
                            >
                              <DollarSign className="mr-2 size-4 text-slate-400" />
                              Precificar grupo
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => setSelectedGroup(group)}
                            >
                              <Eye className="mr-2 size-4 text-slate-400" />
                              Ver detalhes
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {variants.length === 0 && options.length === 0 && (
        <p className="text-center text-xs text-slate-400 py-4">
          Adicione variantes e valores para gerar o estoque do produto.
        </p>
      )}

      <Dialog
        open={!!bulkPricingGroup}
        onOpenChange={(open) => {
          if (!open && !savingBulkPricing) setBulkPricingGroup(null);
        }}
      >
        <DialogContent
          fullScreenMobile
          className="gap-0 overflow-hidden bg-slate-50 p-0 max-md:flex max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:flex-col max-md:min-h-0 sm:max-w-[520px] md:rounded-2xl"
        >
          <DialogHeader className="relative shrink-0 space-y-0 border-b border-slate-200 bg-slate-50 px-4 py-4 text-left max-md:pb-4 max-md:pl-4 max-md:pr-14 max-md:pt-[calc(3rem+env(safe-area-inset-top,0px))] sm:px-6 sm:py-5">
            <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-accent/40 to-transparent" />
            <DialogTitle className="text-base text-slate-900">
              Precificar grupo
            </DialogTitle>
            <DialogDescription className="pt-1 text-sm text-slate-600">
              Aplicar aos {bulkPricingGroup?.variants.length ?? 0} tamanhos de{' '}
              <span className="font-medium text-slate-700">{bulkPricingGroup?.value}</span>.
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden max-md:min-h-0">
            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
            {error && !editingVariant ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600">
                {error}
              </p>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className={labelClass} htmlFor="bulk-variant-price">Preço de venda (R$)</label>
                <Input
                  id="bulk-variant-price"
                  type="text"
                  value={bulkPricingForm.price}
                  onChange={(event) => setBulkPricingForm((prev) => ({ ...prev, price: maskCurrencyInput(event.target.value) }))}
                  placeholder="0,00"
                  inputMode="decimal"
                  className={inputMd}
                />
              </div>
              <div className="space-y-1.5">
                <label className={labelClass} htmlFor="bulk-variant-cost">Custo (R$)</label>
                <Input
                  id="bulk-variant-cost"
                  type="text"
                  value={bulkPricingForm.averageCost}
                  onChange={(event) => setBulkPricingForm((prev) => ({ ...prev, averageCost: maskCurrencyInput(event.target.value) }))}
                  placeholder="0,00"
                  inputMode="decimal"
                  className={inputMd}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                <span>Lucro</span>
                <strong className={cn('font-semibold', bulkPricing.profitPerUnit >= 0 ? 'text-emerald-700' : 'text-red-700')}>
                  {formatCurrency(bulkPricing.profitPerUnit)}
                </strong>
              </span>
              <span className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                <span>Margem</span>
                <strong className={cn('font-semibold', bulkPricing.profitPerUnit >= 0 ? 'text-emerald-700' : 'text-red-700')}>
                  {formatMarginPercent(bulkPricing.marginPercent)}
                </strong>
              </span>
            </div>
            <p className="text-xs leading-5 text-slate-500">
              O preço e o custo serão aplicados a todos os tamanhos deste grupo.
            </p>
            </div>
          </div>

          <DialogFooter className="flex shrink-0 flex-col-reverse gap-3 border-t border-slate-200 bg-slate-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-end sm:gap-3 sm:px-6 sm:py-4">
            <Button type="button" variant="outline" className="h-11 min-h-11 w-full border-slate-200 bg-white shadow-none hover:bg-slate-100 sm:h-10 sm:min-h-0 sm:w-auto" disabled={savingBulkPricing} onClick={() => setBulkPricingGroup(null)}>
              Cancelar
            </Button>
            <Button type="button" className="h-11 min-h-11 w-full bg-brand-accent px-5 text-white shadow-none hover:bg-brand-accent/90 sm:h-10 sm:min-h-0 sm:w-auto" disabled={savingBulkPricing} onClick={() => void handleBulkPricing()}>
              {savingBulkPricing ? <><Loader2 className="mr-2 size-4 animate-spin" /> Aplicando...</> : 'Aplicar aos tamanhos'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              Estoque detalhado por valor de {selectedGroup?.value ?? 'variante'}.
            </DialogDescription>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-5 pt-3">
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full table-fixed whitespace-nowrap text-sm">
                <colgroup>
                  <col className="w-[24%]" />
                  <col className="w-[14%]" />
                  <col className="w-[18%]" />
                  <col className="w-[14%]" />
                  <col className="w-[22%]" />
                  <col className="w-[8%]" />
                </colgroup>
                <thead className="sticky top-0 z-10 bg-slate-50">
                  <tr className="border-b border-slate-100 text-left">
                    <th className="px-4 py-3 text-xs font-medium text-slate-500">Nome</th>
                    <th className="px-4 py-3 text-xs font-medium text-slate-500">Valor</th>
                    <th className="px-4 py-3 text-xs font-medium text-slate-500">Valor / Custo</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-500">
                      Estoque
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500">
                      Disponibilidade
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-500">
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                {selectedGroup?.variants.map((variant) => {
                  const allAttributes = getVariantAttributeEntries(variant, optionOrder);
                  const attributes = selectedGroup.isLegacyCombination
                    ? allAttributes
                    : allAttributes.filter(
                        (attribute) => attribute.name !== selectedGroup.optionName,
                      );
                  const valueLabel = attributes.length
                    ? attributes
                        .map((attribute) => `${attribute.name}: ${attribute.value}`)
                        .join(' · ')
                    : allAttributes[0]?.value ?? variant.title;
                  const threshold = Math.max(variant.lowStockThreshold, 1);
                  const availability = getAvailabilityState(variant.available, threshold);

                  return (
                    <tr
                      key={variant.id}
                      className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50"
                      onClick={() => {
                        setSelectedGroup(null);
                        openVariantEditor(variant);
                      }}
                    >
                      <td className="px-4 py-4 align-middle font-medium text-slate-900">
                        {productName || 'Produto'} · {selectedGroup.value}
                      </td>
                      <td className="px-4 py-4 align-middle text-slate-700">{valueLabel}</td>
                      <td className="px-4 py-4 align-middle">
                        <div className="font-semibold tabular-nums text-slate-900">
                          {formatCurrency(variant.price ?? defaultPrice)}
                        </div>
                        <div className="mt-1 text-xs tabular-nums text-slate-500">
                          Custo: {formatCurrency(variant.averageCost)}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-right align-middle">
                        <div className="font-semibold tabular-nums text-slate-900">
                          {variant.available} disponível
                        </div>
                      </td>
                      <td className="px-4 py-4 align-middle">
                        <div className="flex min-w-0 items-center gap-2">
                          <div className={`h-2 min-w-0 flex-1 rounded-full ${availability.track}`}>
                            <div
                              className={`h-full rounded-full ${availability.bar}`}
                              style={{ width: availability.width }}
                            />
                          </div>
                          {availability.label && (
                            <span className="w-[70px] shrink-0 text-[10px] text-slate-500">
                              {availability.label}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-right align-middle">
                        <button
                          type="button"
                          className="ml-auto flex size-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                          aria-label={`Editar valor ${valueLabel}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedGroup(null);
                            openVariantEditor(variant);
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

      <Dialog
        open={!!editingVariant}
        onOpenChange={(open) => {
          if (!open && !isSavingEditingVariant) requestCloseVariantEditor();
        }}
      >
        <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-slate-100 px-6 py-5">
            <DialogTitle className="text-base text-slate-900">
              Editar{' '}
              {editingVariant
                ? formatVariantDisplayName(
                    editingVariant,
                    productName,
                    options.map((option) => option.name),
                  )
                : 'variante'}
            </DialogTitle>
            <DialogDescription className="text-sm text-slate-500">
              Defina preço, status e dados de estoque em um único lugar.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 px-6 py-5">
            {error && editingVariant ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600">
                {error}
              </p>
            ) : null}

            <label className="flex items-center gap-3 text-sm text-slate-800">
              <input
                type="checkbox"
                checked={variantForm.isActive}
                onChange={(event) => patchVariantForm('isActive', event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-[#A94DFF] focus:ring-[#A94DFF]"
              />
              <span>Criar/ativar esta variante</span>
            </label>

            <section className="space-y-3">
              <div className="max-w-[220px]">
                <label className={labelClass} htmlFor="variant-price">
                  Preço de venda (R$)
                </label>
                <Input
                  id="variant-price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={variantForm.price}
                  onChange={(event) => patchVariantForm('price', event.target.value)}
                  placeholder="0,00"
                  inputMode="decimal"
                  className={inputMd}
                />
              </div>
            </section>

            {editingPricing ? (
              <div className="flex flex-wrap gap-2">
                <label
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition focus-within:border-[#A94DFF]"
                  htmlFor="variant-average-cost"
                >
                  <span>Custo</span>
                  <span className="text-slate-500">R$</span>
                  <Input
                    id="variant-average-cost"
                    type="number"
                    min="0"
                    step="0.01"
                    value={variantForm.averageCost}
                    onChange={(event) => patchVariantForm('averageCost', event.target.value)}
                    placeholder="0,00"
                    inputMode="decimal"
                    className="h-6 w-24 border-0 bg-transparent p-0 text-sm font-semibold text-slate-900 shadow-none focus-visible:ring-0"
                  />
                </label>
                <span className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                  <span>Lucro</span>
                  <strong
                    className={cn(
                      'font-semibold',
                      editingPricing.profitPerUnit >= 0 ? 'text-emerald-700' : 'text-red-700',
                    )}
                  >
                    {formatCurrency(editingPricing.profitPerUnit)}
                  </strong>
                </span>
                <span className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                  <span>Margem</span>
                  <strong
                    className={cn(
                      'font-semibold',
                      editingPricing.profitPerUnit >= 0 ? 'text-emerald-700' : 'text-red-700',
                    )}
                  >
                    {formatMarginPercent(editingPricing.marginPercent)}
                  </strong>
                </span>
              </div>
            ) : null}

            <section className="space-y-3 border-t border-slate-100 pt-5">
              <h3 className="text-sm font-semibold text-slate-800">Estoque</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label className={labelClass} htmlFor="variant-sku">
                    SKU
                  </label>
                  <Input
                    id="variant-sku"
                    value={variantForm.sku}
                    onChange={(event) => patchVariantForm('sku', event.target.value)}
                    placeholder="Ex.: CAM-P-AZUL"
                    className={inputMd}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className={labelClass} htmlFor="variant-threshold">
                    Alerta de estoque baixo
                  </label>
                  <Input
                    id="variant-threshold"
                    type="number"
                    min="0"
                    value={variantForm.lowStockThreshold}
                    onChange={(event) => patchVariantForm('lowStockThreshold', event.target.value)}
                    className={inputMd}
                  />
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                <div className={metricCardClass}>
                  <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                    Disponível
                  </div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">
                    {editingVariant?.available ?? 0}
                  </div>
                </div>
                <div className={metricCardClass}>
                  <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                    Físico
                  </div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">
                    {editingVariant?.onHand ?? 0}
                  </div>
                </div>
                <div className={metricCardClass}>
                  <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                    Em compra
                  </div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">
                    {editingVariant?.incoming ?? 0}
                  </div>
                </div>
              </div>

              <p className="text-xs leading-5 text-slate-500">
                O custo informado será usado no cálculo de lucro, margem e nas próximas vendas.
                Entradas e reposições futuras com custo podem recalcular esse valor médio.
              </p>
            </section>
          </div>

          <DialogFooter className="border-t border-slate-100 px-6 py-4">
            <Button
              type="button"
              variant="ghost"
              className="mr-auto h-10 text-red-600 hover:bg-red-50 hover:text-red-700"
              disabled={isSavingEditingVariant}
              onClick={() => {
                if (editingVariant) void handleDeleteVariant(editingVariant.id);
              }}
            >
              <Trash2 className="mr-2 size-4" />
              Excluir variante
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-10"
              disabled={isSavingEditingVariant}
              onClick={requestCloseVariantEditor}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              className="h-10 bg-[#A94DFF] px-5 text-white hover:bg-[#8E2DE2]"
              disabled={isSavingEditingVariant}
              onClick={() => void handleSaveEditingVariant()}
            >
              {isSavingEditingVariant ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Salvando...
                </>
              ) : (
                'Concluído'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmExitOpen} onOpenChange={setConfirmExitOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sair da edição?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza de que deseja sair? Alterações não salvas serão perdidas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar editando</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => {
                setConfirmExitOpen(false);
                setEditingVariant(null);
              }}
            >
              Sair
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(deleteRequest)}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteRequest(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Excluir {deleteRequest?.type === 'option' ? 'variante' : 'valor'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-slate-900">{deleteRequest?.label}</span>{' '}
              será removido permanentemente. Variantes geradas relacionadas serão reorganizadas
              automaticamente, desde que não tenham estoque, reservas ou histórico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                void confirmDeleteRequest();
              }}
            >
              {deleting ? 'Excluindo...' : 'Excluir permanentemente'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
