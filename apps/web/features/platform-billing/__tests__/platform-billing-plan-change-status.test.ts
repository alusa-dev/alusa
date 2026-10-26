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

    expect(label).toBe('Seu plano Plano anterior continua ativo até 15/05/2030 e, a partir dessa data, sua conta passa para o plano Plano anterior.');
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

    expect(label).toBe('Seu plano Plano anterior continua ativo até a renovação e, a partir dela, sua conta passa para o plano Plano anterior.');
  });

  it('explica uma transição automática de faixa agendada para a renovação', () => {
    const label = getPlanChangeLabel({
      id: 'change-3',
      type: 'UPGRADE',
      status: 'PENDING_EFFECTIVE_DATE',
      fromPlanCode: 'BAND_001_025',
      toPlanCode: 'BAND_026_050',
      effectiveAt: '2030-05-15T12:00:00.000Z',
      requestedAt: '2030-05-01T12:00:00.000Z',
      lastError: null,
    }, '2030-05-15T12:00:00.000Z');

    expect(label).toBe('A faixa do plano será atualizada para 26–50 alunos na renovação em 15/05/2030.');
  });
});
