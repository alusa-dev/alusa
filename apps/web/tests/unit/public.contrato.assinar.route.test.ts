import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { signPublicContractMock, createNotificationMock } = vi.hoisted(() => ({
  signPublicContractMock: vi.fn(),
  createNotificationMock: vi.fn(),
}));

vi.mock('@alusa/lib', () => ({
  signPublicContract: signPublicContractMock,
  createContractSignedNotification: createNotificationMock,
}));

import { POST } from '@/app/api/public/contrato/[token]/assinar/route';

function buildRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/public/contrato/token-1/assinar', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'vitest' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/public/contrato/[token]/assinar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signPublicContractMock.mockResolvedValue({
      success: true,
      hash: 'a'.repeat(64),
      signedPdfHash: 'b'.repeat(64),
      signedPdfUrl: '/api/contratos/contrato-1/documentos/assinado',
      contaId: 'conta-1',
      contratoId: 'contrato-1',
      matriculaId: 'mat-1',
      alunoNome: 'Aluno',
      assinadoPor: 'Responsável',
    });
  });

  it('rejeita assinatura sem aceite explícito', async () => {
    const response = await POST(
      buildRequest({
        nome: 'Responsável',
        cpf: '52998224725',
        email: 'resp@example.com',
      }),
      { params: Promise.resolve({ token: 'token-resolvido' }) },
    );

    expect(response.status).toBe(400);
    expect(signPublicContractMock).not.toHaveBeenCalled();
  });

  it('assina com aceite e usa os params resolvidos', async () => {
    const response = await POST(
      buildRequest({
        nome: 'Responsável',
        cpf: '52998224725',
        email: 'resp@example.com',
        aceite: true,
      }),
      { params: Promise.resolve({ token: 'token-resolvido' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.signedPdfHash).toBe('b'.repeat(64));
    expect(signPublicContractMock).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'token-resolvido',
        aceite: true,
      }),
    );
  });
});
