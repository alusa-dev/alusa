import { describe, it, expect } from 'vitest';
import { safeRedirect, nextParamToRedirect, resolvePostVerificationRedirect } from '@/lib/safe-redirect';

describe('safe-redirect utils', () => {
  it('fallback para /dashboard quando null/undefined/"/"', () => {
    expect(safeRedirect(null)).toBe('/dashboard');
    expect(safeRedirect(undefined)).toBe('/dashboard');
    expect(safeRedirect('/')).toBe('/dashboard');
  });

  it('aceita paths internos válidos', () => {
    expect(safeRedirect('/alunos')).toBe('/alunos');
    expect(safeRedirect('/professores')).toBe('/professores');
  });

  it('rejeita URLs absolutas externas e paths suspeitos', () => {
    expect(safeRedirect('https://evil.com/x')).toBe('/dashboard');
    expect(safeRedirect('http://evil.com/x')).toBe('/dashboard');
    expect(safeRedirect('alunos')).toBe('/dashboard');
    expect(safeRedirect('/a//b')).toBe('/dashboard');
    expect(safeRedirect('/a/../b')).toBe('/dashboard');
  });

  it('nextParamToRedirect usa /dashboard como fallback', () => {
    expect(nextParamToRedirect(null)).toBe('/dashboard');
    expect(nextParamToRedirect('/ok')).toBe('/ok');
  });

  it('preserva onboarding financeiro no primeiro acesso do admin', () => {
    expect(resolvePostVerificationRedirect('/dashboard', 'ADMIN', 'FINANCE_NOT_STARTED')).toBe(
      '/finance/wizard',
    );
    expect(
      resolvePostVerificationRedirect('/dashboard', 'ADMIN', 'FINANCE_ONBOARDING_STARTED'),
    ).toBe('/finance/wizard');
    expect(resolvePostVerificationRedirect('/dashboard', 'ADMIN', 'FINANCE_APPROVED')).toBe(
      '/dashboard',
    );
  });
});
