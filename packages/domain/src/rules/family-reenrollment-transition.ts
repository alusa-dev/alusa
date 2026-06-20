import { createHash } from 'crypto';

export type FamilyReenrollmentDecision =
  | 'REMATRICULAR_AGORA'
  | 'NAO_CONTINUARA'
  | 'DECIDIR_DEPOIS'
  | 'REMATRICULAR_SEPARADAMENTE'
  | 'ALTERAR_PAGADOR'
  | 'TRANSFERIR_MODALIDADE';

export type FamilyReenrollmentPaymentMethod = 'BOLETO' | 'PIX' | 'CARTAO_CREDITO';

export type FamilyReenrollmentStudentInput = {
  sourceEnrollmentId: string;
  alunoId: string;
  alunoNome: string;
  decision: FamilyReenrollmentDecision;
  targetClassId?: string | null;
  targetPlanId?: string | null;
  targetComboId?: string | null;
  payerId?: string | null;
  customerId?: string | null;
  paymentMethod?: FamilyReenrollmentPaymentMethod | null;
  dueDay?: number | null;
  cycle?: string | null;
  startDate: string;
  endDate: string;
  amount: number;
  baseAmount?: number | null;
  discountAmount?: number | null;
  sourceUpdatedAt: string;
  blockReason?: string | null;
};

export type FamilyReenrollmentSourceBillingInput = {
  sourceFamilyEnrollmentId?: string | null;
  sourceFinancialAgreementId?: string | null;
  familyGroupId?: string | null;
  currentSubscriptionId?: string | null;
  currentSubscriptionStatus?: string | null;
  validUntil?: string | null;
  totalAmount?: number | null;
};

export type FamilyReenrollmentTransitionPlanInput = {
  contaId: string;
  responsavelId: string;
  effectiveDate: string;
  sourceVersion: string;
  sourceBilling?: FamilyReenrollmentSourceBillingInput | null;
  students: FamilyReenrollmentStudentInput[];
};

export type FamilyReenrollmentFinancialGroup = {
  compatibilityKey: string;
  payerId: string | null;
  customerId: string | null;
  paymentMethod: FamilyReenrollmentPaymentMethod | null;
  dueDay: number | null;
  cycle: string | null;
  startDate: string;
  endDate: string;
  totalAmount: number;
  items: Array<{
    sourceEnrollmentId: string;
    alunoId: string;
    alunoNome: string;
    amount: number;
    baseAmount: number | null;
    discountAmount: number | null;
  }>;
};

export type FamilyReenrollmentTransitionPlan = {
  contaId: string;
  responsavelId: string;
  effectiveDate: string;
  sourceVersion: string;
  sourceBilling: FamilyReenrollmentSourceBillingInput | null;
  reenrollNow: FamilyReenrollmentStudentInput[];
  notContinuing: FamilyReenrollmentStudentInput[];
  decideLater: FamilyReenrollmentStudentInput[];
  separated: FamilyReenrollmentStudentInput[];
  financialGroups: FamilyReenrollmentFinancialGroup[];
  sourceBillingAction: 'NONE' | 'SCHEDULE_CLOSURE' | 'REVIEW_MANUAL';
  warnings: string[];
  blocks: Array<{ sourceEnrollmentId: string; code: string; message: string }>;
  snapshot: Record<string, unknown>;
  previewHash: string;
};

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

export function hashFamilyReenrollmentPreview(snapshot: Record<string, unknown>): string {
  return createHash('sha256').update(stableStringify(snapshot)).digest('hex');
}

function buildCompatibilityKey(student: FamilyReenrollmentStudentInput): string {
  return [
    student.payerId ?? 'no-payer',
    student.customerId ?? 'no-customer',
    student.paymentMethod ?? 'no-payment-method',
    student.dueDay ?? 'no-due-day',
    student.cycle ?? 'no-cycle',
    student.startDate,
    student.endDate,
  ].join('|');
}

