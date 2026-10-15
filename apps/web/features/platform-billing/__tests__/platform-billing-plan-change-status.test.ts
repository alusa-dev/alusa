import { describe, expect, it } from 'vitest';
import { getPlanChangeLabel } from '../PlatformBillingFeature';

describe('getPlanChangeLabel', () => {
  it('informa até quando o plano atual continua ativo e quando o novo plano começa', () => {
    const label = getPlanChangeLabel({
      id: 'change-1',
      type: 'DOWNGRADE',
      status: 'PENDING_EFFECTIVE_DATE',
      fromPlanCode: 'PRO',
      toPlanCode: 'STARTER',
      effectiveAt: '2030-05-15T12:00:00.000Z',
      requestedAt: '2030-05-01T12:00:00.000Z',
      lastError: null,
    }, '2030-05-15T12:00:00.000Z');

    expect(label).toBe('Seu plano Pro continua ativo até 15/05/2030 e, a partir dessa data, sua conta passa para o plano Starter.');
  });

  it('explica a troca na renovação quando a data ainda não está disponível', () => {
    const label = getPlanChangeLabel({
      id: 'change-2',
      type: 'DOWNGRADE',
      status: 'PENDING_EFFECTIVE_DATE',
      fromPlanCode: 'PREMIUM',
      toPlanCode: 'STARTER',
      effectiveAt: null,
      requestedAt: '2030-05-01T12:00:00.000Z',
      lastError: null,
    }, null);

    expect(label).toBe('Seu plano Premium continua ativo até a renovação e, a partir dela, sua conta passa para o plano Starter.');
  });
});
