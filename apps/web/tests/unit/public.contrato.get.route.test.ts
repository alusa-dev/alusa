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

  it('propaga os campos do modelo para a experiência pública de assinatura', async () => {
    prismaMock.contrato.findFirst.mockResolvedValueOnce({
      id: 'contrato-1',
      contaId: 'conta-1',
      arquivoPdfUrl: '/uploads/contratos/contrato-1.pdf',
      hashPdf: 'a'.repeat(64),
      status: 'PENDENTE',
      tokenExpiraEm: new Date(Date.now() + 60_000),
      matricula: {
        aluno: { nome: 'Aluno 1' },
        responsavelFinanceiro: { nome: 'Responsável 1' },
      },
      modelo: {
        campos: [
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
        ],
      },
    });

    const response = await GET(new NextRequest('http://localhost/api/public/contrato/token-1'), {
      params: { token: 'token-1' },
    });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.camposAssinatura).toHaveLength(2);
    expect(json.camposAssinatura[1]).toMatchObject({
      papel: 'RESPONSAVEL_OU_ALUNO',
      pagina: 3,
      x: 0.26,
    });
  });

  it('prioriza o snapshot dos campos quando o contrato já foi criado', async () => {
    prismaMock.contrato.findFirst.mockResolvedValueOnce({
      id: 'contrato-2',
      contaId: 'conta-1',
      arquivoPdfUrl: '/uploads/contratos/contrato-2.pdf',
      hashPdf: 'b'.repeat(64),
      status: 'PENDENTE',
      tokenExpiraEm: new Date(Date.now() + 60_000),
      camposAssinaturaSnapshot: [
        {
          id: 'campo-snapshot',
          tipo: 'ASSINATURA',
          papel: 'RESPONSAVEL_OU_ALUNO',
          pagina: 3,
          x: 0.73,
          y: 0.81,
          largura: 0.2,
          altura: 0.04,
          obrigatorio: true,
          ordem: 0,
        },
      ],
      matricula: {
        aluno: { nome: 'Aluno 2' },
        responsavelFinanceiro: { nome: 'Responsável 2' },
      },
      modelo: {
        campos: [
          {
            id: 'campo-modelo-atualizado',
            tipo: 'ASSINATURA',
            papel: 'ESCOLA',
            pagina: 1,
            x: 0.1,
            y: 0.1,
            largura: 0.2,
            altura: 0.04,
            obrigatorio: true,
            ordem: 0,
          },
        ],
      },
    });

    const response = await GET(new NextRequest('http://localhost/api/public/contrato/token-2'), {
      params: { token: 'token-2' },
    });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.camposAssinatura).toHaveLength(1);
    expect(json.camposAssinatura[0]).toMatchObject({
      id: 'campo-snapshot',
      papel: 'RESPONSAVEL_OU_ALUNO',
      x: 0.73,
    });
  });

  it('renderiza os dados do assinante no snapshot público do consentimento', async () => {
    prismaMock.contrato.findFirst.mockResolvedValueOnce({
      id: 'contrato-3',
      contaId: 'conta-1',
      arquivoPdfUrl: '/uploads/contratos/contrato-3.pdf',
      hashPdf: 'c'.repeat(64),
      status: 'PENDENTE',
      tokenExpiraEm: new Date(Date.now() + 60_000),
      termosConsentimentoSnapshot: [
        {
          id: 'consent-1',
          codigo: 'IMAGE_USE',
          templateId: 'template-1',
          templateVersao: 1,
          finalidade: 'IMAGE_USE',
          titulo: 'Uso de imagem',
          texto: 'Eu, {{nome_assinante}}, autorizo a imagem de {{nome_aluno}}.',
          papel: 'RESPONSAVEL_OU_ALUNO',
          obrigatorio: true,
          recusaImpedeAssinatura: false,
          ordem: 0,
        },
      ],
      matricula: {
        aluno: { nome: 'Aluno Menor' },
        responsavelFinanceiro: { nome: 'Responsável Teste' },
      },
    });

    const response = await GET(new NextRequest('http://localhost/api/public/contrato/token-3'), {
      params: { token: 'token-3' },
    });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.consentimentos[0]).toMatchObject({
      templateId: 'template-1',
      texto: 'Eu, Responsável Teste, autorizo a imagem de Aluno Menor.',
    });
  });
});
