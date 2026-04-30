import { describe, expect, it } from 'vitest';

import { createInstallmentPlanDTOSchema } from '../create-installment-plan.dto';
import { listInstallmentPlansQueryDTOSchema } from '../list-installment-plans-query.dto';

describe('Installments DTOs', () => {
  it('valida createInstallmentPlanDTO (happy path)', () => {
    const parsed = createInstallmentPlanDTOSchema.safeParse({
      contratoId: 'c1',
      matriculaId: 'm1',
      amount: '150.00',
      firstDueDate: '2026-01-10',
      billingType: 'BOLETO',
      installmentCount: 3,
    });

    expect(parsed.success).toBe(true);
  });

  it('rejeita createInstallmentPlanDTO inválido', () => {
    const parsed = createInstallmentPlanDTOSchema.safeParse({
      contratoId: '',
      matriculaId: 'm1',
      amount: '0',
      firstDueDate: '2026-1-1',
      billingType: 'BOLETO',
      installmentCount: 1,
    });

    expect(parsed.success).toBe(false);
  });

  it('rejeita billingType UNDEFINED para installments', () => {
    const parsed = createInstallmentPlanDTOSchema.safeParse({
      contratoId: 'c1',
      matriculaId: 'm1',
      amount: '150.00',
      firstDueDate: '2026-01-10',
      billingType: 'UNDEFINED',
      installmentCount: 3,
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issues = parsed.error.issues;
      expect(issues.some((i) => i.path.includes('billingType'))).toBe(true);
    }
  });

  it('valida listInstallmentPlansQuery com defaults', () => {
    const parsed = listInstallmentPlansQueryDTOSchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.page).toBe(1);
      expect(parsed.data.pageSize).toBe(10);
    }
  });
});
