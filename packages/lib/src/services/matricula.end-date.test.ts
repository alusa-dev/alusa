import { describe, expect, it, vi } from 'vitest';

vi.mock('@/prisma/client', () => ({
  prisma: {
    $transaction: vi.fn(),
  },
}));

const { resolveSubscriptionEndDate } = await import('./matricula');

describe('resolveSubscriptionEndDate', () => {
  it('retorna undefined quando dataFimContrato não existe', () => {
    const result = resolveSubscriptionEndDate(new Date('2025-01-01'), null);
    expect(result).toBeUndefined();
  });

  it('retorna data formatada quando dataFimContrato >= nextDueDate', () => {
    const result = resolveSubscriptionEndDate(
      new Date('2025-01-01'),
      new Date('2025-01-15'),
    );
    expect(result).toBe('2025-01-15');
  });

  it('ignora quando dataFimContrato é anterior ao próximo vencimento', () => {
    const result = resolveSubscriptionEndDate(
      new Date('2025-01-10'),
      new Date('2025-01-05'),
    );
    expect(result).toBeUndefined();
  });
});
