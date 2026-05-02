import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    contrato: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('@/prisma/client', () => ({
  prisma: prismaMock,
}));

import { GET } from '@/app/api/public/contrato/[token]/route';

describe('GET /api/public/contrato/[token]', () => {
  it('não expõe CPF do aluno nem do responsável no payload público', async () => {
    prismaMock.contrato.findUnique.mockResolvedValueOnce({
      id: 'contrato-1',
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
    expect(json.arquivoPdfUrl).toBe(
      '/api/files/uploads/contratos/contrato-1.pdf?contratoToken=token-1',
    );
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('adiciona token público à URL protegida do arquivo do contrato', async () => {
    prismaMock.contrato.findUnique.mockResolvedValueOnce({
      id: 'contrato-1',
      arquivoPdfUrl: '/api/files/uploads/contratos/contrato-1.pdf',
      hashPdf: 'a'.repeat(64),
      status: 'PENDENTE',
      tokenExpiraEm: new Date(Date.now() + 60_000),
      matricula: {
        aluno: { nome: 'Aluno 1' },
        responsavelFinanceiro: { nome: 'Responsável 1' },
      },
    });

    const response = await GET(new NextRequest('http://localhost/api/public/contrato/token-1'), {
      params: { token: 'token-1' },
    });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.arquivoPdfUrl).toBe(
      '/api/files/uploads/contratos/contrato-1.pdf?contratoToken=token-1',
    );
  });
});
