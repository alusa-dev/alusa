import { describe, expect, it } from 'vitest';
import { PLATFORM_PLANS, getMaxActiveStudents, isPlatformPlanCode, parsePublicCheckoutPlanCode } from '../src';

describe('@alusa/platform-billing plans catalog', () => {
  it('mantém valores em centavos', () => {
    expect(PLATFORM_PLANS.STARTER.amountCents).toBe(14_900);
    expect(PLATFORM_PLANS.PREMIUM.amountCents).toBe(27_900);
    expect(PLATFORM_PLANS.PRO.amountCents).toBe(49_900);
  });

  it('mantém limites de alunos ativos', () => {
    expect(getMaxActiveStudents('STARTER')).toBe(60);
    expect(getMaxActiveStudents('PREMIUM')).toBe(150);
    expect(getMaxActiveStudents('PRO')).toBe(300);
  });

  it('usa BRL e periodicidade mensal', () => {
    expect(PLATFORM_PLANS.STARTER.currency).toBe('brl');
    expect(PLATFORM_PLANS.PREMIUM.currency).toBe('brl');
    expect(PLATFORM_PLANS.PRO.currency).toBe('brl');
    expect(PLATFORM_PLANS.STARTER.interval).toBe('month');
    expect(PLATFORM_PLANS.PREMIUM.interval).toBe('month');
    expect(PLATFORM_PLANS.PRO.interval).toBe('month');
  });

  it('mantém duração válida de teste em todos os planos públicos', () => {
    expect(PLATFORM_PLANS.STARTER.trialDays).toBe(14);
    expect(PLATFORM_PLANS.PREMIUM.trialDays).toBe(14);
    expect(PLATFORM_PLANS.PRO.trialDays).toBe(14);
  });

  it('rejeita códigos inválidos', () => {
    expect(isPlatformPlanCode('UNKNOWN')).toBe(false);
    expect(() => parsePublicCheckoutPlanCode('UNKNOWN')).toThrow();
  });

  it('impede mutação acidental em runtime', () => {
    expect(Object.isFrozen(PLATFORM_PLANS)).toBe(true);
    expect(Object.isFrozen(PLATFORM_PLANS.STARTER)).toBe(true);
    expect(() => {
      (PLATFORM_PLANS.STARTER as { amountCents: number }).amountCents = 1;
    }).toThrow();
    expect(PLATFORM_PLANS.STARTER.amountCents).toBe(14_900);
  });

  it('mantém plano personalizado fora do checkout público', () => {
    expect(PLATFORM_PLANS.CUSTOM.publicCheckoutEnabled).toBe(false);
    expect(() => parsePublicCheckoutPlanCode('CUSTOM')).toThrow();
  });
});
