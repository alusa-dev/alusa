import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getBalance } from '../get-balance';

vi.mock('@alusa/database', () => ({
  loadAsaasCredentials: vi.fn(),
}));

vi.mock('@alusa/asaas', () => ({
  getBalance: vi.fn(),
}));

describe('getBalance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve retornar erro se credenciais não configuradas', async () => {
    const { loadAsaasCredentials } = await import('@alusa/database');
    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce(null as never);

    const result = await getBalance({ contaId: 't1' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');
    }
  });

  it('deve retornar balance', async () => {
    const { loadAsaasCredentials } = await import('@alusa/database');
    const { getBalance: asaasGetBalance } = await import('@alusa/asaas');

    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'sandbox_x', contaId: 't1' } as never);
    vi.mocked(asaasGetBalance).mockResolvedValueOnce({ balance: 99.5 } as never);

    const result = await getBalance({ contaId: 't1' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.balance).toBe(99.5);
    }

    expect(asaasGetBalance).toHaveBeenCalledWith({ apiKey: 'sandbox_x' });
  });
});
