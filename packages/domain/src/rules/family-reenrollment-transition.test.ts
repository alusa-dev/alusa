import { describe, expect, it } from 'vitest';

import { buildFamilyReenrollmentTransitionPlan } from './family-reenrollment-transition.js';

const baseStudent = {
  alunoId: 'aluno_lara',
  alunoNome: 'Lara',
  targetPlanId: 'plano_ballet',
  payerId: 'resp_vera',
  customerId: 'cus_vera',
  paymentMethod: 'BOLETO' as const,
  dueDay: 5,
  cycle: 'MONTHLY',
  startDate: '2026-07-05',
  endDate: '2027-07-05',
  amount: 150,
  baseAmount: 150,
  discountAmount: 0,
  sourceUpdatedAt: '2026-06-01T10:00:00.000Z',
};

describe('buildFamilyReenrollmentTransitionPlan', () => {
  it('agrupa alunos compatíveis e preserva alocações individuais', () => {
    const plan = buildFamilyReenrollmentTransitionPlan({
      contaId: 'conta_1',
      responsavelId: 'resp_vera',
      effectiveDate: '2026-07-05',
      sourceVersion: 'v1',
      sourceBilling: {
        sourceFamilyEnrollmentId: 'fam_1',
        sourceFinancialAgreementId: 'sub_old',
        currentSubscriptionId: 'sub_remote_old',
        totalAmount: 300,
      },
      students: [
        {
          ...baseStudent,
          sourceEnrollmentId: 'mat_lara_old',
          decision: 'REMATRICULAR_AGORA',
          amount: 150,
        },
        {
          ...baseStudent,
          sourceEnrollmentId: 'mat_nicole_old',
          alunoId: 'aluno_nicole',
          alunoNome: 'Nicole',
          targetPlanId: 'plano_jazz',
          decision: 'REMATRICULAR_AGORA',
          amount: 180,
          baseAmount: 180,
        },
      ],
    });

    expect(plan.blocks).toEqual([]);
    expect(plan.financialGroups).toHaveLength(1);
    expect(plan.financialGroups[0]?.totalAmount).toBe(330);
    expect(plan.financialGroups[0]?.items).toEqual([
      expect.objectContaining({ alunoNome: 'Lara', amount: 150 }),
      expect.objectContaining({ alunoNome: 'Nicole', amount: 180 }),
    ]);
    expect(plan.sourceBillingAction).toBe('SCHEDULE_CLOSURE');
    expect(plan.previewHash).toHaveLength(64);
  });

  it('separa grupos quando termos financeiros são incompatíveis', () => {
    const plan = buildFamilyReenrollmentTransitionPlan({
      contaId: 'conta_1',
      responsavelId: 'resp_vera',
      effectiveDate: '2026-07-05',
      sourceVersion: 'v1',
      students: [
        {
          ...baseStudent,
          sourceEnrollmentId: 'mat_lara_old',
          decision: 'REMATRICULAR_AGORA',
        },
        {
          ...baseStudent,
          sourceEnrollmentId: 'mat_nicole_old',
          alunoId: 'aluno_nicole',
          alunoNome: 'Nicole',
          paymentMethod: 'PIX',
          decision: 'REMATRICULAR_AGORA',
        },
      ],
    });

    expect(plan.financialGroups).toHaveLength(2);
    expect(plan.warnings).toContain(
      'A operação criará mais de uma composição financeira porque os termos de cobrança não são compatíveis.',
    );
  });

  it('não cria cobrança para aluno com decisão posterior', () => {
    const plan = buildFamilyReenrollmentTransitionPlan({
      contaId: 'conta_1',
      responsavelId: 'resp_vera',
      effectiveDate: '2026-07-05',
      sourceVersion: 'v1',
      students: [
        {
          ...baseStudent,
          sourceEnrollmentId: 'mat_lara_old',
          decision: 'REMATRICULAR_AGORA',
        },
        {
          ...baseStudent,
          sourceEnrollmentId: 'mat_nicole_old',
          alunoId: 'aluno_nicole',
          alunoNome: 'Nicole',
          decision: 'DECIDIR_DEPOIS',
          amount: 0,
        },
      ],
    });

    expect(plan.financialGroups).toHaveLength(1);
    expect(plan.decideLater.map((student) => student.alunoNome)).toEqual(['Nicole']);
    expect(plan.financialGroups[0]?.items.map((item) => item.alunoNome)).toEqual(['Lara']);
  });

  it('bloqueia rematrícula sem produto financeiro de destino', () => {
    const plan = buildFamilyReenrollmentTransitionPlan({
      contaId: 'conta_1',
      responsavelId: 'resp_vera',
      effectiveDate: '2026-07-05',
      sourceVersion: 'v1',
      students: [
        {
          ...baseStudent,
          sourceEnrollmentId: 'mat_lara_old',
          targetPlanId: null,
          decision: 'REMATRICULAR_AGORA',
        },
      ],
    });

    expect(plan.blocks).toEqual([
      expect.objectContaining({
        sourceEnrollmentId: 'mat_lara_old',
        code: 'PRODUTO_DESTINO_OBRIGATORIO',
      }),
    ]);
  });
});
