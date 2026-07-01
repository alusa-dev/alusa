import { PlatformBillingError } from './errors';
import { PLATFORM_PLANS, type PlatformPlanCode } from './plans';

export interface StudentCapacityInput {
  contaId: string;
  planCode: PlatformPlanCode | null;
  activeStudents: number;
  additionalActiveStudents: number;
}

export interface StudentCapacityResult {
  allowed: boolean;
  planCode: PlatformPlanCode | null;
  maxActiveStudents: number | null;
  activeStudents: number;
  additionalActiveStudents: number;
  projectedActiveStudents: number;
  recommendedPlanCode: PlatformPlanCode | null;
}

const PLAN_CAPACITY_ORDER: PlatformPlanCode[] = ['STARTER', 'PREMIUM', 'PRO', 'CUSTOM'];

export function recommendPlatformPlanForActiveStudents(activeStudents: number): PlatformPlanCode {
  for (const planCode of PLAN_CAPACITY_ORDER) {
    const max = PLATFORM_PLANS[planCode].maxActiveStudents;
    if (max === null || activeStudents <= max) return planCode;
  }

  return 'CUSTOM';
}

export function evaluateStudentCapacity(input: StudentCapacityInput): StudentCapacityResult {
  const additionalActiveStudents = Math.max(0, Math.floor(input.additionalActiveStudents));
  const activeStudents = Math.max(0, Math.floor(input.activeStudents));
  const projectedActiveStudents = activeStudents + additionalActiveStudents;
  const maxActiveStudents = input.planCode ? PLATFORM_PLANS[input.planCode].maxActiveStudents : null;
  const allowed = maxActiveStudents === null || projectedActiveStudents <= maxActiveStudents;

  return {
    allowed,
    planCode: input.planCode,
    maxActiveStudents,
    activeStudents,
    additionalActiveStudents,
    projectedActiveStudents,
    recommendedPlanCode: allowed ? null : recommendPlatformPlanForActiveStudents(projectedActiveStudents),
  };
}

export function assertStudentCapacityDomain(input: StudentCapacityInput): StudentCapacityResult {
  const result = evaluateStudentCapacity(input);
  if (result.allowed) return result;

  throw new PlatformBillingError(
    'Student capacity exceeded for the current Alusa commercial plan.',
    'PLATFORM_BILLING_STUDENT_CAPACITY_EXCEEDED',
    {
      contaId: input.contaId,
      planCode: result.planCode,
      maxActiveStudents: result.maxActiveStudents,
      activeStudents: result.activeStudents,
      additionalActiveStudents: result.additionalActiveStudents,
      projectedActiveStudents: result.projectedActiveStudents,
      recommendedPlanCode: result.recommendedPlanCode,
    },
  );
}
