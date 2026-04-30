'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Package2 } from '@/components/icons/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/cn';
import { toast } from '@/components/ui/toast';
import type { ProductCategory, ProductListItem } from './services/products-service';
import {
  createProduct,
  updateProduct,
  getProduct,
  toggleProductActive,
  listCategories,
} from './services/products-service';
import type { ProductImageDTO } from './services/product-image-service';
import { listProductImages } from './services/product-image-service';
import { ProductMediaTab } from './components/tabs/ProductMediaTab';
import { ProductVariantsTab } from './components/tabs/ProductVariantsTab';
import { calculatePricingMetrics, formatMarginPercent } from './pricing-utils';

// ── Style tokens ─────────────────────────────────────────────────
const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30';
const selectTriggerClass = cn(
  inputClass,
  'flex items-center justify-between gap-2 text-left data-[placeholder]:text-slate-400',
);
const textareaClass =
  'min-h-[120px] w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30';
const cardClass = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4';
const sectionTitleClass = 'text-sm font-semibold text-slate-800';
const labelClass = 'text-xs font-medium text-slate-600';
const errorClass = 'text-[11px] font-medium text-[#DC2626]';
const metricCardClass = 'rounded-xl border border-slate-200 bg-slate-50 px-3 py-3';
const priceChipClass =
  'inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700';

// ── Types ─────────────────────────────────────────────────────────
export interface ProductFormValues {
  name: string;
  description: string;
  sku: string;
  price: string;
  averageCost?: string;
  initialStock: string;
  lowStockThreshold: string;
  categoryId: string;
}

type FieldKey = keyof ProductFormValues;

