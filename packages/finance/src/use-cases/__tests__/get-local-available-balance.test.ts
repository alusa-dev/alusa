import { describe, expect, it, vi } from 'vitest';

import { getLocalAvailableBalance } from '../get-local-available-balance';

describe('getLocalAvailableBalance', () => {
  it('calcula o saldo local apenas com liquidação disponível', async () => {
    const aggregate = vi.fn().mockResolvedValue({
      _sum: { asaasNetValue: { toNumber: () => 123.45 } },
    });

    const result = await getLocalAvailableBalance('conta-a', {
      cobranca: { aggregate },
    } as never);

    expect(result).toBe(123.45);
    expect(aggregate).toHaveBeenCalledWith({
      where: {
        matricula: { aluno: { contaId: 'conta-a' } },
        liquidacaoStatus: 'DISPONIVEL',
        asaasStatus: { not: 'RECEIVED_IN_CASH' },
      },
      _sum: { asaasNetValue: true },
    });
  });
});
