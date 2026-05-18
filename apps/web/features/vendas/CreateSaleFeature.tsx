'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { FinancePayerCandidateDTO } from '@/features/finance/dtos';
import { PayerSearchInput } from '@/components/financeiro/PayerSearchInput';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
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
import type { ProductListItem } from './services/products-service';

type CustomerMode = 'REGISTRADO' | 'AVULSO';
type WizardStep = 0 | 1 | 2;
type WalkInDocumentStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available' }
  | { state: 'exists'; name: string | null }
  | { state: 'error' };

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
  const [walkInDocumentStatus, setWalkInDocumentStatus] = useState<WalkInDocumentStatus>({
    state: 'idle',
  });
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
  const walkInDocumentDigits = onlyDigits(walkInDocument);
  const walkInDocumentError = useMemo(() => {
    if (!walkInDocumentDigits) return null;
    if (!isValidCpfCnpjBR(walkInDocumentDigits)) return 'CPF/CNPJ inválido';
    if (walkInDocumentStatus.state === 'exists') return 'Cliente já cadastrado';
    if (walkInDocumentStatus.state === 'error') return 'Não foi possível validar';
    return null;
  }, [walkInDocumentDigits, walkInDocumentStatus]);
  const cartSubtotal = useMemo(
    () => cart.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [cart],
  );
  const total = useMemo(() => Math.max(cartSubtotal - discount, 0), [cartSubtotal, discount]);
  const canUseInstallments = billingType === 'BOLETO' || billingType === 'CREDIT_CARD';
  const activeProducts = useMemo(() => products.filter((product) => product.isActive), [products]);

  const addProductToCart = useCallback((product: ProductListItem) => {
    const availableStock = product.totalAvailable;

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
  }, []);

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

  useEffect(() => {
    if (customerMode !== 'AVULSO') {
      setWalkInDocumentStatus({ state: 'idle' });
      return;
    }

    if (!walkInDocumentDigits || !isValidCpfCnpjBR(walkInDocumentDigits)) {
      setWalkInDocumentStatus({ state: 'idle' });
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setWalkInDocumentStatus({ state: 'checking' });
      try {
        const response = await fetch(
          `/api/vendas/clientes-avulsos/documento?${new URLSearchParams({
            document: walkInDocumentDigits,
            uiRequestId: requestId,
          }).toString()}`,
          { cache: 'no-store', signal: controller.signal },
        );

        if (!response.ok) throw new Error('Falha ao validar CPF/CNPJ');
        const data = (await response.json()) as {
          exists?: boolean;
          match?: { name?: string | null } | null;
        };

        setWalkInDocumentStatus(
          data.exists
            ? { state: 'exists', name: data.match?.name ?? null }
            : { state: 'available' },
        );
      } catch (validationError) {
        if ((validationError as Error).name === 'AbortError') return;
        setWalkInDocumentStatus({ state: 'error' });
      }
    }, 350);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [customerMode, walkInDocumentDigits, requestId]);

  const productColumns: DataTableColumn<(typeof products)[number]>[] = [
    {
      id: 'produto',
      header: 'Produto',
      width: 'min-w-0 w-[40%]',
      noWrap: false,
      render: (product) => (
        <div className="min-w-0 space-y-1">
          <p className="truncate font-medium text-slate-900">{product.name}</p>
          <p className="truncate text-xs text-slate-500">
            {product.category?.name ?? 'Sem categoria'}
            {product.sku ? ` · SKU ${product.sku}` : ''}
          </p>
        </div>
      ),
    },
    {
      id: 'preco',
      header: 'Preço',
      width: 'w-[16%]',
      align: 'right',
      headerClassName: 'text-right',
      cellClassName: 'text-right tabular-nums',
      render: (product) => formatCurrencyBRL(product.price),
    },
    {
      id: 'estoque',
      header: 'Disponível',
      width: 'w-[14%]',
      align: 'center',
      headerClassName: 'text-center',
      cellClassName: 'text-center tabular-nums',
      render: (product) => String(product.totalAvailable),
    },
    {
      id: 'acoes',
      header: '',
      width: 'w-[30%] min-w-[9.5rem]',
      align: 'right',
      headerClassName: 'pr-4 text-right md:pr-6',
      cellClassName: 'pr-4 text-right md:pr-6',
      noWrap: false,
      render: (product) => {
        const availableStock = product.totalAvailable;

        return (
          <div className="flex justify-end">
            <Button
              size="sm"
              className="max-w-full shrink-0"
              disabled={availableStock <= 0}
              onClick={(event) => {
                event.stopPropagation();
                addProductToCart(product);
              }}
            >
              <Plus className="mr-2 h-4 w-4 shrink-0" />
              {product.hasVariants ? 'Variante' : 'Adicionar'}
            </Button>
          </div>
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
    setWalkInDocumentStatus({ state: 'idle' });
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
      const documentDigits = walkInDocumentDigits;
      const phoneDigits = onlyDigits(walkInPhone);
      const email = walkInEmail.trim().toLowerCase();

      if (requiresFinancialCustomer) {
        if (
          !isValidCpfCnpjBR(documentDigits) ||
          walkInDocumentStatus.state === 'exists' ||
          walkInDocumentStatus.state === 'checking'
        ) {
          const title =
            walkInDocumentStatus.state === 'exists'
              ? 'Cliente já cadastrado'
              : walkInDocumentStatus.state === 'checking'
                ? 'Validando CPF/CNPJ'
                : 'CPF/CNPJ obrigatório';
          toast.warning({
            title,
            description:
              walkInDocumentStatus.state === 'exists'
                ? 'Use a opção Buscar Cliente para continuar.'
                : walkInDocumentStatus.state === 'checking'
                  ? 'Aguarde a validação para continuar.'
                  : 'Informe um CPF ou CNPJ válido para continuar.',
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

  const goNext = () => {
    if (wizardStep === 0 && customerMode === 'AVULSO') {
      if (walkInDocumentStatus.state === 'checking') {
        toast.warning({
          title: 'Validando CPF/CNPJ',
          description: 'Aguarde a validação para continuar.',
        });
        return;
      }

      if (walkInDocumentError) {
        toast.warning({
          title: walkInDocumentError,
          description:
            walkInDocumentError === 'Cliente já cadastrado'
              ? 'Use a opção Buscar Cliente para continuar.'
              : 'Revise os dados do cliente avulso para continuar.',
        });
        return;
      }
    }

    setWizardStep((s) => Math.min(2, s + 1) as WizardStep);
  };
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
        className={cn(
          'mx-auto w-full min-w-0',
          isIntroStep && 'md:grid md:min-h-[min(100%,720px)] md:place-items-center',
        )}
      >
        <div
          className={cn(
            'mx-auto w-full min-w-0 space-y-4 sm:space-y-5 md:space-y-6',
            isIntroStep ? 'max-w-full md:max-w-xl lg:max-w-2xl' : 'max-w-4xl',
          )}
        >
          {/* Cabeçalho */}
          <div className={cn(isIntroStep && 'text-center')}>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl md:text-[24px]">
              Nova venda
            </h1>
            <p className="mt-1 text-sm leading-snug text-slate-500 sm:mt-0">
              Preencha as informações para registrar uma nova venda.
            </p>
          </div>

          {/* Indicador de etapas */}
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-4 sm:px-6 sm:py-5">
            <div className="flex w-full items-start">
              {STEP_LABELS.flatMap((label, index) => {
                const isDone = index < wizardStep;
                const isActive = index === wizardStep;
                const stepEl = (
                  <div
                    key={label}
                    className="flex w-[4.5rem] shrink-0 flex-col items-center gap-1.5 sm:w-[5.5rem] md:w-24"
                  >
                    <div
                      className={cn(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-all',
                        isDone && 'bg-brand-accent text-white',
                        isActive && 'bg-brand-accent text-white ring-4 ring-brand-accent/20',
                        !isDone && !isActive && 'bg-slate-100 text-slate-400',
                      )}
                    >
                      {isDone ? <Check className="h-4 w-4" /> : index + 1}
                    </div>
                    <span
                      className={cn(
                        'w-full text-center text-[10px] font-medium leading-tight sm:text-xs',
                        isActive ? 'text-slate-900' : 'text-slate-400',
                      )}
                    >
                      {label}
                    </span>
                  </div>
                );

                if (index >= STEP_LABELS.length - 1) {
                  return [stepEl];
                }

                const lineEl = (
                  <div
                    key={`${label}-sep`}
                    className={cn(
                      'mx-0.5 mt-4 h-px min-w-[8px] flex-1 sm:mx-2 md:mx-3',
                      index < wizardStep ? 'bg-brand-accent' : 'bg-slate-200',
                    )}
                    aria-hidden
                  />
                );
                return [stepEl, lineEl];
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
                    'relative flex min-h-[5.5rem] flex-col gap-3 rounded-xl border-2 p-4 text-left transition-all active:scale-[0.99] sm:min-h-0 sm:p-5',
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
                    'relative flex min-h-[5.5rem] flex-col gap-3 rounded-xl border-2 p-4 text-left transition-all active:scale-[0.99] sm:min-h-0 sm:p-5',
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
                        <div className="flex items-center gap-2">
                          <label className={labelClass}>CPF/CNPJ</label>
                          {walkInDocumentError ? (
                            <span className="text-xs font-medium text-red-600">
                              {walkInDocumentError}
                            </span>
                          ) : null}
                        </div>
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
            <div className="grid gap-5 xl:grid-cols-[1fr,360px] xl:gap-6">
              {/* Tabela de produtos */}
              <Card className="min-w-0">
                <CardHeader className="space-y-1 pb-4">
                  <CardTitle className="text-lg md:text-xl">Escolha os produtos</CardTitle>
                  <p className="text-sm text-slate-500">
                    Busque, filtre por categoria e adicione itens ao carrinho.
                  </p>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="flex flex-col gap-3 sm:grid sm:grid-cols-[1fr,200px] sm:items-stretch">
                    <Input
                      className="h-11"
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
                      <SelectTrigger className="h-11 w-full">
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

                  {/* Mobile: cartões empilhados; desktop: tabela */}
                  <div className="md:hidden">
                    {loading ? (
                      <div className="space-y-3">
                        {[0, 1, 2].map((key) => (
                          <div
                            key={key}
                            className="space-y-3 rounded-xl border border-slate-200 bg-white p-4"
                          >
                            <Skeleton className="h-5 w-4/5" />
                            <Skeleton className="h-3 w-1/2" />
                            <div className="flex gap-4">
                              <Skeleton className="h-4 flex-1" />
                              <Skeleton className="h-4 w-16" />
                            </div>
                            <Skeleton className="h-11 w-full rounded-md" />
                          </div>
                        ))}
                      </div>
                    ) : activeProducts.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                        Nenhum produto disponível para venda.
                      </div>
                    ) : (
                      <ul className="space-y-3">
                        {activeProducts.map((product) => {
                          const available = product.totalAvailable;
                          return (
                            <li
                              key={product.id}
                              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                            >
                              <div className="space-y-3">
                                <div>
                                  <p className="font-medium leading-snug text-slate-900">
                                    {product.name}
                                  </p>
                                  <p className="mt-1 text-xs text-slate-500">
                                    {product.category?.name ?? 'Sem categoria'}
                                    {product.sku ? ` · SKU ${product.sku}` : ''}
                                  </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
                                  <span>
                                    Preço{' '}
                                    <span className="font-medium text-slate-900">
                                      {formatCurrencyBRL(product.price)}
                                    </span>
                                  </span>
                                  <span>
                                    Disponível{' '}
                                    <span className="font-medium text-slate-900">{available}</span>
                                  </span>
                                </div>
                                <Button
                                  type="button"
                                  className="h-11 w-full"
                                  disabled={available <= 0}
                                  onClick={() => addProductToCart(product)}
                                >
                                  <Plus className="mr-2 h-4 w-4" />
                                  {product.hasVariants ? 'Escolher variante' : 'Adicionar ao carrinho'}
                                </Button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>

                  <div className="hidden rounded-xl border border-slate-200 bg-white md:block [&_.alusa-session-panel]:rounded-none [&_.alusa-session-panel]:border-0">
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
                    className="w-full min-w-0"
                    total={meta.total}
                    page={meta.page}
                    pageSize={meta.pageSize}
                    onChange={setPage}
                  />
                </CardContent>
              </Card>

              {/* Carrinho */}
              <div className="min-w-0 xl:sticky xl:top-24 xl:self-start">
                <Card>
                  <CardHeader className="space-y-1 pb-4">
                    <CardTitle className="text-lg md:text-xl">Carrinho</CardTitle>
                    {cart.length > 0 ? (
                      <p className="text-sm text-slate-500">
                        {cart.length} {cart.length === 1 ? 'item' : 'itens'}
                      </p>
                    ) : null}
                  </CardHeader>
                  <CardContent className="space-y-5">
                    {cart.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                        Nenhum item adicionado.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {cart.map((item) => (
                          <div
                            key={`${item.productId}-${item.variantId ?? 'base'}`}
                            className="rounded-xl border border-slate-200 p-4"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <p className="font-medium leading-snug text-slate-900">
                                  {item.productName}
                                </p>
                                <p className="mt-1 text-xs text-slate-500">
                                  {item.variantTitle ? `${item.variantTitle} · ` : ''}
                                  {item.categoryName ?? 'Sem categoria'} ·{' '}
                                  {formatCurrencyBRL(item.price)}
                                </p>
                              </div>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-10 w-10 shrink-0 text-slate-500 md:h-9 md:w-9"
                                aria-label="Remover do carrinho"
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
                            <div className="mt-4 flex min-h-11 items-center justify-between gap-3">
                              <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-1.5 py-1">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-9 w-9 md:h-7 md:w-7"
                                  aria-label="Diminuir quantidade"
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
                                <span className="min-w-[2rem] px-1 text-center text-sm font-medium text-slate-900 tabular-nums">
                                  {item.quantity}
                                </span>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-9 w-9 md:h-7 md:w-7"
                                  aria-label="Aumentar quantidade"
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
                              <p className="text-sm font-semibold tabular-nums text-slate-900">
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
                        className="h-11"
                        inputMode="numeric"
                        placeholder="0,00"
                        value={discountInput}
                        onChange={(event) => setDiscountInput(formatBRLInput(event.target.value))}
                      />
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                      <div className="flex items-center justify-between gap-2">
                        <span>Subtotal</span>
                        <span className="tabular-nums">{formatCurrencyBRL(cartSubtotal)}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span>Desconto</span>
                        <span className="tabular-nums">{formatCurrencyBRL(discount)}</span>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2 text-base font-semibold text-slate-900">
                        <span>Total</span>
                        <span className="tabular-nums">{formatCurrencyBRL(total)}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          {wizardStep === 2 && (
            <div className="grid gap-5 xl:grid-cols-[1fr,320px] xl:gap-6">
              {/* Opções de pagamento */}
              <Card className="min-w-0 order-2 xl:order-none">
                <CardHeader className="space-y-1 pb-4">
                  <CardTitle className="text-lg md:text-xl">Estoque e pagamento</CardTitle>
                  <p className="text-sm text-slate-500">
                    Defina como o estoque será tratado e como a venda será finalizada.
                  </p>
                </CardHeader>
                <CardContent className="space-y-5 sm:space-y-6">
                  <div className="space-y-2">
                    <label className={labelClass}>Operação de estoque</label>
                    <Select
                      value={inventoryMode}
                      onValueChange={(value: InventoryModeValue) => setInventoryMode(value)}
                      disabled={finalizationType === 'COBRANCA'}
                    >
                      <SelectTrigger className="h-11 w-full">
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
                      <SelectTrigger className="h-11 w-full">
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
                        <SelectTrigger className="h-11 w-full">
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
                    <div className="grid gap-4 sm:gap-5 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className={labelClass}>Método de recebimento</label>
                        <Select
                          value={paymentMethod}
                          onValueChange={(value: SalePaymentMethodValue) => setPaymentMethod(value)}
                        >
                          <SelectTrigger className="h-11 w-full">
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
                            className="h-11"
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
                    <div className="grid gap-4 sm:gap-5 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className={labelClass}>Vencimento</label>
                        <DatePicker
                          className="h-11 w-full"
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
                          <SelectTrigger className="h-11 w-full">
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
                      <div className="space-y-2 md:col-span-2">
                        <label className={labelClass}>Parcelamento</label>
                        <Select
                          value={String(installmentCount)}
                          disabled={!canUseInstallments}
                          onValueChange={(value) => setInstallmentCount(Number(value))}
                        >
                          <SelectTrigger className="h-11 w-full">
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

              {/* Resumo do pedido — no mobile aparece primeiro para contexto rápido */}
              <div className="order-1 min-w-0 xl:order-none xl:sticky xl:top-24 xl:self-start">
                <Card>
                  <CardHeader className="space-y-1 pb-4">
                    <CardTitle className="text-lg md:text-xl">Resumo</CardTitle>
                    <p className="text-sm text-slate-500">Itens e valores desta venda.</p>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="divide-y divide-slate-100">
                      {cart.map((item) => (
                        <div
                          key={`${item.productId}-${item.variantId ?? 'base'}`}
                          className="flex items-start justify-between gap-3 py-3 text-sm first:pt-0 last:pb-0"
                        >
                          <span className="min-w-0 flex-1 leading-snug text-slate-700">
                            <span className="font-medium text-slate-900">{item.productName}</span>
                            {item.variantTitle ? (
                              <span className="text-slate-500"> ({item.variantTitle})</span>
                            ) : null}
                            <span className="block text-xs text-slate-500 sm:inline sm:before:mx-1 sm:before:content-['·']">
                              Qtd. {item.quantity}
                            </span>
                          </span>
                          <span className="shrink-0 font-medium tabular-nums text-slate-900">
                            {formatCurrencyBRL(item.price * item.quantity)}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                      <div className="flex items-center justify-between gap-2">
                        <span>Subtotal</span>
                        <span className="tabular-nums">{formatCurrencyBRL(cartSubtotal)}</span>
                      </div>
                      {discount > 0 ? (
                        <div className="mt-1.5 flex items-center justify-between gap-2">
                          <span>Desconto</span>
                          <span className="tabular-nums">−{formatCurrencyBRL(discount)}</span>
                        </div>
                      ) : null}
                      <div className="mt-3 flex items-center justify-between gap-2 text-base font-semibold text-slate-900">
                        <span>Total</span>
                        <span className="tabular-nums">{formatCurrencyBRL(total)}</span>
                      </div>
                      {paymentMethod === 'DINHEIRO' && amountReceivedInput ? (
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span>Troco</span>
                          <span className="tabular-nums">
                            {formatCurrencyBRL(Math.max(amountReceived - total, 0))}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          {/* Navegação entre etapas — mobile: Voltar acima, ação principal abaixo (alvo de toque maior) */}
          <div
            className={cn(
              'flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center',
              wizardStep > 0 ? 'sm:justify-between' : 'sm:justify-end',
            )}
          >
            {wizardStep > 0 ? (
              <Button variant="outline" className="h-11 w-full sm:h-10 sm:w-auto" onClick={goBack}>
                Voltar
              </Button>
            ) : null}
            {wizardStep < 2 ? (
              <Button
                className="h-11 w-full bg-brand-accent text-white hover:bg-brand-accent/90 sm:h-10 sm:w-auto"
                disabled={wizardStep === 0 ? !canAdvanceStep0 : !canAdvanceStep1}
                onClick={goNext}
              >
                Avançar
              </Button>
            ) : (
              <Button
                className="h-11 w-full bg-brand-accent text-white hover:bg-brand-accent/90 sm:h-10 sm:w-auto"
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