const defaults: ProductFormValues = {
  name: '',
  description: '',
  sku: '',
  price: '',
  averageCost: '0',
  initialStock: '0',
  lowStockThreshold: '5',
  categoryId: '',
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

interface Props {
  mode: 'criar' | 'editar';
  productId?: string;
}

// ── Component ────────────────────────────────────────────────────
export function ProductFormFeature({ mode, productId }: Props) {
  const router = useRouter();

  const [values, setValues] = useState<ProductFormValues>(defaults);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [loadingProduct, setLoadingProduct] = useState(mode === 'editar');
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [isActive, setIsActive] = useState(true);
  const [managesStockByVariants, setManagesStockByVariants] = useState(false);

  // Current product ID — set after first save in create mode, or loaded in edit mode
  const [currentProductId, setCurrentProductId] = useState<string | null>(productId ?? null);
  const [product, setProduct] = useState<ProductListItem | null>(null);

  // Media state
  const [images, setImages] = useState<ProductImageDTO[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  // Sections disabled until first save (create mode only)
  const mediaSectionsDisabled = mode === 'criar' && !currentProductId;

  // ── Load ────────────────────────────────────────────────────────
  useEffect(() => {
    void listCategories()
      .then(setCategories)
      .catch(() => null);
  }, []);

  useEffect(() => {
    if (mode === 'editar' && productId) {
      setLoadingProduct(true);
      void getProduct(productId)
        .then((p) => {
          setProduct(p);
          setIsActive(p.isActive);
          setManagesStockByVariants(p.hasVariants);
          setValues({
            name: p.name ?? '',
            description: p.description ?? '',
            sku: p.sku ?? '',
            price: p.price ? String(p.price) : '',
            averageCost: String(p.averageCost ?? 0),
            initialStock: '0',
            lowStockThreshold: String(p.lowStockThreshold ?? 5),
            categoryId: p.categoryId ?? '',
          });
        })
        .catch(() => toast.error('Não foi possível carregar o produto.'))
        .finally(() => setLoadingProduct(false));

      void listProductImages(productId)
        .then(setImages)
        .catch(() => null);
    }
  }, [mode, productId]);

  // ── Field handlers ───────────────────────────────────────────────
  const handleFieldChange = useCallback((key: FieldKey, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const handlePriceChange = useCallback(
    (raw: string) => {
      const cleaned = raw.replace(/[^\d,.]/g, '').replace(',', '.');
      handleFieldChange('price', cleaned);
    },
    [handleFieldChange],
  );

  const handleAverageCostChange = useCallback(
    (raw: string) => {
      const cleaned = raw.replace(/[^\d,.]/g, '').replace(',', '.');
      handleFieldChange('averageCost', cleaned);
    },
    [handleFieldChange],
  );

  const handleIntegerChange = useCallback(
    (key: FieldKey, raw: string) => {
      const cleaned = raw.replace(/\D/g, '');
      handleFieldChange(key, cleaned);
    },
    [handleFieldChange],
  );

  // ── Validation ───────────────────────────────────────────────────
  function validate(): boolean {
    const next: Partial<Record<FieldKey, string>> = {};
    if (!values.name.trim()) next.name = 'Informe o nome do produto.';

    if (!managesStockByVariants) {
      const price = Number(values.price);
      const averageCost = Number(values.averageCost ?? '');
      const initialStock = Number(values.initialStock);

      if (!values.price.trim() || Number.isNaN(price) || price <= 0) {
        next.price = 'Informe um preço válido (maior que zero).';
      }

      if (!(values.averageCost ?? '').trim() || Number.isNaN(averageCost) || averageCost < 0) {
        next.averageCost = 'Informe um custo válido.';
      }

      if (
        mode === 'criar' &&
        (!values.initialStock.trim() || !Number.isInteger(initialStock) || initialStock < 0)
      ) {
        next.initialStock = 'Informe um estoque inicial válido.';
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  // ── Submit ───────────────────────────────────────────────────────
  async function handleSubmit() {
    if (submitting) return;
    if (!validate()) return;

    const basePayload = {
      name: values.name.trim(),
      description: values.description.trim() || undefined,
      sku: values.sku.trim() || undefined,
      categoryId: values.categoryId || null,
    };
    const simplePricingPayload = {
      price: Number(values.price),
      averageCost: Number(values.averageCost ?? 0),
      initialStock: mode === 'criar' ? Number(values.initialStock || 0) : undefined,
      lowStockThreshold: Number(values.lowStockThreshold),
    };

    setSubmitting(true);
    try {
      if (mode === 'criar') {
        const created = await createProduct({ ...basePayload, ...simplePricingPayload });
        setCurrentProductId(created.id);
        toast.success('Produto criado! Adicione imagens e variantes.');
        // Redirect to edit page so all sections are enabled
        router.replace(`/vendas/produtos/${created.id}/editar`);
      } else if (currentProductId) {
        const payload = managesStockByVariants
          ? basePayload
          : { ...basePayload, ...simplePricingPayload };
        const updated = await updateProduct(currentProductId, payload);
        setProduct(updated);
        setManagesStockByVariants(updated.hasVariants);
        toast.success('Produto atualizado');
      }
    } catch (err) {
      toast.error((err as Error).message ?? 'Erro ao salvar produto.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleActive(active: boolean) {
    if (!currentProductId) return;
    try {
      const updated = await toggleProductActive(currentProductId, active);
      setProduct(updated);
      setIsActive(active);
    } catch (err) {
      toast.error((err as Error).message ?? 'Erro ao alterar status.');
    }
  }

  // ── Loading state ────────────────────────────────────────────────
  if (loadingProduct) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  const pageTitle = mode === 'criar' ? 'Novo produto' : (product?.name ?? 'Editar produto');
  const currentPrice = Number(values.price) || 0;
  const currentAverageCost = Number(values.averageCost) || 0;
  const pricing = calculatePricingMetrics(currentPrice, currentAverageCost);

  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-6 px-4 pb-12 pt-6 md:px-6">
      {/* ── Page header ──────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-lg text-slate-600 hover:bg-slate-100"
            onClick={() => router.push('/vendas/produtos')}
            aria-label="Voltar para produtos"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{pageTitle}</h1>
            {mode === 'criar' && (
              <p className="text-sm text-slate-500">Preencha os dados e salve para continuar.</p>
            )}
          </div>
        </div>

        <Button
          type="button"
          disabled={submitting}
          onClick={handleSubmit}
          className="h-10 bg-[#A94DFF] px-5 text-white hover:bg-[#8E2DE2] disabled:opacity-60 sm:ml-auto"
        >
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Salvando...
            </>
          ) : mode === 'criar' ? (
            'Criar produto'
          ) : (
            'Salvar alterações'
          )}
        </Button>
      </div>

      {/* ── Two-column layout ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* ── Main column ───────────────────────────────────────── */}
        <div className="space-y-6">
          {/* Section: Informações gerais */}
          <div className={cardClass}>
            <h2 className={sectionTitleClass}>Informações gerais</h2>

            <div className="flex flex-col gap-1">
              <label className={labelClass} htmlFor="pf-name">
                Nome do produto
              </label>
              <Input
                id="pf-name"
                value={values.name}
                onChange={(e) => handleFieldChange('name', e.target.value)}
                placeholder="Ex.: Camiseta Clássica"
                autoComplete="off"
                className={cn(
                  inputClass,
                  errors.name && 'border-[#DC2626] focus:border-[#DC2626] focus:ring-[#DC2626]/20',
                )}
              />
              {errors.name && <p className={errorClass}>{errors.name}</p>}
            </div>

            <div className="flex flex-col gap-1">
              <label className={labelClass} htmlFor="pf-desc">
                Descrição <span className="text-slate-400">(opcional)</span>
              </label>
              <Textarea
                id="pf-desc"
                value={values.description}
                onChange={(e) => handleFieldChange('description', e.target.value)}
                placeholder="Descreva o produto..."
                className={textareaClass}
              />
            </div>
          </div>

          {/* Section: Mídia */}
          <div className={cardClass}>
            <h2 className={sectionTitleClass}>Mídia</h2>
            <p className="text-xs text-slate-500">
              Adicione até 8 imagens. A primeira marcada como principal aparece no catálogo.
            </p>

            {mediaSectionsDisabled ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 py-12">
                <Package2 className="h-8 w-8 text-slate-300" />
                <p className="text-sm text-slate-400">Salve o produto para adicionar imagens.</p>
              </div>
            ) : (
              <ProductMediaTab
                productId={currentProductId}
                images={images}
                onChange={setImages}
                pendingFiles={pendingFiles}
                onAddPendingFile={(f) => setPendingFiles((prev) => [...prev, f])}
                onRemovePendingFile={(i) =>
                  setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))
                }
              />
            )}
          </div>

          {/* Section: Preço */}
          {managesStockByVariants ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
              <h2 className={sectionTitleClass}>Preço</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Este produto usa variantes. Para evitar divergências, preço de venda, custo, lucro e
                margem são definidos individualmente na tabela de variantes abaixo.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="space-y-3 p-5">
                <div>
                  <h2 className={sectionTitleClass}>Preço</h2>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Defina o preço de venda e o custo do produto. Lucro e margem são calculados
                    automaticamente.
                  </p>
                </div>

                <div className="max-w-[240px]">
                  <label className={labelClass} htmlFor="pf-price">
                    Preço de venda (R$)
                  </label>
                  <Input
                    id="pf-price"
                    value={values.price}
                    onChange={(e) => handlePriceChange(e.target.value)}
                    placeholder="0,00"
                    autoComplete="off"
                    inputMode="decimal"
                    className={cn(
                      inputClass,
                      'mt-1',
                      errors.price &&
                        'border-[#DC2626] focus:border-[#DC2626] focus:ring-[#DC2626]/20',
                    )}
                  />
                  {errors.price && <p className={cn(errorClass, 'mt-1')}>{errors.price}</p>}
                </div>
              </div>

              <div className="border-t border-slate-100 bg-slate-50 px-5 py-3">
                <div className="flex flex-wrap gap-2">
                  <label
                    className={cn(
                      priceChipClass,
                      'transition focus-within:border-[#A94DFF]',
                      errors.averageCost && 'border-[#DC2626]',
                    )}
                    htmlFor="pf-average-cost"
                  >
                    <span>Custo</span>
                    <span className="text-slate-500">R$</span>
                    <Input
                      id="pf-average-cost"
                      value={values.averageCost ?? ''}
                      onChange={(e) => handleAverageCostChange(e.target.value)}
                      placeholder="0,00"
                      autoComplete="off"
                      inputMode="decimal"
                      className="h-6 w-24 border-0 bg-transparent p-0 text-sm font-semibold text-slate-900 shadow-none focus-visible:ring-0"
                    />
                  </label>
                  <span className={priceChipClass}>
                    <span>Lucro</span>
                    <strong
                      className={cn(
                        'font-semibold',
                        pricing.profitPerUnit >= 0 ? 'text-emerald-700' : 'text-red-700',
                      )}
                    >
                      {formatCurrency(pricing.profitPerUnit)}
                    </strong>
                  </span>
                  <span className={priceChipClass}>
                    <span>Margem</span>
                    <strong
                      className={cn(
                        'font-semibold',
                        pricing.profitPerUnit >= 0 ? 'text-emerald-700' : 'text-red-700',
                      )}
                    >
                      {formatMarginPercent(pricing.marginPercent)}
                    </strong>
                  </span>
                </div>
                {errors.averageCost ? (
                  <p className={cn(errorClass, 'mt-2')}>{errors.averageCost}</p>
                ) : null}
              </div>
            </div>
          )}

          {/* Section: Variantes */}
          <div className={cardClass}>
            <h2 className={sectionTitleClass}>Variantes</h2>
            <p className="text-xs text-slate-500">
              Configure opções como tamanho e cor para gerar variantes automaticamente.
            </p>

            {mediaSectionsDisabled ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 py-10">
                <p className="text-sm text-slate-400">Salve o produto para gerenciar variantes.</p>
              </div>
            ) : (
              <ProductVariantsTab
                productId={currentProductId!}
                defaultPrice={currentPrice}
                onHasVariantsChange={setManagesStockByVariants}
              />
            )}
          </div>

          {/* Section: Estoque */}
          <div className={cardClass}>
            <div>
              <h2 className={sectionTitleClass}>Estoque</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {mode === 'criar'
                  ? 'Informe o saldo inicial para o produto já nascer vendável. Se for usar variantes, deixe zero e cadastre o estoque em cada variante depois.'
                  : managesStockByVariants
                    ? 'O estoque é controlado por variante. Edite alertas por variante e use as telas de estoque para entradas, ajustes e reposições.'
                    : 'O saldo não é editado no cadastro. Use entradas, ajustes e reposições para manter o custo médio correto.'}
              </p>
            </div>

            {mode === 'criar' && !managesStockByVariants ? (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="max-w-[240px]">
                  <label className={labelClass} htmlFor="pf-initial-stock">
                    Estoque inicial
                  </label>
                  <Input
                    id="pf-initial-stock"
                    type="number"
                    min="0"
                    step="1"
                    value={values.initialStock}
                    onChange={(e) => handleIntegerChange('initialStock', e.target.value)}
                    autoComplete="off"
                    className={cn(
                      inputClass,
                      'mt-1',
                      errors.initialStock &&
                        'border-[#DC2626] focus:border-[#DC2626] focus:ring-[#DC2626]/20',
                    )}
                  />
                  {errors.initialStock ? (
                    <p className={cn(errorClass, 'mt-1')}>{errors.initialStock}</p>
                  ) : (
                    <p className="mt-1 text-[11px] text-slate-400">
                      Zero mantém o produto ativo, mas sem venda até uma entrada de estoque.
                    </p>
                  )}
                </div>
              </div>
            ) : mode === 'editar' && product ? (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className={metricCardClass}>
                  <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                    Físico
                  </div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">{product.onHand}</div>
                </div>
                <div className={metricCardClass}>
                  <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                    Disponível
                  </div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">
                    {product.available}
                  </div>
                </div>
                <div className={metricCardClass}>
                  <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                    Reservado
                  </div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">
                    {product.reserved}
                  </div>
                </div>
                <div className={metricCardClass}>
                  <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                    Em compra
                  </div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">
                    {product.incoming}
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                Salve o produto para registrar entradas, ajustes e reposições.
              </div>
            )}

            {!managesStockByVariants && (
              <div className="max-w-[240px]">
                <label className={labelClass} htmlFor="pf-threshold">
                  Alerta de estoque baixo
                </label>
                <Input
                  id="pf-threshold"
                  type="number"
                  min="0"
                  value={values.lowStockThreshold}
                  onChange={(e) => handleFieldChange('lowStockThreshold', e.target.value)}
                  autoComplete="off"
                  className={cn(inputClass, 'mt-1')}
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Aviso quando o disponível cair abaixo deste valor.
                </p>
              </div>
            )}

            {mode === 'editar' && product ? (
              <div className="flex flex-wrap gap-2">
                <Button asChild type="button" variant="outline" className="h-9 px-3 text-xs">
                  <Link href={`/vendas/estoque?productId=${product.id}`}>Abrir estoque</Link>
                </Button>
                <Button asChild type="button" variant="outline" className="h-9 px-3 text-xs">
                  <Link href="/vendas/reposicoes">Criar reposição</Link>
                </Button>
              </div>
            ) : null}
          </div>
        </div>

        {/* ── Sidebar ───────────────────────────────────────────── */}
        <div className="space-y-4">
          {/* Status */}
          <div className={cardClass}>
            <h2 className={sectionTitleClass}>Status</h2>
            {mode === 'editar' ? (
              <Select
                value={isActive ? 'ativo' : 'inativo'}
                onValueChange={(value) => void handleToggleActive(value === 'ativo')}
              >
                <SelectTrigger className={selectTriggerClass} aria-label="Status do produto">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ativo">Ativo</SelectItem>
                  <SelectItem value="inativo">Inativo</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-sm font-medium text-slate-900">Ativo</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  O produto será criado visível no catálogo.
                </p>
              </div>
            )}
          </div>

          {/* Loja */}
          <div className={cardClass}>
            <h2 className={sectionTitleClass}>Loja</h2>
            <div>
              <p className="text-sm text-slate-700">
                {mode === 'editar'
                  ? 'Nenhuma venda recente deste produto'
                  : 'Disponível após salvar'}
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {mode === 'editar'
                  ? 'Use o histórico para auditar compras, devoluções e margem realizada.'
                  : 'Após criar o produto, o histórico da Loja aparecerá aqui.'}
              </p>
            </div>
            {mode === 'editar' ? (
              <Button
                asChild
                type="button"
                variant="outline"
                className="h-9 justify-start px-3 text-xs"
              >
                <Link href="/vendas/historico">Ver histórico</Link>
              </Button>
            ) : null}
          </div>

          {/* Organização */}
          <div className={cardClass}>
            <h2 className={sectionTitleClass}>Organização do produto</h2>

            <div className="flex flex-col gap-1">
              <label className={labelClass} htmlFor="pf-sku">
                SKU base <span className="text-slate-400">(opcional)</span>
              </label>
              <Input
                id="pf-sku"
                value={values.sku}
                onChange={(e) => handleFieldChange('sku', e.target.value)}
                placeholder="Ex.: CAM-001"
                autoComplete="off"
                className={inputClass}
              />
              {managesStockByVariants ? (
                <p className="text-[11px] leading-5 text-slate-400">
                  Variantes podem ter SKU próprio no modal de edição.
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1">
              <label className={labelClass} htmlFor="pf-category">
                Categoria <span className="text-slate-400">(opcional)</span>
              </label>
              <Select
                value={values.categoryId || '_none'}
                onValueChange={(v) => handleFieldChange('categoryId', v === '_none' ? '' : v)}
              >
                <SelectTrigger className={selectTriggerClass} id="pf-category">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">Nenhuma</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
