import { describe, expect, it } from 'vitest';
import { decideFamilySubscriptionUpdate } from '../subscription-update-decision';

describe('decideFamilySubscriptionUpdate', () => {
  it('atualiza quando o remoto ainda possui o valor anterior', () => {
    expect(
      decideFamilySubscriptionUpdate({
        previousValue: 200,
        desiredValue: 350,
        remoteValue: 200,
      }),
    ).toEqual({ action: 'UPDATE', desiredValue: 350 });
  });

  it('trata retry como sucesso quando o valor desejado já foi aplicado', () => {
    expect(
      decideFamilySubscriptionUpdate({
        previousValue: 200,
        desiredValue: 350,
        remoteValue: 350,
      }),
    ).toEqual({ action: 'ALREADY_APPLIED', desiredValue: 350 });
  });

  it('exige reconciliação para um valor remoto desconhecido', () => {
    expect(
      decideFamilySubscriptionUpdate({
        previousValue: 200,
        desiredValue: 350,
        remoteValue: 275,
      }),
    ).toEqual({
      action: 'REQUIRES_RECONCILIATION',
      previousValue: 200,
      desiredValue: 350,
      remoteValue: 275,
    });
  });
});
