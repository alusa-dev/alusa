import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    contrato: {
      findFirst: vi.fn(),
    },
    contractEvidence: {
      create: vi.fn(),
    },
  },
}));

vi.mock('@/prisma/client', () => ({
  prisma: prismaMock,
}));

import { GET } from '@/app/api/public/contrato/[token]/route';

describe('GET /api/public/contrato/[token]', () => {
  it('não expõe CPF do aluno nem do responsável no payload público', async () => {
    prismaMock.contrato.findFirst.mockResolvedValueOnce({
      id: 'contrato-1',
      contaId: 'conta-1',
      arquivoPdfUrl: '/uploads/contratos/contrato-1.pdf',
      hashPdf: 'a'.repeat(64),
      status: 'PENDENTE',
      tokenExpiraEm: new Date(Date.now() + 60_000),
      matricula: {
        aluno: { nome: 'Aluno 1', cpf: '12345678900' },
        responsavelFinanceiro: { nome: 'Responsável 1', cpf: '98765432100' },
      },
    });

    const response = await GET(new NextRequest('http://localhost/api/public/contrato/token-1'), {
      params: { token: 'token-1' },
    });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.matricula.aluno).not.toHaveProperty('cpf');
    expect(json.matricula.responsavelFinanceiro).not.toHaveProperty('cpf');
    expect(json.acceptanceText).toContain('Declaro que li');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('valida os params resolvidos antes de consultar o contrato', async () => {
    prismaMock.contrato.findFirst.mockResolvedValueOnce(null);

    await GET(new NextRequest('http://localhost/api/public/contrato/token-1'), {
      params: Promise.resolve({ token: 'token-resolvido' }),
    });

    expect(prismaMock.contrato.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ tokenPublicoHash: expect.any(String) }),
          ]),
        }),
      }),
    );
  });
});
