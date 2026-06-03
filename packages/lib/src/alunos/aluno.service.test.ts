import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createAluno, deleteAluno, listAlunos } from './aluno.service';
import { encryptSecret } from '../security/encryption';

const {
  listCustomersMock,
  createCustomerMock,
  updateCustomerMock,
  deleteCustomerMock,
} = vi.hoisted(() => ({
  listCustomersMock: vi.fn(),
  createCustomerMock: vi.fn(),
  updateCustomerMock: vi.fn(),
  deleteCustomerMock: vi.fn(),
}));

vi.mock('@alusa/asaas', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alusa/asaas')>();
  return {
    ...actual,
    listCustomers: listCustomersMock,
    createCustomer: createCustomerMock,
    updateCustomer: updateCustomerMock,
    deleteCustomer: deleteCustomerMock,
  };
});

const prisma = new PrismaClient();

describe('Aluno Service', () => {
  const contaId = 'conta-default';

  beforeAll(async () => {
    if (!process.env.ENCRYPTION_KEY) {
      process.env.ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
    }
    // garante conta existente
    // Garante conta com owner (obrigatório)
    const owner = await prisma.usuario.upsert({
      where: { email: 'owner+aluno.test@example.com' },
      update: {},
      create: { id: 'owner-aluno-test', contaId: contaId, nome: 'Owner Test', email: 'owner+aluno.test@example.com', senhaHash: 'x', role: 'ADMIN', status: 'ATIVO' }
    });
    await prisma.conta.upsert({
      where: { id: contaId },
      update: { ownerUserId: owner.id },
      create: { id: contaId, nome: 'Conta Teste', cpfCnpj: '99999999999999', ownerUserId: owner.id }
    });

    const financeProfile = await prisma.financeProfile.upsert({
      where: { contaId },
      update: {},
      create: { contaId },
    });

    await prisma.asaasCredential.upsert({
      where: { financeProfileId: financeProfile.id },
      update: { apiKeyEncrypted: encryptSecret('sandbox_test_key') },
      create: { financeProfileId: financeProfile.id, apiKeyEncrypted: encryptSecret('sandbox_test_key') },
    });

    // Garante que a fonte preferida (asaasAccount.apiKeyEncrypted) é válida e descriptografável.
    // Evita falhas por registros antigos/invalidos em ambiente de teste compartilhado.
    await prisma.asaasAccount.upsert({
      where: { financeProfileId: financeProfile.id },
      update: {
        apiKeyEncrypted: encryptSecret('sandbox_test_key'),
        apiKeyStatus: 'CONNECTED',
        status: 'APPROVED',
      },
      create: {
        financeProfileId: financeProfile.id,
        apiKeyEncrypted: encryptSecret('sandbox_test_key'),
        apiKeyStatus: 'CONNECTED',
        status: 'APPROVED',
      },
    });

    // Limpar dados de teste (ordem importa por causa das FKs)
    await prisma.subscription.deleteMany({ where: { contaId } });
    await prisma.installmentPlan.deleteMany({ where: { contaId } });
    await prisma.pagamento.deleteMany({ where: { contaId } });
    await prisma.cobranca.deleteMany({ where: { contaId } });
    await prisma.contrato.deleteMany({ where: { matricula: { contaId } } });
    await prisma.matriculaOperacao.deleteMany({ where: { contaId } });
    await prisma.matriculaLog.deleteMany({ where: { matricula: { contaId } } });
    await prisma.matriculaTurma.deleteMany({ where: { contaId } });
    await prisma.descontoMatricula.deleteMany({ where: { matricula: { contaId } } });
    await prisma.alunoResponsavel.deleteMany({ where: { aluno: { contaId } } });
    await prisma.matricula.deleteMany({ where: { contaId } });
    await prisma.aluno.deleteMany({ where: { contaId } });
    await prisma.responsavel.deleteMany({ where: { cpf: { in: ['11144477735', '98765432100'] } } });
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    let counter = 0;
    listCustomersMock.mockResolvedValue({
      object: 'list',
      hasMore: false,
      totalCount: 0,
      limit: 10,
      offset: 0,
      data: [],
    });
    createCustomerMock.mockImplementation(async () => {
      counter += 1;
      return {
        id: `cust_${counter}`,
        object: 'customer',
        dateCreated: '2026-01-01',
        name: 'Teste',
        cpfCnpj: '12345678901',
        deleted: false,
        notificationDisabled: false,
      };
    });
    updateCustomerMock.mockResolvedValue({
      id: 'cust_updated',
      object: 'customer',
      dateCreated: '2026-01-01',
      name: 'Teste',
      cpfCnpj: '12345678901',
      deleted: false,
      notificationDisabled: false,
    });
    deleteCustomerMock.mockResolvedValue({
      id: 'cust_deleted',
      object: 'customer',
      dateCreated: '2026-01-01',
      name: 'Teste',
      cpfCnpj: '12345678901',
      deleted: true,
      notificationDisabled: false,
    });

    await prisma.subscription.deleteMany({ where: { contaId } });
    await prisma.installmentPlan.deleteMany({ where: { contaId } });
    await prisma.pagamento.deleteMany({ where: { contaId } });
    await prisma.cobranca.deleteMany({ where: { contaId } });
    await prisma.contrato.deleteMany({ where: { matricula: { contaId } } });
    await prisma.matriculaOperacao.deleteMany({ where: { contaId } });
    await prisma.matriculaLog.deleteMany({ where: { matricula: { contaId } } });
    await prisma.matriculaTurma.deleteMany({ where: { contaId } });
    await prisma.descontoMatricula.deleteMany({ where: { matricula: { contaId } } });
    await prisma.alunoResponsavel.deleteMany({ where: { aluno: { contaId } } });
    await prisma.matricula.deleteMany({ where: { contaId } });
    await prisma.aluno.deleteMany({ where: { contaId } });
    await prisma.responsavel.deleteMany({ where: { cpf: { in: ['11144477735'] } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('cria e lista alunos', async () => {
    const aluno = await createAluno({
      contaId,
      nome: 'Teste Unit',
      cpf: '52998224725',
      dataNasc: new Date('2005-01-01'),
      endereco: { cep: '01001000', logradouro: 'Rua A', numero: '10', bairro: 'Centro', cidade: 'SP', uf: 'SP' }
    });
    const alunos = await listAlunos(contaId);
    expect(alunos.length).toBeGreaterThan(0);
    expect(alunos[0].nome).toBe('Teste Unit');

    const alunoDb = await prisma.aluno.findUnique({ where: { id: aluno.id } });
    expect(alunoDb?.asaasCustomerId).toBeTruthy();
  });

  it('gera codigoInterno sequencial', async () => {
    // Limpar dados de teste
    await prisma.alunoResponsavel.deleteMany({ where: { aluno: { contaId } } });
    await prisma.aluno.deleteMany({ where: { contaId } });
    
    const endereco = { cep: '01001000', logradouro: 'Rua A', numero: '10', bairro: 'Centro', cidade: 'SP', uf: 'SP' };
    const a1 = await createAluno({ contaId, nome: 'Aluno 1', cpf: '12345678909', dataNasc: new Date('2000-02-02'), endereco });
    const a2 = await createAluno({ contaId, nome: 'Aluno 2', cpf: '98765432100', dataNasc: new Date('2001-03-03'), endereco });
    expect(a1.codigoInterno).toBeDefined();
    expect(a2.codigoInterno).toBeDefined();
    expect(Number(a2.codigoInterno) - Number(a1.codigoInterno)).toBe(1);
    expect(a1.codigoInterno?.length).toBeGreaterThanOrEqual(5);
  });

  it('cria aluno menor com responsável', async () => {
    const endereco = { cep: '01001000', logradouro: 'Rua A', numero: '10', bairro: 'Centro', cidade: 'SP', uf: 'SP' };
    const aluno = await createAluno({
      contaId,
      nome: 'João Silva',
      cpf: '74185296355',
      dataNasc: new Date('2015-05-15'), // menor de idade
      endereco,
      responsavel: {
        nome: 'Maria Silva',
        cpf: '11144477735',
        email: 'maria@example.com',
        telefone: '11999999999',
        endereco,
        financeiro: true,
      }
    });
    
    expect(aluno.nome).toBe('João Silva');
    
    // Verificar se responsável foi criado e vinculado
    const alunoComResponsavel = await prisma.aluno.findUnique({
      where: { id: aluno.id },
      include: {
        responsaveis: {
          include: { responsavel: true }
        }
      }
    });
    
    expect(alunoComResponsavel?.responsaveis).toHaveLength(1);
    const responsavelDb = alunoComResponsavel?.responsaveis[0].responsavel;
    expect(responsavelDb?.nome).toBe('Maria Silva');
    expect(responsavelDb?.cpf).toBe('11144477735');
    expect(responsavelDb?.asaasCustomerId).toBeTruthy();
  });

  it('hard delete aluno quando não há histórico financeiro', async () => {
    const endereco = { cep: '01001000', logradouro: 'Rua A', numero: '10', bairro: 'Centro', cidade: 'SP', uf: 'SP' };
    const aluno = await createAluno({
      contaId,
      nome: 'Aluno Delete',
      cpf: '39053344705',
      dataNasc: new Date('2000-01-01'),
      endereco,
    });

    await deleteAluno(aluno.id, contaId, 'duplicado');

    const updated = await prisma.aluno.findUnique({ where: { id: aluno.id } });
    expect(updated).toBeNull();
    expect(deleteCustomerMock).toHaveBeenCalled();
  });

  it('arquiva aluno mesmo com assinaturas ativas', async () => {
    const endereco = { cep: '01001000', logradouro: 'Rua A', numero: '10', bairro: 'Centro', cidade: 'SP', uf: 'SP' };
    const aluno = await createAluno({
      contaId,
      nome: 'Aluno Assinatura',
      cpf: '52998224725',
      dataNasc: new Date('2000-01-01'),
      endereco,
    });

    const matricula = await prisma.matricula.create({
      data: {
        contaId,
        alunoId: aluno.id,
        dataInicio: new Date('2026-01-01'),
        dataFimContrato: new Date('2026-12-31'),
        taxaMatricula: 0,
        status: 'ATIVA',
      },
    });

    const contrato = await prisma.contrato.create({
      data: {
        contaId,
        matriculaId: matricula.id,
        conteudoFinal: '<p>Contrato de teste</p>',
        status: 'PENDENTE',
        arquivoPdfUrl: 'https://example.com/contrato.pdf',
        hashPdf: 'hash_teste',
      },
    });

    await prisma.subscription.create({
      data: {
        contaId,
        contratoId: contrato.id,
        matriculaId: matricula.id,
        externalReference: `subscription:${contrato.id}`,
        status: 'ACTIVE',
        asaasSubscriptionId: 'sub_123',
      },
    });

    await deleteAluno(aluno.id, contaId);

    const stillThere = await prisma.aluno.findUnique({ where: { id: aluno.id } });
    expect(stillThere).not.toBeNull();
    expect(stillThere?.status).toBe('INATIVO');
    expect(deleteCustomerMock).not.toHaveBeenCalled();
  });

  it('arquiva aluno mesmo com matrículas ativas', async () => {
    const endereco = { cep: '01001000', logradouro: 'Rua A', numero: '10', bairro: 'Centro', cidade: 'SP', uf: 'SP' };
    const aluno = await createAluno({
      contaId,
      nome: 'Aluno Matricula',
      cpf: '15350946056',
      dataNasc: new Date('2000-01-01'),
      endereco,
    });

    await prisma.matricula.create({
      data: {
        contaId,
        alunoId: aluno.id,
        dataInicio: new Date('2026-01-01'),
        dataFimContrato: new Date('2026-12-31'),
        taxaMatricula: 0,
        status: 'ATIVA',
      },
    });

    await deleteAluno(aluno.id, contaId);

    const stillThere = await prisma.aluno.findUnique({ where: { id: aluno.id } });
    expect(stillThere).not.toBeNull();
    expect(stillThere?.status).toBe('INATIVO');
    expect(deleteCustomerMock).not.toHaveBeenCalled();
  });

  it('trata consentimento de imagem corretamente', async () => {
    const endereco = { cep: '01001000', logradouro: 'Rua A', numero: '10', bairro: 'Centro', cidade: 'SP', uf: 'SP' };
    
    // Aluno com consentimento
    const alunoComConsentimento = await createAluno({
      contaId,
      nome: 'Ana Costa',
      cpf: '39053344705',
      dataNasc: new Date('2000-01-01'),
      endereco,
      consentimentoImagem: true,
      dataConsentimentoImagem: new Date('2024-01-15'),
    });
    
    expect(alunoComConsentimento.consentimentoImagem).toBe(true);
    expect(alunoComConsentimento.dataConsentimentoImagem).toBeDefined();
    
    // Aluno sem consentimento
    const alunoSemConsentimento = await createAluno({
      contaId,
      nome: 'Pedro Santos',
      cpf: '15350946056',
      dataNasc: new Date('2000-01-01'),
      endereco,
      consentimentoImagem: false,
    });
    
    expect(alunoSemConsentimento.consentimentoImagem).toBe(false);
    expect(alunoSemConsentimento.dataConsentimentoImagem).toBeNull();
  });

  it('normaliza CPF e telefone corretamente', async () => {
    const endereco = { cep: '01001000', logradouro: 'Rua A', numero: '10', bairro: 'Centro', cidade: 'SP', uf: 'SP' };
    const aluno = await createAluno({
      contaId,
      nome: 'Carlos Teste',
      dataNasc: new Date('2000-01-01'),
      endereco,
      cpf: '529.982.247-25', // com pontuação
      telefone: '(11) 99999-9999', // com formatação
    });
    
    // Buscar diretamente no banco para verificar normalização
    const alunoDb = await prisma.aluno.findUnique({ where: { id: aluno.id } });
    expect(alunoDb?.cpf).toBe('52998224725'); // sem pontuação
    expect(alunoDb?.telefone).toBe('11999999999'); // sem formatação
  });

  it('não cria aluno quando o Asaas falha', async () => {
    listCustomersMock.mockRejectedValueOnce(new Error('timeout'));

    const endereco = { cep: '01001000', logradouro: 'Rua A', numero: '10', bairro: 'Centro', cidade: 'SP', uf: 'SP' };

    await expect(
      createAluno({
        contaId,
        nome: 'Falha Asaas',
        cpf: '93541134780',
        dataNasc: new Date('2005-01-01'),
        endereco,
      }),
    ).rejects.toBeTruthy();

    const count = await prisma.aluno.count({
      where: { contaId, cpf: '93541134780' },
    });
    expect(count).toBe(0);
  });

  // ============================================================================
  // TESTES DE REGRAS DE NEGÓCIO: MENOR x MAIOR
  // ============================================================================

  describe('Regras de menor de idade', () => {
    it('cria aluno menor SEM CPF quando responsável está completo', async () => {
      const aluno = await createAluno({
        contaId,
        nome: 'Menor Sem CPF',
        dataNasc: new Date('2015-05-15'), // < 18 anos
        // Sem CPF do aluno
        responsavel: {
          nome: 'Responsável Válido',
          cpf: '11144477735',
          email: 'resp.valido@example.com',
          telefone: '11999999999',
          financeiro: true,
        },
      });

      expect(aluno.nome).toBe('Menor Sem CPF');
      expect(aluno.cpf).toBeNull();

      // Verifica que responsável foi criado
      const alunoComResp = await prisma.aluno.findUnique({
        where: { id: aluno.id },
        include: { responsaveis: { include: { responsavel: true } } },
      });
      expect(alunoComResp?.responsaveis).toHaveLength(1);
      expect(alunoComResp?.responsaveis[0].responsavel.cpf).toBe('11144477735');
    });

    it('reutiliza responsável existente selecionado por id', async () => {
      const responsavelExistente = await prisma.responsavel.create({
        data: {
          contaId,
          nome: 'Responsável Existente',
          cpf: '11144477735',
          email: 'resp.existente@example.com',
          telefone: '11999999999',
          financeiro: true,
        },
      });

      const aluno = await createAluno({
        contaId,
        nome: 'Menor Vinculado',
        dataNasc: new Date('2015-05-15'),
        responsavelExistenteId: responsavelExistente.id,
      });

      const alunoComResp = await prisma.aluno.findUnique({
        where: { id: aluno.id },
        include: { responsaveis: { include: { responsavel: true } } },
      });

      const totalResponsaveis = await prisma.responsavel.count({
        where: { contaId, cpf: '11144477735' },
      });

      expect(alunoComResp?.responsaveis).toHaveLength(1);
      expect(alunoComResp?.responsaveis[0].responsavel.id).toBe(responsavelExistente.id);
      expect(totalResponsaveis).toBe(1);
    });

    it('cria aluno menor COM CPF quando responsável está completo', async () => {
      const aluno = await createAluno({
        contaId,
        nome: 'Menor Com CPF',
        dataNasc: new Date('2015-05-15'), // < 18 anos
        cpf: '52998224725', // CPF válido
        responsavel: {
          nome: 'Responsável Com CPF',
          cpf: '11144477735',
          email: 'resp.comcpf@example.com',
          telefone: '11999999999',
          financeiro: true,
        },
      });

      expect(aluno.nome).toBe('Menor Com CPF');
      expect(aluno.cpf).toBe('52998224725');
    });

    it('cria aluno menor sem endereço (endereço opcional)', async () => {
      const aluno = await createAluno({
        contaId,
        nome: 'Menor Sem Endereco',
        dataNasc: new Date('2015-05-15'), // < 18 anos
        // Sem endereço
        responsavel: {
          nome: 'Responsável Sem End',
          cpf: '11144477735',
          email: 'resp.semend@example.com',
          telefone: '11999999999',
          financeiro: true,
        },
      });

      expect(aluno.nome).toBe('Menor Sem Endereco');
    });
  });

  describe('Regras de maior de idade', () => {
    it('cria aluno maior SEM responsável (responsável opcional)', async () => {
      const aluno = await createAluno({
        contaId,
        nome: 'Maior Sem Responsável',
        cpf: '52998224725', // CPF válido
        dataNasc: new Date('2000-01-01'), // >= 18 anos
        // Sem responsável
      });

      expect(aluno.nome).toBe('Maior Sem Responsável');
      expect(aluno.cpf).toBe('52998224725');
    });

    it('cria aluno maior COM responsável (responsável opcional)', async () => {
      const aluno = await createAluno({
        contaId,
        nome: 'Maior Com Responsável',
        cpf: '52998224725', // CPF válido
        dataNasc: new Date('2000-01-01'), // >= 18 anos
        responsavel: {
          nome: 'Responsável Opcional',
          cpf: '11144477735',
          email: 'resp.opcional@example.com',
          telefone: '11999999999',
        },
      });

      expect(aluno.nome).toBe('Maior Com Responsável');
      expect(aluno.cpf).toBe('52998224725');
    });

    it('cria aluno maior sem endereço (endereço opcional)', async () => {
      const aluno = await createAluno({
        contaId,
        nome: 'Maior Sem Endereco',
        cpf: '52998224725', // CPF válido
        dataNasc: new Date('2000-01-01'), // >= 18 anos
        // Sem endereço
      });

      expect(aluno.nome).toBe('Maior Sem Endereco');
    });
  });
});
