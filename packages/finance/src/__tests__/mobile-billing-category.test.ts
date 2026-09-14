import { describe, expect, it } from 'vitest';

import { resolveMobileBillingCategory } from '../billing-status';

describe('resolveMobileBillingCategory', () => {
  const startOfToday = new Date('2026-09-10T00:00:00.000Z');

  it('mantém cobranças canceladas visíveis na listagem', () => {
    expect(resolveMobileBillingCategory({
      localStatus: 'CANCELADO',
      asaasStatus: null,
      liquidacaoStatus: null,
      dueDate: new Date('2026-09-05T00:00:00.000Z'),
      startOfToday,
    })).toBe('CANCELLED');
  });

  it('prioriza o status do Asaas quando a cobrança foi cancelada remotamente', () => {
    expect(resolveMobileBillingCategory({
      localStatus: 'OPEN',
      asaasStatus: 'CANCELED',
      liquidacaoStatus: null,
      dueDate: new Date('2026-09-20T00:00:00.000Z'),
      startOfToday,
    })).toBe('CANCELLED');
  });

  it('separa cobranças estornadas das canceladas', () => {
    expect(resolveMobileBillingCategory({
      localStatus: 'ESTORNADO',
      asaasStatus: null,
      liquidacaoStatus: null,
      dueDate: new Date('2026-09-05T00:00:00.000Z'),
      startOfToday,
    })).toBe('REFUNDED');
  });
});
