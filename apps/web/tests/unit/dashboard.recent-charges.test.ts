import { describe, expect, it } from 'vitest';

import { dedupeRecentChargeRows, type RecentChargeReadModelRow } from '@/lib/dashboard/load-recent-charges';

function row(overrides: Partial<RecentChargeReadModelRow> = {}): RecentChargeReadModelRow {
  return {
    id: 'crm:CHARGE:1',
    sourceKind: 'CHARGE',
    sourceId: 'charge-1',
    asaasPaymentId: 'pay-1',
    alunoId: 'student-1',
    payerName: 'Responsável',
    value: 170,
    dueDate: new Date('2026-09-10T00:00:00.000Z'),
    status: 'PENDING',
    createdAt: new Date('2026-08-31T12:00:00.000Z'),
    ...overrides,
  };
}

describe('recent dashboard charges', () => {
  it('deduplica projeções pelo pagamento do Asaas e prioriza Charge', () => {
    const result = dedupeRecentChargeRows([
      row({ id: 'crm:COBRANCA:1', sourceKind: 'COBRANCA' }),
      row({ id: 'crm:CHARGE:1', sourceKind: 'CHARGE' }),
      row({
        id: 'crm:CHARGE:2',
        sourceId: 'charge-2',
        asaasPaymentId: 'pay-2',
        createdAt: new Date('2026-09-01T12:00:00.000Z'),
      }),
    ]);

    expect(result.map((item) => item.asaasPaymentId)).toEqual(['pay-2', 'pay-1']);
    expect(result.find((item) => item.asaasPaymentId === 'pay-1')?.sourceKind).toBe('CHARGE');
  });

  it('ignora registros sem vínculo com pagamento do Asaas', () => {
    expect(dedupeRecentChargeRows([row({ asaasPaymentId: null })])).toEqual([]);
  });
});
