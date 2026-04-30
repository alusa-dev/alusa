import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AsaasListResponse, AsaasFinancialTransaction } from '@alusa/asaas';

vi.mock('@alusa/asaas', () => ({
  listFinancialTransactions: vi.fn(),
}));

vi.mock('@alusa/database', () => ({
  loadAsaasCredentials: vi.fn(),
  prisma: {
    charge: {
      findMany: vi.fn(async () => []),
    },
    invoice: {
      findMany: vi.fn(async () => []),
    },
    transferRequest: {
      findMany: vi.fn(async () => []),
    },
    webhookAsaas: {
      findMany: vi.fn(async () => []),
    },
  },
}));

import { getExtrato } from '../get-extrato';

function mockCredentials(apiKey = '$aact_hmlg_test') {
  return vi.mocked((async () => {
    const mod = await import('@alusa/database');
    return mod.loadAsaasCredentials;
  })()).then((fn) => fn);
}

function asaasEntries(
  items: Array<{
    id: string;
    value: number;
    balance: number;
    type: string;
    date: string;
    description: string;
    externalReference?: string | null;
    paymentId?: string;
    invoiceId?: string | null;
  }>,
): AsaasListResponse<AsaasFinancialTransaction> {
  return {
    object: 'list',
    data: items.map((item) => ({
      object: 'financialTransaction',
      splitId: null,
      transferId: null,
      anticipationId: null,
      billId: null,
      invoiceId: null,
      paymentDunningId: null,
      creditBureauReportId: null,
      ...item,
    })),
    hasMore: false,
    totalCount: items.length,
    limit: 100,
    offset: 0,
  };
}

