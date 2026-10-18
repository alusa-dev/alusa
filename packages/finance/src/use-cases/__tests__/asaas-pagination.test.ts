import { describe, expect, it } from 'vitest';
import { assertCompleteAsaasPage } from '../asaas-pagination';

describe('assertCompleteAsaasPage', () => {
  it('falha fechado quando uma página não final tem menos itens que o limite', () => {
    expect(() => assertCompleteAsaasPage({
      data: [{ id: 'first' }],
      hasMore: true,
      totalCount: 101,
      offset: 0,
      limit: 100,
    }, 0, 100)).toThrow('ASAAS_LIST_INCOMPLETE:SHORT_PAGE_WITH_MORE');
  });

  it('aceita página não final cheia e página final curta', () => {
    expect(assertCompleteAsaasPage({
      data: Array.from({ length: 100 }, (_, index) => ({ id: `payment-${index}` })),
      hasMore: true,
      totalCount: 101,
      offset: 0,
      limit: 100,
    }, 0, 100)).toBe(101);
    expect(assertCompleteAsaasPage({
      data: [{ id: 'last' }],
      hasMore: false,
      totalCount: 101,
      offset: 100,
      limit: 100,
    }, 100, 100, 101)).toBe(101);
  });
});
