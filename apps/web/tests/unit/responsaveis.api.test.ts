/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

const prismaMock = {
  responsavel: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
  },
};

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}));

const { getServerSession } = await import('next-auth');
const { GET, POST } = await import('@/app/api/responsaveis/route');

describe('/api/responsaveis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 401 no GET quando não autenticado', async () => {
    vi.mocked(getServerSession).mockResolvedValueOnce(null as never);

    const response = await GET(
      new NextRequest('http://localhost/api/responsaveis?q=maria'),
    );

    expect(response.status).toBe(401);
  });

  it('lista responsáveis usando DTO de saída estável', async () => {
    vi.mocked(getServerSession).mockResolvedValueOnce({
      user: { id: 'u1', contaId: 'conta-1' },
    } as never);
    prismaMock.responsavel.findMany.mockResolvedValueOnce([
      {
        id: 'r1',
        nome: 'Maria Silva',
        cpf: '12345678901',
        email: 'maria@example.com',
        telefone: '92999999999',
        financeiro: true,
      },
    ]);

    const response = await GET(
      new NextRequest('http://localhost/api/responsaveis?q=Maria'),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      items: [
        {
          id: 'r1',
          nome: 'Maria Silva',
          cpf: '12345678901',
          email: 'maria@example.com',
          telefone: '92999999999',
          financeiro: true,
        },
      ],
    });
    expect(prismaMock.responsavel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contaId: 'conta-1',
        }),
      }),
    );
  });

  it('retorna 400 no POST com payload inválido', async () => {
    vi.mocked(getServerSession).mockResolvedValueOnce({
      user: { id: 'u1', contaId: 'conta-1' },
    } as never);

    const response = await POST(
      new NextRequest('http://localhost/api/responsaveis', {
        method: 'POST',
        body: JSON.stringify({ nome: 'Jo', cpf: '123' }),
      }),
    );

    expect(response.status).toBe(400);
  });

  it('cria responsável usando DTO de entrada e saída', async () => {
    vi.mocked(getServerSession).mockResolvedValueOnce({
      user: { id: 'u1', contaId: 'conta-1' },
    } as never);
    prismaMock.responsavel.findFirst.mockResolvedValueOnce(null);
    prismaMock.responsavel.create.mockResolvedValueOnce({
      id: 'r1',
      nome: 'Maria Silva',
      cpf: '12345678901',
      email: 'maria@example.com',
      telefone: '92999999999',
      financeiro: true,
    });

    const response = await POST(
      new NextRequest('http://localhost/api/responsaveis', {
        method: 'POST',
        body: JSON.stringify({
          nome: 'Maria Silva',
          cpf: '529.982.247-25',
          email: 'maria@example.com',
          telefone: '(92) 99999-9999',
          financeiro: true,
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json).toEqual({
      id: 'r1',
      nome: 'Maria Silva',
      cpf: '12345678901',
      email: 'maria@example.com',
      telefone: '92999999999',
      financeiro: true,
    });
    expect(prismaMock.responsavel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contaId: 'conta-1',
          cpf: '52998224725',
          telefone: '92999999999',
        }),
      }),
    );
  });
});