export function buildFamilyReenrollmentTransitionPlan(
  input: FamilyReenrollmentTransitionPlanInput,
): FamilyReenrollmentTransitionPlan {
  const warnings: string[] = [];
  const blocks: FamilyReenrollmentTransitionPlan['blocks'] = [];

  if (input.students.length === 0) {
    blocks.push({
      sourceEnrollmentId: 'family',
      code: 'SEM_ALUNOS',
      message: 'Informe ao menos um aluno da composição familiar.',
    });
  }

  for (const student of input.students) {
    if (!student.decision) {
      blocks.push({
        sourceEnrollmentId: student.sourceEnrollmentId,
        code: 'DECISAO_OBRIGATORIA',
        message: 'Cada aluno precisa de uma decisão explícita.',
      });
    }

    if (student.decision === 'REMATRICULAR_AGORA') {
      if (!student.targetPlanId && !student.targetComboId) {
        blocks.push({
          sourceEnrollmentId: student.sourceEnrollmentId,
          code: 'PRODUTO_DESTINO_OBRIGATORIO',
          message: 'Selecione plano ou combo para rematricular o aluno.',
        });
      }
      if (student.amount < 0 || !Number.isFinite(student.amount)) {
        blocks.push({
          sourceEnrollmentId: student.sourceEnrollmentId,
          code: 'VALOR_INVALIDO',
          message: 'O valor financeiro do aluno é inválido.',
        });
      }
    }
  }

  const reenrollNow = input.students.filter((student) => student.decision === 'REMATRICULAR_AGORA');
  const notContinuing = input.students.filter((student) => student.decision === 'NAO_CONTINUARA');
  const decideLater = input.students.filter((student) => student.decision === 'DECIDIR_DEPOIS');
  const separated = input.students.filter(
    (student) =>
      student.decision === 'REMATRICULAR_SEPARADAMENTE' ||
      student.decision === 'ALTERAR_PAGADOR' ||
      student.decision === 'TRANSFERIR_MODALIDADE',
  );

  if (decideLater.length > 0) {
    warnings.push('Há alunos com decisão posterior; nenhuma cobrança nova será criada para eles.');
  }

  if (notContinuing.length > 0) {
    warnings.push('Alunos marcados como não continuarão permanecem apenas no ciclo atual.');
  }

  const grouped = new Map<string, FamilyReenrollmentFinancialGroup>();
  for (const student of reenrollNow) {
    const key = buildCompatibilityKey(student);
    const current = grouped.get(key);
    const item = {
      sourceEnrollmentId: student.sourceEnrollmentId,
      alunoId: student.alunoId,
      alunoNome: student.alunoNome,
      amount: roundMoney(student.amount),
      baseAmount: student.baseAmount == null ? null : roundMoney(student.baseAmount),
      discountAmount:
        student.discountAmount == null ? null : roundMoney(student.discountAmount),
    };

    if (!current) {
      grouped.set(key, {
        compatibilityKey: key,
        payerId: student.payerId ?? null,
        customerId: student.customerId ?? null,
        paymentMethod: student.paymentMethod ?? null,
        dueDay: student.dueDay ?? null,
        cycle: student.cycle ?? null,
        startDate: student.startDate,
        endDate: student.endDate,
        totalAmount: item.amount,
        items: [item],
      });
    } else {
      current.items.push(item);
      current.totalAmount = roundMoney(current.totalAmount + item.amount);
    }
  }

  const financialGroups = Array.from(grouped.values()).map((group) => ({
    ...group,
    totalAmount: roundMoney(group.totalAmount),
  }));

  if (financialGroups.length > 1) {
    warnings.push(
      'A operação criará mais de uma composição financeira porque os termos de cobrança não são compatíveis.',
    );
  }

  const sourceBillingAction = input.sourceBilling?.currentSubscriptionId
    ? 'SCHEDULE_CLOSURE'
    : input.sourceBilling?.sourceFinancialAgreementId
      ? 'REVIEW_MANUAL'
      : 'NONE';

  const snapshot = {
    version: 1,
    contaId: input.contaId,
    responsavelId: input.responsavelId,
    effectiveDate: input.effectiveDate,
    sourceVersion: input.sourceVersion,
    sourceBilling: input.sourceBilling ?? null,
    decisions: input.students.map((student) => ({
      sourceEnrollmentId: student.sourceEnrollmentId,
      alunoId: student.alunoId,
      alunoNome: student.alunoNome,
      decision: student.decision,
      targetClassId: student.targetClassId ?? null,
      targetPlanId: student.targetPlanId ?? null,
      targetComboId: student.targetComboId ?? null,
      payerId: student.payerId ?? null,
      customerId: student.customerId ?? null,
      paymentMethod: student.paymentMethod ?? null,
      dueDay: student.dueDay ?? null,
      cycle: student.cycle ?? null,
      startDate: student.startDate,
      endDate: student.endDate,
      amount: roundMoney(student.amount),
      baseAmount: student.baseAmount == null ? null : roundMoney(student.baseAmount),
      discountAmount:
        student.discountAmount == null ? null : roundMoney(student.discountAmount),
      sourceUpdatedAt: student.sourceUpdatedAt,
    })),
    financialGroups,
    sourceBillingAction,
    warnings,
    blocks,
  };

  return {
    contaId: input.contaId,
    responsavelId: input.responsavelId,
    effectiveDate: input.effectiveDate,
    sourceVersion: input.sourceVersion,
    sourceBilling: input.sourceBilling ?? null,
    reenrollNow,
    notContinuing,
    decideLater,
    separated,
    financialGroups,
    sourceBillingAction,
    warnings,
    blocks,
    snapshot,
    previewHash: hashFamilyReenrollmentPreview(snapshot),
  };
}
