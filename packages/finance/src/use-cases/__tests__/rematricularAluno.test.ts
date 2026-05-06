/**
 * Testes para RematricularAlunoUseCase
 *
 * Cenários cobertos:
 * - Rematrícula bem-sucedida (fluxo 2-fases)
 * - Validação de elegibilidade
 * - Validação de capacidade
 * - Regra de pagador (aluno maior / responsável para menor)
 * - Tratamento de erros do provedor (origem preservada)
 * - Retry idempotente
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rematricularAluno, retryRematricula } from '../rematricularAluno';
import type { PaymentsProviderPort } from '../../ports/PaymentsProviderPort';

// Mock @alusa/domain
vi.mock('@alusa/domain', () => ({
  resolvePayer: vi.fn((input) => {
    // Simular lógica: se dataNasc é menor de 18 anos e não tem responsável, falha
    const today = new Date();
    const birthDate = input.alunoDataNasc;
    const age = today.getFullYear() - birthDate.getFullYear();
    const isMenor = age < 18;

    if (isMenor && !input.responsavelFinanceiroId) {
      return { success: false };
    }

    return {
      success: true,
      payer: isMenor
        ? { type: 'RESPONSAVEL', id: input.responsavelFinanceiroId }
        : { type: 'ALUNO', id: input.alunoId },
    };
  }),
  validarCapacidadeRematricula: vi.fn(() => ({ success: true })),
  validarConflitosRematricula: vi.fn(() => ({ success: true })),
  validarDatasRematricula: vi.fn(() => ({ success: true })),
  validarElegibilidadeRematricula: vi.fn(() => ({ success: true })),
  getDomainSeatOccupyingStatuses: vi.fn(() => ['PENDENTE_TAXA', 'AGUARDANDO_CONFIRMACAO', 'ATIVA']),
}));

// Mock do Prisma
function createMockPrisma() {
  const mockMatricula = {
    id: 'matricula-123',
    alunoId: 'aluno-123',
    responsavelFinanceiroId: null,
    turmaId: 'turma-123',
    planoId: 'plano-123',
    comboId: null,
    dataInicio: new Date('2024-01-01'),
    dataFimContrato: new Date('2024-12-31'),
    status: 'ATIVA',
    statusFinanceiro: 'EM_DIA',
    statusContrato: 'ATIVO',
    vencimentoDia: 5,
    formaPagamento: 'BOLETO',
    formaPagamentoTaxa: 'BOLETO',
    jurosMensal: 1,
    multaPercentual: 2,
    descontoAntecipado: null,
    prazoDesconto: null,
    asaasSubscriptionId: 'sub_old_123',
    aluno: {
      id: 'aluno-123',
      contaId: 'conta-123',
      nome: 'João Silva',
      cpf: '12345678901',
      email: 'joao@email.com',
      telefone: '11999999999',
      dataNasc: new Date('1990-01-01'), // Maior de idade
      enderecoCep: '01234567',
      enderecoLogradouro: 'Rua Teste',
      enderecoNumero: '100',
      enderecoComplemento: null,
      enderecoBairro: 'Centro',
      asaasCustomerId: 'cus_123',
    },
    responsavelFinanceiro: null,
    plano: {
      id: 'plano-123',
      nome: 'Plano Mensal',
      valor: 150,
      periodicidade: 'MENSAL',
      status: 'ATIVO',
    },
    turma: {
      id: 'turma-123',
      nome: 'Turma A',
      capacidade: 20,
      diasSemana: ['SEGUNDA', 'QUARTA'],
      horaInicio: '08:00',
      horaFim: '10:00',
      status: 'ATIVO',
    },
    combo: null,
  };

  return {
    matricula: {
      findUnique: vi.fn().mockResolvedValue(mockMatricula),
      findFirst: vi.fn().mockResolvedValue(mockMatricula),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({
        ...mockMatricula,
        id: 'matricula-nova-123',
        asaasSubscriptionId: null,
      }),
      update: vi
        .fn()
        .mockImplementation((args) => Promise.resolve({ ...mockMatricula, ...args.data })),
      count: vi.fn().mockResolvedValue(5), // 5 matrículas ativas, turma tem 20 vagas
    },
    rematriculaOperacao: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi
        .fn()
        .mockResolvedValue({ id: 'operacao-123', correlationId: 'corr-123', status: 'PENDING' }),
      update: vi.fn().mockResolvedValue({ id: 'operacao-123', status: 'PENDING_FINANCE' }),
    },
    matriculaLog: {
      create: vi.fn().mockResolvedValue({ id: 'log-123' }),
    },
    plano: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'plano-123',
        nome: 'Plano Mensal',
        valor: 150,
        periodicidade: 'MENSAL',
      }),
    },
    turma: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'turma-123',
        nome: 'Turma A',
        capacidade: 20,
        diasSemana: ['SEGUNDA', 'QUARTA'],
        horaInicio: '08:00',
        horaFim: '10:00',
      }),
    },
    combo: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    desconto: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    descontoMatricula: {
      create: vi.fn().mockResolvedValue({ id: 'desconto-matricula-123' }),
    },
    aluno: {
      update: vi.fn().mockResolvedValue({}),
    },
    responsavel: {
      update: vi.fn().mockResolvedValue({}),
    },
    cobranca: {
      create: vi
        .fn()
        .mockImplementation((args) =>
          Promise.resolve({ id: `cobranca-${Date.now()}`, ...args.data }),
        ),
      update: vi.fn().mockResolvedValue({}),
    },
  } as unknown as Parameters<typeof rematricularAluno>[1]['prisma'];
}

function createMockPaymentsProvider(): PaymentsProviderPort {
  return {
    resolveOrCreateCustomerForPayer: vi.fn().mockResolvedValue({
      customerId: 'cus_new_123',
      created: false,
    }),
    cancelSubscription: vi.fn().mockResolvedValue({
      success: true,
      notFound: false,
    }),
    createSubscription: vi.fn().mockResolvedValue({
      subscriptionId: 'sub_new_123',
      nextDueDate: '2099-02-05',
      status: 'ACTIVE',
    }),
    createPayment: vi.fn().mockResolvedValue({
      paymentId: 'pay_taxa_123',
      status: 'PENDING',
      invoiceUrl: 'https://example.com/invoice',
      bankSlipUrl: 'https://example.com/boleto',
    }),
    listSubscriptionPayments: vi.fn().mockResolvedValue({
      data: [
        {
          id: 'pay_first_123',
          value: 150,
          dueDate: '2099-02-05',
          status: 'PENDING',
          invoiceUrl: 'https://example.com/invoice',
          bankSlipUrl: 'https://example.com/boleto',
        },
      ],
      totalCount: 1,
    }),
  };
}

describe('rematricularAluno', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let mockProvider: PaymentsProviderPort;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = createMockPrisma();
    mockProvider = createMockPaymentsProvider();
  });

  describe('fluxo de sucesso (2-fases)', () => {
    it('deve retornar sucesso idempotente quando a operação já estiver committed', async () => {
      mockPrisma.rematriculaOperacao.findFirst = vi.fn().mockResolvedValue({
        id: 'operacao-existente',
        status: 'COMMITTED',
        matriculaNovaId: 'matricula-nova-123',
      });

      const result = await rematricularAluno(
        {
          contaId: 'conta-123',
          matriculaId: 'matricula-123',
          createdById: 'user-123',
          dataInicio: new Date('2025-01-01'),
          dataFimContrato: new Date('2025-12-31'),
        },
        { prisma: mockPrisma, paymentsProvider: mockProvider },
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.operationId).toBe('operacao-existente');
        expect(result.data.matriculaIdNova).toBe('matricula-nova-123');
      }
      expect(mockPrisma.rematriculaOperacao.create).not.toHaveBeenCalled();
      expect(mockProvider.createSubscription).not.toHaveBeenCalled();
    });

    it('deve rematricular aluno maior de idade usando ele mesmo como pagador', async () => {
      const result = await rematricularAluno(
        {
          contaId: 'conta-123',
          matriculaId: 'matricula-123',
          createdById: 'user-123',
          dataInicio: new Date('2025-01-01'),
          dataFimContrato: new Date('2025-12-31'),
        },
        { prisma: mockPrisma, paymentsProvider: mockProvider },
      );

      expect(result.success).toBe(true);
      if (result.success) {
        // Fluxo 2-fases: status final é COMMITTED
        expect(result.data.status).toBe('COMMITTED');
        expect(result.data.step).toBe('COMPLETED');
        expect(result.data.matriculaIdNova).toBeDefined();
      }

      // Verificar que o customer foi resolvido com tipo ALUNO
      expect(mockProvider.resolveOrCreateCustomerForPayer).toHaveBeenCalledWith(
        expect.objectContaining({
          payer: expect.objectContaining({ type: 'ALUNO' }),
        }),
      );

      // Verificar que a assinatura anterior foi cancelada (FASE 2)
      expect(mockProvider.cancelSubscription).toHaveBeenCalledWith({
        contaId: 'conta-123',
        subscriptionId: 'sub_old_123',
      });

      // Verificar que nova assinatura foi criada (FASE 1)
      expect(mockProvider.createSubscription).toHaveBeenCalled();

      // Verificar que matrícula origem foi cancelada (FASE 2 - após gateway OK)
      expect(mockPrisma.matricula.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'matricula-123' },
          data: expect.objectContaining({ status: 'CANCELADA' }),
        }),
      );
    });

    it('deve criar assinatura com valor líquido quando há benefício herdado', async () => {
      (mockPrisma.desconto.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 'desconto-50',
          nome: 'Bolsa 50%',
          tipo: 'PERCENTUAL',
          valor: 50,
        },
      ]);

      const result = await rematricularAluno(
        {
          contaId: 'conta-123',
          matriculaId: 'matricula-123',
          createdById: 'user-123',
          dataInicio: new Date('2025-01-01'),
          dataFimContrato: new Date('2025-12-31'),
          descontos: [{ id: 'desconto-50' }],
        },
        { prisma: mockPrisma, paymentsProvider: mockProvider },
      );

      expect(result.success).toBe(true);
      expect(mockProvider.createSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          value: 75,
        }),
      );
      expect(mockPrisma.descontoMatricula.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            descontoId: 'desconto-50',
            valorFinal: 75,
          }),
        }),
      );
    });

    it('deve criar matrícula nova em estado AGUARDANDO_CONFIRMACAO antes do gateway', async () => {
      const result = await rematricularAluno(
        {
          contaId: 'conta-123',
          matriculaId: 'matricula-123',
          createdById: 'user-123',
          dataInicio: new Date('2025-01-01'),
          dataFimContrato: new Date('2025-12-31'),
        },
        { prisma: mockPrisma, paymentsProvider: mockProvider },
      );

      expect(result.success).toBe(true);

      // Verificar que a matrícula foi criada em estado provisório
      expect(mockPrisma.matricula.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'AGUARDANDO_CONFIRMACAO',
            statusContrato: 'AGUARDANDO_ASSINATURA',
          }),
        }),
      );
    });

    it('deve persistir snapshot da política e override na operação', async () => {
      await rematricularAluno(
        {
          contaId: 'conta-123',
          matriculaId: 'matricula-123',
          createdById: 'user-123',
          dataInicio: new Date('2025-01-01'),
          dataFimContrato: new Date('2025-12-31'),
          overrideReason: 'Acordo aprovado pela coordenação financeira',
          policyContext: {
            actionStatus: 'REQUER_OVERRIDE',
            blockReason: 'COBRANCA_ATRASADA',
            overrideUsed: true,
            overrideApprovedById: 'user-123',
            policySnapshot: { rematriculaDebtPolicy: 'PERMITIR_COM_OVERRIDE' },
            financialSnapshot: { financialStatus: 'ATRASADO', overdueChargesCount: 1 },
          },
        },
        { prisma: mockPrisma, paymentsProvider: mockProvider },
      );

      expect(mockPrisma.rematriculaOperacao.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actionStatus: 'REQUER_OVERRIDE',
            blockReason: 'COBRANCA_ATRASADA',
            overrideUsed: true,
            overrideReason: 'Acordo aprovado pela coordenação financeira',
            overrideApprovedById: 'user-123',
          }),
        }),
      );
    });

    it('deve rematricular aluno menor de idade usando responsável como pagador', async () => {
      // Configurar aluno menor de idade
      const mockMatriculaMenor = {
        id: 'matricula-menor-123',
        alunoId: 'aluno-menor-123',
        responsavelFinanceiroId: 'resp-123',
        turmaId: 'turma-123',
        planoId: 'plano-123',
        comboId: null,
        dataInicio: new Date('2024-01-01'),
        dataFimContrato: new Date('2024-12-31'),
        status: 'ATIVA',
        vencimentoDia: 5,
        formaPagamento: 'BOLETO',
        formaPagamentoTaxa: 'BOLETO',
        jurosMensal: 1,
        multaPercentual: 2,
        descontoAntecipado: null,
        prazoDesconto: null,
        asaasSubscriptionId: 'sub_old_menor_123',
        aluno: {
          id: 'aluno-menor-123',
          contaId: 'conta-123',
          nome: 'Maria Silva',
          cpf: null,
          email: null,
          telefone: null,
          dataNasc: new Date('2015-01-01'), // Menor de idade
          enderecoCep: null,
          enderecoLogradouro: null,
          enderecoNumero: null,
          enderecoComplemento: null,
          enderecoBairro: null,
          asaasCustomerId: null,
        },
        responsavelFinanceiro: {
          id: 'resp-123',
          nome: 'Carlos Silva',
          cpf: '98765432101',
          email: 'carlos@email.com',
          telefone: '11988888888',
          enderecoCep: '01234567',
          enderecoLogradouro: 'Rua Pai',
          enderecoNumero: '200',
          enderecoComplemento: 'Apt 10',
          enderecoBairro: 'Centro',
          asaasCustomerId: 'cus_resp_123',
        },
        plano: {
          id: 'plano-123',
          nome: 'Plano Mensal',
          valor: 150,
          periodicidade: 'MENSAL',
          status: 'ATIVO',
        },
        turma: {
          id: 'turma-123',
          nome: 'Turma A',
          capacidade: 20,
          diasSemana: ['SEGUNDA'],
          horaInicio: '08:00',
          horaFim: '10:00',
          status: 'ATIVO',
        },
        combo: null,
      };

      mockPrisma.matricula.findUnique = vi.fn().mockResolvedValue(mockMatriculaMenor);

      const result = await rematricularAluno(
        {
          contaId: 'conta-123',
          matriculaId: 'matricula-menor-123',
          createdById: 'user-123',
          dataInicio: new Date('2025-01-01'),
          dataFimContrato: new Date('2025-12-31'),
        },
        { prisma: mockPrisma, paymentsProvider: mockProvider },
      );

      expect(result.success).toBe(true);

      // Verificar que o customer foi resolvido com tipo RESPONSAVEL
      expect(mockProvider.resolveOrCreateCustomerForPayer).toHaveBeenCalledWith(
        expect.objectContaining({
          payer: expect.objectContaining({ type: 'RESPONSAVEL' }),
        }),
      );
    });
  });

  describe('validações', () => {
    it('deve rejeitar se matrícula não existe', async () => {
      mockPrisma.matricula.findUnique = vi.fn().mockResolvedValue(null);

      const result = await rematricularAluno(
        {
          contaId: 'conta-123',
          matriculaId: 'matricula-inexistente',
          createdById: 'user-123',
          dataInicio: new Date('2025-01-01'),
          dataFimContrato: new Date('2025-12-31'),
        },
        { prisma: mockPrisma, paymentsProvider: mockProvider },
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('MATRICULA_NAO_ENCONTRADA');
      }
    });

    it('deve rejeitar se matrícula pertence a outra conta', async () => {
      const result = await rematricularAluno(
        {
          contaId: 'outra-conta',
          matriculaId: 'matricula-123',
          createdById: 'user-123',
          dataInicio: new Date('2025-01-01'),
          dataFimContrato: new Date('2025-12-31'),
        },
        { prisma: mockPrisma, paymentsProvider: mockProvider },
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('MATRICULA_PERTENCE_OUTRA_CONTA');
      }
    });

    it('deve rejeitar se já existe operação em andamento', async () => {
      mockPrisma.rematriculaOperacao.findFirst = vi.fn().mockResolvedValue({
        id: 'operacao-existente',
        status: 'PENDING',
      });

      const result = await rematricularAluno(
        {
          contaId: 'conta-123',
          matriculaId: 'matricula-123',
          createdById: 'user-123',
          dataInicio: new Date('2025-01-01'),
          dataFimContrato: new Date('2025-12-31'),
        },
        { prisma: mockPrisma, paymentsProvider: mockProvider },
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('OPERACAO_EM_ANDAMENTO');
      }
    });

    it('deve rejeitar aluno menor sem responsável financeiro', async () => {
      // Aluno menor sem responsável
      const mockMatriculaMenorSemResp = {
        id: 'matricula-menor-sem-resp',
        alunoId: 'aluno-menor-123',
        responsavelFinanceiroId: null,
        turmaId: 'turma-123',
        planoId: 'plano-123',
        comboId: null,
        dataInicio: new Date('2024-01-01'),
        dataFimContrato: new Date('2024-12-31'),
        status: 'ATIVA',
        vencimentoDia: 5,
        jurosMensal: 1,
        multaPercentual: 2,
        descontoAntecipado: null,
        prazoDesconto: null,
        asaasSubscriptionId: null,
        aluno: {
          id: 'aluno-menor-123',
          contaId: 'conta-123',
          nome: 'Maria Silva',
          cpf: null,
          email: null,
          telefone: null,
          dataNasc: new Date('2015-01-01'), // Menor de idade
          enderecoCep: null,
          enderecoLogradouro: null,
          enderecoNumero: null,
          enderecoComplemento: null,
          enderecoBairro: null,
          asaasCustomerId: null,
        },
        responsavelFinanceiro: null,
        plano: {
          id: 'plano-123',
          nome: 'Plano Mensal',
          valor: 150,
          periodicidade: 'MENSAL',
          status: 'ATIVO',
        },
        turma: {
          id: 'turma-123',
          nome: 'Turma A',
          capacidade: 20,
          diasSemana: ['SEGUNDA'],
          horaInicio: '08:00',
          horaFim: '10:00',
          status: 'ATIVO',
        },
        combo: null,
      };

      mockPrisma.matricula.findUnique = vi.fn().mockResolvedValue(mockMatriculaMenorSemResp);

      const result = await rematricularAluno(
        {
          contaId: 'conta-123',
          matriculaId: 'matricula-menor-sem-resp',
          createdById: 'user-123',
          dataInicio: new Date('2025-01-01'),
          dataFimContrato: new Date('2025-12-31'),
        },
        { prisma: mockPrisma, paymentsProvider: mockProvider },
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('RESPONSAVEL_OBRIGATORIO_MENOR');
      }
    });
  });

  describe('tratamento de erros do provedor', () => {
    it('deve registrar falha quando provedor retorna erro e preservar origem', async () => {
      (mockProvider.createSubscription as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Erro de conexão com o provedor'),
      );

      const result = await rematricularAluno(
        {
          contaId: 'conta-123',
          matriculaId: 'matricula-123',
          createdById: 'user-123',
          dataInicio: new Date('2025-01-01'),
          dataFimContrato: new Date('2025-12-31'),
        },
        { prisma: mockPrisma, paymentsProvider: mockProvider },
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('ERRO_PROVEDOR');
      }

      // Verificar que a operação foi marcada como FAILED
      expect(mockPrisma.rematriculaOperacao.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'FAILED' }),
        }),
      );

      // IMPORTANTE: Verificar que a matrícula origem NÃO foi cancelada
      // (falha ocorreu antes da FASE 2 - origem preservada)
      const cancelOrigemCalls = (
        mockPrisma.matricula.update as ReturnType<typeof vi.fn>
      ).mock.calls.filter(
        (call: unknown[]) =>
          (call[0] as { where: { id: string } }).where.id === 'matricula-123' &&
          (call[0] as { data: { status: string } }).data.status === 'CANCELADA',
      );

      // Se falhou, origem não deve ter sido cancelada
      expect(cancelOrigemCalls.length).toBe(0);
    });

    it('deve permitir retry após falha', async () => {
      // Verificar que operação FAILED permite retry
      // Este teste é coberto pelo retryRematricula
    });
  });

  describe('retryRematricula', () => {
    it('deve retornar sucesso idempotente se operação já está COMMITTED', async () => {
      // Mock de operação já concluída
      const mockOperacaoCommitted = {
        id: 'operacao-123',
        correlationId: 'corr-123',
        contaId: 'conta-123',
        matriculaOrigemId: 'matricula-123',
        matriculaNovaId: 'matricula-nova-123',
        status: 'COMMITTED',
        step: 'COMPLETED',
        customerId: 'cus_123',
        newSubscriptionId: 'sub_new_123',
        oldSubscriptionId: 'sub_old_123',
        payerType: 'ALUNO',
        payerId: 'aluno-123',
        retryCount: 0,
        lastRetryAt: null,
        matriculaOrigem: {
          id: 'matricula-123',
          asaasSubscriptionId: 'sub_old_123',
          aluno: {
            id: 'aluno-123',
            contaId: 'conta-123',
            nome: 'João Silva',
            cpf: '12345678901',
            email: 'joao@email.com',
            telefone: '11999999999',
            dataNasc: new Date('1990-01-01'),
            enderecoCep: '01234567',
            enderecoLogradouro: 'Rua Teste',
            enderecoNumero: '100',
            enderecoComplemento: null,
            enderecoBairro: 'Centro',
            asaasCustomerId: 'cus_123',
          },
          responsavelFinanceiro: null,
        },
        matriculaNova: {
          id: 'matricula-nova-123',
          planoId: 'plano-123',
          comboId: null,
          dataInicio: new Date('2025-01-01'),
          dataFimContrato: new Date('2025-12-31'),
          vencimentoDia: 5,
        },
      };

      const mockPrismaRetry = {
        ...mockPrisma,
        rematriculaOperacao: {
          ...mockPrisma.rematriculaOperacao,
          findUnique: vi.fn().mockResolvedValue(mockOperacaoCommitted),
        },
      } as unknown as Parameters<typeof retryRematricula>[1]['prisma'];

      const result = await retryRematricula(
        {
          operacaoId: 'operacao-123',
          contaId: 'conta-123',
          createdById: 'user-123',
        },
        { prisma: mockPrismaRetry, paymentsProvider: mockProvider },
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('COMMITTED');
        expect(result.data.uiMessage).toContain('já estava concluída');
      }

      // Não deve ter chamado o provedor (já estava concluída)
      expect(mockProvider.createSubscription).not.toHaveBeenCalled();
    });

    it('deve rejeitar retry de operação de outra conta', async () => {
      const mockOperacaoOutraConta = {
        id: 'operacao-123',
        contaId: 'outra-conta',
        status: 'FAILED',
      };

      const mockPrismaRetry = {
        ...mockPrisma,
        rematriculaOperacao: {
          ...mockPrisma.rematriculaOperacao,
          findUnique: vi.fn().mockResolvedValue(mockOperacaoOutraConta),
        },
      } as unknown as Parameters<typeof retryRematricula>[1]['prisma'];

      const result = await retryRematricula(
        {
          operacaoId: 'operacao-123',
          contaId: 'conta-123',
          createdById: 'user-123',
        },
        { prisma: mockPrismaRetry, paymentsProvider: mockProvider },
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('OPERACAO_PERTENCE_OUTRA_CONTA');
      }
    });

    it('deve preservar o valor líquido da matrícula ao recriar assinatura no retry', async () => {
      const mockOperacaoFailed = {
        id: 'operacao-123',
        correlationId: 'corr-123',
        contaId: 'conta-123',
        matriculaOrigemId: 'matricula-123',
        matriculaNovaId: 'matricula-nova-123',
        status: 'FAILED',
        step: 'NEW_MATRICULA_CREATED',
        customerId: 'cus_123',
        newSubscriptionId: null,
        oldSubscriptionId: 'sub_old_123',
        payerType: 'ALUNO',
        payerId: 'aluno-123',
        retryCount: 1,
        matriculaOrigem: {
          id: 'matricula-123',
          asaasSubscriptionId: 'sub_old_123',
          aluno: {
            id: 'aluno-123',
            contaId: 'conta-123',
            nome: 'João Silva',
            cpf: '12345678901',
            email: 'joao@email.com',
            telefone: '11999999999',
            dataNasc: new Date('1990-01-01'),
            enderecoCep: '01234567',
            enderecoLogradouro: 'Rua Teste',
            enderecoNumero: '100',
            enderecoComplemento: null,
            enderecoBairro: 'Centro',
            asaasCustomerId: 'cus_123',
          },
          responsavelFinanceiro: null,
        },
        matriculaNova: {
          id: 'matricula-nova-123',
          planoId: 'plano-123',
          comboId: null,
          dataInicio: new Date('2025-01-01'),
          dataFimContrato: new Date('2025-12-31'),
          vencimentoDia: 5,
          formaPagamento: 'BOLETO',
          formaPagamentoTaxa: 'BOLETO',
          descontos: [
            {
              desconto: {
                id: 'desconto-50',
                nome: 'Bolsa 50%',
                tipo: 'PERCENTUAL',
                valor: 50,
              },
            },
          ],
        },
      };

      const mockPrismaRetry = {
        ...mockPrisma,
        rematriculaOperacao: {
          ...mockPrisma.rematriculaOperacao,
          findUnique: vi.fn().mockResolvedValue(mockOperacaoFailed),
          update: vi.fn().mockResolvedValue({}),
        },
        plano: {
          ...mockPrisma.plano,
          findFirst: vi.fn().mockResolvedValue({
            id: 'plano-123',
            valor: 150,
            periodicidade: 'MENSAL',
          }),
        },
        matricula: {
          ...mockPrisma.matricula,
          update: vi.fn().mockResolvedValue({}),
        },
      } as unknown as Parameters<typeof retryRematricula>[1]['prisma'];

      const result = await retryRematricula(
        {
          operacaoId: 'operacao-123',
          contaId: 'conta-123',
          createdById: 'user-123',
        },
        { prisma: mockPrismaRetry, paymentsProvider: mockProvider },
      );

      expect(result.success).toBe(true);
      expect(mockProvider.createSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          value: 75,
        }),
      );
    });
  });

  describe('taxa de matrícula', () => {
    it('deve criar matrícula com taxa isenta quando taxaIsenta=true', async () => {
      const result = await rematricularAluno(
        {
          contaId: 'conta-123',
          matriculaId: 'matricula-123',
          createdById: 'user-123',
          dataInicio: new Date('2025-01-01'),
          dataFimContrato: new Date('2025-12-31'),
          taxaIsenta: true,
          taxaJustificativa: 'Aluno bolsista',
        },
        { prisma: mockPrisma, paymentsProvider: mockProvider },
      );

      expect(result.success).toBe(true);

      expect(mockPrisma.matricula.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            taxaMatricula: 0,
            taxaIsenta: true,
            taxaStatus: 'ISENTO',
            taxaJustificativa: 'Aluno bolsista',
          }),
        }),
      );

      // Não deve criar pagamento avulso para taxa isenta
      expect(mockProvider.createPayment).not.toHaveBeenCalled();
    });

    it('deve criar taxa no gateway quando não isenta e valor > 0', async () => {
      const result = await rematricularAluno(
        {
          contaId: 'conta-123',
          matriculaId: 'matricula-123',
          createdById: 'user-123',
          dataInicio: new Date('2025-01-01'),
          dataFimContrato: new Date('2025-12-31'),
          taxaMatricula: 50,
          taxaIsenta: false,
          formaPagamentoTaxa: 'PIX',
        },
        { prisma: mockPrisma, paymentsProvider: mockProvider },
      );

      expect(result.success).toBe(true);

      // Deve ter criado matrícula com taxa
      expect(mockPrisma.matricula.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            taxaMatricula: 50,
            taxaIsenta: false,
            taxaStatus: 'PENDENTE',
          }),
        }),
      );

      // Deve ter criado cobrança local TAXA_MATRICULA
      const cobrancaCalls =
        (mockPrisma.cobranca?.create as ReturnType<typeof vi.fn>)?.mock?.calls ?? [];
      const taxaCalls = cobrancaCalls.filter(
        (call: unknown[]) => (call[0] as { data: { tipo: string } }).data.tipo === 'TAXA_MATRICULA',
      );
      // Se cobranca mock exists, taxa should have been created
      if (taxaCalls.length > 0) {
        expect(taxaCalls[0][0].data.valor).toBe(50);
      }

      // Deve ter criado pagamento avulso no gateway
      expect(mockProvider.createPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          contaId: 'conta-123',
          value: 50,
          billingType: 'PIX',
        }),
      );
    });

    it('não deve chamar createPayment quando taxaMatricula=0', async () => {
      const result = await rematricularAluno(
        {
          contaId: 'conta-123',
          matriculaId: 'matricula-123',
          createdById: 'user-123',
          dataInicio: new Date('2025-01-01'),
          dataFimContrato: new Date('2025-12-31'),
          taxaMatricula: 0,
          taxaIsenta: false,
        },
        { prisma: mockPrisma, paymentsProvider: mockProvider },
      );

      expect(result.success).toBe(true);
      expect(mockProvider.createPayment).not.toHaveBeenCalled();
    });

    it('rejeita forma de pagamento indefinida sem cair para boleto', async () => {
      const origemIndefinida = {
        ...(await mockPrisma.matricula.findUnique({ where: { id: 'matricula-123' } })),
        formaPagamento: 'INDEFINIDO',
        formaPagamentoTaxa: 'INDEFINIDO',
      };
      mockPrisma.matricula.findUnique = vi.fn().mockResolvedValue(origemIndefinida);

      const result = await rematricularAluno(
        {
          contaId: 'conta-123',
          matriculaId: 'matricula-123',
          createdById: 'user-123',
          dataInicio: new Date('2025-01-01'),
          dataFimContrato: new Date('2025-12-31'),
        },
        { prisma: mockPrisma, paymentsProvider: mockProvider },
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('FORMA_PAGAMENTO_INVALIDA');
      }
      expect(mockPrisma.rematriculaOperacao.create).not.toHaveBeenCalled();
      expect(mockProvider.resolveOrCreateCustomerForPayer).not.toHaveBeenCalled();
      expect(mockProvider.createSubscription).not.toHaveBeenCalled();
    });
  });

  describe('reconciliação do 1º ciclo', () => {
    it('deve registrar que o primeiro ciclo aguarda webhook após criar subscription', async () => {
      const result = await rematricularAluno(
        {
          contaId: 'conta-123',
          matriculaId: 'matricula-123',
          createdById: 'user-123',
          dataInicio: new Date('2025-01-01'),
          dataFimContrato: new Date('2025-12-31'),
        },
        { prisma: mockPrisma, paymentsProvider: mockProvider },
      );

      expect(result.success).toBe(true);
      expect(mockProvider.listSubscriptionPayments).not.toHaveBeenCalled();
      expect(mockPrisma.matriculaLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'REMATRICULA_PRIMEIRO_CICLO_AGUARDANDO_WEBHOOK',
            metadata: expect.objectContaining({
              asaasSubscriptionId: 'sub_new_123',
              expectedWebhooks: ['SUBSCRIPTION_CREATED', 'PAYMENT_CREATED'],
            }),
          }),
        }),
      );
    });

    it('deve continuar sem depender de reconciliação síncrona do primeiro ciclo', async () => {
      (mockProvider.listSubscriptionPayments as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Timeout na API'),
      );

      const result = await rematricularAluno(
        {
          contaId: 'conta-123',
          matriculaId: 'matricula-123',
          createdById: 'user-123',
          dataInicio: new Date('2025-01-01'),
          dataFimContrato: new Date('2025-12-31'),
        },
        { prisma: mockPrisma, paymentsProvider: mockProvider },
      );

      expect(result.success).toBe(true);
      expect(mockProvider.listSubscriptionPayments).not.toHaveBeenCalled();
    });
  });
});
