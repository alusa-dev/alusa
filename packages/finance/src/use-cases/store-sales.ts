import type { BillingType } from '@alusa/asaas';
import { prisma } from '@alusa/database';
import {
  Prisma,
  type FormaPagamento,
  SaleFinalizationType,
  SaleInventoryMode,
  SaleInventoryStatus,
  SalePaymentMethod,
  SaleStatus,
  StatusMatricula,
} from '@prisma/client';

import { isPrismaUniqueViolation } from '../core';
import { auditLogService } from '../foundation/audit-log.service';
import { deleteInstallmentPayments, deletePayment } from './asaas-ops';
import { createStandaloneCharge } from './create-standalone-charge';
import {
  applySaleInventoryOnCreate,
  cancelSaleInventory,
  fulfillReservedSale as fulfillReservedSaleInventory,
  registerSaleReturn as registerSaleReturnInventory,
  StoreInventoryError,
} from './store-inventory';
import { syncPaymentStateFromAsaas } from './sync-payment-state-from-asaas';

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;
const STORE_SALE_TRANSACTION_TIMEOUT_MS = 20_000;
const STORE_SALE_TRANSACTION_MAX_WAIT_MS = 5_000;

const SALE_ITEM_BASE_SELECT = {
  id: true,
  productId: true,
  variantId: true,
  productName: true,
  quantity: true,
  returnedQuantity: true,
  unitPrice: true,
  subtotal: true,
} satisfies Prisma.SaleItemSelect;

const SALE_ITEM_SNAPSHOT_SELECT = {
  unitCostAtSale: true,
  totalCostAtSale: true,
  discountShareAtSale: true,
  netSubtotalAtSale: true,
  grossProfitAtSale: true,
  marginAtSale: true,
} satisfies Prisma.SaleItemSelect;

const SALE_ITEM_HAS_SNAPSHOT_FIELDS = (() => {
  const saleItemModel = Prisma.dmmf.datamodel.models.find((model) => model.name === 'SaleItem');
  const fieldNames = new Set(saleItemModel?.fields.map((field) => field.name) ?? []);

  return Object.keys(SALE_ITEM_SNAPSHOT_SELECT).every((field) => fieldNames.has(field));
})();

const SALE_ITEM_DETAIL_SELECT = (
  SALE_ITEM_HAS_SNAPSHOT_FIELDS
    ? { ...SALE_ITEM_BASE_SELECT, ...SALE_ITEM_SNAPSHOT_SELECT }
    : SALE_ITEM_BASE_SELECT
) satisfies Prisma.SaleItemSelect;

const SALE_DETAIL_INCLUDE = {
  items: {
    orderBy: { createdAt: 'asc' },
    select: SALE_ITEM_DETAIL_SELECT,
  },
  charge: {
    select: {
      id: true,
      status: true,
      dueDate: true,
      billingType: true,
      asaasPaymentId: true,
      invoiceUrl: true,
      description: true,
      value: true,
      standaloneInstallmentPlan: {
        select: {
          id: true,
          status: true,
          asaasInstallmentId: true,
          installmentCount: true,
          billingType: true,
          value: true,
          firstDueDate: true,
          charges: {
            orderBy: { dueDate: 'asc' },
            select: {
              id: true,
              status: true,
              dueDate: true,
              billingType: true,
              asaasPaymentId: true,
              invoiceUrl: true,
              description: true,
              value: true,
            },
          },
        },
      },
    },
  },
  standaloneInstallmentPlan: {
    select: {
      id: true,
      status: true,
      asaasInstallmentId: true,
      installmentCount: true,
      billingType: true,
      value: true,
      firstDueDate: true,
      charges: {
        orderBy: { dueDate: 'asc' },
        select: {
          id: true,
          status: true,
          dueDate: true,
          billingType: true,
          asaasPaymentId: true,
          invoiceUrl: true,
          description: true,
          value: true,
        },
      },
    },
  },
  conta: {
    select: {
      nome: true,
      cpfCnpj: true,
      enderecoLogradouro: true,
      enderecoNumero: true,
      enderecoBairro: true,
      enderecoCidade: true,
      enderecoUf: true,
      ownerUser: {
        select: {
          email: true,
        },
      },
      financeProfile: {
        select: {
          mobilePhone: true,
          landlinePhone: true,
          asaasLoginEmail: true,
        },
      },
    },
  },
  aluno: {
    select: {
      id: true,
      nome: true,
      cpf: true,
      email: true,
      telefone: true,
    },
  },
  responsavel: {
    select: {
      id: true,
      nome: true,
      cpf: true,
      email: true,
      telefone: true,
    },
  },
  matricula: {
    select: {
      id: true,
      status: true,
      asaasSubscriptionId: true,
      vencimentoDia: true,
      formaPagamento: true,
      aluno: {
        select: {
          id: true,
          nome: true,
          cpf: true,
          email: true,
          telefone: true,
        },
      },
      plano: {
        select: {
          nome: true,
        },
      },
      combo: {
        select: {
          nome: true,
        },
      },
      turma: {
        select: {
          nome: true,
        },
      },
    },
  },
  operador: {
    select: {
      id: true,
      nome: true,
    },
  },
} satisfies Prisma.SaleInclude;

type SaleRecord = Prisma.SaleGetPayload<{ include: typeof SALE_DETAIL_INCLUDE }>;

type PreparedSaleItem = {
  productId: string;
  variantId: string | null;
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  unitCostAtSale: number;
  totalCostAtSale: number;
  discountShareAtSale: number;
  netSubtotalAtSale: number;
  grossProfitAtSale: number;
  marginAtSale: number;
};

type PreparedCustomer =
  | {
      type: 'ALUNO';
      alunoId: string;
      alunoName: string;
      responsavelId: string | null;
      responsavelName: string | null;
      displayName: string;
    }
  | {
      type: 'RESPONSAVEL';
      responsavelId: string;
      responsavelName: string;
      displayName: string;
    }
  | {
      type: 'AVULSO';
      displayName: string;
      walkInDocument: string | null;
      walkInEmail: string | null;
      walkInPhone: string | null;
      walkInNotes: string | null;
      saveAsCustomer: boolean;
    };

type PreparedChargeConfig = {
  dueDate: string;
  billingType: BillingType;
  chargeType: 'ONE_TIME' | 'INSTALLMENT';
  installmentCount: number;
  matriculaId: string | null;
};

type PreparedSaleContext = {
  customer: PreparedCustomer;
  items: PreparedSaleItem[];
  subtotal: number;
  discount: number;
  total: number;
  totalCost: number;
  grossProfit: number;
  grossMargin: number;
  inventoryMode: SaleInventoryMode;
  finalizationType: SaleFinalizationType;
  paymentMethod: SalePaymentMethod | null;
  amountReceived: number | null;
  changeGiven: number | null;
  chargeConfig: PreparedChargeConfig | null;
};

type CreatedSaleInventoryLine = {
  saleItemId: string;
  productId: string | null;
  variantId: string | null;
  productName: string;
  quantity: number;
};

export type StoreSaleFilterStatus =
  | 'TODOS'
  | 'CONCLUIDA'
  | 'PENDENTE'
  | 'VINCULADA_MENSALIDADE'
  | 'CANCELADA';

export type StoreSaleItemInput = {
  productId: string;
  variantId?: string | null;
  quantity: number;
};

export type StoreSaleCustomerInput =
  | {
      type: 'ALUNO';
      alunoId: string;
      responsavelId?: string | null;
    }
  | {
      type: 'RESPONSAVEL';
      responsavelId: string;
    }
  | {
      type: 'AVULSO';
      name: string;
      document?: string | null;
      email?: string | null;
      phone?: string | null;
      notes?: string | null;
      saveCustomer?: boolean | null;
    };

export type CreateStoreSaleInput = {
  contaId: string;
  operatorId: string;
  uiRequestId: string;
  inventoryMode?: SaleInventoryMode | 'IMMEDIATE' | 'RESERVE';
  customer: StoreSaleCustomerInput;
  items: StoreSaleItemInput[];
  discount?: number;
  finalization:
    | {
        type: 'RECEBIMENTO_PRESENCIAL';
        paymentMethod: SalePaymentMethod;
        amountReceived?: number | null;
      }
    | {
        type: 'COBRANCA';
        dueDate: string;
        billingType: BillingType;
        installmentCount?: number | null;
      };
};

export type ListStoreSalesInput = {
  contaId: string;
  page?: number;
  pageSize?: number;
  search?: string;
  status?: StoreSaleFilterStatus;
  finalizationType?: SaleFinalizationType | 'TODOS';
  fromDate?: string;
  toDate?: string;
};

export type GetStoreSaleInput = {
  contaId: string;
  saleId: string;
};

export type CancelStoreSaleInput = {
  contaId: string;
  saleId: string;
  operatorId: string;
  reason: string;
};

