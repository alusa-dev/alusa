'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { FinancePayerCandidateDTO } from '@/features/finance/dtos';
import { PayerSearchInput } from '@/components/financeiro/PayerSearchInput';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import DataTable, { type DataTableColumn } from '@/components/layout/DataTable';
import Pagination from '@/components/layout/Pagination';
import { Check, Minus, Plus, ShoppingBag, Trash2, User, UserPlus } from '@/components/icons/icons';
import { toast } from '@/components/ui/toast';
import { useProducts } from '@/features/vendas/hooks/use-products';
import { usePayerSearch } from '@/hooks/usePayerSearch';
import { cn } from '@/lib/utils';
import { formatBRLInput, labelClass, parseNumber } from '@/lib/finance-form-utils';
import {
  formatCpfCnpjBR,
  formatPhoneBR,
  isValidCpfCnpjBR,
  isValidPhoneBR,
  onlyDigits,
} from '@/lib/formatters';

import {
  BILLING_TYPE_LABELS,
  createSale,
  formatCurrencyBRL,
  formatSaleNumber,
  INVENTORY_MODE_LABELS,
  SALE_FINALIZATION_LABELS,
  SALE_PAYMENT_METHOD_LABELS,
  type BillingTypeValue,
  type CreateSaleRequest,
  type InventoryModeValue,
  type SaleFinalizationValue,
  type SalePaymentMethodValue,
} from './services/sales-service';
import { VariantSelectorModal } from './components/VariantSelectorModal';

type CustomerMode = 'REGISTRADO' | 'AVULSO';
type WizardStep = 0 | 1 | 2;

const STEP_LABELS = ['Cliente', 'Produtos', 'Pagamento'] as const;

type CartItem = {
  productId: string;
  productName: string;
  price: number;
  stock: number;
  quantity: number;
  categoryName: string | null;
  variantId?: string | null;
  variantTitle?: string | null;
};

function createUiRequestId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function mapSelectedCustomer(candidate: FinancePayerCandidateDTO): CreateSaleRequest['customer'] {
  if (candidate.type === 'aluno') {
    return {
      type: 'ALUNO',
      alunoId: candidate.id,
      responsavelId:
        candidate.payerResolved.type === 'responsavel'
          ? candidate.payerResolved.id
          : candidate.responsibleId,
    };
  }

  return {
    type: 'RESPONSAVEL',
    responsavelId: candidate.id,
  };
}

function toDateString(value: Date | undefined): string | null {
  if (!value) return null;
  const normalized = new Date(value);
  if (Number.isNaN(normalized.getTime())) return null;
  return normalized.toISOString().slice(0, 10);
}

function getTomorrow() {
  const value = new Date();
  value.setDate(value.getDate() + 1);
  return value;
}

