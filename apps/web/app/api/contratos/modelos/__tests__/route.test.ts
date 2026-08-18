/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { getSessionUserMock, prismaMock } = vi.hoisted(() => ({
  getSessionUserMock: vi.fn(),
  prismaMock: {
    contratoModelo: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findFirstOrThrow: vi.fn(),
    },
    contratoModeloCampo: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    contratoConsentimentoTemplate: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth/session', () => ({ getSessionUser: getSessionUserMock }));
vi.mock('@/prisma/client', () => ({ prisma: prismaMock }));

import { POST } from '../route';
import { PUT } from '../[id]/route';

const fields = [
  {
    id: 'campo-escola',
    tipo: 'ASSINATURA',
    papel: 'ESCOLA',
    pagina: 3,
    x: 0.25,
    y: 0.37,
    largura: 0.4,
    altura: 0.03,
    obrigatorio: true,
    ordem: 0,
  },
  {
    id: 'campo-responsavel',
    tipo: 'ASSINATURA',
    papel: 'RESPONSAVEL_OU_ALUNO',
    pagina: 3,
    x: 0.26,
    y: 0.4,
    largura: 0.4,
    altura: 0.03,
    obrigatorio: true,
    ordem: 1,
  },
] as const;

function buildRequest() {
  return new NextRequest('http://localhost/api/contratos/modelos', {
    method: 'POST',
    body: JSON.stringify({
      nome: 'Contrato de matrícula 2026',
      arquivoPdfUrl: '/uploads/contratos/modelo.pdf',
      hashSha256: 'a'.repeat(64),
      tamanhoBytes: 5175,
      campos: fields.map(({ id: _id, ...field }) => field),
    }),
  });
}

describe('POST /api/contratos/modelos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionUserMock.mockResolvedValue({ id: 'user-1', contaId: 'conta-1' });
    prismaMock.contratoModelo.findFirst.mockResolvedValue(null);
    prismaMock.contratoConsentimentoTemplate.findMany.mockResolvedValue([]);
  prismaMock.contratoModelo.create.mockResolvedValue({
      id: 'modelo-1',
      contaId: 'conta-1',
      nome: 'Contrato de matrícula 2026',
      descricao: null,
      arquivoOriginalUrl: null,
      arquivoPdfUrl: '/uploads/contratos/modelo.pdf',
      mimeType: 'application/pdf',
      hashSha256: 'a'.repeat(64),
      tamanhoBytes: 5175,
      versao: 1,
      status: 'ATIVO',
      createdAt: new Date('2026-08-12T00:00:00.000Z'),
      updatedAt: new Date('2026-08-12T00:00:00.000Z'),
      campos: fields,
    });
    prismaMock.$transaction.mockImplementation(async (callback: (_tx: typeof prismaMock) => Promise<unknown>) => callback(prismaMock));
  });

  it('persiste os campos posicionados junto com o modelo e os devolve na resposta', async () => {
    const response = await POST(buildRequest());
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(prismaMock.contratoModelo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contaId: 'conta-1',
          campos: {
            create: expect.arrayContaining([
              expect.objectContaining({ papel: 'ESCOLA', pagina: 3 }),
              expect.objectContaining({ papel: 'RESPONSAVEL_OU_ALUNO', pagina: 3 }),
            ]),
          },
        }),
        include: {
          campos: { orderBy: { ordem: 'asc' } },
          consentimentos: { orderBy: { ordem: 'asc' }, include: { template: { select: { versao: true } } } },
        },
      }),
    );
    expect(json.campos).toHaveLength(2);
    expect(json.campos[1]).toMatchObject({ papel: 'RESPONSAVEL_OU_ALUNO', pagina: 3 });
  });

  it('permite adicionar campos a um modelo antigo em uma atualização transacional', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    const update = vi.fn().mockResolvedValue({ id: 'modelo-1' });
    const findFirstOrThrow = vi.fn().mockResolvedValue({
      id: 'modelo-1',
      contaId: 'conta-1',
      nome: 'Contrato antigo',
      descricao: null,
      arquivoPdfUrl: '/uploads/contratos/modelo.pdf',
      arquivoOriginalUrl: null,
      mimeType: 'application/pdf',
      hashSha256: 'a'.repeat(64),
      tamanhoBytes: 5175,
      versao: 1,
      status: 'ATIVO',
      createdAt: new Date('2026-08-12T00:00:00.000Z'),
      updatedAt: new Date('2026-08-12T00:00:00.000Z'),
      campos: fields,
    });
    prismaMock.contratoModelo.findFirst.mockResolvedValueOnce({ id: 'modelo-1', nome: 'Contrato antigo' });
    prismaMock.contratoModelo.update = update;
    prismaMock.contratoModeloCampo.deleteMany = deleteMany;
    prismaMock.contratoModeloCampo.createMany = createMany;
    prismaMock.contratoModelo.findFirstOrThrow = findFirstOrThrow;

    const response = await PUT(
      new NextRequest('http://localhost/api/contratos/modelos/modelo-1', {
        method: 'PUT',
        body: JSON.stringify({
          nome: 'Contrato antigo',
          descricao: 'Atualizado',
          campos: fields.map(({ id: _id, ...field }) => field),
        }),
      }),
      { params: Promise.resolve({ id: 'modelo-1' }) },
    );

    expect(response.status).toBe(200);
    expect(deleteMany).toHaveBeenCalledWith({ where: { modeloId: 'modelo-1', contaId: 'conta-1' } });
    expect(createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ modeloId: 'modelo-1', contaId: 'conta-1', papel: 'ESCOLA' }),
        expect.objectContaining({ modeloId: 'modelo-1', contaId: 'conta-1', papel: 'RESPONSAVEL_OU_ALUNO' }),
      ]),
    });
  });
});
