import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { create, list, update, findExactColaboradorCreateRetry, ColaboradorIdentityConflictError } from './colaborador-service';

const prisma = new PrismaClient();

describe('Colaborador Service', () => {
  const contaId = 'conta-default';
  const cpf = '390.533.447-05';
  const email = 'maria.teste@example.com';
  const digits = (v?: string | null) => (typeof v === 'string' ? v.replace(/\D/g, '') : v ?? undefined);

  beforeAll(async () => {
    // A Conta precisa existir antes do usuário por causa da FK Usuario_contaId.
    await prisma.conta.upsert({
      where: { id: contaId },
      update: {},
      create: { id: contaId, nome: 'Conta Teste', cpfCnpj: '99999999999999' },
    });

    const owner = await prisma.usuario.upsert({
      where: { email: 'owner+colab.test@example.com' },
      update: {},
      create: { id: 'owner-colab-test', contaId, nome: 'Owner Colab', email: 'owner+colab.test@example.com', senhaHash: 'x', role: 'ADMIN', status: 'ATIVO' }
    });
    await prisma.conta.update({
      where: { id: contaId },
      data: { ownerUserId: owner.id, nome: 'Conta Teste' },
    });
    // Cleanup defensivo em execuções repetidas
  await prisma.colaborador.deleteMany({ where: { OR: [ { cpf: digits(cpf) }, { email } ] } } as unknown as Parameters<typeof prisma.colaborador.deleteMany>[0]);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('sincronização idempotente com Professor', () => {
    const schoolA = 'colab-professor-contract-a';
    const schoolB = 'colab-professor-contract-b';
    const employeeIds = ['colab-professor-duplicate', 'colab-professor-mismatch', 'colab-professor-missing', 'colab-professor-cross-tenant', 'colab-retry-identity-a', 'colab-retry-identity-b', 'colab-professor-inactive-create', 'colab-professor-inactive-update'];
    const professorIds = ['professor-match-existing', 'professor-match-cpf', 'professor-match-email', 'professor-match-tenant-b'];
    const employeeEmails = ['professor-match@example.test', 'professor-email-owner@example.test', 'sem-cpf-professor@example.test', 'professor-cross-tenant@example.test', 'retry-a@example.test', 'retry-b@example.test', 'professor-inactive-create@example.test', 'professor-inactive-update@example.test'];
    const employeeCpfs = ['52998224725', '52998224725', '11144477735', '39053344705', '11144477735', '12345678909', '98765432100'];
    const professorEmails = [
      'professor-match@example.test', 'professor-cpf-owner@example.test',
      'professor-email-owner@example.test', 'professor-cross-tenant@example.test',
    ];

    async function cleanupProfessorFixtures() {
      await prisma.colaborador.deleteMany({
        where: {
          contaId: { in: [schoolA, schoolB] },
          OR: [
            { id: { in: employeeIds } },
            { email: { in: employeeEmails } },
            { cpf: { in: employeeCpfs } },
          ],
        },
      });
      await prisma.professor.deleteMany({
        where: {
          contaId: { in: [schoolA, schoolB] },
          OR: [
            { id: { in: professorIds } },
            { email: { in: professorEmails, mode: 'insensitive' } },
            { cpf: { in: employeeCpfs } },
          ],
        },
      });
    }

    beforeAll(async () => {
      await Promise.all([
        prisma.conta.upsert({ where: { id: schoolA }, update: { status: 'ATIVO' }, create: { id: schoolA, nome: 'Escola Professor A', status: 'ATIVO' } }),
        prisma.conta.upsert({ where: { id: schoolB }, update: { status: 'ATIVO' }, create: { id: schoolB, nome: 'Escola Professor B', status: 'ATIVO' } }),
      ]);
      await cleanupProfessorFixtures();
    });

    beforeEach(async () => cleanupProfessorFixtures());
    afterEach(async () => cleanupProfessorFixtures());

    it('reconhece por CPF/e-mail normalizados e não cria Professor duplicado', async () => {
      await prisma.professor.create({
        data: {
          id: professorIds[0], contaId: schoolA, nome: 'Ana Professora', cpf: '52998224725',
          email: professorEmails[0].toUpperCase(), dataNasc: new Date('1990-01-01T00:00:00.000Z'), telefoneCel: '11999999999',
        },
      });

      const created = await create({
        id: employeeIds[0], contaId: schoolA, nome: 'Ana Souza', cpf: '529.982.247-25',
        cargo: 'PROFESSOR', status: 'ATIVO', email: professorEmails[0],
        dataNasc: new Date('1990-01-01T00:00:00.000Z'), telefone1: '(11) 99999-9999', enderecoCep: '12345-678',
      } as unknown as Parameters<typeof create>[0]);

      expect(created.id).toBeTruthy();
      await expect(prisma.professor.count({ where: { contaId: schoolA, cpf: '52998224725' } })).resolves.toBe(1);
    });

    it('falha explicitamente quando CPF e e-mail apontam para Professores diferentes', async () => {
      await Promise.all([
        prisma.professor.create({ data: { id: professorIds[1], contaId: schoolA, nome: 'Pessoa CPF', cpf: '52998224725', email: professorEmails[1], dataNasc: new Date('1990-01-01T00:00:00.000Z'), telefoneCel: '11999999991' } }),
        prisma.professor.create({ data: { id: professorIds[2], contaId: schoolA, nome: 'Pessoa email', cpf: '11144477735', email: professorEmails[2], dataNasc: new Date('1990-01-01T00:00:00.000Z'), telefoneCel: '11999999992' } }),
      ]);

      await expect(create({
        id: employeeIds[1], contaId: schoolA, nome: 'Cadastro conflitante', cpf: '52998224725',
        cargo: 'PROFESSOR', status: 'ATIVO', email: professorEmails[2],
        dataNasc: new Date('1990-01-01T00:00:00.000Z'), telefone1: '11999999999', enderecoCep: '12345-678',
      } as unknown as Parameters<typeof create>[0])).rejects.toThrow(/CPF e e-mail correspondem a cadastros diferentes/);

      await expect(prisma.colaborador.count({
        where: { contaId: schoolA, OR: [{ cpf: '52998224725' }, { email: professorEmails[2] }] },
      })).resolves.toBe(0);
      await expect(prisma.professor.count({
        where: { contaId: schoolA, OR: [{ cpf: '52998224725' }, { email: professorEmails[2] }] },
      })).resolves.toBe(2);
    });

    it('não ignora dados mínimos ausentes para cargo Professor', async () => {
      await expect(create({
        id: employeeIds[2], contaId: schoolA, nome: 'Sem CPF', cargo: 'PROFESSOR', status: 'ATIVO',
        email: 'sem-cpf-professor@example.test', dataNasc: new Date('1990-01-01T00:00:00.000Z'),
        telefone1: '11999999999', enderecoCep: '12345-678',
      } as unknown as Parameters<typeof create>[0])).rejects.toThrow(/informe CPF, nascimento, e-mail e telefone/);
      await expect(prisma.colaborador.count({ where: { contaId: schoolA, email: 'sem-cpf-professor@example.test' } })).resolves.toBe(0);
      await expect(prisma.professor.count({ where: { contaId: schoolA, email: 'sem-cpf-professor@example.test' } })).resolves.toBe(0);
    });

    it('resolve identidade Professor dentro da própria Conta', async () => {
      await prisma.professor.create({
        data: {
          id: professorIds[3], contaId: schoolB, nome: 'Professor B', cpf: '11144477735',
          email: professorEmails[3], dataNasc: new Date('1990-01-01T00:00:00.000Z'), telefoneCel: '11999999993',
        },
      });

      await create({
        id: employeeIds[3], contaId: schoolA, nome: 'Professor A', cpf: '52998224725',
        cargo: 'PROFESSOR', status: 'ATIVO', email: professorEmails[3].toUpperCase(),
        dataNasc: new Date('1990-01-01T00:00:00.000Z'), telefone1: '11999999994', enderecoCep: '12345-678',
      } as unknown as Parameters<typeof create>[0]);

      await expect(prisma.professor.count({ where: { contaId: schoolA, email: { equals: professorEmails[3], mode: 'insensitive' } } })).resolves.toBe(1);
      await expect(prisma.professor.count({ where: { contaId: schoolB, email: professorEmails[3] } })).resolves.toBe(1);
    });

    it('recupera somente retry exato e rejeita CPF/e-mail que identificam registros diferentes', async () => {
      const date = new Date('1990-01-01T00:00:00.000Z');
      await prisma.colaborador.create({ data: {
        id: employeeIds[4], contaId: schoolA, nome: 'Retry A', nomeSocial: 'Ana', cpf: '39053344705', email: employeeEmails[4],
        foto: 'https://cdn.test/avatar-a.png', genero: 'FEMININO', cargo: 'RECEPCAO', status: 'ATIVO', dataNasc: date,
        telefone1: '11999990001', contatoEmergenciaTelefone: '11999990002', enderecoCep: '12345678', enderecoLogradouro: 'Rua A',
        enderecoNumero: '10', enderecoComplemento: 'Casa 2', enderecoBairro: 'Centro', enderecoCidade: 'Manaus', enderecoUf: 'AM',
        especialidade: 'Ballet', rg: 'RG-A', orgaoEmissor: 'SSP', dataEmissao: new Date('2010-01-01T00:00:00.000Z'),
        dataAdmissao: new Date('2020-02-01T00:00:00.000Z'), dataDesligamento: new Date('2022-02-01T00:00:00.000Z'),
        observacoes: 'Contrato original', salario: '4000.50', temAcesso: true,
      } });
      await prisma.colaborador.create({ data: {
        id: employeeIds[5], contaId: schoolA, nome: 'Retry B', cpf: '11144477735', email: employeeEmails[5],
        cargo: 'RECEPCAO', status: 'ATIVO', dataNasc: date, telefone1: '11999990002', enderecoCep: '12345678', temAcesso: true,
      } });

      await expect(findExactColaboradorCreateRetry({
        contaId: schoolA, nome: 'Retry A', nomeSocial: 'Ana', cpf: '390.533.447-05', email: employeeEmails[4], cargo: 'RECEPCAO', status: 'ATIVO',
        foto: 'https://cdn.test/avatar-a.png', genero: 'FEMININO', dataNasc: date, telefone1: '(11) 99999-0001',
        contatoEmergenciaTelefone: '(11) 99999-0002', enderecoCep: '12345-678', enderecoLogradouro: 'Rua A', enderecoNumero: '10',
        enderecoComplemento: 'Casa 2', enderecoBairro: 'Centro', enderecoCidade: 'Manaus', enderecoUf: 'AM', temAcesso: true,
        salario: 4000.5, especialidade: 'Ballet', rg: 'RG-A', orgaoEmissor: 'SSP', dataEmissao: new Date('2010-01-01T00:00:00.000Z'),
        dataAdmissao: new Date('2020-02-01T00:00:00.000Z'), dataDesligamento: new Date('2022-02-01T00:00:00.000Z'), observacoes: 'Contrato original',
      } as never)).resolves.toMatchObject({ id: employeeIds[4] });
      await expect(findExactColaboradorCreateRetry({
        contaId: schoolA, nome: 'Retry A', cpf: '39053344705', email: employeeEmails[5], cargo: 'RECEPCAO', status: 'ATIVO',
        dataNasc: date, telefone1: '11999990001', enderecoCep: '12345678', temAcesso: true,
      } as never)).rejects.toBeInstanceOf(ColaboradorIdentityConflictError);
      await expect(findExactColaboradorCreateRetry({
        contaId: schoolA, nome: 'Retry A', cpf: '39053344705', email: employeeEmails[4], cargo: 'RECEPCAO', status: 'ATIVO',
        dataNasc: date, telefone1: '11999990001', enderecoCep: '12345678', temAcesso: true,
        foto: 'https://cdn.test/avatar-a.png', salario: 5000, enderecoLogradouro: 'Rua A', enderecoNumero: '10', especialidade: 'Ballet', rg: 'RG-A',
        dataAdmissao: new Date('2020-02-01T00:00:00.000Z'), observacoes: 'Contrato original',
      } as never)).rejects.toBeInstanceOf(ColaboradorIdentityConflictError);
      await expect(findExactColaboradorCreateRetry({
        contaId: schoolA, nome: 'Retry A', cpf: '39053344705', email: employeeEmails[4], cargo: 'RECEPCAO', status: 'ATIVO',
        dataNasc: date, telefone1: '11999990001', enderecoCep: '12345678', temAcesso: true,
        foto: 'https://cdn.test/avatar-a.png', salario: 4000.5, enderecoLogradouro: 'Rua B', enderecoNumero: '10', especialidade: 'Ballet', rg: 'RG-A',
        dataAdmissao: new Date('2020-02-01T00:00:00.000Z'), observacoes: 'Contrato original',
      } as never)).rejects.toBeInstanceOf(ColaboradorIdentityConflictError);
      await expect(findExactColaboradorCreateRetry({
        contaId: schoolA, nome: 'Retry A', nomeSocial: 'Ana', cpf: '39053344705', email: employeeEmails[4], cargo: 'RECEPCAO', status: 'ATIVO',
        foto: 'https://cdn.test/avatar-b.png', genero: 'FEMININO', dataNasc: date, telefone1: '11999990001',
        contatoEmergenciaTelefone: '11999990002', enderecoCep: '12345678', enderecoLogradouro: 'Rua A', enderecoNumero: '10',
        enderecoComplemento: 'Casa 2', enderecoBairro: 'Centro', enderecoCidade: 'Manaus', enderecoUf: 'AM', temAcesso: true,
        salario: 4000.5, especialidade: 'Ballet', rg: 'RG-A', orgaoEmissor: 'SSP', dataEmissao: new Date('2010-01-01T00:00:00.000Z'),
        dataAdmissao: new Date('2020-02-01T00:00:00.000Z'), dataDesligamento: new Date('2022-02-01T00:00:00.000Z'), observacoes: 'Contrato original',
      } as never)).rejects.toBeInstanceOf(ColaboradorIdentityConflictError);
    });

    it('mantém Professor INATIVO ao criar ou inativar o colaborador vinculado', async () => {
      const shared = { contaId: schoolA, nome: 'Professor Inativo', cargo: 'PROFESSOR', status: 'INATIVO', dataNasc: new Date('1990-01-01T00:00:00.000Z'), telefone1: '11999991111', enderecoCep: '12345678' };
      await create({
        ...shared, id: employeeIds[6], cpf: '12345678909', email: employeeEmails[6],
      } as unknown as Parameters<typeof create>[0]);
      await expect(prisma.professor.findFirst({ where: { contaId: schoolA, cpf: '12345678909' }, select: { status: true } }))
        .resolves.toMatchObject({ status: 'INATIVO' });

      const activeEmployee = await create({
        ...shared, id: employeeIds[7], nome: 'Professor Reativável', status: 'ATIVO',
        cpf: '98765432100', email: employeeEmails[7],
      } as unknown as Parameters<typeof create>[0]);
      await update(activeEmployee.id, schoolA, { status: 'INATIVO' });
      await expect(prisma.professor.findFirst({ where: { contaId: schoolA, cpf: '98765432100' }, select: { status: true } }))
        .resolves.toMatchObject({ status: 'INATIVO' });
    });
  });

  it('cria e lista colaboradores', async () => {
    const created = await create({
      contaId,
      nome: 'Maria Teste',
      cpf,
      cargo: 'RECEPCAO',
      status: 'ATIVO',
      email,
    } as unknown as Parameters<typeof create>[0]);

    expect(created.nome).toBe('Maria Teste');

    const items = await list(contaId);
    expect(items.length).toBeGreaterThan(0);
    // Cleanup pós-validação para manter idempotência
  await prisma.colaborador.deleteMany({ where: { OR: [ { cpf: digits(cpf) }, { email } ] } } as unknown as Parameters<typeof prisma.colaborador.deleteMany>[0]);
  });
});
