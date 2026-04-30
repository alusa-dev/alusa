import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@alusa/asaas', () => ({
  listFinancialTransactions: vi.fn(),
}));

vi.mock('@alusa/database', () => ({
  loadAsaasCredentials: vi.fn(),
}));

import { listLedgerEntries } from '../list-ledger-entries';

describe('listLedgerEntries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve retornar erro se credenciais não configuradas', async () => {
    const { loadAsaasCredentials } = await import('@alusa/database');
    vi.mocked(loadAsaasCredentials).mockResolvedValue(null);

    const result = await listLedgerEntries({ contaId: 'c1' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');
    }
  });

  it('deve retornar ledger entries normalizados', async () => {
    const { loadAsaasCredentials } = await import('@alusa/database');
    const { listFinancialTransactions } = await import('@alusa/asaas');

    vi.mocked(loadAsaasCredentials).mockResolvedValue({ apiKey: 'key' } as Awaited<ReturnType<typeof loadAsaasCredentials>>);
    vi.mocked(listFinancialTransactions).mockResolvedValue({
      object: 'list',
      hasMore: false,
      totalCount: 2,
      limit: 20,
      offset: 0,
      data: [
        {
          object: 'financialTransaction' as const,
          id: 'ft_1',
          value: 100,
          balance: 500,
          type: 'PAYMENT_RECEIVED',
          date: '2025-03-01',
          description: 'Pagamento recebido',
          paymentId: 'pay_1',
        },
        {
          object: 'financialTransaction' as const,
          id: 'ft_2',
          value: -3.5,
          balance: 496.5,
          type: 'PAYMENT_FEE',
          date: '2025-03-01',
          description: 'Taxa',
          paymentId: 'pay_1',
        },
      ],
    });

    const result = await listLedgerEntries({ contaId: 'c1' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.data).toHaveLength(2);
      expect(result.data.data[0].category).toBe('PAYMENT_RECEIVED');
      expect(result.data.data[0].sign).toBe('CREDIT');
      expect(result.data.data[1].category).toBe('PAYMENT_FEE');
      expect(result.data.data[1].sign).toBe('DEBIT');
      expect(result.data.summaryScope).toBe('CURRENT_PAGE');
      expect(result.data.summary.credits).toBe(100);
      expect(result.data.summary.debits).toBe(-3.5);
      expect(result.data.summary.fees).toBe(3.5);
      expect(result.data.summary.net).toBe(96.5);
    }
  });

  it('deve repassar apenas filtros oficiais do Asaas', async () => {
    const { loadAsaasCredentials } = await import('@alusa/database');
    const { listFinancialTransactions } = await import('@alusa/asaas');

    vi.mocked(loadAsaasCredentials).mockResolvedValue({ apiKey: 'key' } as Awaited<ReturnType<typeof loadAsaasCredentials>>);
    vi.mocked(listFinancialTransactions).mockResolvedValue({
      object: 'list',
      hasMore: false,
      totalCount: 2,
      limit: 20,
      offset: 0,
      data: [
        {
          object: 'financialTransaction' as const,
          id: 'ft_1',
          value: 100,
          balance: 500,
          type: 'PAYMENT_RECEIVED',
          date: '2025-03-01',
          description: 'Pagamento',
          paymentId: 'pay_1',
        },
        {
          object: 'financialTransaction' as const,
          id: 'ft_2',
          value: -3.5,
          balance: 496.5,
          type: 'PAYMENT_FEE',
          date: '2025-03-01',
          description: 'Taxa',
          paymentId: 'pay_1',
        },
      ],
    });

    const result = await listLedgerEntries({
      contaId: 'c1',
      offset: 20,
      limit: 50,
      startDate: '2025-03-01',
      finishDate: '2025-03-31',
      order: 'asc',
    });

    expect(result.success).toBe(true);
    expect(listFinancialTransactions).toHaveBeenCalledWith({
      apiKey: 'key',
      offset: 20,
      limit: 50,
      startDate: '2025-03-01',
      finishDate: '2025-03-31',
      order: 'asc',
    });
  });

  it('deve retornar erro genérico em caso de exceção', async () => {
    const { loadAsaasCredentials } = await import('@alusa/database');
    const { listFinancialTransactions } = await import('@alusa/asaas');

    vi.mocked(loadAsaasCredentials).mockResolvedValue({ apiKey: 'key' } as Awaited<ReturnType<typeof loadAsaasCredentials>>);
    vi.mocked(listFinancialTransactions).mockRejectedValue(new Error('Network error'));

    const result = await listLedgerEntries({ contaId: 'c1' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('ERRO_AO_LISTAR_EXTRATO');
    }
  });
});
