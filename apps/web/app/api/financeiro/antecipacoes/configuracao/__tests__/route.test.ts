/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/safe-server-session', () => ({
  safeGetServerSession: vi.fn(),
}));

vi.mock('@/lib/finance/financial-account-gate', () => ({
  guardFinancialAccountOr412: vi.fn(async () => ({ ok: true })),
}));

vi.mock('@alusa/finance', () => ({
  getReceivableAnticipationConfiguration: vi.fn(),
  updateReceivableAnticipationConfiguration: vi.fn(),
  updateAnticipationConfigurationInputDTOSchema: {
    parse: (value: unknown) => value,
  },
}));

const { PUT } = await import('../route');

async function mockSession(user: Record<string, string> | null) {
  const mod = await import('@/lib/safe-server-session');
  vi.mocked(mod.safeGetServerSession).mockResolvedValue(user ? ({ user } as never) : null);
}

function buildRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/financeiro/antecipacoes/configuracao', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

describe('PUT /api/financeiro/antecipacoes/configuracao', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 409 quando a antecipação automática exige conta PJ', async () => {
    await mockSession({ id: 'u1', contaId: 'c1', role: 'FINANCEIRO' });
    const finance = await import('@alusa/finance');

    vi.mocked(finance.updateReceivableAnticipationConfiguration).mockResolvedValueOnce({
      success: false,
      error: 'ANTECIPACAO_AUTOMATICA_EXIGE_PJ',
    } as never);

    const response = await PUT(buildRequest({ creditCardAutomaticEnabled: true }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe('ANTECIPACAO_AUTOMATICA_EXIGE_PJ');
    expect(body.message).toBe('A antecipação automática está disponível apenas para contas PJ no Asaas.');
  });

  it('repassa bloqueio do gate financeiro', async () => {
    await mockSession({ id: 'u1', contaId: 'c1', role: 'ADMIN' });
    const gate = await import('@/lib/finance/financial-account-gate');

    vi.mocked(gate.guardFinancialAccountOr412).mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'KYC_PENDENTE' }, { status: 412 }),
    } as never);

    const response = await PUT(buildRequest({ creditCardAutomaticEnabled: true }));
    const body = await response.json();

    expect(response.status).toBe(412);
    expect(body.error).toBe('KYC_PENDENTE');
  });
});