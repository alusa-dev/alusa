import { describe, expect, it } from 'vitest';

import { canViewSensitivePersonData } from '@/lib/privacy/sensitive-access';

describe('sensitive access policy', () => {
  it('permite detalhe institucional apenas para roles autorizadas no mesmo tenant', () => {
    expect(
      canViewSensitivePersonData({
        user: { id: 'u1', role: 'ADMIN', contaId: 'conta-1' },
        contaId: 'conta-1',
        purpose: 'STUDENT_DETAIL',
      }),
    ).toBe(true);

    expect(
      canViewSensitivePersonData({
        user: { id: 'u1', role: 'PROFESSOR', contaId: 'conta-1' },
        contaId: 'conta-1',
        purpose: 'STUDENT_DETAIL',
      }),
    ).toBe(false);
  });

  it('nega acesso quando o tenant da sessão não bate com a operação', () => {
    expect(
      canViewSensitivePersonData({
        user: { id: 'u1', role: 'ADMIN', contaId: 'conta-2' },
        contaId: 'conta-1',
        purpose: 'RESPONSAVEL_DETAIL',
      }),
    ).toBe(false);
  });
});
