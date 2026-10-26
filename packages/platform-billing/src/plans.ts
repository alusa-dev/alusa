import { SCHOOL_PRICE_BANDS } from './commercial-model';
import type { SchoolPriceBandCode } from './commercial-model';

const createBand = <Code extends string>(code: Code, name: string, amountCents: number, minActiveStudents: number, maxActiveStudents: number) => ({
  code, name, amountCents, currency: 'brl', interval: 'month', trialDays: 14,
  minActiveStudents, maxActiveStudents, publicCheckoutEnabled: true,
  includedFeatures: [
    'Alusa completa',
    'Usuários internos ilimitados',
    'Professores ilimitados',
    'Cadastros históricos ilimitados',
    'Nenhum módulo bloqueado',
  ],
} as const);

type NewPlatformPlans = {
  readonly [Code in SchoolPriceBandCode]: ReturnType<typeof createBand<Code>>;
};

const NEW_PLANS = Object.fromEntries(SCHOOL_PRICE_BANDS.map((band) => [
  band.code,
  createBand(band.code, band.name, band.amountCents, band.minStudents, band.maxStudents),
])) as NewPlatformPlans;

/** Legacy values remain readable for webhook reconciliation, never public checkout or selection. */
const LEGACY_PLANS = {
  STARTER: { code: 'STARTER', name: 'Plano legado', amountCents: 14_900, currency: 'brl', interval: 'month', trialDays: null, minActiveStudents: null, maxActiveStudents: null, publicCheckoutEnabled: false, legacy: true, includedFeatures: [] },
  PREMIUM: { code: 'PREMIUM', name: 'Plano legado', amountCents: 27_900, currency: 'brl', interval: 'month', trialDays: null, minActiveStudents: null, maxActiveStudents: null, publicCheckoutEnabled: false, legacy: true, includedFeatures: [] },
  PRO: { code: 'PRO', name: 'Plano legado', amountCents: 49_900, currency: 'brl', interval: 'month', trialDays: null, minActiveStudents: null, maxActiveStudents: null, publicCheckoutEnabled: false, legacy: true, includedFeatures: [] },
  CUSTOM: { code: 'CUSTOM', name: 'Condição personalizada', amountCents: null, currency: 'brl', interval: 'month', trialDays: null, minActiveStudents: null, maxActiveStudents: null, publicCheckoutEnabled: false, legacy: true, includedFeatures: [] },
} as const;

export const PLATFORM_PLANS = deepFreeze({ ...NEW_PLANS, ...LEGACY_PLANS } as const);
export type PlatformPlanCode = keyof typeof PLATFORM_PLANS;
export type PublicPlatformPlanCode = keyof typeof NEW_PLANS;
export type PlatformPlan = (typeof PLATFORM_PLANS)[PlatformPlanCode];
export type PublicPlatformPlan = (typeof PLATFORM_PLANS)[PublicPlatformPlanCode];

export function isPlatformPlanCode(value: unknown): value is PlatformPlanCode {
  return typeof value === 'string' && value in PLATFORM_PLANS;
}

export function isPublicPlatformPlanCode(value: unknown): value is PublicPlatformPlanCode {
  return typeof value === 'string' && value in NEW_PLANS;
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
    if (item && typeof item === 'object') deepFreeze(item as Record<string, unknown>);
  }
  return value;
}