export function CreateSaleFeature() {
  const router = useRouter();
  const payerSearch = usePayerSearch();
  const { items: products, categories, loading, error, meta, reload } = useProducts();

  const [wizardStep, setWizardStep] = useState<WizardStep>(0);
  const [customerMode, setCustomerMode] = useState<CustomerMode>('REGISTRADO');
  const [walkInName, setWalkInName] = useState('');
  const [walkInDocument, setWalkInDocument] = useState('');
  const [walkInEmail, setWalkInEmail] = useState('');
  const [walkInPhone, setWalkInPhone] = useState('');
  const [walkInNotes, setWalkInNotes] = useState('');
  const [saveWalkInCustomer, setSaveWalkInCustomer] = useState<'NAO' | 'SIM'>('NAO');
  const [inventoryMode, setInventoryMode] = useState<InventoryModeValue>('IMMEDIATE');
  const [finalizationType, setFinalizationType] =
    useState<SaleFinalizationValue>('RECEBIMENTO_PRESENCIAL');
  const [paymentMethod, setPaymentMethod] = useState<SalePaymentMethodValue>('DINHEIRO');
  const [amountReceivedInput, setAmountReceivedInput] = useState('');
  const [chargeDueDate, setChargeDueDate] = useState<Date | undefined>(getTomorrow());
  const [billingType, setBillingType] = useState<BillingTypeValue>('PIX');
  const [installmentCount, setInstallmentCount] = useState(1);
  const [discountInput, setDiscountInput] = useState('');
  const [requestId, setRequestId] = useState(() => createUiRequestId());
  const [productSearch, setProductSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string>('ALL');
  const [page, setPage] = useState(1);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Variant selector
  const [variantSelectorProduct, setVariantSelectorProduct] = useState<
    (typeof products)[number] | null
  >(null);

  const deferredProductSearch = useDeferredValue(productSearch);
  const discount = parseNumber(discountInput) ?? 0;
  const amountReceived = parseNumber(amountReceivedInput) ?? 0;

  const selectedPayer = payerSearch.selectedPayer;
  const cartSubtotal = useMemo(
    () => cart.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [cart],
  );
  const total = useMemo(() => Math.max(cartSubtotal - discount, 0), [cartSubtotal, discount]);
  const canUseInstallments = billingType === 'BOLETO' || billingType === 'CREDIT_CARD';
  const activeProducts = useMemo(() => products.filter((product) => product.isActive), [products]);

  useEffect(() => {
    void reload({
      search: deferredProductSearch,
      categoryId: categoryId === 'ALL' ? undefined : categoryId,
      activeOnly: true,
      page,
      pageSize: 8,
    });
  }, [categoryId, deferredProductSearch, page, reload]);

  useEffect(() => {
    if (finalizationType === 'COBRANCA') {
      setInventoryMode('RESERVE');
    }
  }, [finalizationType]);

  useEffect(() => {
    if (!canUseInstallments) {
      setInstallmentCount(1);
    }
  }, [canUseInstallments]);

  useEffect(() => {
    if (!error) return;
    toast.error({ title: 'Erro ao carregar produtos', description: error });
  }, [error]);

  const productColumns: DataTableColumn<(typeof products)[number]>[] = [
    {
      id: 'produto',
      header: 'Produto',
      render: (product) => (
        <div className="space-y-1">
          <p className="font-medium text-slate-900">{product.name}</p>
          <p className="text-xs text-slate-500">
            {product.category?.name ?? 'Sem categoria'}
            {product.sku ? ` · SKU ${product.sku}` : ''}
          </p>
        </div>
      ),
    },
    {
      id: 'preco',
      header: 'Preço',
      width: 'w-[140px]',
      render: (product) => formatCurrencyBRL(product.price),
    },
    {
      id: 'estoque',
      header: 'Disponível',
      width: 'w-[120px]',
      render: (product) => String(product.totalAvailable),
    },
    {
      id: 'acoes',
      header: '',
      width: 'w-[130px]',
      align: 'right',
      render: (product) => {
        const availableStock = product.totalAvailable;

        return (
          <Button
            size="sm"
            disabled={availableStock <= 0}
            onClick={(event) => {
              event.stopPropagation();

              if (product.hasVariants) {
                setVariantSelectorProduct(product);
                return;
              }

              setCart((current) => {
                const existing = current.find(
                  (item) => item.productId === product.id && !item.variantId,
                );
                if (!existing) {
                  return [
                    ...current,
                    {
                      productId: product.id,
                      productName: product.name,
                      price: product.price,
                      stock: availableStock,
                      quantity: 1,
                      categoryName: product.category?.name ?? null,
                    },
                  ];
                }

                if (existing.quantity >= availableStock) {
                  toast.warning({
                    title: 'Estoque atingido',
                    description: `Não há mais unidades disponíveis de ${product.name}.`,
                  });
                  return current;
                }

                return current.map((item) =>
                  item.productId === product.id && !item.variantId
                    ? { ...item, quantity: item.quantity + 1, stock: availableStock }
                    : item,
                );
              });
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            {product.hasVariants ? 'Variante' : 'Adicionar'}
          </Button>
        );
      },
    },
  ];

  const resetForm = () => {
    payerSearch.reset();
    setWizardStep(0);
    setCustomerMode('REGISTRADO');
    setWalkInName('');
    setWalkInDocument('');
    setWalkInEmail('');
    setWalkInPhone('');
    setWalkInNotes('');
    setSaveWalkInCustomer('NAO');
    setInventoryMode('IMMEDIATE');
    setFinalizationType('RECEBIMENTO_PRESENCIAL');
    setPaymentMethod('DINHEIRO');
    setAmountReceivedInput('');
    setChargeDueDate(getTomorrow());
    setBillingType('PIX');
    setInstallmentCount(1);
    setDiscountInput('');
    setCart([]);
    setRequestId(createUiRequestId());
    setVariantSelectorProduct(null);
  };

  const handleSubmit = async () => {
    if (cart.length === 0) {
      toast.warning({
        title: 'Carrinho vazio',
        description: 'Adicione ao menos um produto para concluir.',
      });
      return;
    }

    let customer: CreateSaleRequest['customer'];
    if (customerMode === 'REGISTRADO') {
      if (!selectedPayer) {
        toast.warning({
          title: 'Cliente obrigatório',
          description: 'Selecione um aluno ou responsável.',
        });
        return;
      }
      customer = mapSelectedCustomer(selectedPayer);
    } else {
      if (!walkInName.trim()) {
        toast.warning({
          title: 'Nome obrigatório',
          description: 'Informe o nome do cliente avulso.',
        });
        return;
      }

      const requiresFinancialCustomer =
        finalizationType === 'COBRANCA' || saveWalkInCustomer === 'SIM';
      const documentDigits = onlyDigits(walkInDocument);
      const phoneDigits = onlyDigits(walkInPhone);
      const email = walkInEmail.trim().toLowerCase();

      if (requiresFinancialCustomer) {
        if (!isValidCpfCnpjBR(documentDigits)) {
          toast.warning({
            title: 'CPF/CNPJ obrigatório',
            description: 'Informe um CPF ou CNPJ válido para continuar.',
          });
          return;
        }

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          toast.warning({
            title: 'E-mail obrigatório',
            description: 'Informe um e-mail válido para continuar.',
          });
          return;
        }

        if (!isValidPhoneBR(phoneDigits)) {
          toast.warning({
            title: 'Telefone obrigatório',
            description: 'Informe um telefone válido para continuar.',
          });
          return;
        }
      }

      customer = {
        type: 'AVULSO',
        name: walkInName.trim(),
        document: documentDigits || null,
        email: email || null,
        phone: phoneDigits || null,
        notes: walkInNotes.trim() || null,
        saveCustomer: saveWalkInCustomer === 'SIM',
      };
    }

    let finalization: CreateSaleRequest['finalization'];
    if (finalizationType === 'RECEBIMENTO_PRESENCIAL') {
      if (paymentMethod === 'DINHEIRO' && amountReceived < total) {
        toast.warning({
          title: 'Valor insuficiente',
          description: 'O valor recebido em dinheiro deve cobrir o total da venda.',
        });
        return;
      }

      finalization = {
        type: 'RECEBIMENTO_PRESENCIAL',
        paymentMethod,
        amountReceived: paymentMethod === 'DINHEIRO' ? amountReceived : null,
      };
    } else if (finalizationType === 'COBRANCA') {
      const dueDate = toDateString(chargeDueDate);
      if (!dueDate) {
        toast.warning({
          title: 'Vencimento obrigatório',
          description: 'Defina o vencimento da cobrança.',
        });
        return;
      }

      finalization = {
        type: 'COBRANCA',
        dueDate,
        billingType,
        installmentCount: canUseInstallments ? installmentCount : 1,
      };
    } else {
      toast.error({
        title: 'Finalização inválida',
        description: 'Selecione uma forma de finalização suportada para a venda.',
      });
      return;
    }

    setSubmitting(true);
    try {
      const sale = await createSale({
        uiRequestId: requestId,
        inventoryMode: finalizationType === 'COBRANCA' ? 'RESERVE' : inventoryMode,
        customer,
        items: cart.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          variantId: item.variantId ?? undefined,
        })),
        discount,
        finalization,
      });

      toast.success({
        title: `Venda ${formatSaleNumber(sale.saleNumber)} criada`,
        description:
          sale.inventoryMode === 'RESERVE'
            ? 'Reserva registrada. O estoque ficou comprometido até o cumprimento da venda.'
            : sale.finalizationType === 'RECEBIMENTO_PRESENCIAL'
              ? 'Recebimento presencial confirmado e estoque atualizado.'
              : 'Cobrança gerada. O estoque ficou reservado até a confirmação.',
      });

      resetForm();
      router.push(
        sale.finalizationType === 'RECEBIMENTO_PRESENCIAL'
          ? `/vendas/${sale.id}/comprovante`
          : `/vendas/${sale.id}/cobranca`,
      );
      router.refresh();
    } catch (submitError) {
      toast.error({
        title: 'Falha ao concluir venda',
        description: (submitError as Error).message,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const canAdvanceStep0 =
    customerMode === 'REGISTRADO' ? Boolean(selectedPayer) : Boolean(walkInName.trim());

  const canAdvanceStep1 = cart.length > 0;

  const goNext = () => setWizardStep((s) => Math.min(2, s + 1) as WizardStep);
  const goBack = () => setWizardStep((s) => Math.max(0, s - 1) as WizardStep);
  const isIntroStep = wizardStep === 0;

  return (
    <>
      {variantSelectorProduct && (
        <VariantSelectorModal
          open={!!variantSelectorProduct}
          productId={variantSelectorProduct.id}
          productName={variantSelectorProduct.name}
          defaultPrice={variantSelectorProduct.price}
          onClose={() => setVariantSelectorProduct(null)}
          onConfirm={(variant) => {
            const price = variant.price ?? variantSelectorProduct.price;
            setCart((current) => {
              const existing = current.find(
                (item) =>
                  item.productId === variantSelectorProduct.id && item.variantId === variant.id,
              );
              if (!existing) {
                return [
                  ...current,
                  {
                    productId: variantSelectorProduct.id,
                    productName: variantSelectorProduct.name,
                    price,
                    stock: variant.available,
                    quantity: 1,
                    categoryName: variantSelectorProduct.category?.name ?? null,
                    variantId: variant.id,
                    variantTitle: variant.title,
                  },
                ];
              }
              if (existing.quantity >= variant.available) {
                toast.warning({
                  title: 'Estoque atingido',
                  description: `Não há mais unidades disponíveis de ${variantSelectorProduct.name} — ${variant.title}.`,
                });
                return current;
              }
              return current.map((item) =>
                item.productId === variantSelectorProduct.id && item.variantId === variant.id
                  ? { ...item, quantity: item.quantity + 1 }
                  : item,
              );
            });
          }}
        />
      )}
      <div
        className={cn('mx-auto w-full', isIntroStep && 'grid h-full min-h-full place-items-center')}
      >
        <div
          className={cn('mx-auto w-full space-y-6', isIntroStep ? 'max-w-[640px]' : 'max-w-4xl')}
        >
          {/* Cabeçalho */}
          <div className={cn(isIntroStep && 'text-center')}>
            <h1 className="text-[24px] font-semibold tracking-tight text-slate-900">Nova venda</h1>
            <p className="text-sm text-slate-500">
              Preencha as informações para registrar uma nova venda.
            </p>
          </div>

          {/* Indicador de etapas */}
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-5">
            <div className="flex items-start justify-center gap-0">
              {STEP_LABELS.map((label, index) => {
                const isDone = index < wizardStep;
                const isActive = index === wizardStep;
                return (
                  <div key={label} className="flex items-start">
                    <div className="flex flex-col items-center gap-2">
                      <div
                        className={cn(
                          'flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-all',
                          isDone && 'bg-brand-accent text-white',
                          isActive && 'bg-brand-accent text-white ring-4 ring-brand-accent/20',
                          !isDone && !isActive && 'bg-slate-100 text-slate-400',
                        )}
                      >
                        {isDone ? <Check className="h-4 w-4" /> : index + 1}
                      </div>
                      <span
                        className={cn(
                          'text-xs font-medium',
                          isActive ? 'text-slate-900' : 'text-slate-400',
                        )}
                      >
                        {label}
                      </span>
                    </div>
                    {index < STEP_LABELS.length - 1 && (
                      <div
                        className={cn(
                          'mx-4 mt-4 h-px w-20 transition-colors',
                          index < wizardStep ? 'bg-brand-accent' : 'bg-slate-200',
                        )}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Conteúdo da etapa */}
          {wizardStep === 0 && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setCustomerMode('REGISTRADO')}
                  className={cn(
                    'relative flex flex-col gap-3 rounded-xl border-2 p-5 text-left transition-all',
                    customerMode === 'REGISTRADO'
                      ? 'border-brand-accent bg-brand-accent/5'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
                  )}
                >
                  {customerMode === 'REGISTRADO' && (
                    <span className="absolute right-4 top-4 flex h-5 w-5 items-center justify-center rounded-full bg-brand-accent">
                      <Check className="h-3 w-3 text-white" />
                    </span>
                  )}
                  <span
                    className={cn(
                      'flex h-10 w-10 items-center justify-center rounded-lg',
                      customerMode === 'REGISTRADO'
                        ? 'bg-brand-accent/10 text-brand-accent'
                        : 'bg-slate-100 text-slate-500',
                    )}
                  >
                    <User className="h-5 w-5" />
                  </span>
                  <span>
                    <span className="block font-medium text-slate-900">Buscar Cliente</span>
                    <span className="mt-0.5 block text-sm text-slate-500">
                      Pessoa já cadastrada no sistema
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setCustomerMode('AVULSO')}
                  className={cn(
                    'relative flex flex-col gap-3 rounded-xl border-2 p-5 text-left transition-all',
                    customerMode === 'AVULSO'
                      ? 'border-brand-accent bg-brand-accent/5'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
                  )}
                >
                  {customerMode === 'AVULSO' && (
                    <span className="absolute right-4 top-4 flex h-5 w-5 items-center justify-center rounded-full bg-brand-accent">
                      <Check className="h-3 w-3 text-white" />
                    </span>
                  )}
                  <span
                    className={cn(
                      'flex h-10 w-10 items-center justify-center rounded-lg',
                      customerMode === 'AVULSO'
                        ? 'bg-brand-accent/10 text-brand-accent'
                        : 'bg-slate-100 text-slate-500',
                    )}
                  >
                    <UserPlus className="h-5 w-5" />
                  </span>
                  <span>
                    <span className="block font-medium text-slate-900">Cliente avulso</span>
                    <span className="mt-0.5 block text-sm text-slate-500">
                      Pessoa não cadastrada no sistema
                    </span>
                  </span>
                </button>
              </div>

              <Card>
                <CardContent className="space-y-4 pt-6">
                  {customerMode === 'REGISTRADO' ? (
                    <>
                      <PayerSearchInput
                        search={payerSearch}
                        label="Nome ou CPF"
                        placeholder="Busque pelo nome ou CPF"
                      />
                      {selectedPayer ? (
                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                          <p className="font-medium text-slate-900">{selectedPayer.name}</p>
                          <p className="text-slate-500">
                            {selectedPayer.type === 'aluno' ? 'Aluno' : 'Responsável financeiro'}
                            {selectedPayer.payerResolved.type === 'responsavel' &&
                            selectedPayer.type === 'aluno'
                              ? ` · Pagador: ${selectedPayer.payerResolved.name}`
                              : ''}
                          </p>
                          {selectedPayer.financialStatus === 'INCOMPLETE' ? (
                            <p className="mt-2 text-amber-700">
                              Cadastro incompleto. Cobrança pode ser bloqueada até informar
                              CPF/CNPJ.
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2 sm:col-span-2">
                        <label className={labelClass}>Nome *</label>
                        <Input
                          value={walkInName}
                          onChange={(event) => setWalkInName(event.target.value)}
                          placeholder="Nome completo"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className={labelClass}>CPF/CNPJ</label>
                        <Input
                          value={walkInDocument}
                          onChange={(event) =>
                            setWalkInDocument(formatCpfCnpjBR(event.target.value))
                          }
                          placeholder="000.000.000-00"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className={labelClass}>Telefone</label>
                        <Input
                          value={walkInPhone}
                          onChange={(event) => setWalkInPhone(formatPhoneBR(event.target.value))}
                          placeholder="(00) 00000-0000"
                        />
                      </div>
                      <div className="space-y-2 sm:col-span-2">
                        <label className={labelClass}>E-mail</label>
                        <Input
                          type="email"
                          value={walkInEmail}
                          onChange={(event) => setWalkInEmail(event.target.value)}
                          placeholder="cliente@email.com"
                        />
                      </div>
                      <div className="space-y-2 sm:col-span-2">
                        <label className={labelClass}>Observação</label>
                        <Textarea
                          value={walkInNotes}
                          onChange={(event) => setWalkInNotes(event.target.value)}
                          rows={3}
                          placeholder="Informações adicionais"
                        />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {wizardStep === 1 && (
            <div className="grid gap-6 xl:grid-cols-[1fr,360px]">
              {/* Tabela de produtos */}
              <Card>
                <CardHeader>
                  <CardTitle>Escolha os produtos</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-[1fr,200px]">
                    <Input
                      placeholder="Buscar por produto ou SKU"
                      value={productSearch}
                      onChange={(event) => {
                        setPage(1);
                        setProductSearch(event.target.value);
                      }}
                    />
                    <Select
                      value={categoryId}
                      onValueChange={(value) => {
                        setPage(1);
                        setCategoryId(value);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">Todas as categorias</SelectItem>
                        {categories.map((category) => (
                          <SelectItem key={category.id} value={category.id}>
                            {category.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <DataTable
                      columns={productColumns}
                      data={activeProducts}
                      rowKey={(product) => product.id}
                      loading={loading}
                      emptyMessage={
                        <div className="px-6 py-10 text-center text-sm text-slate-500">
                          Nenhum produto disponível para venda.
                        </div>
                      }
                    />
                  </div>
                  <Pagination
                    total={meta.total}
                    page={meta.page}
                    pageSize={meta.pageSize}
                    onChange={setPage}
                  />
                </CardContent>
              </Card>

              {/* Carrinho */}
              <div className="xl:sticky xl:top-24 xl:self-start">
                <Card>
                  <CardHeader>
                    <CardTitle>Carrinho</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {cart.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                        Nenhum item adicionado.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {cart.map((item) => (
                          <div
                            key={`${item.productId}-${item.variantId ?? 'base'}`}
                            className="rounded-xl border border-slate-200 p-3"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-medium text-slate-900">{item.productName}</p>
                                <p className="text-xs text-slate-500">
                                  {item.variantTitle ? `${item.variantTitle} · ` : ''}
                                  {item.categoryName ?? 'Sem categoria'} ·{' '}
                                  {formatCurrencyBRL(item.price)}
                                </p>
                              </div>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="text-slate-500"
                                onClick={() =>
                                  setCart((current) =>
                                    current.filter(
                                      (entry) =>
                                        !(
                                          entry.productId === item.productId &&
                                          entry.variantId === item.variantId
                                        ),
                                    ),
                                  )
                                }
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                            <div className="mt-3 flex items-center justify-between">
                              <div className="flex items-center gap-2 rounded-full border border-slate-200 px-2 py-1">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7"
                                  onClick={() =>
                                    setCart((current) =>
                                      current
                                        .map((entry) =>
                                          entry.productId === item.productId &&
                                          entry.variantId === item.variantId
                                            ? {
                                                ...entry,
                                                quantity: Math.max(1, entry.quantity - 1),
                                              }
                                            : entry,
                                        )
                                        .filter((entry) => entry.quantity > 0),
                                    )
                                  }
                                >
                                  <Minus className="h-4 w-4" />
                                </Button>
                                <span className="min-w-[20px] text-center text-sm font-medium text-slate-900">
                                  {item.quantity}
                                </span>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7"
                                  onClick={() => {
                                    if (item.quantity >= item.stock) {
                                      toast.warning({
                                        title: 'Estoque atingido',
                                        description: `Não há mais unidades disponíveis de ${item.productName}.`,
                                      });
                                      return;
                                    }
                                    setCart((current) =>
                                      current.map((entry) =>
                                        entry.productId === item.productId &&
                                        entry.variantId === item.variantId
                                          ? { ...entry, quantity: entry.quantity + 1 }
                                          : entry,
                                      ),
                                    );
                                  }}
                                >
                                  <Plus className="h-4 w-4" />
                                </Button>
                              </div>
                              <p className="text-sm font-semibold text-slate-900">
                                {formatCurrencyBRL(item.price * item.quantity)}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="space-y-2">
                      <label className={labelClass}>Desconto</label>
                      <Input
                        inputMode="numeric"
                        placeholder="0,00"
                        value={discountInput}
                        onChange={(event) => setDiscountInput(formatBRLInput(event.target.value))}
                      />
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                      <div className="flex items-center justify-between">
                        <span>Subtotal</span>
                        <span>{formatCurrencyBRL(cartSubtotal)}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <span>Desconto</span>
                        <span>{formatCurrencyBRL(discount)}</span>
                      </div>
                      <div className="mt-3 flex items-center justify-between text-base font-semibold text-slate-900">
                        <span>Total</span>
                        <span>{formatCurrencyBRL(total)}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          {wizardStep === 2 && (
            <div className="grid gap-6 xl:grid-cols-[1fr,320px]">
              {/* Opções de pagamento */}
              <Card>
                <CardHeader>
                  <CardTitle>Estoque e pagamento</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <label className={labelClass}>Operação de estoque</label>
                    <Select
                      value={inventoryMode}
                      onValueChange={(value: InventoryModeValue) => setInventoryMode(value)}
                      disabled={finalizationType === 'COBRANCA'}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(INVENTORY_MODE_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-slate-500">
                      {inventoryMode === 'IMMEDIATE'
                        ? 'Baixa física imediata no estoque.'
                        : finalizationType === 'COBRANCA'
                          ? 'Cobrança reserva o saldo até o pagamento e a entrega.'
                          : 'Reserva o saldo agora e baixa fisicamente no cumprimento da venda.'}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className={labelClass}>Tipo de finalização</label>
                    <Select
                      value={finalizationType}
                      onValueChange={(value: SaleFinalizationValue) => setFinalizationType(value)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="RECEBIMENTO_PRESENCIAL">
                          {SALE_FINALIZATION_LABELS.RECEBIMENTO_PRESENCIAL}
                        </SelectItem>
                        <SelectItem value="COBRANCA">
                          {SALE_FINALIZATION_LABELS.COBRANCA}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {customerMode === 'AVULSO' ? (
                    <div className="space-y-2">
                      <label className={labelClass}>Salvar cliente no sistema?</label>
                      <Select
                        value={saveWalkInCustomer}
                        onValueChange={(value: 'NAO' | 'SIM') => setSaveWalkInCustomer(value)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="NAO">Não salvar</SelectItem>
                          <SelectItem value="SIM">Salvar cliente</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}

                  {finalizationType === 'RECEBIMENTO_PRESENCIAL' ? (
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className={labelClass}>Método de recebimento</label>
                        <Select
                          value={paymentMethod}
                          onValueChange={(value: SalePaymentMethodValue) => setPaymentMethod(value)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(SALE_PAYMENT_METHOD_LABELS).map(([value, label]) => (
                              <SelectItem key={value} value={value}>
                                {label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {paymentMethod === 'DINHEIRO' ? (
                        <div className="space-y-2">
                          <label className={labelClass}>Valor recebido</label>
                          <Input
                            inputMode="numeric"
                            placeholder="0,00"
                            value={amountReceivedInput}
                            onChange={(event) =>
                              setAmountReceivedInput(formatBRLInput(event.target.value))
                            }
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {finalizationType === 'COBRANCA' ? (
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className={labelClass}>Vencimento</label>
                        <DatePicker
                          value={chargeDueDate}
                          onChange={setChargeDueDate}
                          variant="input"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className={labelClass}>Forma de cobrança</label>
                        <Select
                          value={billingType}
                          onValueChange={(value: BillingTypeValue) => {
                            setBillingType(value);
                            if (value === 'PIX' || value === 'UNDEFINED') {
                              setInstallmentCount(1);
                            }
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(BILLING_TYPE_LABELS).map(([value, label]) => (
                              <SelectItem key={value} value={value}>
                                {label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <label className={labelClass}>Parcelamento</label>
                        <Select
                          value={String(installmentCount)}
                          disabled={!canUseInstallments}
                          onValueChange={(value) => setInstallmentCount(Number(value))}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Array.from({ length: 12 }, (_, index) => index + 1).map((count) => (
                              <SelectItem key={count} value={String(count)}>
                                {count === 1
                                  ? 'À vista'
                                  : `${count}x de ${formatCurrencyBRL(total / count)}`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-slate-500">
                          {canUseInstallments
                            ? 'Parcelamento disponível para boleto e cartão de crédito.'
                            : 'Pix e débito/link são gerados à vista.'}
                        </p>
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              {/* Resumo do pedido */}
              <div className="xl:sticky xl:top-24 xl:self-start">
                <Card>
                  <CardHeader>
                    <CardTitle>Resumo</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      {cart.map((item) => (
                        <div
                          key={`${item.productId}-${item.variantId ?? 'base'}`}
                          className="flex items-center justify-between text-sm"
                        >
                          <span className="text-slate-700">
                            {item.productName}
                            {item.variantTitle ? (
                              <span className="text-slate-500"> ({item.variantTitle})</span>
                            ) : null}{' '}
                            <span className="text-slate-400">× {item.quantity}</span>
                          </span>
                          <span className="font-medium text-slate-900">
                            {formatCurrencyBRL(item.price * item.quantity)}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="border-t border-slate-100 pt-3 text-sm text-slate-600">
                      <div className="flex items-center justify-between">
                        <span>Subtotal</span>
                        <span>{formatCurrencyBRL(cartSubtotal)}</span>
                      </div>
                      {discount > 0 ? (
                        <div className="mt-1.5 flex items-center justify-between">
                          <span>Desconto</span>
                          <span>−{formatCurrencyBRL(discount)}</span>
                        </div>
                      ) : null}
                      <div className="mt-3 flex items-center justify-between text-base font-semibold text-slate-900">
                        <span>Total</span>
                        <span>{formatCurrencyBRL(total)}</span>
                      </div>
                      {paymentMethod === 'DINHEIRO' && amountReceivedInput ? (
                        <div className="mt-2 flex items-center justify-between">
                          <span>Troco</span>
                          <span>{formatCurrencyBRL(Math.max(amountReceived - total, 0))}</span>
                        </div>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          {/* Navegação entre etapas */}
          <div className="flex items-center justify-between border-t border-slate-100 pt-4">
            {wizardStep > 0 ? (
              <Button variant="outline" onClick={goBack}>
                Voltar
              </Button>
            ) : (
              <div />
            )}

            {wizardStep < 2 ? (
              <Button
                className="bg-brand-accent text-white hover:bg-brand-accent/90"
                disabled={wizardStep === 0 ? !canAdvanceStep0 : !canAdvanceStep1}
                onClick={goNext}
              >
                Avançar
              </Button>
            ) : (
              <Button
                className="bg-brand-accent text-white hover:bg-brand-accent/90"
                disabled={submitting || cart.length === 0}
                onClick={handleSubmit}
              >
                <ShoppingBag className="mr-2 h-4 w-4" />
                {submitting ? 'Processando...' : 'Concluir venda'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