describe('getExtrato', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve retornar erro quando credenciais não existem', async () => {
    const { loadAsaasCredentials } = await import('@alusa/database');
    vi.mocked(loadAsaasCredentials).mockResolvedValue(null);

    const result = await getExtrato({
      contaId: 't1',
      query: { page: 1, pageSize: 20, sort: 'date', direction: 'desc' },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');
    }
  });

  it('deve retornar extrato vazio quando Asaas retorna lista vazia', async () => {
    const { loadAsaasCredentials } = await import('@alusa/database');
    vi.mocked(loadAsaasCredentials).mockResolvedValue({ apiKey: '$aact_hmlg_test' } as any);

    const { listFinancialTransactions } = await import('@alusa/asaas');
    vi.mocked(listFinancialTransactions).mockResolvedValue(asaasEntries([]));

    const result = await getExtrato({
      contaId: 't1',
      query: { page: 1, pageSize: 20, sort: 'date', direction: 'desc' },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.transactions).toHaveLength(0);
      expect(result.data.summary).toEqual({ receitas: 0, despesas: 0, estornos: 0, liquido: 0 });
      expect(result.data.pagination.totalItems).toBe(0);
      expect(result.data.sync.truncated).toBe(false);
    }
  });

  it('deve calcular summary corretamente sobre o período completo', async () => {
    const { loadAsaasCredentials } = await import('@alusa/database');
    vi.mocked(loadAsaasCredentials).mockResolvedValue({ apiKey: '$aact_hmlg_test' } as any);

    const { listFinancialTransactions } = await import('@alusa/asaas');
    vi.mocked(listFinancialTransactions).mockResolvedValue(asaasEntries([
      { id: 'ft_1', value: 100, balance: 100, type: 'PAYMENT_RECEIVED', date: '2025-06-01', description: 'Pagamento 1' },
      { id: 'ft_2', value: -3.49, balance: 96.51, type: 'PAYMENT_FEE', date: '2025-06-01', description: 'Taxa pag 1' },
      { id: 'ft_3', value: 200, balance: 296.51, type: 'PAYMENT_RECEIVED', date: '2025-06-02', description: 'Pagamento 2' },
      { id: 'ft_4', value: -100, balance: 196.51, type: 'REVERSAL', date: '2025-06-03', description: 'Estorno pag 1' },
      { id: 'ft_5', value: -50, balance: 146.51, type: 'TRANSFER', date: '2025-06-04', description: 'Transferência' },
    ]));

    const result = await getExtrato({
      contaId: 't1',
      query: { page: 1, pageSize: 20, sort: 'date', direction: 'desc' },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.summary.receitas).toBe(300); // 100 + 200
      expect(result.data.summary.estornos).toBe(100); // abs(-100)
      expect(result.data.summary.despesas).toBe(53.49); // taxa + transferência
      // liquido = 100 - 3.49 + 200 - 100 - 50 = 146.51
      expect(result.data.summary.liquido).toBe(146.51);
    }
  });

  it('deve paginar resultado corretamente', async () => {
    const { loadAsaasCredentials } = await import('@alusa/database');
    vi.mocked(loadAsaasCredentials).mockResolvedValue({ apiKey: '$aact_hmlg_test' } as any);

    const entries = Array.from({ length: 5 }, (_, i) => ({
      id: `ft_${i}`,
      value: 100,
      balance: (i + 1) * 100,
      type: 'PAYMENT_RECEIVED',
      date: `2025-06-0${i + 1}`,
      description: `Pagamento ${i + 1}`,
    }));

    const { listFinancialTransactions } = await import('@alusa/asaas');
    vi.mocked(listFinancialTransactions).mockResolvedValue(asaasEntries(entries));

    const result = await getExtrato({
      contaId: 't1',
      query: { page: 2, pageSize: 2, sort: 'date', direction: 'desc' },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.transactions).toHaveLength(2);
      expect(result.data.pagination.page).toBe(2);
      expect(result.data.pagination.totalItems).toBe(5);
      expect(result.data.pagination.totalPages).toBe(3);
      expect(result.data.pagination.hasNextPage).toBe(true);
    }
  });

  it('deve filtrar por type localmente', async () => {
    const { loadAsaasCredentials } = await import('@alusa/database');
    vi.mocked(loadAsaasCredentials).mockResolvedValue({ apiKey: '$aact_hmlg_test' } as any);

    const { listFinancialTransactions } = await import('@alusa/asaas');
    vi.mocked(listFinancialTransactions).mockResolvedValue(asaasEntries([
      { id: 'ft_1', value: 100, balance: 100, type: 'PAYMENT_RECEIVED', date: '2025-06-01', description: 'Pagamento' },
      { id: 'ft_2', value: -3.49, balance: 96.51, type: 'PAYMENT_FEE', date: '2025-06-01', description: 'Taxa' },
      { id: 'ft_3', value: -50, balance: 46.51, type: 'TRANSFER', date: '2025-06-02', description: 'Transferência' },
    ]));

    const result = await getExtrato({
      contaId: 't1',
      query: { page: 1, pageSize: 20, sort: 'date', direction: 'desc', type: ['RECEITA'] },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.transactions).toHaveLength(1);
      expect(result.data.transactions[0].type).toBe('RECEITA');
      expect(result.data.pagination.totalItems).toBe(1);
    }
  });

  it('deve filtrar por search (description, chargeName, paymentId)', async () => {
    const { loadAsaasCredentials } = await import('@alusa/database');
    vi.mocked(loadAsaasCredentials).mockResolvedValue({ apiKey: '$aact_hmlg_test' } as any);

    const { listFinancialTransactions } = await import('@alusa/asaas');
    vi.mocked(listFinancialTransactions).mockResolvedValue(asaasEntries([
      { id: 'ft_1', value: 100, balance: 100, type: 'PAYMENT_RECEIVED', date: '2025-06-01', description: 'Mensalidade João' },
      { id: 'ft_2', value: 200, balance: 300, type: 'PAYMENT_RECEIVED', date: '2025-06-02', description: 'Mensalidade Maria' },
      { id: 'ft_3', value: -3.49, balance: 296.51, type: 'PAYMENT_FEE', date: '2025-06-02', description: 'Taxa' },
    ]));

    const result = await getExtrato({
      contaId: 't1',
      query: { page: 1, pageSize: 20, sort: 'date', direction: 'desc', search: 'joão' },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.transactions).toHaveLength(1);
      expect(result.data.transactions[0].description).toBe('Mensalidade João');
    }
  });

  it('deve enriquecer linha por invoiceId quando não houver paymentId vinculado', async () => {
    const { loadAsaasCredentials, prisma } = await import('@alusa/database');
    vi.mocked(loadAsaasCredentials).mockResolvedValue({ apiKey: '$aact_hmlg_test' } as any);
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      {
        id: 'inv_local_1',
        asaasInvoiceId: 'inv_ext_1',
        charge: {
          payerName: 'Responsável Financeiro',
          description: 'Mensalidade Fevereiro',
          customerId: 'cust_1',
          cobrancaId: 'cob_1',
          standaloneInstallmentPlanId: null,
          standaloneSubscriptionId: 'sub_local_1',
        },
      },
    ] as any);

    const { listFinancialTransactions } = await import('@alusa/asaas');
    vi.mocked(listFinancialTransactions).mockResolvedValue(asaasEntries([
      {
        id: 'ft_1',
        value: -12,
        balance: 188,
        type: 'INVOICE_FEE',
        date: '2025-06-02',
        description: 'Taxa de nota fiscal',
        invoiceId: 'inv_ext_1',
      } as any,
    ]));

    const result = await getExtrato({
      contaId: 't1',
      query: { page: 1, pageSize: 20, sort: 'date', direction: 'desc' },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.transactions[0].chargeName).toBe('Mensalidade Fevereiro');
      expect(result.data.transactions[0].customerName).toBe('Responsável Financeiro');
      expect(result.data.transactions[0].metadata?.invoiceRecordId).toBe('inv_local_1');
      expect(result.data.transactions[0].metadata?.chargeId).toBe('cob_1');
    }
  });

  it('deve enriquecer linha de transferencia com destinatario e referencia local', async () => {
    const { loadAsaasCredentials, prisma } = await import('@alusa/database');
    vi.mocked(loadAsaasCredentials).mockResolvedValue({ apiKey: '$aact_hmlg_test' } as any);
    vi.mocked(prisma.transferRequest.findMany).mockResolvedValue([
      {
        id: 'tr_local_1',
        asaasTransferId: 'asaas_tr_1',
        externalReference: 'transfer:tr_local_1',
        description: 'Repasse mensal para parceiro',
        destination: {
          type: 'PIX',
          pixAddressKey: 'b3d7e6d7-1d2a-4fbe-92d5-1234567890ab',
          pixAddressKeyType: 'EVP',
        },
        pixTransferSession: {
          recipientName: 'Joao Silva',
          recipientDocumentMasked: '***.911.111-**',
          recipientBank: 'Banco Virtual - BACEN',
        },
      },
    ] as any);

    const { listFinancialTransactions } = await import('@alusa/asaas');
    vi.mocked(listFinancialTransactions).mockResolvedValue(asaasEntries([
      {
        id: 'ft_transfer_1',
        value: -80,
        balance: 120,
        type: 'TRANSFER',
        date: '2025-06-02',
        description: 'Transferência PIX enviada',
        transferId: 'asaas_tr_1',
      } as any,
      {
        id: 'ft_transfer_fee_1',
        value: -2.5,
        balance: 117.5,
        type: 'TRANSFER_FEE',
        date: '2025-06-02',
        description: 'Taxa da transferência',
        transferId: 'asaas_tr_1',
      } as any,
    ]));

    const result = await getExtrato({
      contaId: 't1',
      query: { page: 1, pageSize: 20, sort: 'date', direction: 'desc' },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      const transfer = result.data.transactions.find((entry) => entry.id === 'ft_transfer_1');
      expect(transfer).toMatchObject({
        customerName: 'Joao Silva',
        chargeName: 'Repasse mensal para parceiro',
        transferId: 'asaas_tr_1',
        metadata: expect.objectContaining({
          transferRequestId: 'tr_local_1',
          transferExternalReference: 'transfer:tr_local_1',
          transferRecipientDocumentMasked: '***.911.111-**',
          transferRecipientBank: 'Banco Virtual - BACEN',
        }),
      });
    }
  });

  it('nunca altera campos oficiais do ledger durante o enriquecimento local', async () => {
    const { loadAsaasCredentials, prisma } = await import('@alusa/database');
    vi.mocked(loadAsaasCredentials).mockResolvedValue({ apiKey: '$aact_hmlg_test' } as any);
    vi.mocked(prisma.charge.findMany).mockResolvedValue([
      {
        asaasPaymentId: 'pay_1',
        payerName: 'Responsável Financeiro',
        description: 'Mensalidade Março',
        customerId: 'cust_1',
        cobrancaId: 'cob_1',
        standaloneInstallmentPlanId: null,
        standaloneSubscriptionId: null,
      },
    ] as any);

    const { listFinancialTransactions } = await import('@alusa/asaas');
    vi.mocked(listFinancialTransactions).mockResolvedValue(asaasEntries([
      {
        id: 'ft_1',
        value: 150,
        balance: 450,
        type: 'PAYMENT_RECEIVED',
        date: '2026-03-09',
        description: 'Recebimento oficial',
        paymentId: 'pay_1',
      },
    ]));

    const result = await getExtrato({
      contaId: 't1',
      query: { page: 1, pageSize: 20, sort: 'date', direction: 'desc' },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.transactions[0]).toMatchObject({
        id: 'ft_1',
        description: 'Recebimento oficial',
        type: 'RECEITA',
        status: 'CONFIRMADO',
        grossValue: 150,
        fee: 0,
        netValue: 150,
        balanceAfter: 450,
        chargeName: 'Mensalidade Março',
        customerName: 'Responsável Financeiro',
      });
    }
  });

  it('deve ordenar por grossValue', async () => {
    const { loadAsaasCredentials } = await import('@alusa/database');
    vi.mocked(loadAsaasCredentials).mockResolvedValue({ apiKey: '$aact_hmlg_test' } as any);

    const { listFinancialTransactions } = await import('@alusa/asaas');
    vi.mocked(listFinancialTransactions).mockResolvedValue(asaasEntries([
      { id: 'ft_1', value: 100, balance: 100, type: 'PAYMENT_RECEIVED', date: '2025-06-01', description: 'P1' },
      { id: 'ft_2', value: 300, balance: 400, type: 'PAYMENT_RECEIVED', date: '2025-06-02', description: 'P2' },
      { id: 'ft_3', value: 50, balance: 450, type: 'PAYMENT_RECEIVED', date: '2025-06-03', description: 'P3' },
    ]));

    const result = await getExtrato({
      contaId: 't1',
      query: { page: 1, pageSize: 20, sort: 'grossValue', direction: 'asc' },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.transactions[0].grossValue).toBe(50);
      expect(result.data.transactions[1].grossValue).toBe(100);
      expect(result.data.transactions[2].grossValue).toBe(300);
    }
  });

  it('deve incluir filtros aplicados na resposta', async () => {
    const { loadAsaasCredentials } = await import('@alusa/database');
    vi.mocked(loadAsaasCredentials).mockResolvedValue({ apiKey: '$aact_hmlg_test' } as any);

    const { listFinancialTransactions } = await import('@alusa/asaas');
    vi.mocked(listFinancialTransactions).mockResolvedValue(asaasEntries([]));

    const result = await getExtrato({
      contaId: 't1',
      query: {
        page: 1,
        pageSize: 10,
        sort: 'date',
        direction: 'asc',
        startDate: '2025-01-01',
        endDate: '2025-01-31',
        type: ['RECEITA'],
        search: 'teste',
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.filters.startDate).toBe('2025-01-01');
      expect(result.data.filters.endDate).toBe('2025-01-31');
      expect(result.data.filters.type).toEqual(['RECEITA']);
      expect(result.data.filters.search).toBe('teste');
    }
  });

  it('deve preservar externalReference do ledger oficial para busca e auditoria', async () => {
    const { loadAsaasCredentials } = await import('@alusa/database');
    vi.mocked(loadAsaasCredentials).mockResolvedValue({ apiKey: '$aact_hmlg_test' } as any);

    const { listFinancialTransactions } = await import('@alusa/asaas');
    vi.mocked(listFinancialTransactions).mockResolvedValue(asaasEntries([
      {
        id: 'ft_1',
        value: 100,
        balance: 100,
        type: 'PAYMENT_RECEIVED',
        date: '2025-06-01',
        description: 'Pagamento externo',
        externalReference: 'charge:local_123',
      },
    ]));

    const result = await getExtrato({
      contaId: 't1',
      query: { page: 1, pageSize: 20, sort: 'date', direction: 'desc', search: 'local_123' },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.transactions).toHaveLength(1);
      expect(result.data.transactions[0].externalReference).toBe('charge:local_123');
      expect(result.data.transactions[0].metadata?.externalReference).toBe('charge:local_123');
    }
  });

  it('summary de TAXA deve ter netValue 0 e não contar como despesa', async () => {
    const { loadAsaasCredentials } = await import('@alusa/database');
    vi.mocked(loadAsaasCredentials).mockResolvedValue({ apiKey: '$aact_hmlg_test' } as any);

    const { listFinancialTransactions } = await import('@alusa/asaas');
    vi.mocked(listFinancialTransactions).mockResolvedValue(asaasEntries([
      { id: 'ft_1', value: 100, balance: 100, type: 'PAYMENT_RECEIVED', date: '2025-06-01', description: 'Pag' },
      { id: 'ft_2', value: -3.49, balance: 96.51, type: 'PAYMENT_FEE', date: '2025-06-01', description: 'Taxa' },
    ]));

    const result = await getExtrato({
      contaId: 't1',
      query: { page: 1, pageSize: 20, sort: 'date', direction: 'desc' },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.summary.receitas).toBe(100);
      expect(result.data.summary.despesas).toBe(3.49);
      expect(result.data.summary.liquido).toBe(96.51);
    }
  });
});