export type FulfillStoreSaleInput = {
  contaId: string;
  saleId: string;
  operatorId: string;
};

export type RegisterStoreSaleReturnInput = {
  contaId: string;
  saleId: string;
  operatorId: string;
  reason?: string;
  items: Array<{
    saleItemId: string;
    quantity: number;
  }>;
};

export type ListEligibleStoreSaleMatriculasInput =
  | {
      contaId: string;
      customerType: 'ALUNO';
      alunoId: string;
    }
  | {
      contaId: string;
      customerType: 'RESPONSAVEL';
      responsavelId: string;
    };

export type StoreSaleCustomerDTO = {
  type: 'ALUNO' | 'RESPONSAVEL' | 'AVULSO';
  displayName: string;
  document: string | null;
  email: string | null;
  phone: string | null;
  alunoId: string | null;
  alunoName: string | null;
  responsavelId: string | null;
  responsavelName: string | null;
  walkInPhone: string | null;
  walkInNotes: string | null;
};

export type StoreSaleMerchantDTO = {
  name: string;
  document: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
};

export type StoreSaleItemDTO = {
  id: string;
  productId: string | null;
  variantId: string | null;
  productName: string;
  quantity: number;
  returnedQuantity: number;
  unitPrice: number;
  subtotal: number;
  unitCostAtSale: number | null;
  totalCostAtSale: number | null;
  discountShareAtSale: number | null;
  netSubtotalAtSale: number | null;
  grossProfitAtSale: number | null;
  marginAtSale: number | null;
};

export type StoreSaleChargeDTO = {
  id: string;
  status: string;
  dueDate: string | null;
  billingType: string | null;
  asaasPaymentId: string | null;
  invoiceUrl: string | null;
  description: string | null;
  value: number | null;
};

export type StoreSaleInstallmentPlanDTO = {
  id: string;
  status: string;
  asaasInstallmentId: string | null;
  installmentCount: number;
  billingType: string;
  value: number;
  firstDueDate: string;
  charges: StoreSaleChargeDTO[];
};

export type StoreSaleMatriculaDTO = {
  id: string;
  alunoId: string;
  alunoName: string;
  planoLabel: string | null;
  turmaName: string | null;
};

export type StoreSaleDTO = {
  id: string;
  uiRequestId: string | null;
  saleNumber: number;
  status: SaleStatus;
  baseStatus: SaleStatus;
  finalizationType: SaleFinalizationType;
  inventoryMode: SaleInventoryMode;
  inventoryStatus: SaleInventoryStatus;
  paymentMethod: SalePaymentMethod | null;
  subtotal: number;
  discount: number;
  total: number;
  totalCost: number | null;
  grossProfit: number | null;
  grossMargin: number | null;
  amountReceived: number | null;
  changeGiven: number | null;
  createdAt: string;
  updatedAt: string;
  canceledAt: string | null;
  cancelReason: string | null;
  merchant: StoreSaleMerchantDTO;
  customer: StoreSaleCustomerDTO;
  charge: StoreSaleChargeDTO | null;
  installmentPlan: StoreSaleInstallmentPlanDTO | null;
  matricula: StoreSaleMatriculaDTO | null;
  operator: {
    id: string;
    name: string;
  };
  items: StoreSaleItemDTO[];
};

export type ListStoreSalesOutput = {
  data: StoreSaleDTO[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

export type EligibleStoreSaleMatriculaDTO = {
  id: string;
  alunoId: string;
  alunoName: string;
  planoLabel: string | null;
  turmaName: string | null;
  nextDueDate: string;
  billingType: BillingType;
  asaasSubscriptionId: string;
};

export class StoreSaleError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'StoreSaleError';
    this.code = code;
    this.status = status;
  }
}

function normalizeText(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeDigits(value?: string | null): string | null {
  const digits = value?.replace(/\D/g, '') ?? '';
  return digits ? digits : null;
}

function normalizeEmail(value?: string | null): string | null {
  const email = normalizeText(value)?.toLowerCase() ?? null;
  return email;
}

function isValidBasicEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function assertWalkInFinancialData(customer: Extract<PreparedCustomer, { type: 'AVULSO' }>): {
  document: string;
  email: string;
  phone: string;
} {
  const document = normalizeDigits(customer.walkInDocument);
  const email = normalizeEmail(customer.walkInEmail);
  const phone = normalizeDigits(customer.walkInPhone);

  if (!document || ![11, 14].includes(document.length)) {
    throw new StoreSaleError(
      'CLIENTE_AVULSO_DOCUMENTO_OBRIGATORIO',
      'Informe CPF/CNPJ válido para gerar cobrança ou salvar o cliente.',
      422,
    );
  }

  if (!email || !isValidBasicEmail(email)) {
    throw new StoreSaleError(
      'CLIENTE_AVULSO_EMAIL_OBRIGATORIO',
      'Informe um e-mail válido para gerar cobrança ou salvar o cliente.',
      422,
    );
  }

  if (!phone || ![10, 11].includes(phone.length)) {
    throw new StoreSaleError(
      'CLIENTE_AVULSO_TELEFONE_OBRIGATORIO',
      'Informe um telefone válido para gerar cobrança ou salvar o cliente.',
      422,
    );
  }

  return { document, email, phone };
}

function normalizeDateInput(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new StoreSaleError('DATA_INVALIDA', 'Data inválida para a cobrança.', 422);
  }
  return value;
}

function moneyToNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value == null) return 0;
  return Number(value);
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}

function roundRate(value: number): number {
  return Number(value.toFixed(4));
}

function numberToDecimal(value: number, scale = 2): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(scale));
}

function moneyToDecimal(value: number): Prisma.Decimal {
  return numberToDecimal(value, 2);
}

function computeMarginPercent(profit: number, netValue: number): number {
  if (netValue <= 0) return 0;
  return roundRate((profit / netValue) * 100);
}

function clampPage(page?: number): number {
  if (!page || Number.isNaN(page) || page < 1) return DEFAULT_PAGE;
  return Math.floor(page);
}

function clampPageSize(pageSize?: number): number {
  if (!pageSize || Number.isNaN(pageSize) || pageSize < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.floor(pageSize), MAX_PAGE_SIZE);
}

function formatSaleNumber(value: number): string {
  return `#${String(value).padStart(4, '0')}`;
}

function mapFormaPagamentoToBillingType(value: FormaPagamento | null | undefined): BillingType {
  switch (value) {
    case 'PIX':
      return 'PIX';
    case 'CARTAO_CREDITO':
      return 'CREDIT_CARD';
    case 'BOLETO':
      return 'BOLETO';
    case 'INDEFINIDO':
    default:
      return 'UNDEFINED';
  }
}

