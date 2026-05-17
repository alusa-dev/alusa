import { beforeEach, describe, it, expect, vi } from 'vitest';

vi.mock('../financial-read-convergence', () => ({
  convergeStandaloneChargesWithAsaas: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../read-model/charge-read-model.service', () => ({
  chargeReadModelService: {
    listStandaloneChargesFromReadModel: vi.fn(),
  },
}));

import { chargeReadModelService } from '../../read-model/charge-read-model.service';
import { convergeStandaloneChargesWithAsaas } from '../financial-read-convergence';
import { listStandaloneCharges } from '../list-standalone-charges';

// ---------------------------------------------------------------------------
// Mock Prisma via DI
// ---------------------------------------------------------------------------

function createMockDb() {
  return {
    charge: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function makeCharge(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ch_1',
    status: 'OPEN',
    asaasPaymentId: 'pay_asaas_1',
    payerName: 'Maria Silva',
    description: 'Taxa extra',
    value: 150,
    dueDate: new Date('2025-06-20'),
    billingType: 'PIX',
    invoiceUrl: 'https://asaas.com/pay/123',
    standaloneInstallmentPlanId: null,
    createdAt: new Date('2025-06-01'),
    ...overrides,
  };
}

function makeChargeReadModelItem(overrides: Partial<import('../list-standalone-charges').StandaloneChargeItem> = {}) {
  return {
    id: 'crm_1',
    origin: 'STANDALONE' as const,
    description: 'Taxa extra',
    payerName: 'Maria Silva',
    value: 150,
    dueDate: '2025-06-20T00:00:00.000Z',
    billingType: 'PIX',
    status: 'PENDING' as const,
    chargeType: 'ONE_TIME' as const,
    linkStatus: 'LINKED' as const,
    groupId: null,
    asaasPaymentId: 'pay_asaas_1',
    createdAt: '2025-06-01T00:00:00.000Z',
    invoiceUrl: 'https://asaas.com/pay/123',
    isInstallment: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('listStandaloneCharges', () => {
  beforeEach(() => {
    delete process.env.FIN_READMODEL_ENABLED;
    delete process.env.FIN_READMODEL_SHADOW_COMPARE;
    vi.clearAllMocks();
    vi.mocked(convergeStandaloneChargesWithAsaas).mockResolvedValue(false);
    vi.mocked(chargeReadModelService.listStandaloneChargesFromReadModel).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 0,
    });
  });

  it('retorna lista vazia quando não há charges', async () => {
    const db = createMockDb();
    const result = await listStandaloneCharges({ contaId: 'ct_1' }, db);

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.page).toBe(1);
  });

  it('normaliza charge status OPEN → PENDING', async () => {
    const db = createMockDb();
    db.charge.findMany.mockResolvedValue([makeCharge()]);
    db.charge.count.mockResolvedValue(1);

    const result = await listStandaloneCharges({ contaId: 'ct_1' }, db);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].status).toBe('PENDING');
    expect(result.items[0].payerName).toBe('Maria Silva');
    expect(result.items[0].value).toBe(150);
  });

  it('normaliza charge status PAID', async () => {
    const db = createMockDb();
    db.charge.findMany.mockResolvedValue([
      makeCharge({ status: 'PAID' }),
    ]);
    db.charge.count.mockResolvedValue(1);

    const result = await listStandaloneCharges(
      { contaId: 'ct_1', statusView: 'paid' },
      db,
    );

    expect(result.items[0].status).toBe('PAID');
  });

  it('identifica charges de parcelamento via isInstallment', async () => {
    const db = createMockDb();
    db.charge.findMany.mockResolvedValue([
      makeCharge({ standaloneInstallmentPlanId: 'sip_1' }),
    ]);
    db.charge.count.mockResolvedValue(1);

    const result = await listStandaloneCharges({ contaId: 'ct_1' }, db);

    expect(result.items[0].isInstallment).toBe(true);
  });

  it('charge sem plano tem isInstallment=false', async () => {
    const db = createMockDb();
    db.charge.findMany.mockResolvedValue([makeCharge()]);
    db.charge.count.mockResolvedValue(1);

    const result = await listStandaloneCharges({ contaId: 'ct_1' }, db);

    expect(result.items[0].isInstallment).toBe(false);
  });

  it('filtra cobrancaId=null na query (apenas standalone)', async () => {
    const db = createMockDb();
    await listStandaloneCharges({ contaId: 'ct_1' }, db);

    const where = db.charge.findMany.mock.calls[0][0].where;
    expect(where.cobrancaId).toBeNull();
    expect(where.contaId).toBe('ct_1');
  });

  it('statusView=open filtra status CREATED/OPEN/OVERDUE', async () => {
    const db = createMockDb();
    await listStandaloneCharges({ contaId: 'ct_1', statusView: 'open' }, db);

    const where = db.charge.findMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ['CREATED', 'OPEN', 'OVERDUE'] });
  });

  it('statusView=paid filtra status PAID', async () => {
    const db = createMockDb();
    await listStandaloneCharges({ contaId: 'ct_1', statusView: 'paid' }, db);

    const where = db.charge.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('PAID');
  });

  it('statusView=all não filtra status', async () => {
    const db = createMockDb();
    await listStandaloneCharges({ contaId: 'ct_1', statusView: 'all' }, db);

    const where = db.charge.findMany.mock.calls[0][0].where;
    expect(where.status).toBeUndefined();
  });

  it('busca textual é passada como OR payerName/description', async () => {
    const db = createMockDb();
    await listStandaloneCharges({ contaId: 'ct_1', search: 'silva' }, db);

    const where = db.charge.findMany.mock.calls[0][0].where;
    expect(where.OR).toBeDefined();
    expect(where.OR).toHaveLength(2);
    expect(where.OR[0].payerName.contains).toBe('silva');
  });

  it('paginação funciona corretamente', async () => {
    const db = createMockDb();
    db.charge.findMany.mockResolvedValue([makeCharge()]);
    db.charge.count.mockResolvedValue(25);

    const result = await listStandaloneCharges(
      { contaId: 'ct_1', page: 2, pageSize: 10 },
      db,
    );

    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(10);
    expect(result.total).toBe(25);
    expect(result.totalPages).toBe(3);

    // Verifica skip/take
    const call = db.charge.findMany.mock.calls[0][0];
    expect(call.skip).toBe(10);
    expect(call.take).toBe(10);
  });

  it('preenche fallback para payerName e description', async () => {
    const db = createMockDb();
    db.charge.findMany.mockResolvedValue([
      makeCharge({ payerName: null, description: null, value: null }),
    ]);
    db.charge.count.mockResolvedValue(1);

    const result = await listStandaloneCharges({ contaId: 'ct_1' }, db);

    expect(result.items[0].payerName).toBe('Cliente');
    expect(result.items[0].description).toBe('Cobrança Avulsa');
    expect(result.items[0].value).toBe(0);
  });

  it('reconsulta a cobrança após convergência oficial do Asaas', async () => {
    const db = createMockDb();
    db.charge.findMany
      .mockResolvedValueOnce([makeCharge({ status: 'OPEN' })])
      .mockResolvedValueOnce([makeCharge({ status: 'PAID' })]);
    db.charge.count.mockResolvedValue(1);
    vi.mocked(convergeStandaloneChargesWithAsaas).mockResolvedValueOnce(true);

    const result = await listStandaloneCharges({ contaId: 'ct_1' }, db);

    expect(convergeStandaloneChargesWithAsaas).toHaveBeenCalledWith({
      contaId: 'ct_1',
      charges: [{ asaasPaymentId: 'pay_asaas_1', status: 'OPEN' }],
    });
    expect(db.charge.findMany).toHaveBeenCalledTimes(2);
    expect(result.items[0].status).toBe('PAID');
  });

  it('usa ChargeReadModel diretamente quando FIN_READMODEL_ENABLED=true', async () => {
    process.env.FIN_READMODEL_ENABLED = 'true';
    const db = createMockDb();
    vi.mocked(chargeReadModelService.listStandaloneChargesFromReadModel).mockResolvedValueOnce({
      items: [makeChargeReadModelItem({ id: 'crm_1' })],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });

    const result = await listStandaloneCharges({ contaId: 'ct_1' }, db);

    expect(result.items[0].id).toBe('crm_1');
    expect(chargeReadModelService.listStandaloneChargesFromReadModel).toHaveBeenCalledWith({ contaId: 'ct_1' });
    expect(db.charge.findMany).not.toHaveBeenCalled();
    expect(db.charge.count).not.toHaveBeenCalled();
    expect(convergeStandaloneChargesWithAsaas).not.toHaveBeenCalled();
  });

  it('mantém fluxo legado quando FIN_READMODEL_ENABLED=false', async () => {
    process.env.FIN_READMODEL_ENABLED = 'false';
    const db = createMockDb();
    db.charge.findMany.mockResolvedValue([makeCharge()]);
    db.charge.count.mockResolvedValue(1);

    await listStandaloneCharges({ contaId: 'ct_1' }, db);

    expect(db.charge.findMany).toHaveBeenCalledTimes(1);
    expect(db.charge.count).toHaveBeenCalledTimes(1);
    expect(convergeStandaloneChargesWithAsaas).toHaveBeenCalledTimes(1);
    expect(chargeReadModelService.listStandaloneChargesFromReadModel).not.toHaveBeenCalled();
  });
});
