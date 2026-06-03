/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  getSessionUserMock,
  createSubscriptionMock,
  materializeSubscriptionPaymentForChargeMock,
  prismaMock,
  transactionMock,
} = vi.hoisted(() => ({
  getSessionUserMock: vi.fn(),
  createSubscriptionMock: vi.fn(),
  materializeSubscriptionPaymentForChargeMock: vi.fn(),
  transactionMock: {
    contrato: {
      create: vi.fn(),
    },
    contratoDocumento: {
      create: vi.fn(),
    },
    contractEvidence: {
      create: vi.fn(),
    },
    matricula: {
      update: vi.fn(),
    },
  },
  prismaMock: {
    contrato: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    subscription: {
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    contratoModelo: {
      findFirst: vi.fn(),
    },
    matricula: {
      findFirst: vi.fn(),
    },
    cobranca: {
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth/session', () => ({
  getSessionUser: getSessionUserMock,
}));

vi.mock('@/prisma/client', () => ({
  prisma: prismaMock,
}));

vi.mock('@alusa/finance', () => ({
  createSubscription: createSubscriptionMock,
  buildSubscriptionExternalReference: vi.fn(({ matriculaId, planoId }) => `alusa:subscription:${matriculaId}:${planoId}`),
}));

vi.mock('@/src/server/matriculas/subscription-payment-materialization', () => ({
  materializeSubscriptionPaymentForCharge: materializeSubscriptionPaymentForChargeMock,
}));

const { POST } = await import('../route');

function buildRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/contratos', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/contratos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionUserMock.mockResolvedValue({
      id: 'user-1',
      contaId: 'conta-1',
    });
    prismaMock.$transaction.mockImplementation(async (callback: (_tx: typeof transactionMock) => Promise<unknown>) =>
      callback(transactionMock as never),
    );
    transactionMock.contrato.create.mockResolvedValue({
      id: 'contrato-1',
      contaId: 'conta-1',
      matriculaId: 'mat-1',
      modeloId: 'modelo-1',
      contratoOrigemId: null,
      arquivoPdfUrl: 'https://example.com/contrato.pdf',
      hashPdf: 'hash-1',
      status: 'PENDENTE',
      tokenPublico: 'token-publico',
      tokenPublicoHash: 'hash-token-publico',
      tokenExpiraEm: new Date('2025-02-20T00:00:00.000Z'),
      createdAt: new Date('2025-02-01T00:00:00.000Z'),
      updatedAt: new Date('2025-02-01T00:00:00.000Z'),
    });
    transactionMock.matricula.update.mockResolvedValue({ id: 'mat-1' });
    materializeSubscriptionPaymentForChargeMock.mockResolvedValue({
      found: false,
      matchedBy: null,
      payment: null,
      linkedChargeId: null,
      updated: false,
    });
    prismaMock.subscription.findFirst.mockResolvedValue(null);
  });

  it('reaproveita a assinatura existente da matrícula e evita criar uma segunda assinatura', async () => {
    prismaMock.contrato.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'contrato-1',
        contaId: 'conta-1',
        matriculaId: 'mat-1',
        modeloId: 'modelo-1',
        contratoOrigemId: null,
        arquivoPdfUrl: 'https://example.com/contrato.pdf',
        hashPdf: 'hash-1',
        status: 'PENDENTE',
        assinadoPor: null,
        assinadoEmail: null,
        assinadoCpf: null,
        assinadoIp: null,
        assinadoEm: null,
        assinadoUserAgent: null,
        hashAssinatura: null,
        tokenPublico: 'token-publico',
        tokenPublicoHash: 'hash-token-publico',
        tokenExpiraEm: new Date('2025-02-20T00:00:00.000Z'),
        createdAt: new Date('2025-02-01T00:00:00.000Z'),
        updatedAt: new Date('2025-02-01T00:00:00.000Z'),
        modelo: { id: 'modelo-1', nome: 'Modelo padrão' },
        matricula: {
          id: 'mat-1',
          contratoAtualId: 'contrato-1',
          aluno: { id: 'aluno-1', nome: 'Aluno 1', cpf: '12345678900' },
          turma: { id: 'turma-1', nome: 'Turma A' },
        },
      });

    prismaMock.matricula.findFirst.mockResolvedValue({
      id: 'mat-1',
      alunoId: 'aluno-1',
      dataInicio: new Date('2025-02-05T00:00:00.000Z'),
      dataFimContrato: new Date('2025-12-31T00:00:00.000Z'),
      vencimentoDia: 10,
      descontoAntecipado: null,
      prazoDesconto: null,
      descontoTipo: 'PERCENTAGE',
      jurosMensal: null,
      multaPercentual: null,
      multaTipo: 'PERCENTAGE',
      asaasSubscriptionId: 'sub-existente',
      aluno: {
        id: 'aluno-1',
        contaId: 'conta-1',
        nome: 'Aluno 1',
        cpf: '12345678900',
        email: 'aluno@example.com',
        telefone: '11999999999',
        enderecoLogradouro: 'Rua A',
        enderecoNumero: '10',
        enderecoBairro: 'Centro',
        enderecoCidade: 'São Paulo',
        enderecoUf: 'SP',
      },
      responsavelFinanceiro: null,
      turma: { nome: 'Turma A' },
      plano: { nome: 'Plano Mensal', valor: 300, periodicidade: 'MENSAL' },
      combo: null,
      cobrancas: [
        {
          id: 'cobr-1',
          valor: 300,
          formaPagamento: 'BOLETO',
          vencimento: new Date('2025-02-10T00:00:00.000Z'),
          asaasPaymentId: null,
        },
      ],
    });

    prismaMock.contratoModelo.findFirst.mockResolvedValue({
      id: 'modelo-1',
      contaId: 'conta-1',
      nome: 'Modelo padrão',
      arquivoPdfUrl: 'https://example.com/contrato.pdf',
      arquivoOriginalUrl: null,
      hashSha256: 'hash-1',
      tamanhoBytes: 1024,
      mimeType: 'application/pdf',
      status: 'ATIVO',
    });
    prismaMock.subscription.findFirst.mockResolvedValueOnce({
      id: 'sub-local-1',
      contratoId: null,
      asaasSubscriptionId: 'sub-existente',
    });

    const response = await POST(
      buildRequest({
        matriculaId: 'mat-1',
        modeloId: 'modelo-1',
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(createSubscriptionMock).not.toHaveBeenCalled();
    expect(prismaMock.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-local-1' },
      data: { contratoId: 'contrato-1' },
    });
    expect(data.subscriptionSync).toEqual(
      expect.objectContaining({
        success: true,
        asaasSubscriptionId: 'sub-existente',
        asaasPaymentId: null,
        expectedWebhooks: ['PAYMENT_CREATED'],
        message: 'A cobrança recorrente já foi solicitada na finalização da matrícula. O primeiro ciclo será materializado pelo webhook oficial do Asaas.',
      }),
    );
  });

  it('materializa imediatamente o primeiro payment quando o Asaas já o expôs para a assinatura', async () => {
    prismaMock.contrato.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'contrato-1',
        matriculaId: 'mat-1',
        modeloId: 'modelo-1',
        contratoOrigemId: null,
        arquivoPdfUrl: 'https://example.com/contrato.pdf',
        hashPdf: 'hash-1',
        status: 'PENDENTE',
        assinadoPor: null,
        assinadoEmail: null,
        assinadoCpf: null,
        assinadoIp: null,
        assinadoEm: null,
        assinadoUserAgent: null,
        hashAssinatura: null,
        tokenPublico: 'token-publico',
        tokenExpiraEm: new Date('2025-02-20T00:00:00.000Z'),
        createdAt: new Date('2025-02-01T00:00:00.000Z'),
        updatedAt: new Date('2025-02-01T00:00:00.000Z'),
        modelo: { id: 'modelo-1', nome: 'Modelo padrão' },
        matricula: {
          id: 'mat-1',
          contratoAtualId: 'contrato-1',
          aluno: { id: 'aluno-1', nome: 'Aluno 1', cpf: '12345678900' },
          turma: { id: 'turma-1', nome: 'Turma A' },
        },
      });

    prismaMock.matricula.findFirst.mockResolvedValue({
      id: 'mat-1',
      alunoId: 'aluno-1',
      dataInicio: new Date('2025-02-05T00:00:00.000Z'),
      dataFimContrato: new Date('2025-12-31T00:00:00.000Z'),
      vencimentoDia: 10,
      descontoAntecipado: null,
      prazoDesconto: null,
      descontoTipo: 'PERCENTAGE',
      jurosMensal: null,
      multaPercentual: null,
      multaTipo: 'PERCENTAGE',
      asaasSubscriptionId: 'sub-existente',
      aluno: {
        id: 'aluno-1',
        contaId: 'conta-1',
        nome: 'Aluno 1',
        cpf: '12345678900',
        email: 'aluno@example.com',
        telefone: '11999999999',
        enderecoLogradouro: 'Rua A',
        enderecoNumero: '10',
        enderecoBairro: 'Centro',
        enderecoCidade: 'São Paulo',
        enderecoUf: 'SP',
      },
      responsavelFinanceiro: null,
      turma: { nome: 'Turma A' },
      plano: { nome: 'Plano Mensal', valor: 300, periodicidade: 'MENSAL' },
      combo: null,
      cobrancas: [
        {
          id: 'cobr-1',
          valor: 300,
          formaPagamento: 'BOLETO',
          vencimento: new Date('2025-02-10T00:00:00.000Z'),
          asaasPaymentId: null,
        },
      ],
    });

    prismaMock.contratoModelo.findFirst.mockResolvedValue({
      id: 'modelo-1',
      contaId: 'conta-1',
      nome: 'Modelo padrão',
      arquivoPdfUrl: 'https://example.com/contrato.pdf',
      hashSha256: 'hash-1',
      status: 'ATIVO',
    });

    materializeSubscriptionPaymentForChargeMock.mockResolvedValueOnce({
      found: true,
      matchedBy: 'EXACT_DUE_DATE',
      linkedChargeId: 'cobr-1',
      updated: true,
      payment: {
        id: 'pay_1',
        status: 'PENDING',
        dueDate: '2025-02-10',
        value: 300,
        netValue: 294,
        invoiceUrl: 'https://asaas.test/invoice/pay_1',
        bankSlipUrl: 'https://asaas.test/boleto/pay_1',
      },
    });

    const response = await POST(
      buildRequest({
        matriculaId: 'mat-1',
        modeloId: 'modelo-1',
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(createSubscriptionMock).not.toHaveBeenCalled();
    expect(data.subscriptionSync).toEqual(
      expect.objectContaining({
        success: true,
        asaasSubscriptionId: 'sub-existente',
        asaasPaymentId: 'pay_1',
        invoiceUrl: 'https://asaas.test/invoice/pay_1',
        bankSlipUrl: 'https://asaas.test/boleto/pay_1',
        expectedWebhooks: [],
        message: 'A cobrança recorrente já existia e o primeiro payment foi reconciliado diretamente com o Asaas.',
      }),
    );
  });

  it('materializa o primeiro payment logo após criar a assinatura quando o Asaas já retornou ciclos', async () => {
    prismaMock.contrato.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'contrato-1',
        matriculaId: 'mat-1',
        modeloId: 'modelo-1',
        contratoOrigemId: null,
        arquivoPdfUrl: 'https://example.com/contrato.pdf',
        hashPdf: 'hash-1',
        status: 'PENDENTE',
        assinadoPor: null,
        assinadoEmail: null,
        assinadoCpf: null,
        assinadoIp: null,
        assinadoEm: null,
        assinadoUserAgent: null,
        hashAssinatura: null,
        tokenPublico: 'token-publico',
        tokenExpiraEm: new Date('2025-02-20T00:00:00.000Z'),
        createdAt: new Date('2025-02-01T00:00:00.000Z'),
        updatedAt: new Date('2025-02-01T00:00:00.000Z'),
        modelo: { id: 'modelo-1', nome: 'Modelo padrão' },
        matricula: {
          id: 'mat-1',
          contratoAtualId: 'contrato-1',
          aluno: { id: 'aluno-1', nome: 'Aluno 1', cpf: '12345678900' },
          turma: { id: 'turma-1', nome: 'Turma A' },
        },
      });

    prismaMock.matricula.findFirst.mockResolvedValue({
      id: 'mat-1',
      alunoId: 'aluno-1',
      dataInicio: new Date('2025-02-05T00:00:00.000Z'),
      dataFimContrato: new Date('2025-12-31T00:00:00.000Z'),
      vencimentoDia: 10,
      descontoAntecipado: null,
      prazoDesconto: null,
      descontoTipo: 'PERCENTAGE',
      jurosMensal: null,
      multaPercentual: null,
      multaTipo: 'PERCENTAGE',
      asaasSubscriptionId: null,
      formaPagamento: 'BOLETO',
      aluno: {
        id: 'aluno-1',
        contaId: 'conta-1',
        nome: 'Aluno 1',
        cpf: '12345678900',
        email: 'aluno@example.com',
        telefone: '11999999999',
        enderecoLogradouro: 'Rua A',
        enderecoNumero: '10',
        enderecoBairro: 'Centro',
        enderecoCidade: 'São Paulo',
        enderecoUf: 'SP',
      },
      responsavelFinanceiro: null,
      turma: { nome: 'Turma A' },
      plano: { id: 'plano-1', nome: 'Plano Mensal', valor: 300, periodicidade: 'MENSAL' },
      combo: null,
      descontos: [],
      cobrancas: [],
    });

    prismaMock.contratoModelo.findFirst.mockResolvedValue({
      id: 'modelo-1',
      contaId: 'conta-1',
      nome: 'Modelo padrão',
      arquivoPdfUrl: 'https://example.com/contrato.pdf',
      hashSha256: 'hash-1',
      status: 'ATIVO',
    });

    createSubscriptionMock.mockResolvedValueOnce({
      success: true,
      data: {
        asaasSubscriptionId: 'sub-nova',
      },
    });

    const response = await POST(
      buildRequest({
        matriculaId: 'mat-1',
        modeloId: 'modelo-1',
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(createSubscriptionMock).toHaveBeenCalledOnce();
    expect(data.subscriptionSync).toEqual(
      expect.objectContaining({
        success: true,
        asaasSubscriptionId: 'sub-nova',
        asaasPaymentId: null,
        invoiceUrl: null,
        bankSlipUrl: null,
        expectedWebhooks: ['SUBSCRIPTION_CREATED', 'PAYMENT_CREATED'],
        message: 'A assinatura foi criada no Asaas. O primeiro ciclo será materializado pelo webhook oficial.',
      }),
    );
  });
});
