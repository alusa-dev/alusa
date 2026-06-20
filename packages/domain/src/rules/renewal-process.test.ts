import { describe, expect, it } from 'vitest';
import {
  buildRenewalPreview,
  calculateRenewalEffectiveAt,
  canTransitionRenewalProcess,
  type RenewalItemInput,
} from './renewal-process.js';

const source = {
  id: 'mat-1',
  currentContractEndsAt: new Date('2026-07-04T00:00:00.000Z'),
  updatedAt: new Date('2026-01-10T10:00:00.000Z'),
  monthlyAmount: 300,
  enrollmentFeeAmount: 50,
};

function buildItems(items: RenewalItemInput[]) {
  return buildRenewalPreview({
    contaId: 'conta-1',
    origin: 'STANDALONE',
    targetPeriodId: '2027',
    targetPeriodStartsAt: new Date('2026-07-01T00:00:00.000Z'),
    holderType: 'STUDENT',
    holderId: 'aluno-1',
    items,
    sourceEnrollments: [source],
    enrollmentFeeAmount: 50,
  });
}

describe('renewal-process domain rules', () => {
  it('calcula effectiveAt como o dia seguinte ao fim atual quando ele é maior que o início do período', () => {
    const effectiveAt = calculateRenewalEffectiveAt({
      currentContractEndsAt: new Date('2026-07-04T00:00:00.000Z'),
      targetPeriodStartsAt: new Date('2026-07-01T00:00:00.000Z'),
    });

    expect(effectiveAt.toISOString().slice(0, 10)).toBe('2026-07-05');
  });

  it('não cria efeitos quando todos os itens são decisões sem renovação', () => {
    const preview = buildItems([
      {
        decision: 'DECIDE_LATER',
        sourceEnrollmentId: 'mat-1',
        target: null,
      },
    ]);

    expect(preview.renewCount).toBe(0);
    expect(preview.targetEnrollments).toHaveLength(0);
    expect(preview.reservations).toHaveLength(0);
    expect(preview.futureFinancialAgreement).toBeNull();
    expect(preview.warnings).toContain(
      'Nenhum vínculo será renovado; apenas as decisões serão registradas.',
    );
  });

  it('bloqueia destino residual para decisão sem renovação', () => {
    const preview = buildItems([
      {
        decision: 'DO_NOT_CONTINUE',
        sourceEnrollmentId: 'mat-1',
        target: { type: 'CLASS', targetId: 'turma-1', planId: 'plano-1' },
      } as RenewalItemInput,
    ]);

    expect(preview.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'TARGET_MUST_BE_NULL',
          sourceEnrollmentId: 'mat-1',
        }),
      ]),
    );
  });

  it('monta preview de renovação com matrícula futura, reserva e financeiro futuro', () => {
    const preview = buildItems([
      {
        decision: 'RENEW',
        sourceEnrollmentId: 'mat-1',
        target: { type: 'CLASS', targetId: 'turma-1', planId: 'plano-1' },
      },
    ]);

    expect(preview.renewCount).toBe(1);
    expect(preview.monthlyTotal).toBe(300);
    expect(preview.enrollmentFeeTotal).toBe(50);
    expect(preview.effectiveAt).toBe('2026-07-05');
    expect(preview.targetEnrollments[0]).toMatchObject({
      sourceEnrollmentId: 'mat-1',
      targetType: 'CLASS',
      targetId: 'turma-1',
      planId: 'plano-1',
    });
    expect(preview.reservations[0]?.status).toBe('RESERVED');
    expect(preview.previewHash).toHaveLength(64);
  });

  it('valida transições canônicas do processo', () => {
    expect(canTransitionRenewalProcess('PREVIEWED', 'CONFIRMED')).toBe(true);
    expect(canTransitionRenewalProcess('CONFIRMED', 'EFFECTIVE')).toBe(true);
    expect(canTransitionRenewalProcess('CANCELLED', 'CONFIRMED')).toBe(false);
  });
});
