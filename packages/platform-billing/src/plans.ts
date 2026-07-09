export const PLATFORM_PLANS = deepFreeze({
  STARTER: {
    code: 'STARTER',
    name: 'Starter',
    amountCents: 14_900,
    currency: 'brl',
    interval: 'month',
    trialDays: 14,
    maxActiveStudents: 60,
    publicCheckoutEnabled: true,
    includedFeatures: [
      'Alusa completa',
      'Usuários internos ilimitados',
      'Professores ilimitados',
      'Cadastros históricos ilimitados',
      'Nenhum módulo bloqueado',
    ],
  },
  PREMIUM: {
    code: 'PREMIUM',
    name: 'Premium',
    amountCents: 27_900,
    currency: 'brl',
    interval: 'month',
    trialDays: 14,
    maxActiveStudents: 150,
    publicCheckoutEnabled: true,
    includedFeatures: [
      'Alusa completa',
      'Usuários internos ilimitados',
      'Professores ilimitados',
      'Cadastros históricos ilimitados',
      'Nenhum módulo bloqueado',
    ],
  },
  PRO: {
    code: 'PRO',
    name: 'Pro',
    amountCents: 49_900,
    currency: 'brl',
    interval: 'month',
    trialDays: 14,
    maxActiveStudents: 300,
    publicCheckoutEnabled: true,
    includedFeatures: [
      'Alusa completa',
      'Usuários internos ilimitados',
      'Professores ilimitados',
      'Cadastros históricos ilimitados',
      'Nenhum módulo bloqueado',
    ],
  },
  CUSTOM: {
    code: 'CUSTOM',
    name: 'Personalizado',
    amountCents: null,
    currency: 'brl',
    interval: 'month',
    trialDays: null,
    maxActiveStudents: null,
    publicCheckoutEnabled: false,
    includedFeatures: [
      'Alusa completa',
      'Usuários internos ilimitados',
      'Professores ilimitados',
      'Cadastros históricos ilimitados',
      'Nenhum módulo bloqueado',
    ],
  },
} as const);

export type PlatformPlanCode = keyof typeof PLATFORM_PLANS;
export type PublicPlatformPlanCode = Exclude<PlatformPlanCode, 'CUSTOM'>;
export type PlatformPlan = (typeof PLATFORM_PLANS)[PlatformPlanCode];
export type PublicPlatformPlan = (typeof PLATFORM_PLANS)[PublicPlatformPlanCode];

export function isPlatformPlanCode(value: unknown): value is PlatformPlanCode {
  return typeof value === 'string' && value in PLATFORM_PLANS;
}

export function getPlatformPlan(planCode: PlatformPlanCode): PlatformPlan {
  return PLATFORM_PLANS[planCode];
}

export function getMaxActiveStudents(planCode: PlatformPlanCode): number | null {
  return getPlatformPlan(planCode).maxActiveStudents;
}

function deepFreeze<T extends Record<string, unknown>>(value: T): Readonly<T> {
  Object.freeze(value);

  for (const item of Object.values(value)) {
    if (item && typeof item === 'object') {
      deepFreeze(item as Record<string, unknown>);
    }
  }

  return value;
}