function formatDateOnly(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

function computeNextDueDateFromDay(day: number): string {
  const today = new Date();
  const target = new Date(today.getFullYear(), today.getMonth(), 1);
  const normalizedDay = Math.max(1, Math.min(day, 28));
  target.setDate(normalizedDay);
  if (target < new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
    target.setMonth(target.getMonth() + 1);
  }
  return target.toISOString().slice(0, 10);
}

function resolveMatriculaPlanLabel(record: {
  plano: { nome: string } | null;
  combo: { nome: string } | null;
}): string | null {
  return record.plano?.nome ?? record.combo?.nome ?? null;
}

function computeEffectiveSaleStatus(
  baseStatus: SaleStatus,
  chargeStatus?: string | null,
  installmentPlan?: {
    status: string;
    charges: Array<{ status: string }>;
  } | null,
): SaleStatus {
  if (baseStatus === SaleStatus.CANCELADA) return SaleStatus.CANCELADA;

  if (installmentPlan) {
    const activeCharges = installmentPlan.charges.filter((charge) => charge.status !== 'CANCELED');
    if (
      installmentPlan.status === 'COMPLETED' ||
      (activeCharges.length > 0 && activeCharges.every((charge) => charge.status === 'PAID'))
    ) {
      return SaleStatus.CONCLUIDA;
    }

    return baseStatus;
  }

  if (chargeStatus === 'PAID') return SaleStatus.CONCLUIDA;
  return baseStatus;
}

function buildSaleChargeDescription(saleNumber: number, items: PreparedSaleItem[]): string {
  const preview = items
    .slice(0, 3)
    .map((item) => `${item.productName} x${item.quantity}`)
    .join(', ');

  return `Loja ${formatSaleNumber(saleNumber)} - ${preview}`;
}

function compactAddress(parts: Array<string | null | undefined>): string | null {
  const value = parts
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .join(', ');

  return value || null;
}

async function convergeStoreSalesFinancialState(params: {
  contaId: string;
  sales: SaleRecord[];
}): Promise<boolean> {
  const pendingPaymentIds = new Set<string>();

  for (const sale of params.sales) {
    const installmentPlan =
      sale.standaloneInstallmentPlan ?? sale.charge?.standaloneInstallmentPlan ?? null;

    if (installmentPlan) {
      for (const charge of installmentPlan.charges) {
        if (charge.asaasPaymentId && charge.status !== 'PAID' && charge.status !== 'CANCELED') {
          pendingPaymentIds.add(charge.asaasPaymentId);
        }
      }
      continue;
    }

    if (
      sale.charge?.asaasPaymentId &&
      sale.charge.status !== 'PAID' &&
      sale.charge.status !== 'CANCELED'
    ) {
      pendingPaymentIds.add(sale.charge.asaasPaymentId);
    }
  }

  if (pendingPaymentIds.size === 0) {
    return false;
  }

  let converged = false;
  for (const asaasPaymentId of pendingPaymentIds) {
    const syncResult = await syncPaymentStateFromAsaas({
      contaId: params.contaId,
      asaasPaymentId,
    });

    if (syncResult.success) {
      converged = true;
    }
  }

  return converged;
}

function mapSaleRecord(record: SaleRecord): StoreSaleDTO {
  type SaleItemSnapshotShape = {
    unitCostAtSale?: Prisma.Decimal | null;
    totalCostAtSale?: Prisma.Decimal | null;
    discountShareAtSale?: Prisma.Decimal | null;
    netSubtotalAtSale?: Prisma.Decimal | null;
    grossProfitAtSale?: Prisma.Decimal | null;
    marginAtSale?: Prisma.Decimal | null;
  };

  const installmentPlan =
    record.standaloneInstallmentPlan ?? record.charge?.standaloneInstallmentPlan ?? null;
  const effectiveStatus = computeEffectiveSaleStatus(
    record.status,
    record.charge?.status ?? null,
    installmentPlan,
  );
  const alunoName = record.aluno?.nome ?? record.matricula?.aluno.nome ?? null;
  const responsavelName = record.responsavel?.nome ?? null;
  const customerDocument =
    record.aluno?.cpf ?? record.responsavel?.cpf ?? record.matricula?.aluno.cpf ?? null;
  const customerEmail =
    record.aluno?.email ?? record.responsavel?.email ?? record.matricula?.aluno.email ?? null;
  const customerPhone =
    record.walkInPhone ??
    record.aluno?.telefone ??
    record.responsavel?.telefone ??
    record.matricula?.aluno.telefone ??
    null;
  const displayName =
    record.walkInName ??
    record.aluno?.nome ??
    record.responsavel?.nome ??
    record.matricula?.aluno.nome ??
    'Cliente não identificado';

  return {
    id: record.id,
    uiRequestId: record.uiRequestId ?? null,
    saleNumber: record.saleNumber,
    status: effectiveStatus,
    baseStatus: record.status,
    finalizationType: record.finalizationType,
    inventoryMode: record.inventoryMode,
    inventoryStatus: record.inventoryStatus,
    paymentMethod: record.paymentMethod ?? null,
    subtotal: moneyToNumber(record.subtotal),
    discount: moneyToNumber(record.discount),
    total: moneyToNumber(record.total),
    totalCost: record.totalCost != null ? moneyToNumber(record.totalCost) : null,
    grossProfit: record.grossProfit != null ? moneyToNumber(record.grossProfit) : null,
    grossMargin: record.grossMargin != null ? moneyToNumber(record.grossMargin) : null,
    amountReceived: record.amountReceived != null ? moneyToNumber(record.amountReceived) : null,
    changeGiven: record.changeGiven != null ? moneyToNumber(record.changeGiven) : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    canceledAt: record.canceledAt?.toISOString() ?? null,
    cancelReason: record.cancelReason ?? null,
    merchant: {
      name: record.conta.nome,
      document: record.conta.cpfCnpj ?? null,
      phone:
        record.conta.financeProfile?.mobilePhone ??
        record.conta.financeProfile?.landlinePhone ??
        null,
      email: record.conta.financeProfile?.asaasLoginEmail ?? record.conta.ownerUser?.email ?? null,
      address: compactAddress([
        record.conta.enderecoLogradouro,
        record.conta.enderecoNumero,
        record.conta.enderecoBairro,
        record.conta.enderecoCidade,
        record.conta.enderecoUf,
      ]),
    },
    customer: {
      type: record.customerType as StoreSaleCustomerDTO['type'],
      displayName,
      document: customerDocument,
      email: customerEmail,
      phone: customerPhone,
      alunoId: record.alunoId ?? record.matricula?.aluno.id ?? null,
      alunoName,
      responsavelId: record.responsavelId ?? null,
      responsavelName,
      walkInPhone: record.walkInPhone ?? null,
      walkInNotes: record.walkInNotes ?? null,
    },
    charge: record.charge
      ? {
          id: record.charge.id,
          status: record.charge.status,
          dueDate: formatDateOnly(record.charge.dueDate),
          billingType: record.charge.billingType ?? null,
          asaasPaymentId: record.charge.asaasPaymentId ?? null,
          invoiceUrl: record.charge.invoiceUrl ?? null,
          description: record.charge.description ?? null,
          value: record.charge.value != null ? moneyToNumber(record.charge.value) : null,
        }
      : null,
    installmentPlan: installmentPlan
      ? {
          id: installmentPlan.id,
          status: installmentPlan.status,
          asaasInstallmentId: installmentPlan.asaasInstallmentId ?? null,
          installmentCount: installmentPlan.installmentCount,
          billingType: installmentPlan.billingType,
          value: moneyToNumber(installmentPlan.value),
          firstDueDate: formatDateOnly(installmentPlan.firstDueDate) ?? '',
          charges: installmentPlan.charges.map((charge) => ({
            id: charge.id,
            status: charge.status,
            dueDate: formatDateOnly(charge.dueDate),
            billingType: charge.billingType ?? null,
            asaasPaymentId: charge.asaasPaymentId ?? null,
            invoiceUrl: charge.invoiceUrl ?? null,
            description: charge.description ?? null,
            value: charge.value != null ? moneyToNumber(charge.value) : null,
          })),
        }
      : null,
    matricula: record.matricula
      ? {
          id: record.matricula.id,
          alunoId: record.matricula.aluno.id,
          alunoName: record.matricula.aluno.nome,
          planoLabel: resolveMatriculaPlanLabel(record.matricula),
          turmaName: record.matricula.turma?.nome ?? null,
        }
      : null,
    operator: {
      id: record.operador.id,
      name: record.operador.nome,
    },
    items: record.items.map((item) => {
      const snapshotItem = item as typeof item & SaleItemSnapshotShape;

      return {
        id: item.id,
        productId: item.productId ?? null,
        variantId: item.variantId ?? null,
        productName: item.productName,
        quantity: item.quantity,
        returnedQuantity: item.returnedQuantity,
        unitPrice: moneyToNumber(item.unitPrice),
        subtotal: moneyToNumber(item.subtotal),
        unitCostAtSale:
          snapshotItem.unitCostAtSale != null ? moneyToNumber(snapshotItem.unitCostAtSale) : null,
        totalCostAtSale:
          snapshotItem.totalCostAtSale != null ? moneyToNumber(snapshotItem.totalCostAtSale) : null,
        discountShareAtSale:
          snapshotItem.discountShareAtSale != null
            ? moneyToNumber(snapshotItem.discountShareAtSale)
            : null,
        netSubtotalAtSale:
          snapshotItem.netSubtotalAtSale != null
            ? moneyToNumber(snapshotItem.netSubtotalAtSale)
            : null,
        grossProfitAtSale:
          snapshotItem.grossProfitAtSale != null
            ? moneyToNumber(snapshotItem.grossProfitAtSale)
            : null,
        marginAtSale:
          snapshotItem.marginAtSale != null ? moneyToNumber(snapshotItem.marginAtSale) : null,
      };
    }),
  };
}

async function findSaleById(contaId: string, saleId: string): Promise<SaleRecord | null> {
  return prisma.sale.findFirst({
    where: { id: saleId, contaId },
    include: SALE_DETAIL_INCLUDE,
  });
}

async function findSaleByUiRequestId(
  contaId: string,
  uiRequestId: string,
): Promise<SaleRecord | null> {
  return prisma.sale.findFirst({
    where: { contaId, uiRequestId },
    include: SALE_DETAIL_INCLUDE,
  });
}

async function resolveEligibleMatriculas(
  input: ListEligibleStoreSaleMatriculasInput,
): Promise<EligibleStoreSaleMatriculaDTO[]> {
  const where: Prisma.MatriculaWhereInput = {
    status: StatusMatricula.ATIVA,
    asaasSubscriptionId: { not: null },
    aluno: {
      contaId: input.contaId,
    },
  };

  if (input.customerType === 'ALUNO') {
    where.aluno = {
      id: input.alunoId,
      contaId: input.contaId,
    };
  } else {
    where.aluno = {
      contaId: input.contaId,
      responsaveis: {
        some: {
          responsavelId: input.responsavelId,
        },
      },
    };
  }

  const matriculas = await prisma.matricula.findMany({
    where,
    select: {
      id: true,
      alunoId: true,
      asaasSubscriptionId: true,
      vencimentoDia: true,
      formaPagamento: true,
      status: true,
      aluno: {
        select: {
          id: true,
          nome: true,
        },
      },
      plano: {
        select: {
          nome: true,
        },
      },
      combo: {
        select: {
          nome: true,
        },
      },
      turma: {
        select: {
          nome: true,
        },
      },
      cobrancas: {
        where: {
          tipo: {
            in: ['MENSALIDADE', 'PARCELADA'],
          },
          status: {
            notIn: ['CANCELADO', 'ESTORNADO'],
          },
        },
        select: {
          id: true,
          vencimento: true,
          status: true,
          tipo: true,
        },
        orderBy: {
          vencimento: 'asc',
        },
      },
    },
  });

  const mapped: EligibleStoreSaleMatriculaDTO[] = [];

  for (const matricula of matriculas) {
    const nextDueDate =
      formatDateOnly(matricula.cobrancas[0]?.vencimento) ??
      computeNextDueDateFromDay(matricula.vencimentoDia);
    const billingType = mapFormaPagamentoToBillingType(matricula.formaPagamento);
    if (!matricula.asaasSubscriptionId || billingType === 'UNDEFINED') {
      continue;
    }

    mapped.push({
      id: matricula.id,
      alunoId: matricula.alunoId,
      alunoName: matricula.aluno.nome,
      planoLabel: resolveMatriculaPlanLabel(matricula),
      turmaName: matricula.turma?.nome ?? null,
      nextDueDate,
      billingType,
      asaasSubscriptionId: matricula.asaasSubscriptionId,
    });
  }

  return mapped.sort((left, right) => left.alunoName.localeCompare(right.alunoName, 'pt-BR'));
}

async function prepareCustomer(
  input: StoreSaleCustomerInput,
  contaId: string,
): Promise<PreparedCustomer> {
  if (input.type === 'AVULSO') {
    const name = normalizeText(input.name);
    if (!name) {
      throw new StoreSaleError(
        'CLIENTE_AVULSO_NOME_OBRIGATORIO',
        'Informe o nome do cliente avulso.',
        422,
      );
    }

    return {
      type: 'AVULSO',
      displayName: name,
      walkInDocument: normalizeDigits(input.document),
      walkInEmail: normalizeEmail(input.email),
      walkInPhone: normalizeText(input.phone),
      walkInNotes: normalizeText(input.notes),
      saveAsCustomer: input.saveCustomer === true,
    };
  }

  if (input.type === 'RESPONSAVEL') {
    const responsavel = await prisma.responsavel.findFirst({
      where: { id: input.responsavelId, contaId },
      select: { id: true, nome: true },
    });

    if (!responsavel) {
      throw new StoreSaleError(
        'RESPONSAVEL_NAO_ENCONTRADO',
        'Responsável financeiro não encontrado.',
        404,
      );
    }

    return {
      type: 'RESPONSAVEL',
      responsavelId: responsavel.id,
      responsavelName: responsavel.nome,
      displayName: responsavel.nome,
    };
  }

  const aluno = await prisma.aluno.findFirst({
    where: { id: input.alunoId, contaId },
    select: {
      id: true,
      nome: true,
      responsaveis: {
        select: {
          responsavelId: true,
          responsavel: {
            select: {
              id: true,
              nome: true,
            },
          },
        },
      },
    },
  });

  if (!aluno) {
    throw new StoreSaleError('ALUNO_NAO_ENCONTRADO', 'Aluno não encontrado.', 404);
  }

  const matchedResponsavel = input.responsavelId
    ? (aluno.responsaveis.find((relation) => relation.responsavelId === input.responsavelId)
        ?.responsavel ?? null)
    : null;

  return {
    type: 'ALUNO',
    alunoId: aluno.id,
    alunoName: aluno.nome,
    responsavelId: matchedResponsavel?.id ?? null,
    responsavelName: matchedResponsavel?.nome ?? null,
    displayName: aluno.nome,
  };
}

function prepareItems(
  rawItems: StoreSaleItemInput[],
  products: Array<{
    id: string;
    name: string;
    price: Prisma.Decimal;
    stock: number;
    hasVariants: boolean;
    available: number;
    averageCost: number;
  }>,
  variants: Array<{
    id: string;
    productId: string;
    title: string;
    price: Prisma.Decimal | null;
    stock: number;
    available: number;
    isActive: boolean;
    averageCost: number;
  }>,
): PreparedSaleItem[] {
  const productMap = new Map(products.map((product) => [product.id, product]));
  const variantMap = new Map(variants.map((variant) => [variant.id, variant]));

  return rawItems.map((rawItem) => {
    const product = productMap.get(rawItem.productId);
    if (!product) {
      throw new StoreSaleError(
        'PRODUTO_NAO_ENCONTRADO',
        'Um ou mais produtos não foram encontrados.',
        404,
      );
    }

    if (rawItem.variantId) {
      const variant = variantMap.get(rawItem.variantId);
      if (!variant || variant.productId !== product.id || !variant.isActive) {
        throw new StoreSaleError(
          'VARIANTE_NAO_ENCONTRADA',
          'Uma ou mais variantes não estão disponíveis para venda.',
          404,
        );
      }

      if (variant.available < rawItem.quantity) {
        throw new StoreSaleError(
          'ESTOQUE_INSUFICIENTE',
          `Estoque insuficiente para ${product.name} - ${variant.title}. Disponível: ${variant.available}.`,
          422,
        );
      }

      const unitPrice = moneyToNumber(variant.price ?? product.price);
      const subtotal = roundMoney(unitPrice * rawItem.quantity);
      const unitCostAtSale = roundRate(variant.averageCost);
      const totalCostAtSale = roundMoney(unitCostAtSale * rawItem.quantity);

      return {
        productId: product.id,
        variantId: variant.id,
        productName: `${product.name} - ${variant.title}`,
        quantity: rawItem.quantity,
        unitPrice,
        subtotal,
        unitCostAtSale,
        totalCostAtSale,
        discountShareAtSale: 0,
        netSubtotalAtSale: subtotal,
        grossProfitAtSale: roundMoney(subtotal - totalCostAtSale),
        marginAtSale: computeMarginPercent(subtotal - totalCostAtSale, subtotal),
      };
    }

    if (product.hasVariants) {
      throw new StoreSaleError(
        'VARIANTE_OBRIGATORIA',
        `Selecione uma variante para vender ${product.name}.`,
        422,
      );
    }

    if (product.available < rawItem.quantity) {
      throw new StoreSaleError(
        'ESTOQUE_INSUFICIENTE',
        `Estoque insuficiente para ${product.name}. Disponível: ${product.available}.`,
        422,
      );
    }

    const unitPrice = moneyToNumber(product.price);
    const subtotal = roundMoney(unitPrice * rawItem.quantity);
    const unitCostAtSale = roundRate(product.averageCost);
    const totalCostAtSale = roundMoney(unitCostAtSale * rawItem.quantity);

    return {
      productId: product.id,
      variantId: null,
      productName: product.name,
      quantity: rawItem.quantity,
      unitPrice,
      subtotal,
      unitCostAtSale,
      totalCostAtSale,
      discountShareAtSale: 0,
      netSubtotalAtSale: subtotal,
      grossProfitAtSale: roundMoney(subtotal - totalCostAtSale),
      marginAtSale: computeMarginPercent(subtotal - totalCostAtSale, subtotal),
    };
  });
}

function applyDiscountSnapshots(
  items: PreparedSaleItem[],
  discount: number,
  subtotal: number,
): PreparedSaleItem[] {
  if (discount <= 0 || subtotal <= 0) {
    return items;
  }

  let allocatedDiscount = 0;

  return items.map((item, index) => {
    const isLast = index === items.length - 1;
    const discountShare = isLast
      ? roundMoney(discount - allocatedDiscount)
      : roundMoney(discount * (item.subtotal / subtotal));

    allocatedDiscount = roundMoney(allocatedDiscount + discountShare);

    const netSubtotalAtSale = roundMoney(item.subtotal - discountShare);
    const grossProfitAtSale = roundMoney(netSubtotalAtSale - item.totalCostAtSale);

    return {
      ...item,
      discountShareAtSale: discountShare,
      netSubtotalAtSale,
      grossProfitAtSale,
      marginAtSale: computeMarginPercent(grossProfitAtSale, netSubtotalAtSale),
    };
  });
}

async function prepareSaleContext(input: CreateStoreSaleInput): Promise<PreparedSaleContext> {
  if (!input.uiRequestId.trim()) {
    throw new StoreSaleError(
      'UI_REQUEST_ID_OBRIGATORIO',
      'uiRequestId é obrigatório para idempotência.',
      422,
    );
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new StoreSaleError('ITENS_OBRIGATORIOS', 'Adicione ao menos um item à venda.', 422);
  }

  const inventoryMode =
    input.finalization.type === 'COBRANCA' || input.inventoryMode === 'RESERVE'
      ? SaleInventoryMode.RESERVE
      : SaleInventoryMode.IMMEDIATE;

  const aggregatedMap = new Map<string, StoreSaleItemInput>();
  for (const item of input.items) {
    if (!item.productId?.trim() || !Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new StoreSaleError('ITEM_INVALIDO', 'Os itens da venda estão inválidos.', 422);
    }

    const aggregationKey = `${item.productId}::${item.variantId ?? '_product'}`;
    const current = aggregatedMap.get(aggregationKey);
    if (current) {
      current.quantity += item.quantity;
      continue;
    }

    aggregatedMap.set(aggregationKey, {
      productId: item.productId,
      variantId: item.variantId ?? null,
      quantity: item.quantity,
    });
  }

  const customer = await prepareCustomer(input.customer, input.contaId);
  if (
    customer.type === 'AVULSO' &&
    (customer.saveAsCustomer || input.finalization.type === 'COBRANCA')
  ) {
    assertWalkInFinancialData(customer);
  }

  const items = Array.from(aggregatedMap.values());
  const productIds = [...new Set(items.map((item) => item.productId))];
  const variantIds = [
    ...new Set(items.flatMap((item) => (item.variantId ? [item.variantId] : []))),
  ];
  const products = await prisma.product.findMany({
    where: {
      contaId: input.contaId,
      archivedAt: null,
      isActive: true,
      id: {
        in: productIds,
      },
    },
    select: {
      id: true,
      name: true,
      price: true,
      stock: true,
      hasVariants: true,
    },
  });

  const variants = variantIds.length
    ? await prisma.productVariant.findMany({
        where: {
          id: { in: variantIds },
          productId: { in: productIds },
        },
        select: {
          id: true,
          productId: true,
          title: true,
          price: true,
          stock: true,
          isActive: true,
        },
      })
    : [];

  const inventoryBalances = await prisma.inventoryBalance.findMany({
    where: {
      contaId: input.contaId,
      OR: [
        {
          productId: {
            in: productIds,
          },
          variantId: null,
        },
        ...(variantIds.length
          ? [
              {
                variantId: {
                  in: variantIds,
                },
              },
            ]
          : []),
      ],
    },
    select: {
      productId: true,
      variantId: true,
      onHand: true,
      reserved: true,
      averageCost: true,
    },
  });

  if (products.length !== productIds.length) {
    throw new StoreSaleError(
      'PRODUTO_NAO_ENCONTRADO',
      'Um ou mais produtos não estão disponíveis.',
      404,
    );
  }

  const productBalanceMap = new Map(
    inventoryBalances
      .filter((balance) => balance.variantId == null)
      .map((balance) => [balance.productId, balance]),
  );
  const variantBalanceMap = new Map(
    inventoryBalances
      .filter((balance): balance is typeof balance & { variantId: string } =>
        Boolean(balance.variantId),
      )
      .map((balance) => [balance.variantId, balance]),
  );

  const preparedItems = prepareItems(
    items,
    products.map((product) => {
      const balance = productBalanceMap.get(product.id);
      return {
        ...product,
        available: balance ? balance.onHand - balance.reserved : product.stock,
        averageCost: moneyToNumber(balance?.averageCost),
      };
    }),
    variants.map((variant) => {
      const balance = variantBalanceMap.get(variant.id);
      return {
        ...variant,
        available: balance ? balance.onHand - balance.reserved : variant.stock,
        averageCost: moneyToNumber(balance?.averageCost),
      };
    }),
  );
  const subtotal = Number(preparedItems.reduce((sum, item) => sum + item.subtotal, 0).toFixed(2));
  const discount = Number((input.discount ?? 0).toFixed(2));

  if (discount < 0 || discount > subtotal) {
    throw new StoreSaleError(
      'DESCONTO_INVALIDO',
      'O desconto precisa estar entre zero e o subtotal.',
      422,
    );
  }

  const total = Number((subtotal - discount).toFixed(2));
  if (total <= 0) {
    throw new StoreSaleError('TOTAL_INVALIDO', 'O total da venda deve ser maior que zero.', 422);
  }

  const discountedItems = applyDiscountSnapshots(preparedItems, discount, subtotal);
  const totalCost = roundMoney(
    discountedItems.reduce((sum, item) => sum + item.totalCostAtSale, 0),
  );
  const grossProfit = roundMoney(
    discountedItems.reduce((sum, item) => sum + item.grossProfitAtSale, 0),
  );
  const grossMargin = computeMarginPercent(grossProfit, total);

  if (input.finalization.type === 'RECEBIMENTO_PRESENCIAL') {
    const paymentMethod = input.finalization.paymentMethod;
    const amountReceived =
      paymentMethod === SalePaymentMethod.DINHEIRO
        ? Number((input.finalization.amountReceived ?? 0).toFixed(2))
        : total;

    if (paymentMethod === SalePaymentMethod.DINHEIRO && amountReceived < total) {
      throw new StoreSaleError(
        'VALOR_RECEBIDO_INVALIDO',
        'O valor recebido em dinheiro deve ser maior ou igual ao total.',
        422,
      );
    }

    return {
      customer,
      items: discountedItems,
      subtotal,
      discount,
      total,
      totalCost,
      grossProfit,
      grossMargin,
      inventoryMode,
      finalizationType: SaleFinalizationType.RECEBIMENTO_PRESENCIAL,
      paymentMethod,
      amountReceived,
      changeGiven: Number((amountReceived - total).toFixed(2)),
      chargeConfig: null,
    };
  }

  if (input.finalization.type === 'COBRANCA') {
    const installmentCount = Math.max(1, Math.floor(input.finalization.installmentCount ?? 1));
    if (
      installmentCount > 1 &&
      !['BOLETO', 'CREDIT_CARD'].includes(input.finalization.billingType)
    ) {
      throw new StoreSaleError(
        'FORMA_PAGAMENTO_PARCELAMENTO_INVALIDA',
        'Parcelamento da Loja está disponível para boleto ou cartão de crédito.',
        422,
      );
    }

    return {
      customer,
      items: discountedItems,
      subtotal,
      discount,
      total,
      totalCost,
      grossProfit,
      grossMargin,
      inventoryMode,
      finalizationType: SaleFinalizationType.COBRANCA,
      paymentMethod: null,
      amountReceived: null,
      changeGiven: null,
      chargeConfig: {
        dueDate: normalizeDateInput(input.finalization.dueDate),
        billingType: input.finalization.billingType,
        chargeType: installmentCount > 1 ? 'INSTALLMENT' : 'ONE_TIME',
        installmentCount,
        matriculaId: null,
      },
    };
  }

  throw new StoreSaleError(
    'FINALIZACAO_NAO_SUPORTADA',
    'A Loja não adiciona venda em mensalidade. Use recebimento presencial ou cobrança avulsa.',
    422,
  );
}

async function ensureWalkInResponsavel(input: {
  tx: Prisma.TransactionClient;
  contaId: string;
  customer: Extract<PreparedCustomer, { type: 'AVULSO' }>;
  exposeInSearch: boolean;
}): Promise<string> {
  const { document, email, phone } = assertWalkInFinancialData(input.customer);
  const name = input.customer.displayName;

  const existingByCpf = await input.tx.responsavel.findFirst({
    where: { contaId: input.contaId, cpf: document },
    select: { id: true, financeiro: true },
  });

  if (existingByCpf) {
    const emailOwner = await input.tx.responsavel.findFirst({
      where: {
        contaId: input.contaId,
        email,
        id: { not: existingByCpf.id },
      },
      select: { id: true },
    });

    if (emailOwner) {
      throw new StoreSaleError(
        'CLIENTE_AVULSO_EMAIL_EM_USO',
        'Este e-mail já está cadastrado para outro cliente.',
        409,
      );
    }

    const updated = await input.tx.responsavel.update({
      where: { id: existingByCpf.id },
      data: {
        nome: name,
        email,
        telefone: phone,
        financeiro: existingByCpf.financeiro || input.exposeInSearch,
      },
      select: { id: true },
    });

    return updated.id;
  }

  const existingByEmail = await input.tx.responsavel.findFirst({
    where: { contaId: input.contaId, email },
    select: { id: true, cpf: true, financeiro: true },
  });

  if (existingByEmail) {
    if (existingByEmail.cpf !== document) {
      throw new StoreSaleError(
        'CLIENTE_AVULSO_EMAIL_EM_USO',
        'Este e-mail já está cadastrado para outro cliente.',
        409,
      );
    }

    const updated = await input.tx.responsavel.update({
      where: { id: existingByEmail.id },
      data: {
        nome: name,
        telefone: phone,
        financeiro: existingByEmail.financeiro || input.exposeInSearch,
      },
      select: { id: true },
    });

    return updated.id;
  }

  try {
    const created = await input.tx.responsavel.create({
      data: {
        contaId: input.contaId,
        nome: name,
        cpf: document,
        email,
        telefone: phone,
        financeiro: input.exposeInSearch,
      },
      select: { id: true },
    });

    return created.id;
  } catch (error) {
    if (isPrismaUniqueViolation(error)) {
      throw new StoreSaleError(
        'CLIENTE_AVULSO_DUPLICADO',
        'Já existe um cliente com este CPF/CNPJ ou e-mail.',
        409,
      );
    }

    throw error;
  }
}

async function createLocalSaleRecord(input: {
  contaId: string;
  operatorId: string;
  uiRequestId: string;
  prepared: PreparedSaleContext;
}): Promise<SaleRecord> {
  let attempts = 0;

  while (attempts < 3) {
    attempts += 1;

    try {
      const saleId = await prisma.$transaction(async (tx) => {
        const existing = await tx.sale.findFirst({
          where: {
            contaId: input.contaId,
            uiRequestId: input.uiRequestId,
          },
          select: { id: true },
        });

        if (existing) return existing.id;

        const lastSale = await tx.sale.findFirst({
          where: { contaId: input.contaId },
          select: { saleNumber: true },
          orderBy: { saleNumber: 'desc' },
        });

        const saleNumber = (lastSale?.saleNumber ?? 0) + 1;
        const walkInResponsavelId =
          input.prepared.customer.type === 'AVULSO' &&
          (Boolean(input.prepared.chargeConfig) || input.prepared.customer.saveAsCustomer)
            ? await ensureWalkInResponsavel({
                tx,
                contaId: input.contaId,
                customer: input.prepared.customer,
                exposeInSearch: input.prepared.customer.saveAsCustomer,
              })
            : null;

        const createdSale = await tx.sale.create({
          data: {
            contaId: input.contaId,
            uiRequestId: input.uiRequestId,
            saleNumber,
            status:
              input.prepared.finalizationType === SaleFinalizationType.RECEBIMENTO_PRESENCIAL
                ? SaleStatus.CONCLUIDA
                : SaleStatus.PENDENTE,
            customerType: input.prepared.customer.type,
            alunoId:
              input.prepared.customer.type === 'ALUNO' ? input.prepared.customer.alunoId : null,
            responsavelId:
              input.prepared.customer.type === 'RESPONSAVEL'
                ? input.prepared.customer.responsavelId
                : input.prepared.customer.type === 'ALUNO'
                  ? input.prepared.customer.responsavelId
                  : walkInResponsavelId,
            walkInName:
              input.prepared.customer.type === 'AVULSO'
                ? input.prepared.customer.displayName
                : null,
            walkInPhone:
              input.prepared.customer.type === 'AVULSO'
                ? input.prepared.customer.walkInPhone
                : null,
            walkInNotes:
              input.prepared.customer.type === 'AVULSO'
                ? input.prepared.customer.walkInNotes
                : null,
            subtotal: moneyToDecimal(input.prepared.subtotal),
            discount: moneyToDecimal(input.prepared.discount),
            total: moneyToDecimal(input.prepared.total),
            totalCost: moneyToDecimal(input.prepared.totalCost),
            grossProfit: moneyToDecimal(input.prepared.grossProfit),
            grossMargin: numberToDecimal(input.prepared.grossMargin, 4),
            finalizationType: input.prepared.finalizationType,
            inventoryMode: input.prepared.inventoryMode,
            inventoryStatus:
              input.prepared.inventoryMode === SaleInventoryMode.RESERVE
                ? SaleInventoryStatus.RESERVED
                : SaleInventoryStatus.FULFILLED,
            paymentMethod: input.prepared.paymentMethod,
            amountReceived:
              input.prepared.amountReceived != null
                ? moneyToDecimal(input.prepared.amountReceived)
                : null,
            changeGiven:
              input.prepared.changeGiven != null
                ? moneyToDecimal(input.prepared.changeGiven)
                : null,
            matriculaId: input.prepared.chargeConfig?.matriculaId ?? null,
            operadorId: input.operatorId,
          },
          select: { id: true },
        });

        const createdItems: CreatedSaleInventoryLine[] = [];
        for (const item of input.prepared.items) {
          const createdItem = await tx.saleItem.create({
            data: {
              saleId: createdSale.id,
              productId: item.productId,
              variantId: item.variantId,
              productName: item.productName,
              quantity: item.quantity,
              unitPrice: moneyToDecimal(item.unitPrice),
              subtotal: moneyToDecimal(item.subtotal),
              unitCostAtSale: numberToDecimal(item.unitCostAtSale, 4),
              totalCostAtSale: moneyToDecimal(item.totalCostAtSale),
              discountShareAtSale: moneyToDecimal(item.discountShareAtSale),
              netSubtotalAtSale: moneyToDecimal(item.netSubtotalAtSale),
              grossProfitAtSale: moneyToDecimal(item.grossProfitAtSale),
              marginAtSale: numberToDecimal(item.marginAtSale, 4),
            },
            select: {
              id: true,
              productId: true,
              variantId: true,
              productName: true,
              quantity: true,
            },
          });

          createdItems.push({
            saleItemId: createdItem.id,
            productId: createdItem.productId,
            variantId: createdItem.variantId,
            productName: createdItem.productName,
            quantity: createdItem.quantity,
          });
        }

        await applySaleInventoryOnCreate(tx, {
          contaId: input.contaId,
          actorUserId: input.operatorId,
          saleId: createdSale.id,
          items: createdItems,
          inventoryMode: input.prepared.inventoryMode,
        });

        return createdSale.id;
      }, {
        maxWait: STORE_SALE_TRANSACTION_MAX_WAIT_MS,
        timeout: STORE_SALE_TRANSACTION_TIMEOUT_MS,
      });

      const sale = await findSaleById(input.contaId, saleId);
      if (!sale) {
        throw new StoreSaleError(
          'VENDA_NAO_ENCONTRADA',
          'Venda não encontrada após criação local.',
          404,
        );
      }

      return sale;
    } catch (error) {
      if (error instanceof StoreInventoryError) {
        throw new StoreSaleError(error.code, error.message, error.status);
      }

      if (error instanceof StoreSaleError) throw error;

      if (isPrismaUniqueViolation(error)) {
        const existing = await findSaleByUiRequestId(input.contaId, input.uiRequestId);
        if (existing) return existing;
        continue;
      }

      throw error;
    }
  }

  throw new StoreSaleError(
    'ERRO_CONCORRENCIA_VENDA',
    'Não foi possível reservar o número da venda.',
    409,
  );
}

async function ensureChargeForSale(input: {
  contaId: string;
  operatorId: string;
  sale: StoreSaleDTO;
  prepared: PreparedSaleContext;
}): Promise<void> {
  if (!input.prepared.chargeConfig) return;
  if (input.sale.charge?.id || input.sale.installmentPlan?.id) return;

  const payer =
    input.prepared.customer.type === 'ALUNO'
      ? ({ type: 'aluno', alunoId: input.prepared.customer.alunoId } as const)
      : input.prepared.customer.type === 'RESPONSAVEL'
        ? ({ type: 'responsavel', responsavelId: input.prepared.customer.responsavelId } as const)
        : input.sale.customer.responsavelId
          ? ({ type: 'responsavel', responsavelId: input.sale.customer.responsavelId } as const)
          : null;

  if (!payer) {
    throw new StoreSaleError(
      'CLIENTE_AVULSO_SEM_PAGADOR',
      'Informe os dados do cliente avulso para gerar a cobrança.',
      422,
    );
  }

  const chargeResult = await createStandaloneCharge({
    contaId: input.contaId,
    actor: { type: 'USER', id: input.operatorId },
    payer,
    chargeType: input.prepared.chargeConfig.chargeType,
    billingType: input.prepared.chargeConfig.billingType,
    value: input.prepared.chargeConfig.chargeType === 'ONE_TIME' ? input.prepared.total : undefined,
    installmentCount:
      input.prepared.chargeConfig.chargeType === 'INSTALLMENT'
        ? input.prepared.chargeConfig.installmentCount
        : undefined,
    installmentValue:
      input.prepared.chargeConfig.chargeType === 'INSTALLMENT'
        ? input.prepared.total / input.prepared.chargeConfig.installmentCount
        : undefined,
    dueDate: input.prepared.chargeConfig.dueDate,
    description: buildSaleChargeDescription(input.sale.saleNumber, input.prepared.items),
    uiRequestId: `${input.sale.uiRequestId ?? input.sale.id}:charge`,
  });

  if (!chargeResult.success) {
    switch (chargeResult.error) {
      case 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS':
        throw new StoreSaleError(
          'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS',
          'A instituição não possui credenciais financeiras válidas.',
          409,
        );
      case 'KYC_NAO_APROVADO':
        throw new StoreSaleError(
          'KYC_NAO_APROVADO',
          'A conta financeira ainda não está habilitada.',
          409,
        );
      case 'CUSTOMER_SEM_ASAAS_ID':
      case 'PAGADOR_SEM_CPF':
        throw new StoreSaleError(
          'PAGADOR_FINANCEIRO_INVALIDO',
          'O pagador financeiro não está apto para cobrança.',
          422,
        );
      case 'FEATURE_DISABLED':
        throw new StoreSaleError(
          'PARCELAMENTO_DESABILITADO',
          'O parcelamento não está habilitado para esta instituição.',
          409,
        );
      case 'FORMA_PAGAMENTO_INVALIDA':
        throw new StoreSaleError(
          'FORMA_PAGAMENTO_INVALIDA',
          'A forma de cobrança selecionada não é aceita para este tipo de cobrança.',
          422,
        );
      case 'PARCELAS_INVALIDAS':
        throw new StoreSaleError(
          'PARCELAS_INVALIDAS',
          'Informe uma quantidade válida de parcelas.',
          422,
        );
      default:
        throw new StoreSaleError(
          'ERRO_CRIAR_COBRANCA',
          'Não foi possível gerar a cobrança da venda.',
          502,
        );
    }
  }

  if (input.prepared.chargeConfig.chargeType === 'INSTALLMENT') {
    const firstCharge = await prisma.charge.findFirst({
      where: {
        contaId: input.contaId,
        standaloneInstallmentPlanId: chargeResult.data.chargeId,
      },
      select: { id: true },
      orderBy: { dueDate: 'asc' },
    });

    await prisma.sale.update({
      where: { id: input.sale.id },
      data: {
        chargeId: firstCharge?.id ?? null,
        standaloneInstallmentPlanId: chargeResult.data.chargeId,
      },
    });

    if (!firstCharge) {
      console.info('[store-sales][installment-payments-pending]', {
        contaId: input.contaId,
        saleId: input.sale.id,
        standaloneInstallmentPlanId: chargeResult.data.chargeId,
      });
    }

    return;
  }

  await prisma.sale.update({
    where: { id: input.sale.id },
    data: { chargeId: chargeResult.data.chargeId },
  });
}

function buildSearchWhere(search?: string): Prisma.SaleWhereInput | undefined {
  const normalized = normalizeText(search);
  if (!normalized) return undefined;

  const saleNumber = Number(normalized.replace(/\D/g, ''));
  const orFilters: Prisma.SaleWhereInput[] = [];

  if (!Number.isNaN(saleNumber)) {
    orFilters.push({ saleNumber });
  }

  orFilters.push(
    {
      walkInName: {
        contains: normalized,
        mode: 'insensitive',
      },
    },
    {
      aluno: {
        nome: {
          contains: normalized,
          mode: 'insensitive',
        },
      },
    },
    {
      responsavel: {
        nome: {
          contains: normalized,
          mode: 'insensitive',
        },
      },
    },
    {
      items: {
        some: {
          productName: {
            contains: normalized,
            mode: 'insensitive',
          },
        },
      },
    },
  );

  return {
    OR: orFilters,
  };
}

function buildStatusWhere(
  status: StoreSaleFilterStatus | undefined,
): Prisma.SaleWhereInput | undefined {
  if (!status || status === 'TODOS') return undefined;

  switch (status) {
    case 'CONCLUIDA':
      return {
        OR: [
          { status: SaleStatus.CONCLUIDA },
          {
            charge: {
              is: {
                status: 'PAID',
                standaloneInstallmentPlanId: null,
              },
            },
          },
          {
            charge: {
              is: {
                standaloneInstallmentPlan: {
                  is: { status: 'COMPLETED' },
                },
              },
            },
          },
        ],
      };
    case 'PENDENTE':
      return {
        status: SaleStatus.PENDENTE,
        OR: [
          { charge: { is: null } },
          {
            charge: {
              is: {
                standaloneInstallmentPlanId: null,
                status: { not: 'PAID' },
              },
            },
          },
          {
            charge: {
              is: {
                standaloneInstallmentPlan: {
                  is: { status: { not: 'COMPLETED' } },
                },
              },
            },
          },
        ],
      };
    case 'VINCULADA_MENSALIDADE':
      return {
        status: SaleStatus.VINCULADA_MENSALIDADE,
        OR: [{ charge: { is: null } }, { charge: { isNot: { status: 'PAID' } } }],
      };
    case 'CANCELADA':
      return {
        status: SaleStatus.CANCELADA,
      };
    default:
      return undefined;
  }
}

async function syncChargeBeforeCancel(contaId: string, asaasPaymentId: string): Promise<void> {
  await syncPaymentStateFromAsaas({
    contaId,
    asaasPaymentId,
    eventName: 'PAYMENT_UPDATED',
  });
}

export async function listEligibleStoreSaleMatriculas(
  input: ListEligibleStoreSaleMatriculasInput,
): Promise<EligibleStoreSaleMatriculaDTO[]> {
  return resolveEligibleMatriculas(input);
}

export async function createStoreSale(input: CreateStoreSaleInput): Promise<StoreSaleDTO> {
  const startedAt = Date.now();
  const prepared = await prepareSaleContext(input);
  const existing = await findSaleByUiRequestId(input.contaId, input.uiRequestId);

  if (existing) {
    const existingDto = mapSaleRecord(existing);
    if (prepared.chargeConfig && !existingDto.charge) {
      await ensureChargeForSale({
        contaId: input.contaId,
        operatorId: input.operatorId,
        sale: existingDto,
        prepared,
      });

      const repaired = await findSaleById(input.contaId, existing.id);
      if (!repaired) {
        throw new StoreSaleError(
          'VENDA_NAO_ENCONTRADA',
          'Venda não encontrada após o reparo.',
          404,
        );
      }
      return mapSaleRecord(repaired);
    }

    return existingDto;
  }

  const sale = await createLocalSaleRecord({
    contaId: input.contaId,
    operatorId: input.operatorId,
    uiRequestId: input.uiRequestId,
    prepared,
  });

  try {
    const saleDto = mapSaleRecord(sale);
    if (prepared.chargeConfig) {
      await ensureChargeForSale({
        contaId: input.contaId,
        operatorId: input.operatorId,
        sale: saleDto,
        prepared,
      });
    }

    const persisted = await findSaleById(input.contaId, sale.id);
    if (!persisted) {
      throw new StoreSaleError('VENDA_NAO_ENCONTRADA', 'Venda não encontrada após criação.', 404);
    }

    await auditLogService.record({
      contaId: input.contaId,
      actor: { type: 'USER', id: input.operatorId },
      action: 'loja.sale.created',
      entity: { type: 'Sale', id: sale.id },
      metadata: {
        saleNumber: persisted.saleNumber,
        finalizationType: persisted.finalizationType,
        status: persisted.status,
        inventoryMode: persisted.inventoryMode,
        inventoryStatus: persisted.inventoryStatus,
        total: moneyToNumber(persisted.total),
        totalCost: persisted.totalCost != null ? moneyToNumber(persisted.totalCost) : null,
        grossProfit: persisted.grossProfit != null ? moneyToNumber(persisted.grossProfit) : null,
        grossMargin: persisted.grossMargin != null ? moneyToNumber(persisted.grossMargin) : null,
        chargeId: persisted.chargeId ?? null,
        matriculaId: persisted.matriculaId ?? null,
        customerType: persisted.customerType,
        uiRequestId: persisted.uiRequestId ?? null,
      },
    });

    console.info('[store-sales][created]', {
      contaId: input.contaId,
      saleId: sale.id,
      saleNumber: persisted.saleNumber,
      finalizationType: persisted.finalizationType,
      hasCharge: Boolean(persisted.chargeId),
      hasInstallmentPlan: Boolean(persisted.standaloneInstallmentPlanId),
      durationMs: Date.now() - startedAt,
    });

    return mapSaleRecord(persisted);
  } catch (error) {
    console.error('[store-sales][create-failed-after-local-sale]', {
      contaId: input.contaId,
      saleId: sale.id,
      uiRequestId: input.uiRequestId,
      finalizationType: prepared.finalizationType,
      hasChargeConfig: Boolean(prepared.chargeConfig),
      durationMs: Date.now() - startedAt,
      errorName: error instanceof Error ? error.name : null,
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}

export async function listStoreSales(input: ListStoreSalesInput): Promise<ListStoreSalesOutput> {
  const page = clampPage(input.page);
  const pageSize = clampPageSize(input.pageSize);
  const where: Prisma.SaleWhereInput = {
    contaId: input.contaId,
    ...(input.finalizationType && input.finalizationType !== 'TODOS'
      ? { finalizationType: input.finalizationType }
      : {}),
    ...(input.fromDate || input.toDate
      ? {
          createdAt: {
            ...(input.fromDate
              ? { gte: new Date(`${normalizeDateInput(input.fromDate)}T00:00:00.000Z`) }
              : {}),
            ...(input.toDate
              ? { lte: new Date(`${normalizeDateInput(input.toDate)}T23:59:59.999Z`) }
              : {}),
          },
        }
      : {}),
    AND: [buildSearchWhere(input.search), buildStatusWhere(input.status)].filter(
      (value): value is Prisma.SaleWhereInput => Boolean(value),
    ),
  };

  const [total, initialRecords] = await Promise.all([
    prisma.sale.count({ where }),
    prisma.sale.findMany({
      where,
      include: SALE_DETAIL_INCLUDE,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const converged = await convergeStoreSalesFinancialState({
    contaId: input.contaId,
    sales: initialRecords,
  });

  const records = converged
    ? await prisma.sale.findMany({
        where,
        include: SALE_DETAIL_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      })
    : initialRecords;

  return {
    data: records.map(mapSaleRecord),
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

export async function getStoreSaleById(input: GetStoreSaleInput): Promise<StoreSaleDTO | null> {
  let sale = await findSaleById(input.contaId, input.saleId);
  if (!sale) return null;

  const converged = await convergeStoreSalesFinancialState({
    contaId: input.contaId,
    sales: [sale],
  });

  if (converged) {
    sale = await findSaleById(input.contaId, input.saleId);
    if (!sale) return null;
  }

  return mapSaleRecord(sale);
}

export async function cancelStoreSale(input: CancelStoreSaleInput): Promise<StoreSaleDTO> {
  const sale = await findSaleById(input.contaId, input.saleId);
  if (!sale) {
    throw new StoreSaleError('VENDA_NAO_ENCONTRADA', 'Venda não encontrada.', 404);
  }

  if (sale.status === SaleStatus.CANCELADA) {
    throw new StoreSaleError('VENDA_JA_CANCELADA', 'Esta venda já foi cancelada.', 409);
  }

  const reason = normalizeText(input.reason);
  if (!reason) {
    throw new StoreSaleError('MOTIVO_OBRIGATORIO', 'Informe o motivo do cancelamento.', 422);
  }

  if (sale.finalizationType !== SaleFinalizationType.RECEBIMENTO_PRESENCIAL) {
    const installmentPlan =
      sale.standaloneInstallmentPlan ?? sale.charge?.standaloneInstallmentPlan ?? null;

    if (installmentPlan) {
      for (const charge of installmentPlan.charges) {
        if (charge.asaasPaymentId) {
          await syncChargeBeforeCancel(input.contaId, charge.asaasPaymentId);
        }
      }

      const refreshedPlan = await prisma.standaloneInstallmentPlan.findFirst({
        where: { id: installmentPlan.id, contaId: input.contaId },
        select: {
          asaasInstallmentId: true,
          charges: {
            select: {
              id: true,
              status: true,
            },
          },
        },
      });

      if (!refreshedPlan?.asaasInstallmentId) {
        throw new StoreSaleError(
          'COBRANCA_NAO_ENCONTRADA',
          'Parcelamento vinculado não encontrado.',
          409,
        );
      }

      if (refreshedPlan.charges.some((charge) => charge.status === 'PAID')) {
        throw new StoreSaleError(
          'VENDA_JA_PAGA',
          'Uma parcela da venda já foi paga. Estorno deve ser tratado no financeiro.',
          409,
        );
      }

      if (refreshedPlan.charges.some((charge) => charge.status !== 'CANCELED')) {
        await deleteInstallmentPayments(refreshedPlan.asaasInstallmentId, {
          contaId: input.contaId,
        });
      }

      await prisma.$transaction([
        prisma.charge.updateMany({
          where: {
            contaId: input.contaId,
            standaloneInstallmentPlanId: installmentPlan.id,
            status: { not: 'PAID' },
          },
          data: {
            status: 'CANCELED',
            statusUpdatedAt: new Date(),
          },
        }),
        prisma.standaloneInstallmentPlan.update({
          where: { id: installmentPlan.id },
          data: {
            status: 'CANCELED',
            statusUpdatedAt: new Date(),
          },
        }),
      ]);
    } else {
      const asaasPaymentId = sale.charge?.asaasPaymentId;
      if (!sale.charge || !asaasPaymentId) {
        throw new StoreSaleError(
          'COBRANCA_NAO_ENCONTRADA',
          'A venda possui finalização financeira, mas a cobrança vinculada não foi encontrada.',
          409,
        );
      }

      await syncChargeBeforeCancel(input.contaId, asaasPaymentId);
      const refreshedCharge = await prisma.charge.findFirst({
        where: { id: sale.charge.id, contaId: input.contaId },
        select: { status: true, asaasPaymentId: true },
      });

      if (!refreshedCharge || !refreshedCharge.asaasPaymentId) {
        throw new StoreSaleError(
          'COBRANCA_NAO_ENCONTRADA',
          'Cobrança vinculada não encontrada.',
          409,
        );
      }

      if (refreshedCharge.status === 'PAID') {
        throw new StoreSaleError(
          'VENDA_JA_PAGA',
          'A cobrança vinculada já foi paga. Estorno deve ser tratado no financeiro.',
          409,
        );
      }

      if (refreshedCharge.status !== 'CANCELED') {
        await deletePayment(refreshedCharge.asaasPaymentId, { contaId: input.contaId });
        await syncPaymentStateFromAsaas({
          contaId: input.contaId,
          asaasPaymentId: refreshedCharge.asaasPaymentId,
          eventName: 'PAYMENT_DELETED',
        });
      }
    }
  }

  try {
    await cancelSaleInventory({
      contaId: input.contaId,
      actorUserId: input.operatorId,
      saleId: sale.id,
    });
  } catch (error) {
    if (error instanceof StoreInventoryError) {
      throw new StoreSaleError(error.code, error.message, error.status);
    }

    throw error;
  }

  await prisma.sale.update({
    where: { id: sale.id },
    data: {
      status: SaleStatus.CANCELADA,
      canceledAt: new Date(),
      cancelReason: reason,
      canceledById: input.operatorId,
    },
  });

  await auditLogService.record({
    contaId: input.contaId,
    actor: { type: 'USER', id: input.operatorId },
    action: 'loja.sale.canceled',
    entity: { type: 'Sale', id: sale.id },
    metadata: {
      saleNumber: sale.saleNumber,
      finalizationType: sale.finalizationType,
      chargeId: sale.chargeId ?? null,
      cancelReason: reason,
      statusBefore: sale.status,
      inventoryStatusBefore: sale.inventoryStatus,
    },
  });

  const updated = await findSaleById(input.contaId, sale.id);
  if (!updated) {
    throw new StoreSaleError(
      'VENDA_NAO_ENCONTRADA',
      'Venda não encontrada após cancelamento.',
      404,
    );
  }

  return mapSaleRecord(updated);
}

export async function fulfillStoreSale(input: FulfillStoreSaleInput): Promise<StoreSaleDTO> {
  try {
    await fulfillReservedSaleInventory({
      contaId: input.contaId,
      saleId: input.saleId,
      actorUserId: input.operatorId,
    });
  } catch (error) {
    if (error instanceof StoreInventoryError) {
      throw new StoreSaleError(error.code, error.message, error.status);
    }

    throw error;
  }

  const updated = await findSaleById(input.contaId, input.saleId);
  if (!updated) {
    throw new StoreSaleError('VENDA_NAO_ENCONTRADA', 'Venda não encontrada após cumprimento.', 404);
  }

  return mapSaleRecord(updated);
}

export async function registerStoreSaleReturn(
  input: RegisterStoreSaleReturnInput,
): Promise<StoreSaleDTO> {
  try {
    await registerSaleReturnInventory({
      contaId: input.contaId,
      saleId: input.saleId,
      actorUserId: input.operatorId,
      reason: input.reason,
      items: input.items,
    });
  } catch (error) {
    if (error instanceof StoreInventoryError) {
      throw new StoreSaleError(error.code, error.message, error.status);
    }

    throw error;
  }

  const updated = await findSaleById(input.contaId, input.saleId);
  if (!updated) {
    throw new StoreSaleError('VENDA_NAO_ENCONTRADA', 'Venda não encontrada após devolução.', 404);
  }

  return mapSaleRecord(updated);
}
