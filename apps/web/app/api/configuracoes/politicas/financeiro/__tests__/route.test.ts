/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { getServerSessionMock, getContaFinancialPolicyRecordMock, upsertContaFinancialPolicyMock } = vi.hoisted(
  () => ({
    getServerSessionMock: vi.fn(),
    getContaFinancialPolicyRecordMock: vi.fn(),
    upsertContaFinancialPolicyMock: vi.fn(),
  }),
);

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

vi.mock('@/src/server/matriculas/rematricula-financial-policy.service', () => ({
  DEFAULT_FINANCIAL_POLICY: {
    preset: 'FLEXIVEL',
    debtScope: 'QUALQUER_COBRANCA_EM_ABERTO',
    overrideRoles: [],
  },
  getContaFinancialPolicyRecord: getContaFinancialPolicyRecordMock,
  upsertContaFinancialPolicy: upsertContaFinancialPolicyMock,
}));

const { GET, PUT } = await import('../route');

function authenticatedSession(role = 'ADMIN') {
  return { user: { id: 'user-1', contaId: 'conta-1', role } };
}

function buildRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/configuracoes/politicas/financeiro', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

describe('API da regra financeira da rematrícula', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerSessionMock.mockResolvedValue(authenticatedSession());
  });

  it('normaliza a leitura para expor apenas o novo shape simplificado', async () => {
    getContaFinancialPolicyRecordMock.mockResolvedValue({
      preset: 'CONTROLADA',
      debtScope: 'APENAS_VENCIDAS',
      overrideRoles: ['ADMIN'],
      updatedAt: new Date('2026-03-11T12:00:00.000Z'),
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.policy).toMatchObject({
      preset: 'CONTROLADA',
      debtScope: 'APENAS_VENCIDAS',
      overrideRoles: ['ADMIN'],
      summary: 'Exige autorização quando houver cobranças vencidas.',
    });
  });

  it('rejeita regra controlada sem perfis autorizados', async () => {
    const response = await PUT(
      buildRequest({
        preset: 'CONTROLADA',
        debtScope: 'APENAS_VENCIDAS',
        overrideRoles: [],
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.error).toBe('POLITICA_FINANCEIRA_INVALIDA');
    expect(data.details.issues).toContain('Selecione pelo menos um perfil autorizado para liberar exceções.');
    expect(upsertContaFinancialPolicyMock).not.toHaveBeenCalled();
  });

  it('ignora perfis enviados fora do preset controlado e persiste o shape novo', async () => {
    upsertContaFinancialPolicyMock.mockResolvedValue({
      preset: 'RESTRITIVA',
      debtScope: 'APENAS_VENCIDAS',
      overrideRoles: [],
      updatedAt: new Date('2026-03-11T12:10:00.000Z'),
    });

    const response = await PUT(
      buildRequest({
        preset: 'RESTRITIVA',
        debtScope: 'APENAS_VENCIDAS',
        overrideRoles: ['ADMIN', 'FINANCEIRO'],
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(upsertContaFinancialPolicyMock).toHaveBeenCalledWith('conta-1', {
      preset: 'RESTRITIVA',
      debtScope: 'APENAS_VENCIDAS',
      overrideRoles: [],
    });
    expect(data.policy).toMatchObject({
      preset: 'RESTRITIVA',
      debtScope: 'APENAS_VENCIDAS',
      overrideRoles: [],
      summary: 'Bloqueia a rematrícula quando houver cobranças vencidas ou situação financeira inconclusiva.',
    });
  });
});
