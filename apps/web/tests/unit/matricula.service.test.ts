import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { FormaPagamento, PeriodicidadePlano, Status } from '@prisma/client';
import { prisma } from '@/src/prisma';

process.env.NEXTAUTH_SECRET ??= 'test-secret-32-bytes-sign-key-alusa!';

import {
  calcularPrecoMatricula,
  criarMatricula,
  listarMatriculas,
} from '@/src/server/matriculas/matricula.service';

// Serviço oficial para criar conta com owner atendendo ao schema
import { createFirstUser } from '@/lib/first-user-service';

describe('serviço de matrícula', () => {
  describe('calcularPrecoMatricula', () => {
    it('aplica desconto fixo', () => {
      const r = calcularPrecoMatricula({
        planoValor: 200,
        taxaMatricula: 0,
        descontos: [{ tipo: 'FIXO', valor: 50 }],
      });
      expect(r.plano).toBe(200);
      expect(r.descontosAplicados).toEqual([50]);
      expect(r.total).toBe(150);
    });

    it('aplica desconto percentual', () => {
      const r = calcularPrecoMatricula({
        planoValor: 300,
        taxaMatricula: 0,
        descontos: [{ tipo: 'PERCENTUAL', valor: 10 }],
      });
      expect(r.descontosAplicados[0]).toBe(30);
      expect(r.total).toBe(270);
    });

    it('múltiplos cumulativos', () => {
      const r = calcularPrecoMatricula({
        planoValor: 300,
        taxaMatricula: 20,
        descontos: [
          { tipo: 'PERCENTUAL', valor: 10, cumulativo: true }, // 30
          { tipo: 'FIXO', valor: 25, cumulativo: true }, // 25
        ],
      });
      expect(r.descontosAplicados).toEqual([30, 25]);
      expect(r.total).toBe(300 - 30 - 25 + 20);
    });

    it('múltiplos não cumulativos aplica o maior', () => {
      const r = calcularPrecoMatricula({
        planoValor: 400,
        descontos: [
          { tipo: 'PERCENTUAL', valor: 10 }, // 40
          { tipo: 'FIXO', valor: 60 }, // 60 => maior
        ],
      });
      expect(r.descontosAplicados).toEqual([60]);
      expect(r.total).toBe(340);
    });
  });

  const hasDb = !!process.env.DATABASE_URL;
  (hasDb ? describe : describe.skip)('integração com Prisma', () => {
    let contaId: string;
    let alunoId: string;
    let turmaId: string;
    let planoId: string;
    let ownerId: string;
    let responsavelId: string;

    async function ensureData() {
      // Garante a existência de uma conta com owner usando o fluxo oficial
      const base = {
        escolaNome: 'Conta Test',
        cpfCnpj: '00000000000191',
        nome: 'Owner Matricula',
        email: 'owner+matricula.test@example.com',
        birthDate: '1990-01-01',
        senha: 'SenhaFort3!',
      };
      // Se já existir, ignora erro de duplicidade (teste pode rodar mais de uma vez)
      try {
        await createFirstUser(base);
      } catch {
        /* noop */
      }

      const conta = await prisma.conta.findFirstOrThrow({ where: { cpfCnpj: '00000000000191' } });
      const owner = await prisma.usuario.findFirstOrThrow({ where: { contaId: conta.id } });

      // Modalidade & Sala compatíveis com novo modelo
      const modalidade = await prisma.modalidade.upsert({
        where: { id: 'mod-matricula-test' },
        update: { nome: 'Modalidade Teste', status: 'ATIVO', contaId: conta.id },
        create: {
          id: 'mod-matricula-test',
          contaId: conta.id,
          nome: 'Modalidade Teste',
          status: 'ATIVO',
        },
      });
      const sala = await prisma.sala.upsert({
        where: { id: 'sala-matricula-test' },
        update: { nome: 'Sala M1', status: Status.ATIVO, contaId: conta.id, capacidade: 15 },
        create: {
          id: 'sala-matricula-test',
          contaId: conta.id,
          nome: 'Sala M1',
          status: Status.ATIVO,
          capacidade: 15,
        },
      });

      const turma = await prisma.turma.upsert({
        where: { id: 'turma-test' },
        update: {
          contaId: conta.id,
          nome: 'Turma Teste',
          modalidadeId: modalidade.id,
          salaId: sala.id,
          diasSemana: ['SEG'],
          horaInicio: '09:00',
          horaFim: '10:00',
          status: Status.ATIVO,
          capacidade: 20,
        },
        create: {
          id: 'turma-test',
          contaId: conta.id,
          nome: 'Turma Teste',
          modalidadeId: modalidade.id,
          salaId: sala.id,
          diasSemana: ['SEG'],
          horaInicio: '09:00',
          horaFim: '10:00',
          status: Status.ATIVO,
          capacidade: 20,
        },
      });

      // Plano
      const plano = await prisma.plano.upsert({
        where: { id: 'plano-test' },
        update: {
          contaId: conta.id,
          nome: 'Plano Teste',
          descricao: 'Plano para testes',
          periodicidade: PeriodicidadePlano.MENSAL,
          valor: '123.45',
        },
        create: {
          id: 'plano-test',
          contaId: conta.id,
          nome: 'Plano Teste',
          descricao: 'Plano para testes',
          periodicidade: PeriodicidadePlano.MENSAL,
          valor: '123.45',
        },
      } as unknown as Parameters<typeof prisma.plano.upsert>[0]);

      // Aluno
      const uniqueEmail = `aluno.test+${Date.now()}@example.com`;
      const aluno = await prisma.aluno.create({
        data: {
          contaId: conta.id,
          nome: 'Aluno Teste',
          dataNasc: new Date('2000-01-01'),
          email: uniqueEmail,
          status: 'ATIVO',
        },
      });

      const responsavel = await prisma.responsavel.upsert({
        where: { contaId_cpf: { contaId: conta.id, cpf: '00000000000' } },
        update: {
          nome: 'Responsável Teste',
          email: 'responsavel.matricula.test@example.com',
          telefone: '11999999999',
          financeiro: true,
        },
        create: {
          id: 'resp-matricula-test',
          contaId: conta.id,
          nome: 'Responsável Teste',
          cpf: '00000000000',
          email: 'responsavel.matricula.test@example.com',
          telefone: '11999999999',
          financeiro: true,
        },
      });

      const vinculo = await prisma.alunoResponsavel.findFirst({
        where: { alunoId: aluno.id, responsavelId: responsavel.id },
        select: { id: true },
      });
      if (!vinculo) {
        await prisma.alunoResponsavel.create({
          data: {
            alunoId: aluno.id,
            responsavelId: responsavel.id,
            tipoVinculo: 'RESPONSAVEL_FINANCEIRO',
          },
        });
      }

      return { conta, aluno, turma, plano, owner, responsavel };
    }

    beforeAll(async () => {
      const { conta, aluno, turma, plano, owner, responsavel } = await ensureData();
      contaId = conta.id;
      alunoId = aluno.id;
      turmaId = turma.id;
      planoId = plano.id;
      ownerId = owner.id;
      responsavelId = responsavel.id;
    });

    afterEach(async () => {
      if (!alunoId) return;
      await prisma.cobranca.deleteMany({ where: { matricula: { alunoId } } });
      await prisma.matricula.deleteMany({ where: { alunoId } });
    });

    it('criarMatricula mantém taxa pendente sem gerar cobrança imediata por padrão', async () => {
      const dataInicio = new Date();
      const dataFimContrato = new Date(dataInicio);
      dataFimContrato.setMonth(dataFimContrato.getMonth() + 12);

      const { matricula, cobrancas, preco, primeiroVencimento } =
        await criarMatricula({
          contaId,
          alunoId,
          responsavelFinanceiroId: responsavelId,
          turmaId,
          planoId,
          taxaMatricula: 15,
          taxaIsenta: false,
          formaPagamento: FormaPagamento.BOLETO,
          criarCobranca: true,
          gerarCobrancaTaxa: false,
          pagarTaxaAgora: false,
          dataInicio,
          dataFimContrato,
          vencimentoDia: 5,
          createdById: ownerId,
        });
      const m = matricula as { id: string; taxaStatus?: string };
      expect(m.id).toBeTruthy();
      expect(cobrancas.taxa).toBeNull();
      expect(preco.total).toBeGreaterThan(0);
      expect(primeiroVencimento instanceof Date).toBe(true);
    });

    it('criarMatricula gera cobrança da taxa quando explicitamente habilitado', async () => {
      const dataInicio = new Date();
      const dataFimContrato = new Date(dataInicio);
      dataFimContrato.setMonth(dataFimContrato.getMonth() + 12);

      const { cobrancas } = await criarMatricula({
        contaId,
        alunoId,
        responsavelFinanceiroId: responsavelId,
        turmaId,
        planoId,
        taxaMatricula: 15,
        taxaIsenta: false,
        formaPagamento: FormaPagamento.CARTAO_CREDITO,
        criarCobranca: true,
        gerarCobrancaTaxa: true,
        pagarTaxaAgora: true,
        dataInicio,
        dataFimContrato,
        vencimentoDia: 5,
        createdById: ownerId,
      });

      const taxa = cobrancas.taxa as { id: string; status: string } | null;
      expect(taxa?.id).toBeTruthy();
      expect(taxa?.status).toBe('PENDENTE');
    });

    it('criarMatricula exige responsável financeiro para aluno menor de idade', async () => {
      const dataInicio = new Date();
      const dataFimContrato = new Date(dataInicio);
      dataFimContrato.setMonth(dataFimContrato.getMonth() + 12);

      // Create minor student
      const minorEmail = `aluno.minor+${Date.now()}@example.com`;
      const minor = await prisma.aluno.create({
        data: {
          contaId,
          nome: 'Aluno Menor',
          dataNasc: new Date('2015-01-01'), // 10 years old
          email: minorEmail,
          status: 'ATIVO',
        },
      });

      await expect(
        criarMatricula({
          contaId,
          alunoId: minor.id,
          turmaId,
          planoId,
          taxaMatricula: 15,
          taxaIsenta: false,
          formaPagamento: FormaPagamento.BOLETO,
          criarCobranca: true,
          gerarCobrancaTaxa: false,
          pagarTaxaAgora: false,
          dataInicio,
          dataFimContrato,
          vencimentoDia: 5,
          createdById: ownerId,
        })
      ).rejects.toThrow('Responsável financeiro é obrigatório para alunos menores de 18 anos.');
    });

    it('listarMatriculas retorna matrículas do aluno', async () => {
      const dataInicio = new Date();
      const dataFimContrato = new Date(dataInicio);
      dataFimContrato.setMonth(dataFimContrato.getMonth() + 12);

      await criarMatricula({
        contaId,
        alunoId,
        turmaId,
        planoId,
        taxaMatricula: 0,
        taxaIsenta: true,
        formaPagamento: FormaPagamento.PIX,
        criarCobranca: false,
        gerarCobrancaTaxa: false,
        pagarTaxaAgora: false,
        dataInicio,
        dataFimContrato,
        vencimentoDia: 10,
        createdById: ownerId,
      });

      const { data: list } = await listarMatriculas({ contaId, alunoId, page: 1, pageSize: 50 });
      const typed = list as Array<{
        turma?: { nome: string };
        plano?: { nome?: string | null } | null;
        cobrancas: Array<{ valor: unknown; status: string }>;
      }>;
      expect(Array.isArray(typed)).toBe(true);
      expect(typed.length).toBeGreaterThan(0);
      // conferir shape mínimo
      const m = typed[0];
      expect(m.turma?.nome).toBeTruthy();
      expect(m.plano?.nome).toBeTruthy();
      expect(Array.isArray(m.cobrancas)).toBe(true);
    });
  });
});
