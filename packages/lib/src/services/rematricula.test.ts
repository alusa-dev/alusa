import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock do prisma - usar função factory
const mockPrisma = {
  matricula: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  matriculaLog: {
    create: vi.fn(),
  },
  cobranca: {
    updateMany: vi.fn(),
    create: vi.fn(),
  },
  plano: {
    findUnique: vi.fn(),
  },
  descontoMatricula: {
    deleteMany: vi.fn(),
    create: vi.fn(),
  },
  $transaction: vi.fn(),
};

vi.mock('@/prisma/client', () => ({
  prisma: mockPrisma,
}));

// Mock do Asaas
const mockDeleteSubscription = vi.fn();
const mockIsAsaasEnabled = vi.fn();
vi.mock('../asaas', () => ({
  deleteSubscription: mockDeleteSubscription,
  isAsaasEnabled: mockIsAsaasEnabled,
}));

// Mock do maybeCreateAsaasRecords
const mockMaybeCreateAsaasRecords = vi.fn();
vi.mock('./matricula', () => ({
  maybeCreateAsaasRecords: mockMaybeCreateAsaasRecords,
}));

// Importar depois dos mocks
const { listarRematriculasElegiveis, criarRematricula } = await import('./rematricula');

describe('rematricula service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Por padrão, Asaas está habilitado nos testes
    mockIsAsaasEnabled.mockReturnValue(true);
    mockDeleteSubscription.mockResolvedValue({ id: 'sub_123', deleted: true });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('listarRematriculasElegiveis', () => {
    it('deve retornar lista vazia quando não há matrículas elegíveis', async () => {
      mockPrisma.matricula.findMany.mockResolvedValue([]);

      const result = await listarRematriculasElegiveis({
        contaId: 'conta-123',
        diasAntecedencia: 60,
      });

      expect(result.itens).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('deve marcar contrato como expirado quando dias restantes < 0', async () => {
      const hoje = new Date();
      const dataExpirada = new Date(hoje);
      dataExpirada.setDate(dataExpirada.getDate() - 10);

      mockPrisma.matricula.findMany.mockResolvedValue([
        {
          id: 'matricula-1',
          alunoId: 'aluno-1',
          planoId: 'plano-1',
          turmaId: null,
          comboId: null,
          status: 'ATIVA',
          statusContrato: 'ATIVO',
          dataInicio: new Date('2024-01-01'),
          dataFimContrato: dataExpirada,
          vencimentoDia: 5,
          taxaMatricula: 100,
          taxaIsenta: false,
          taxaJustificativa: null,
          formaPagamentoTaxa: 'BOLETO',
          multaPercentual: null,
          jurosMensal: null,
          descontoAntecipado: null,
          prazoDesconto: null,
          diasTolerancia: null,
          aluno: { id: 'aluno-1', nome: 'Aluno Teste', cpf: '12345678901', foto: null },
          plano: { id: 'plano-1', nome: 'Plano Básico' },
          turma: null,
          combo: null,
          cobrancas: [],
          descontos: [],
        },
      ]);

      const result = await listarRematriculasElegiveis({
        contaId: 'conta-123',
        diasAntecedencia: 60,
      });

      expect(result.itens).toHaveLength(1);
      expect(result.itens[0].contratoExpirado).toBe(true);
      expect(result.itens[0].podeRenovar).toBe(true);
      expect(result.itens[0].diasRestantes).toBeLessThan(0);
    });

    it('deve marcar contrato como não expirado quando dias restantes > 0', async () => {
      const hoje = new Date();
      const dataFutura = new Date(hoje);
      dataFutura.setDate(dataFutura.getDate() + 30);

      mockPrisma.matricula.findMany.mockResolvedValue([
        {
          id: 'matricula-1',
          alunoId: 'aluno-1',
          planoId: 'plano-1',
          turmaId: null,
          comboId: null,
          status: 'ATIVA',
          statusContrato: 'ATIVO',
          dataInicio: new Date('2024-01-01'),
          dataFimContrato: dataFutura,
          vencimentoDia: 5,
          taxaMatricula: 100,
          taxaIsenta: false,
          taxaJustificativa: null,
          formaPagamentoTaxa: 'BOLETO',
          multaPercentual: null,
          jurosMensal: null,
          descontoAntecipado: null,
          prazoDesconto: null,
          diasTolerancia: null,
          aluno: { id: 'aluno-1', nome: 'Aluno Teste', cpf: '12345678901', foto: null },
          plano: { id: 'plano-1', nome: 'Plano Básico' },
          turma: null,
          combo: null,
          cobrancas: [],
          descontos: [],
        },
      ]);

      const result = await listarRematriculasElegiveis({
        contaId: 'conta-123',
        diasAntecedencia: 60,
      });

      expect(result.itens).toHaveLength(1);
      expect(result.itens[0].contratoExpirado).toBe(false);
      expect(result.itens[0].podeRenovar).toBe(false);
      expect(result.itens[0].diasRestantes).toBeGreaterThan(0);
    });

    it('deve filtrar por statusContrato quando informado', async () => {
      mockPrisma.matricula.findMany.mockResolvedValue([]);

      await listarRematriculasElegiveis({
        contaId: 'conta-123',
        diasAntecedencia: 60,
        statusContrato: 'ENCERRADO',
      });

      expect(mockPrisma.matricula.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            statusContrato: 'ENCERRADO',
          }),
        }),
      );
    });
  });

  describe('criarRematricula', () => {
    it('deve lançar erro quando matrícula não for encontrada', async () => {
      mockPrisma.matricula.findUnique.mockResolvedValue(null);

      await expect(
        criarRematricula({
          contaId: 'conta-123',
          matriculaId: 'matricula-inexistente',
          createdById: 'user-1',
          dataInicio: new Date('2025-01-01'),
          dataFimContrato: new Date('2025-12-31'),
        }),
      ).rejects.toThrow('Matrícula de origem não encontrada.');
    });

    it('deve lançar erro quando conta não corresponder', async () => {
      mockPrisma.matricula.findUnique.mockResolvedValue({
        id: 'matricula-1',
        alunoId: 'aluno-1',
        planoId: 'plano-1',
        asaasSubscriptionId: null,
        aluno: { contaId: 'outra-conta', id: 'aluno-1' },
        plano: { id: 'plano-1', nome: 'Plano', valor: 100, periodicidade: 'MENSAL' },
        turma: null,
        dataInicio: new Date('2024-01-01'),
        dataFimContrato: new Date('2024-12-31'),
        statusContrato: 'ATIVO',
        cobrancas: [],
      });

      await expect(
        criarRematricula({
          contaId: 'conta-123',
          matriculaId: 'matricula-1',
          createdById: 'user-1',
          dataInicio: new Date('2025-01-01'),
          dataFimContrato: new Date('2025-12-31'),
        }),
      ).rejects.toThrow('Matrícula pertence a outra conta.');
    });

    it('deve lançar erro quando data de início for antes do fim do contrato', async () => {
      mockPrisma.matricula.findUnique.mockResolvedValue({
        id: 'matricula-1',
        alunoId: 'aluno-1',
        planoId: 'plano-1',
        asaasSubscriptionId: null,
        aluno: { contaId: 'conta-123', id: 'aluno-1' },
        plano: { id: 'plano-1', nome: 'Plano', valor: 100, periodicidade: 'MENSAL' },
        turma: null,
        dataInicio: new Date('2024-01-01'),
        dataFimContrato: new Date('2025-06-30'),
        statusContrato: 'ATIVO',
        cobrancas: [],
      });

      await expect(
        criarRematricula({
          contaId: 'conta-123',
          matriculaId: 'matricula-1',
          createdById: 'user-1',
          dataInicio: new Date('2025-01-01'), // Antes do fim do contrato
          dataFimContrato: new Date('2025-12-31'),
        }),
      ).rejects.toThrow('A nova matrícula deve iniciar após o fim do contrato atual.');
    });

    it('deve renovar matrícula existente com sucesso quando dados válidos', async () => {
      const dataFimContratoAtual = new Date('2024-12-31');
      const dataInicioAtual = new Date('2024-01-01');
      
      mockPrisma.matricula.findUnique.mockResolvedValue({
        id: 'matricula-1',
        alunoId: 'aluno-1',
        planoId: 'plano-1',
        turmaId: 'turma-1',
        comboId: null,
        responsavelFinanceiroId: null,
        asaasSubscriptionId: null,
        aluno: { contaId: 'conta-123', id: 'aluno-1' },
        plano: { id: 'plano-1', nome: 'Plano Básico', valor: 150, periodicidade: 'MENSAL' },
        turma: { id: 'turma-1', nome: 'Turma A' },
        dataInicio: dataInicioAtual,
        dataFimContrato: dataFimContratoAtual,
        statusContrato: 'ATIVO',
        vencimentoDia: 5,
        taxaMatricula: 100,
        taxaIsenta: false,
        taxaJustificativa: null,
        formaPagamentoTaxa: 'BOLETO',
        multaPercentual: null,
        jurosMensal: null,
        descontoAntecipado: null,
        prazoDesconto: null,
        diasTolerancia: null,
        cobrancas: [{ id: 'cob-1', formaPagamento: 'BOLETO', tipo: 'MENSALIDADE', status: 'PAGO' }],
      });

      // Matrícula atualizada
      mockPrisma.matricula.update.mockResolvedValue({
        id: 'matricula-1',
        status: 'ATIVA',
        statusContrato: 'ATIVO',
        dataInicio: new Date('2025-01-01'),
        dataFimContrato: new Date('2025-12-31'),
        turmaId: 'turma-2',
        planoId: 'plano-1',
        asaasSubscriptionId: null,
      });

      mockPrisma.matriculaLog.create.mockResolvedValue({});

      const result = await criarRematricula({
        contaId: 'conta-123',
        matriculaId: 'matricula-1',
        createdById: 'user-1',
        dataInicio: new Date('2025-01-01'),
        dataFimContrato: new Date('2025-12-31'),
        turmaId: 'turma-2',
      });

      // Deve retornar matrícula renovada (não nova)
      expect(result.matriculaRenovada).toBeDefined();
      expect(result.matriculaRenovada.id).toBe('matricula-1');
      expect(result.historicoContrato.dataInicioAnterior).toEqual(dataInicioAtual);
      expect(result.historicoContrato.dataFimContratoAnterior).toEqual(dataFimContratoAtual);
      
      // Deve ter chamado update, não criar nova
      expect(mockPrisma.matricula.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'matricula-1' },
          data: expect.objectContaining({
            statusContrato: 'ATIVO',
          }),
        }),
      );
      
      // Não deve chamar deleteSubscription pois não há asaasSubscriptionId
      expect(mockDeleteSubscription).not.toHaveBeenCalled();
    });

    it('deve cancelar subscription antiga quando existir asaasSubscriptionId', async () => {
      const dataFimContratoAtual = new Date('2024-12-31');
      
      mockPrisma.matricula.findUnique.mockResolvedValue({
        id: 'matricula-1',
        alunoId: 'aluno-1',
        planoId: 'plano-1',
        turmaId: null,
        comboId: null,
        responsavelFinanceiroId: null,
        asaasSubscriptionId: 'sub_antigo_123',
        aluno: { contaId: 'conta-123', id: 'aluno-1' },
        plano: { id: 'plano-1', nome: 'Plano Básico', valor: 150, periodicidade: 'MENSAL' },
        turma: null,
        dataInicio: new Date('2024-01-01'),
        dataFimContrato: dataFimContratoAtual,
        statusContrato: 'ATIVO',
        vencimentoDia: 5,
        taxaMatricula: 100,
        taxaIsenta: false,
        taxaJustificativa: null,
        formaPagamentoTaxa: 'BOLETO',
        multaPercentual: null,
        jurosMensal: null,
        descontoAntecipado: null,
        prazoDesconto: null,
        diasTolerancia: null,
        cobrancas: [{ id: 'cob-1', formaPagamento: 'BOLETO', tipo: 'MENSALIDADE', status: 'PAGO' }],
      });

      mockPrisma.matricula.update.mockResolvedValue({
        id: 'matricula-1',
        status: 'ATIVA',
        statusContrato: 'ATIVO',
        dataInicio: new Date('2025-01-01'),
        dataFimContrato: new Date('2025-12-31'),
        turmaId: null,
        planoId: 'plano-1',
        asaasSubscriptionId: null,
      });

      mockPrisma.matriculaLog.create.mockResolvedValue({});

      const result = await criarRematricula({
        contaId: 'conta-123',
        matriculaId: 'matricula-1',
        createdById: 'user-1',
        dataInicio: new Date('2025-01-01'),
        dataFimContrato: new Date('2025-12-31'),
      });

      expect(result.matriculaRenovada).toBeDefined();
      expect(mockDeleteSubscription).toHaveBeenCalledWith('sub_antigo_123', { contaId: 'conta-123' });
      
      // Verificar que log ASSINATURA_ANTERIOR_CANCELADA foi criado
      expect(mockPrisma.matriculaLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'ASSINATURA_ANTERIOR_CANCELADA',
          }),
        }),
      );
    });

    it('deve continuar normalmente quando deleteSubscription retornar 404', async () => {
      const dataFimContratoAtual = new Date('2024-12-31');
      
      mockPrisma.matricula.findUnique.mockResolvedValue({
        id: 'matricula-1',
        alunoId: 'aluno-1',
        planoId: 'plano-1',
        turmaId: null,
        comboId: null,
        responsavelFinanceiroId: null,
        asaasSubscriptionId: 'sub_nao_existe',
        aluno: { contaId: 'conta-123', id: 'aluno-1' },
        plano: { id: 'plano-1', nome: 'Plano Básico', valor: 150, periodicidade: 'MENSAL' },
        turma: null,
        dataInicio: new Date('2024-01-01'),
        dataFimContrato: dataFimContratoAtual,
        statusContrato: 'ATIVO',
        vencimentoDia: 5,
        taxaMatricula: 100,
        taxaIsenta: false,
        taxaJustificativa: null,
        formaPagamentoTaxa: 'BOLETO',
        multaPercentual: null,
        jurosMensal: null,
        descontoAntecipado: null,
        prazoDesconto: null,
        diasTolerancia: null,
        cobrancas: [],
      });

      // Simular erro 404 do Asaas
      mockDeleteSubscription.mockRejectedValue({
        response: { status: 404 },
        message: 'Subscription not found',
      });

      mockPrisma.matricula.update.mockResolvedValue({
        id: 'matricula-1',
        status: 'ATIVA',
        statusContrato: 'ATIVO',
        dataInicio: new Date('2025-01-01'),
        dataFimContrato: new Date('2025-12-31'),
        turmaId: null,
        planoId: 'plano-1',
        asaasSubscriptionId: null,
      });

      mockPrisma.matriculaLog.create.mockResolvedValue({});

      // Não deve lançar erro - deve continuar normalmente
      const result = await criarRematricula({
        contaId: 'conta-123',
        matriculaId: 'matricula-1',
        createdById: 'user-1',
        dataInicio: new Date('2025-01-01'),
        dataFimContrato: new Date('2025-12-31'),
      });

      expect(result.matriculaRenovada).toBeDefined();
      expect(mockDeleteSubscription).toHaveBeenCalledWith('sub_nao_existe', { contaId: 'conta-123' });
      
      // Verificar que log ASSINATURA_ANTERIOR_NAO_ENCONTRADA foi criado
      expect(mockPrisma.matriculaLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'ASSINATURA_ANTERIOR_NAO_ENCONTRADA',
          }),
        }),
      );
    });

    it('deve cancelar cobranças pendentes localmente ao rematricular', async () => {
      const dataFimContratoAtual = new Date('2024-12-31');
      
      mockPrisma.matricula.findUnique.mockResolvedValue({
        id: 'matricula-1',
        alunoId: 'aluno-1',
        planoId: 'plano-1',
        turmaId: null,
        comboId: null,
        responsavelFinanceiroId: null,
        asaasSubscriptionId: null,
        aluno: { contaId: 'conta-123', id: 'aluno-1' },
        plano: { id: 'plano-1', nome: 'Plano Básico', valor: 150, periodicidade: 'MENSAL' },
        turma: null,
        dataInicio: new Date('2024-01-01'),
        dataFimContrato: dataFimContratoAtual,
        statusContrato: 'ATIVO',
        vencimentoDia: 5,
        taxaMatricula: 100,
        taxaIsenta: false,
        taxaJustificativa: null,
        formaPagamentoTaxa: 'BOLETO',
        multaPercentual: null,
        jurosMensal: null,
        descontoAntecipado: null,
        prazoDesconto: null,
        diasTolerancia: null,
        cobrancas: [
          { id: 'cob-1', formaPagamento: 'BOLETO', tipo: 'MENSALIDADE', status: 'PAGO' },
          { id: 'cob-2', formaPagamento: 'BOLETO', tipo: 'MENSALIDADE', status: 'PENDENTE' },
          { id: 'cob-3', formaPagamento: 'BOLETO', tipo: 'MENSALIDADE', status: 'ATRASADO' },
        ],
      });

      mockPrisma.matricula.update.mockResolvedValue({
        id: 'matricula-1',
        status: 'ATIVA',
        statusContrato: 'ATIVO',
        dataInicio: new Date('2025-01-01'),
        dataFimContrato: new Date('2025-12-31'),
        turmaId: null,
        planoId: 'plano-1',
        asaasSubscriptionId: null,
      });

      mockPrisma.matriculaLog.create.mockResolvedValue({});
      mockPrisma.cobranca.updateMany.mockResolvedValue({ count: 2 });

      await criarRematricula({
        contaId: 'conta-123',
        matriculaId: 'matricula-1',
        createdById: 'user-1',
        dataInicio: new Date('2025-01-01'),
        dataFimContrato: new Date('2025-12-31'),
      });

      // Verificar que cobranças PENDENTE e ATRASADO foram canceladas
      expect(mockPrisma.cobranca.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['cob-2', 'cob-3'] } },
          data: { status: 'CANCELADO' },
        }),
      );

      // Verificar que log COBRANCAS_CANCELADAS_REMATRICULA foi criado
      expect(mockPrisma.matriculaLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'COBRANCAS_CANCELADAS_REMATRICULA',
          }),
        }),
      );
    });

    it('não deve chamar Asaas quando integração está desabilitada', async () => {
      const dataFimContratoAtual = new Date('2024-12-31');
      
      // Desabilitar Asaas
      mockIsAsaasEnabled.mockReturnValue(false);

      mockPrisma.matricula.findUnique.mockResolvedValue({
        id: 'matricula-1',
        alunoId: 'aluno-1',
        planoId: 'plano-1',
        turmaId: null,
        comboId: null,
        responsavelFinanceiroId: null,
        asaasSubscriptionId: 'sub_123',
        aluno: { contaId: 'conta-123', id: 'aluno-1' },
        plano: { id: 'plano-1', nome: 'Plano Básico', valor: 150, periodicidade: 'MENSAL' },
        turma: null,
        dataInicio: new Date('2024-01-01'),
        dataFimContrato: dataFimContratoAtual,
        statusContrato: 'ATIVO',
        vencimentoDia: 5,
        taxaMatricula: 100,
        taxaIsenta: false,
        taxaJustificativa: null,
        formaPagamentoTaxa: 'BOLETO',
        multaPercentual: null,
        jurosMensal: null,
        descontoAntecipado: null,
        prazoDesconto: null,
        diasTolerancia: null,
        cobrancas: [],
      });

      mockPrisma.matricula.update.mockResolvedValue({
        id: 'matricula-1',
        status: 'ATIVA',
        statusContrato: 'ATIVO',
        dataInicio: new Date('2025-01-01'),
        dataFimContrato: new Date('2025-12-31'),
        turmaId: null,
        planoId: 'plano-1',
        asaasSubscriptionId: null,
      });

      mockPrisma.matriculaLog.create.mockResolvedValue({});

      await criarRematricula({
        contaId: 'conta-123',
        matriculaId: 'matricula-1',
        createdById: 'user-1',
        dataInicio: new Date('2025-01-01'),
        dataFimContrato: new Date('2025-12-31'),
      });

      // Não deve chamar deleteSubscription quando Asaas está desabilitado
      expect(mockDeleteSubscription).not.toHaveBeenCalled();
    });

    it('deve criar cobrança local de mensalidade quando criarCobranca=true', async () => {
      const dataFimContratoAtual = new Date('2024-12-31');
      
      mockPrisma.matricula.findUnique.mockResolvedValue({
        id: 'matricula-1',
        alunoId: 'aluno-1',
        planoId: 'plano-1',
        turmaId: null,
        comboId: null,
        responsavelFinanceiroId: null,
        asaasSubscriptionId: null,
        aluno: { contaId: 'conta-123', id: 'aluno-1' },
        plano: { id: 'plano-1', nome: 'Plano Mensal', valor: 200, periodicidade: 'MENSAL' },
        turma: null,
        dataInicio: new Date('2024-01-01'),
        dataFimContrato: dataFimContratoAtual,
        statusContrato: 'ATIVO',
        vencimentoDia: 10,
        taxaMatricula: 0,
        taxaIsenta: true,
        taxaJustificativa: null,
        formaPagamentoTaxa: 'BOLETO',
        multaPercentual: null,
        jurosMensal: null,
        descontoAntecipado: null,
        prazoDesconto: null,
        diasTolerancia: null,
        cobrancas: [{ id: 'cob-1', formaPagamento: 'PIX', tipo: 'MENSALIDADE', status: 'PAGO' }],
      });

      mockPrisma.matricula.update.mockResolvedValue({
        id: 'matricula-1',
        status: 'ATIVA',
        statusContrato: 'ATIVO',
        dataInicio: new Date('2025-01-01'),
        dataFimContrato: new Date('2025-12-31'),
        turmaId: null,
        planoId: 'plano-1',
        asaasSubscriptionId: null,
      });

      mockPrisma.cobranca.create.mockResolvedValue({
        id: 'cob-nova-1',
        tipo: 'MENSALIDADE',
        status: 'PENDENTE',
      });

      mockPrisma.plano.findUnique.mockResolvedValue({
        valor: 200,
        periodicidade: 'MENSAL',
        nome: 'Plano Mensal',
      });

      mockPrisma.matriculaLog.create.mockResolvedValue({});

      await criarRematricula({
        contaId: 'conta-123',
        matriculaId: 'matricula-1',
        createdById: 'user-1',
        dataInicio: new Date('2025-01-01'),
        dataFimContrato: new Date('2025-12-31'),
        criarCobranca: true,
      });

      // Deve criar cobrança de mensalidade local
      expect(mockPrisma.cobranca.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            matriculaId: 'matricula-1',
            tipo: 'MENSALIDADE',
            status: 'PENDENTE',
            formaPagamento: 'PIX', // Última forma de pagamento usada
          }),
        }),
      );
    });
  });
});
