import { describe, it, expect } from 'vitest';

import { mapCreateSubscriptionDTOToInput, mapCreateSubscriptionOutputToDTO } from '../subscriptions.mapper';

describe('Subscriptions mapper', () => {
  it('mapeia CreateSubscriptionDTO para input do use case', () => {
    const input = mapCreateSubscriptionDTOToInput(
      {
        contratoId: 'c1',
        matriculaId: 'm1',
        amount: '150.00',
        nextDueDate: '2026-01-10',
        billingType: 'BOLETO',
        cycle: 'MONTHLY',
      },
      { contaId: 't1', actorId: 'u1' },
    );

    expect(input).toMatchObject({
      contaId: 't1',
      contratoId: 'c1',
      matriculaId: 'm1',
      value: 150,
      nextDueDate: '2026-01-10',
      billingType: 'BOLETO',
      cycle: 'MONTHLY',
      actor: { type: 'USER', id: 'u1' },
    });
  });

  it('mapeia output do use case para DTO', () => {
    const dto = mapCreateSubscriptionOutputToDTO(
      {
        subscriptionId: 's1',
        externalReference: 'subscription:s1',
        asaasSubscriptionId: 'asaas_sub_1',
        status: 'ACTIVE',
        createdAt: '2026-01-01T00:00:00.000Z',
        statusUpdatedAt: '2026-01-01T00:00:00.000Z',
      },
      '150.00',
    );

    expect(dto).toMatchObject({
      id: 's1',
      externalReference: 'subscription:s1',
      asaasSubscriptionId: 'asaas_sub_1',
      status: 'ACTIVE',
      amount: '150.00',
    });
  });
});
