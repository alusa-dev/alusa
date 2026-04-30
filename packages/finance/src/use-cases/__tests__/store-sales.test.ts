import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  Prisma,
  SaleFinalizationType,
  SaleInventoryMode,
  SaleInventoryStatus,
  SalePaymentMethod,
  SaleStatus,
} from '@prisma/client';

import { cancelStoreSale, createStoreSale, StoreSaleError } from '../store-sales';

type StoredSaleItem = {
  id: string;
  saleId: string;
  productId: string;
  variantId: string | null;
  productName: string;
  quantity: number;
  returnedQuantity: number;
  unitPrice: Prisma.Decimal;
  subtotal: Prisma.Decimal;
  unitCostAtSale: Prisma.Decimal | null;
  totalCostAtSale: Prisma.Decimal | null;
  discountShareAtSale: Prisma.Decimal | null;
  netSubtotalAtSale: Prisma.Decimal | null;
  grossProfitAtSale: Prisma.Decimal | null;
  marginAtSale: Prisma.Decimal | null;
  createdAt: Date;
};

type StoredResponsavel = {
  id: string;
  contaId: string;
  nome: string;
  cpf: string;
  email: string;
  telefone: string;
  financeiro: boolean;
};

type StoredSale = {
  id: string;
  contaId: string;
  uiRequestId: string | null;
  saleNumber: number;
  status: SaleStatus;
  customerType: string;
  alunoId: string | null;
  responsavelId: string | null;
  walkInName: string | null;
  walkInPhone: string | null;
  walkInNotes: string | null;
  subtotal: Prisma.Decimal;
  discount: Prisma.Decimal;
  total: Prisma.Decimal;
  totalCost: Prisma.Decimal | null;
  grossProfit: Prisma.Decimal | null;
  grossMargin: Prisma.Decimal | null;
  finalizationType: SaleFinalizationType;
  inventoryMode: SaleInventoryMode;
  inventoryStatus: SaleInventoryStatus;
  paymentMethod: SalePaymentMethod | null;
  amountReceived: Prisma.Decimal | null;
  changeGiven: Prisma.Decimal | null;
  chargeId: string | null;
  matriculaId: string | null;
  operadorId: string;
  canceledAt: Date | null;
  cancelReason: string | null;
  canceledById: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type MockState = {
  products: Map<
    string,
    {
      id: string;
      contaId: string;
      name: string;
      price: Prisma.Decimal;
      stock: number;
      hasVariants: boolean;
    }
  >;
  inventoryBalances: Map<
    string,
    {
      productId: string;
      variantId: string | null;
      onHand: number;
      reserved: number;
      averageCost: Prisma.Decimal;
    }
  >;
  sales: Map<string, StoredSale>;
  saleItems: Map<string, StoredSaleItem[]>;
  responsaveis: Map<string, StoredResponsavel>;
  charges: Map<
    string,
    { id: string; contaId: string; status: string; asaasPaymentId: string | null }
  >;
  prisma: {
    aluno: { findFirst: ReturnType<typeof vi.fn> };
    responsavel: {
      findFirst: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    matricula: { findMany: ReturnType<typeof vi.fn> };
    product: {
      findMany: ReturnType<typeof vi.fn>;
    };
    productVariant: { findMany: ReturnType<typeof vi.fn> };
    inventoryBalance: { findMany: ReturnType<typeof vi.fn> };
    sale: {
      findFirst: ReturnType<typeof vi.fn>;
      findFirstOrThrow: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
    saleItem: { create: ReturnType<typeof vi.fn> };
    charge: { findFirst: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  };
};

function createMockState(): MockState {
  const state: MockState = {
    products: new Map(),
    inventoryBalances: new Map(),
    sales: new Map(),
    saleItems: new Map(),
    responsaveis: new Map(),
    charges: new Map(),
    prisma: {} as MockState['prisma'],
  };

  const buildSaleRecord = (sale: StoredSale) => ({
    ...sale,
    charge: sale.chargeId ? (state.charges.get(sale.chargeId) ?? null) : null,
    conta: {
      nome: 'Alusa Escola',
      cpfCnpj: '12345678000190',
      enderecoLogradouro: 'Rua da Loja',
      enderecoNumero: '100',
      enderecoBairro: 'Centro',
      enderecoCidade: 'Manaus',
      enderecoUf: 'AM',
    },
    aluno: null,
    responsavel: sale.responsavelId ? (state.responsaveis.get(sale.responsavelId) ?? null) : null,
    matricula: null,
    operador: {
      id: sale.operadorId,
      nome: 'Operador Loja',
    },
    items: state.saleItems.get(sale.id) ?? [],
  });

  state.prisma = {
    aluno: {
      findFirst: vi.fn(async () => null),
    },
    responsavel: {
      findFirst: vi.fn(
        async (args?: {
          where?: {
            id?: string | { not?: string };
            contaId?: string;
            cpf?: string;
            email?: string;
          };
        }) => {
          const responsaveis = Array.from(state.responsaveis.values());
          return (
            responsaveis.find((responsavel) => {
              const where = args?.where;
              if (!where) return true;
              if (typeof where.id === 'string' && responsavel.id !== where.id) return false;
              if (
                where.id &&
                typeof where.id === 'object' &&
                where.id.not &&
                responsavel.id === where.id.not
              ) {
                return false;
              }
              if (where.contaId && responsavel.contaId !== where.contaId) return false;
              if (where.cpf && responsavel.cpf !== where.cpf) return false;
              if (where.email && responsavel.email !== where.email) return false;
              return true;
            }) ?? null
          );
        },
      ),
      create: vi.fn(
        async (args: { data: Omit<StoredResponsavel, 'id'>; select?: { id?: boolean } }) => {
          const created: StoredResponsavel = {
            id: `resp-${state.responsaveis.size + 1}`,
            ...args.data,
          };
          state.responsaveis.set(created.id, created);
          return { id: created.id };
        },
      ),
      update: vi.fn(
        async (args: {
          where: { id: string };
          data: Partial<StoredResponsavel>;
          select?: { id?: boolean };
        }) => {
          const responsavel = state.responsaveis.get(args.where.id);
          if (!responsavel) throw new Error('Responsável não encontrado');
          Object.assign(responsavel, args.data);
          state.responsaveis.set(responsavel.id, responsavel);
          return { id: responsavel.id };
        },
      ),
    },
    matricula: {
      findMany: vi.fn(async () => []),
    },
    product: {
      findMany: vi.fn(async (args?: { where?: { contaId?: string; id?: { in?: string[] } } }) => {
        const contaId = args?.where?.contaId;
        const ids = args?.where?.id?.in ?? [];
        return Array.from(state.products.values()).filter(
          (product) =>
            (!contaId || product.contaId === contaId) &&
            (ids.length === 0 || ids.includes(product.id)),
        );
      }),
    },
    productVariant: {
      findMany: vi.fn(async () => []),
    },
    inventoryBalance: {
      findMany: vi.fn(
        async (args?: {
          where?: {
            OR?: Array<{ productId?: { in?: string[] }; variantId?: { in?: string[] } | null }>;
          };
        }) => {
          const filters = args?.where?.OR ?? [];
          const productIds = new Set(filters.flatMap((filter) => filter.productId?.in ?? []));
          const variantIds = new Set(
            filters.flatMap((filter) =>
              filter.variantId && typeof filter.variantId === 'object'
                ? (filter.variantId.in ?? [])
                : [],
            ),
          );

          return Array.from(state.inventoryBalances.values()).filter((balance) => {
            if (balance.variantId) return variantIds.has(balance.variantId);
            return productIds.has(balance.productId);
          });
        },
      ),
    },
    sale: {
      findFirst: vi.fn(
        async (args?: {
          where?: { id?: string; contaId?: string; uiRequestId?: string | null };
          orderBy?: { saleNumber?: 'asc' | 'desc' };
        }) => {
          const sales = Array.from(state.sales.values());

          if (args?.where?.id) {
            const sale = state.sales.get(args.where.id);
            if (!sale || (args.where.contaId && sale.contaId !== args.where.contaId)) return null;
            return buildSaleRecord(sale);
          }

          if (args?.where?.uiRequestId) {
            const found = sales.find(
              (sale) =>
                sale.contaId === args.where?.contaId && sale.uiRequestId === args.where.uiRequestId,
            );
            return found ? buildSaleRecord(found) : null;
          }

          if (args?.orderBy?.saleNumber === 'desc') {
            const [last] = sales.sort((left, right) => right.saleNumber - left.saleNumber);
            return last ? { saleNumber: last.saleNumber } : null;
          }

          return null;
        },
      ),
      findFirstOrThrow: vi.fn(async (args: { where: { id: string; contaId: string } }) => {
        const sale = state.sales.get(args.where.id);
        if (!sale || sale.contaId !== args.where.contaId) throw new Error('Venda não encontrada');
        return buildSaleRecord(sale);
      }),
      create: vi.fn(
        async (args: {
          data: Omit<
            StoredSale,
            | 'id'
            | 'createdAt'
            | 'updatedAt'
            | 'canceledAt'
            | 'cancelReason'
            | 'canceledById'
            | 'chargeId'
          > & { chargeId?: string | null };
        }) => {
          const sale: StoredSale = {
            id: `sale-${state.sales.size + 1}`,
            chargeId: args.data.chargeId ?? null,
            canceledAt: null,
            cancelReason: null,
            canceledById: null,
            createdAt: new Date('2026-04-21T10:00:00.000Z'),
            updatedAt: new Date('2026-04-21T10:00:00.000Z'),
            ...args.data,
          };

          state.sales.set(sale.id, sale);
          return buildSaleRecord(sale);
        },
      ),
      update: vi.fn(async (args: { where: { id: string }; data: Partial<StoredSale> }) => {
        const sale = state.sales.get(args.where.id);
        if (!sale) throw new Error('Venda não encontrada');
        Object.assign(sale, args.data, { updatedAt: new Date('2026-04-21T11:00:00.000Z') });
        state.sales.set(sale.id, sale);
        return buildSaleRecord(sale);
      }),
      delete: vi.fn(async (args: { where: { id: string } }) => {
        state.saleItems.delete(args.where.id);
        state.sales.delete(args.where.id);
        return null;
      }),
      count: vi.fn(async () => state.sales.size),
      findMany: vi.fn(async () => Array.from(state.sales.values()).map(buildSaleRecord)),
    },
    saleItem: {
      create: vi.fn(
        async (args: { data: Omit<StoredSaleItem, 'id' | 'createdAt' | 'returnedQuantity'> }) => {
          const current = state.saleItems.get(args.data.saleId) ?? [];
          const created = {
            id: `${args.data.saleId}-item-${current.length + 1}`,
            createdAt: new Date('2026-04-21T10:00:00.000Z'),
            returnedQuantity: 0,
            ...args.data,
          };
          current.push(created);
          state.saleItems.set(args.data.saleId, current);
          return created;
        },
      ),
    },
    charge: {
      findFirst: vi.fn(async (args: { where: { id: string; contaId: string } }) => {
        const charge = state.charges.get(args.where.id);
        if (!charge || charge.contaId !== args.where.contaId) return null;
        return charge;
      }),
    },
    $transaction: vi.fn(async (callback: (_tx: MockState['prisma']) => Promise<unknown>) =>
      callback(state.prisma),
    ),
  };

  return state;
}

function getMockState(): MockState {
  const stateKey = '__alusaStoreSalesTestState';
  const scope = globalThis as typeof globalThis & {
    [key: string]: MockState | undefined;
  };

  if (!scope[stateKey]) {
    scope[stateKey] = createMockState();
  }

  return scope[stateKey] as MockState;
}

const state = getMockState();

vi.mock('@alusa/database', () => ({
  prisma: getMockState().prisma,
}));

vi.mock('../../foundation/audit-log.service', () => ({
  auditLogService: {
    record: vi.fn(async () => undefined),
  },
}));

vi.mock('../create-standalone-charge', () => ({
  createStandaloneCharge: vi.fn(),
}));

vi.mock('../asaas-ops', () => ({
  deletePayment: vi.fn(async () => ({ id: 'pay-1' })),
  deleteInstallmentPayments: vi.fn(async () => ({ deleted: true, id: 'inst-1' })),
}));

vi.mock('../sync-payment-state-from-asaas', () => ({
  syncPaymentStateFromAsaas: vi.fn(async () => ({
    success: true,
    paymentStatus: 'OPEN',
    appliedEvent: 'PAYMENT_UPDATED',
  })),
}));

vi.mock('../store-inventory', () => ({
  applySaleInventoryOnCreate: vi.fn(async () => undefined),
  cancelSaleInventory: vi.fn(async () => ({ inventoryStatus: 'CANCELED' })),
  fulfillReservedSale: vi.fn(async () => ({ inventoryStatus: 'FULFILLED' })),
  registerSaleReturn: vi.fn(async () => ({ inventoryStatus: 'RETURNED_PARTIAL' })),
  StoreInventoryError: class extends Error {
    code = 'STORE_INVENTORY_ERROR';
    status = 409;
  },
}));

describe('store-sales', () => {
  beforeEach(() => {
    state.products.clear();
    state.inventoryBalances.clear();
    state.sales.clear();
    state.saleItems.clear();
    state.responsaveis.clear();
    state.charges.clear();
    vi.clearAllMocks();
  });

  it('cria venda presencial e devolve troco corretamente', async () => {
    state.products.set('prod-1', {
      id: 'prod-1',
      contaId: 'conta-1',
      name: 'Camiseta Alusa',
      price: new Prisma.Decimal('50.00'),
      stock: 5,
      hasVariants: false,
    });
    state.inventoryBalances.set('prod-1', {
      productId: 'prod-1',
      variantId: null,
      onHand: 5,
      reserved: 0,
      averageCost: new Prisma.Decimal('20.00'),
    });

    const result = await createStoreSale({
      contaId: 'conta-1',
      operatorId: 'user-1',
      uiRequestId: 'sale-request-1',
      customer: {
        type: 'AVULSO',
        name: 'Cliente Balcão',
      },
      items: [{ productId: 'prod-1', quantity: 2 }],
      discount: 10,
      finalization: {
        type: 'RECEBIMENTO_PRESENCIAL',
        paymentMethod: 'DINHEIRO',
        amountReceived: 120,
      },
    });

    expect(result.status).toBe('CONCLUIDA');
    expect(result.total).toBe(90);
    expect(result.totalCost).toBe(40);
    expect(result.grossProfit).toBe(50);
    expect(result.grossMargin).toBe(55.5556);
    expect(result.items[0]?.unitCostAtSale).toBe(20);
    expect(result.items[0]?.discountShareAtSale).toBe(10);
    expect(result.items[0]?.netSubtotalAtSale).toBe(90);
    expect(result.items[0]?.grossProfitAtSale).toBe(50);
    expect(result.changeGiven).toBe(30);
    const inventory = await import('../store-inventory');
    expect(inventory.applySaleInventoryOnCreate).toHaveBeenCalledTimes(1);
  });

  it('cria cobrança para cliente avulso sem vínculo com matrícula', async () => {
    state.products.set('prod-1', {
      id: 'prod-1',
      contaId: 'conta-1',
      name: 'Sapatilha',
      price: new Prisma.Decimal('80.00'),
      stock: 3,
      hasVariants: false,
    });
    state.inventoryBalances.set('prod-1', {
      productId: 'prod-1',
      variantId: null,
      onHand: 3,
      reserved: 0,
      averageCost: new Prisma.Decimal('25.00'),
    });

    const { createStandaloneCharge } = await import('../create-standalone-charge');
    vi.mocked(createStandaloneCharge).mockImplementationOnce(async (input) => {
      state.charges.set('charge-walkin-1', {
        id: 'charge-walkin-1',
        contaId: input.contaId,
        status: 'OPEN',
        asaasPaymentId: 'pay-walkin-1',
      });

      return {
        success: true,
        data: {
          chargeId: 'charge-walkin-1',
          asaasPaymentId: 'pay-walkin-1',
          externalReference: 'alusa:charge:walkin-1',
          status: 'OPEN',
        },
      };
    });

    const result = await createStoreSale({
      contaId: 'conta-1',
      operatorId: 'user-1',
      uiRequestId: 'sale-request-walkin-charge',
      customer: {
        type: 'AVULSO',
        name: 'Cliente Avulso',
        document: '11144477735',
        email: 'cliente.avulso@example.com',
        phone: '(92) 99999-0000',
        saveCustomer: false,
      },
      items: [{ productId: 'prod-1', quantity: 1 }],
      finalization: {
        type: 'COBRANCA',
        dueDate: '2099-01-01',
        billingType: 'PIX',
      },
    });

    const createdResponsavel = Array.from(state.responsaveis.values())[0];
    expect(createdResponsavel).toMatchObject({
      nome: 'Cliente Avulso',
      cpf: '11144477735',
      email: 'cliente.avulso@example.com',
      telefone: '92999990000',
      financeiro: false,
    });

    expect(createStandaloneCharge).toHaveBeenCalledWith(
      expect.objectContaining({
        contaId: 'conta-1',
        payer: { type: 'responsavel', responsavelId: createdResponsavel?.id },
        chargeType: 'ONE_TIME',
        billingType: 'PIX',
        value: 80,
        dueDate: '2099-01-01',
      }),
    );
    expect(result.status).toBe('PENDENTE');
    expect(result.customer.type).toBe('AVULSO');
    expect(result.customer.responsavelId).toBe(createdResponsavel?.id);
    expect(result.charge?.id).toBe('charge-walkin-1');
    expect(result.matricula).toBeNull();
  });

  it('bloqueia finalização em mensalidade na Loja', async () => {
    state.products.set('prod-1', {
      id: 'prod-1',
      contaId: 'conta-1',
      name: 'Material didático',
      price: new Prisma.Decimal('30.00'),
      stock: 2,
      hasVariants: false,
    });

    await expect(
      createStoreSale({
        contaId: 'conta-1',
        operatorId: 'user-1',
        uiRequestId: 'sale-request-2',
        customer: {
          type: 'AVULSO',
          name: 'Cliente Balcão',
        },
        items: [{ productId: 'prod-1', quantity: 1 }],
        finalization: {
          type: 'MENSALIDADE',
          matriculaId: 'mat-1',
        } as never,
      }),
    ).rejects.toMatchObject<Partial<StoreSaleError>>({
      code: 'FINALIZACAO_NAO_SUPORTADA',
    });
  });

  it('cancela venda com cobrança aberta e devolve estoque', async () => {
    state.products.set('prod-1', {
      id: 'prod-1',
      contaId: 'conta-1',
      name: 'Livro',
      price: new Prisma.Decimal('40.00'),
      stock: 0,
      hasVariants: false,
    });

    state.charges.set('charge-1', {
      id: 'charge-1',
      contaId: 'conta-1',
      status: 'OPEN',
      asaasPaymentId: 'pay-1',
    });

    state.sales.set('sale-1', {
      id: 'sale-1',
      contaId: 'conta-1',
      uiRequestId: 'sale-request-3',
      saleNumber: 3,
      status: SaleStatus.PENDENTE,
      customerType: 'RESPONSAVEL',
      alunoId: null,
      responsavelId: 'resp-1',
      walkInName: null,
      walkInPhone: null,
      walkInNotes: null,
      subtotal: new Prisma.Decimal('40.00'),
      discount: new Prisma.Decimal('0'),
      total: new Prisma.Decimal('40.00'),
      totalCost: null,
      grossProfit: null,
      grossMargin: null,
      finalizationType: SaleFinalizationType.COBRANCA,
      inventoryMode: SaleInventoryMode.IMMEDIATE,
      inventoryStatus: SaleInventoryStatus.FULFILLED,
      paymentMethod: null,
      amountReceived: null,
      changeGiven: null,
      chargeId: 'charge-1',
      matriculaId: null,
      operadorId: 'user-1',
      canceledAt: null,
      cancelReason: null,
      canceledById: null,
      createdAt: new Date('2026-04-21T10:00:00.000Z'),
      updatedAt: new Date('2026-04-21T10:00:00.000Z'),
    });
    state.saleItems.set('sale-1', [
      {
        id: 'sale-1-item-1',
        saleId: 'sale-1',
        productId: 'prod-1',
        variantId: null,
        productName: 'Livro',
        quantity: 1,
        returnedQuantity: 0,
        unitPrice: new Prisma.Decimal('40.00'),
        subtotal: new Prisma.Decimal('40.00'),
        unitCostAtSale: null,
        totalCostAtSale: null,
        discountShareAtSale: null,
        netSubtotalAtSale: null,
        grossProfitAtSale: null,
        marginAtSale: null,
        createdAt: new Date('2026-04-21T10:00:00.000Z'),
      },
    ]);

    const { deletePayment } = await import('../asaas-ops');
    const { syncPaymentStateFromAsaas } = await import('../sync-payment-state-from-asaas');
    const { cancelSaleInventory } = await import('../store-inventory');

    const result = await cancelStoreSale({
      contaId: 'conta-1',
      saleId: 'sale-1',
      operatorId: 'user-2',
      reason: 'Pedido cancelado no balcão',
    });

    expect(deletePayment).toHaveBeenCalledWith('pay-1', { contaId: 'conta-1' });
    expect(syncPaymentStateFromAsaas).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('CANCELADA');
    expect(cancelSaleInventory).toHaveBeenCalledWith({
      contaId: 'conta-1',
      actorUserId: 'user-2',
      saleId: 'sale-1',
    });
  });
});
