import { describe, expect, it } from 'vitest';

import { resolveSubaccountEmail } from './subaccount-email';

describe('resolveSubaccountEmail', () => {
  it('prioriza o e-mail financeiro configurado', () => {
    expect(resolveSubaccountEmail('  financeiro@escola.example  ', 'dono@escola.example'))
      .toBe('financeiro@escola.example');
  });

  it('usa o e-mail do proprietário como fallback quando não há e-mail configurado', () => {
    expect(resolveSubaccountEmail(null, 'dono@escola.example')).toBe('dono@escola.example');
    expect(resolveSubaccountEmail('   ', 'dono@escola.example')).toBe('dono@escola.example');
  });

  it('retorna null quando nenhum e-mail está disponível', () => {
    expect(resolveSubaccountEmail(null, null)).toBeNull();
  });
});
