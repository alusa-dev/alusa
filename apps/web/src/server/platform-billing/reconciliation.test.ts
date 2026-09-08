import { describe, expect, it } from 'vitest';

import { classifyStuckWebhookEventGroups } from './reconciliation';

describe('classifyStuckWebhookEventGroups', () => {
  it('mantém eventos presos associados ao tenant correto', () => {
    expect(
      classifyStuckWebhookEventGroups(
        [
          { contaId: 'conta-a', count: 2 },
          { contaId: 'conta-b', count: 3 },
        ],
        new Set(['conta-a', 'conta-b']),
      ),
    ).toEqual({
      tenantCounts: { 'conta-a': 2, 'conta-b': 3 },
      platformCount: 0,
    });
  });

  it('trata evento sem tenant ou com tenant inválido como problema da plataforma', () => {
    expect(
      classifyStuckWebhookEventGroups(
        [
          { contaId: null, count: 4 },
          { contaId: 'conta-removida', count: 1 },
        ],
        new Set(['conta-a']),
      ),
    ).toEqual({
      tenantCounts: {},
      platformCount: 5,
    });
  });

  it('não mistura contagens de tenants em uma issue global', () => {
    const result = classifyStuckWebhookEventGroups(
      [
        { contaId: 'conta-a', count: 1 },
        { contaId: null, count: 2 },
      ],
      new Set(['conta-a']),
    );

    expect(result.tenantCounts['conta-a']).toBe(1);
    expect(result.platformCount).toBe(2);
  });
});
