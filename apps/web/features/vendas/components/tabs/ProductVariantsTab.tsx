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
import { Input } from '@/components/ui/input';
import { ChevronDown, ChevronUp, Loader2, Plus, Trash2 } from '@/components/icons/icons';
import { calculatePricingMetrics, formatMarginPercent } from '../../pricing-utils';
import type { ProductOptionDTO, ProductVariantDTO } from '../../services/product-variant-service';
import {
  listProductOptions,
  createProductOption,
  deleteProductOption,
  addOptionValue,
  deleteOptionValue,
  listProductVariants,
  generateProductVariants,
  updateProductVariant,
  deleteProductVariant,
} from '../../services/product-variant-service';

interface Props {
  productId: string;
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

const inputSm =
  'h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30';
const inputMd =
  'h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30';
const labelClass = 'text-xs font-medium text-slate-600';
const metricCardClass = 'rounded-xl border border-slate-200 bg-slate-50 px-3 py-3';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

export function ProductVariantsTab({ productId, defaultPrice = 0, onHasVariantsChange }: Props) {
  const [options, setOptions] = useState<ProductOptionDTO[]>([]);
  const [variants, setVariants] = useState<ProductVariantDTO[]>([]);
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
    }
  }

  async function handleAddValue(optionId: string) {
    const value = newValueInputs[optionId]?.trim();
    if (!value) return;
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
    }
  }

  async function handleGenerate() {
    setError(null);
    try {
      const vars = await generateProductVariants(productId);
      setVariants(vars);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function getEffectivePrice(variant: ProductVariantDTO): number {
    return Number(variant.price ?? defaultPrice);
  }

  function openVariantEditor(variant: ProductVariantDTO) {
    setEditingVariant(variant);
    setVariantForm({
      sku: variant.sku ?? '',
      price: String((variant.price ?? defaultPrice) || ''),
      averageCost: String(variant.averageCost ?? 0),
      lowStockThreshold: String(variant.lowStockThreshold ?? 0),
      isActive: variant.isActive,
    });
    setError(null);
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
  const isSavingEditingVariant = savingVariant === editingVariant?.id;

  return (
    <div className="space-y-5">
      {error && !editingVariant && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600">{error}</p>
      )}

      {/* Opções */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-5 space-y-4">
        <header>
          <h3 className="text-sm font-semibold text-slate-800">Opções</h3>
          <p className="text-xs text-slate-500 mt-0.5">Ex.: Cor, Tamanho, Material.</p>
        </header>

        {options.map((option) => (
          <div
            key={option.id}
            className="rounded-xl border border-slate-200 bg-white overflow-hidden"
          >
            {/* Option header */}
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
                onClick={() => void handleDeleteOption(option.id)}
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
                        onClick={() => void handleDeleteValue(option.id, v.id)}
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
            placeholder="Nome da opção (ex.: Tamanho)"
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
            Nova opção
          </Button>
        </div>
      </div>

      {/* Tabela de variantes */}
      {variants.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-slate-800">
              Variantes{' '}
              <span className="ml-1 text-xs font-normal text-slate-400">({variants.length})</span>
            </h3>
          </div>
          <div className="overflow-hidden">
            <table className="w-full table-fixed text-xs">
              <colgroup>
                <col className="w-[26%]" />
                <col className="w-[15%]" />
                <col className="w-[15%]" />
                <col className="w-[16%]" />
                <col className="w-[14%]" />
                <col className="w-[14%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-slate-200 bg-slate-100">
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Variantes
                  </th>
                  <th className="px-2 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Preço
                  </th>
                  <th className="px-2 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Custo
                  </th>
                  <th className="px-2 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Lucro
                  </th>
                  <th className="px-2 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Margem
                  </th>
                  <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody>
                {variants.map((variant) => {
                  const effectivePrice = getEffectivePrice(variant);
                  const pricing = calculatePricingMetrics(effectivePrice, variant.averageCost);

                  return (
                    <tr
                      key={variant.id}
                      className="cursor-pointer border-b border-slate-100 bg-white last:border-0 hover:bg-slate-50"
                      onClick={() => openVariantEditor(variant)}
                    >
                      <td className="px-4 py-4 align-middle">
                        <span className="truncate font-semibold text-slate-900">
                          {variant.title}
                        </span>
                      </td>
                      <td className="px-2 py-4 text-right align-middle">
                        <div className="font-semibold tabular-nums text-slate-900">
                          {formatCurrency(effectivePrice)}
                        </div>
                        {variant.price == null ? (
                          <div className="mt-1 text-[10px] text-slate-400">padrão</div>
                        ) : null}
                      </td>
                      <td className="px-2 py-4 text-right align-middle tabular-nums text-slate-600">
                        {formatCurrency(pricing.averageCost)}
                      </td>
                      <td
                        className={cn(
                          'px-2 py-4 text-right align-middle font-medium tabular-nums',
                          pricing.profitPerUnit >= 0 ? 'text-emerald-700' : 'text-red-700',
                        )}
                      >
                        {formatCurrency(pricing.profitPerUnit)}
                      </td>
                      <td
                        className={cn(
                          'px-2 py-4 text-right align-middle font-medium tabular-nums',
                          pricing.profitPerUnit >= 0 ? 'text-emerald-700' : 'text-red-700',
                        )}
                      >
                        {formatMarginPercent(pricing.marginPercent)}
                      </td>
                      <td
                        className="px-4 py-4 align-middle"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => void handleDeleteVariant(variant.id)}
                            className="flex size-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-500"
                            aria-label={`Remover variante ${variant.title}`}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
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
          Adicione opções e gere as variantes do produto.
        </p>
      )}

      <Dialog
        open={!!editingVariant}
        onOpenChange={(open) => {
          if (!open && !isSavingEditingVariant) setEditingVariant(null);
        }}
      >
        <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-slate-100 px-6 py-5">
            <DialogTitle className="text-base text-slate-900">
              Editar {editingVariant?.title ?? 'variante'}
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
              variant="outline"
              className="h-10"
              disabled={isSavingEditingVariant}
              onClick={() => setEditingVariant(null)}
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
    </div>
  );
}
