import { test, expect } from '@playwright/test';
import { FormaPagamento, Prisma, StatusCobranca } from '@prisma/client';
import { randomUUID } from 'crypto';

import { resetDb } from '../utils/reset-db';
import {
  prisma,
  registerAndLogin,
  getContaId,
  TEST_ADMIN_EMAIL,
  createResponsavelWithTwoAlunos,
} from '../utils/fixtures';

import { criarMatricula } from '../../../src/server/matriculas/matricula.service';
import { applyMatriculaTimeoutJob } from '../../../../../packages/finance/dist/jobs/apply-matricula-timeout.js';
import { changePayer, retryPayerChange } from '../../../../../packages/finance/dist/use-cases/changePayer.js';

test.describe.serial('Financeiro PR2-PR4 (Playwright)', () => {
  test.beforeEach(async ({ page }) => {
    await resetDb();
    await registerAndLogin(page);
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('cria matrícula com cobrança e BillingMode padrão', async () => {
    const contaId = await getContaId();
    const usuario = await prisma.usuario.findUnique({
      where: { email: TEST_ADMIN_EMAIL },
      select: { id: true },
    });
    if (!usuario) throw new Error('Usuário não encontrado');

    const { turmaId, planoId } = await createTurmaEPlano(contaId);
    const { alunoId, responsavelId } = await createAlunoComResponsavel(contaId);

    const result = await criarMatricula({
      contaId,
      alunoId,
      planoId,
      turmaId,
      dataInicio: new Date(),
      dataFimContrato: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
      vencimentoDia: 5,
      taxaMatricula: 0,
      taxaIsenta: true,
      pagarTaxaAgora: false,
      gerarCobrancaTaxa: false,
      criarCobranca: true,
      formaPagamento: FormaPagamento.BOLETO,
      createdById: usuario.id,
      responsavelFinanceiroId: responsavelId,
    });

    expect(result.cobrancas.mensalidade).not.toBeNull();

    const matricula = await prisma.matricula.findUnique({
      where: { id: result.matricula.id },
      select: { billingMode: true },
    });
    expect(matricula?.billingMode).toBe('INDIVIDUAL');

    const cobrancas = await prisma.cobranca.count({
      where: { matriculaId: result.matricula.id, tipo: 'MENSALIDADE' },
    });
    expect(cobrancas).toBe(1);
  });

  test('troca de pagador sem duplicar cobrança e audita', async () => {
    const contaId = await getContaId();
    const { alunoA, matriculaA } = await createResponsavelWithTwoAlunos({ contaId });
    const newResponsavel = await prisma.responsavel.create({
      data: {
        contaId,
        nome: `Responsavel Novo ${randomUUID()}`,
        cpf: String(Math.floor(Math.random() * 90000000000) + 10000000000),
        email: `${randomUUID()}@example.com`,
        telefone: '11999999999',
        financeiro: true,
      },
      select: { id: true, nome: true },
    });

    await prisma.alunoResponsavel.create({
      data: { alunoId: alunoA.id, responsavelId: newResponsavel.id, tipoVinculo: 'RESPONSAVEL' },
    });

    await prisma.cobranca.create({
      data: {
        matriculaId: matriculaA.id,
        tipo: 'MENSALIDADE',
        descricao: 'Mensalidade',
        competenciaInicio: new Date(),
        competenciaFim: new Date(),
        valor: new Prisma.Decimal('120.00'),
        vencimento: new Date(Date.now() + 1000 * 60 * 60 * 24 * 10),
        formaPagamento: FormaPagamento.BOLETO,
        status: StatusCobranca.A_VENCER,
      },
    });

    const beforeCount = await prisma.cobranca.count({ where: { matriculaId: matriculaA.id } });

    const result = await changePayer({
      contaId,
      matriculaId: matriculaA.id,
      newResponsavelId: newResponsavel.id,
      actor: { type: 'USER', id: 'tester' },
      idempotencyKey: 'change-payer-1',
    });

    expect(result.success).toBe(true);

    const afterCount = await prisma.cobranca.count({ where: { matriculaId: matriculaA.id } });
    expect(afterCount).toBe(beforeCount);

    const updated = await prisma.matricula.findUnique({
      where: { id: matriculaA.id },
      select: { responsavelFinanceiroId: true },
    });
    expect(updated?.responsavelFinanceiroId).toBe(newResponsavel.id);

    const audit = await prisma.auditLog.findFirst({
      where: {
        contaId,
        action: 'payer.change.committed',
        entityId: matriculaA.id,
      },
      select: { id: true },
    });
    expect(audit).not.toBeNull();
  });

  test('idempotência na troca de pagador (mesma idempotencyKey)', async () => {
    const contaId = await getContaId();
    const { alunoA, matriculaA } = await createResponsavelWithTwoAlunos({ contaId });

    const novoResponsavel = await prisma.responsavel.create({
      data: {
        contaId,
        nome: `Responsavel Novo ${randomUUID()}`,
        cpf: String(Math.floor(Math.random() * 90000000000) + 10000000000),
        email: `${randomUUID()}@example.com`,
        telefone: '11999999999',
        financeiro: true,
      },
      select: { id: true },
    });

    await prisma.alunoResponsavel.create({
      data: { alunoId: alunoA.id, responsavelId: novoResponsavel.id, tipoVinculo: 'RESPONSAVEL' },
    });

    const first = await changePayer({
      contaId,
      matriculaId: matriculaA.id,
      newResponsavelId: novoResponsavel.id,
      actor: { type: 'USER', id: 'tester' },
      idempotencyKey: 'change-payer-2',
    });

    expect(first.success).toBe(true);

    const second = await changePayer({
      contaId,
      matriculaId: matriculaA.id,
      newResponsavelId: novoResponsavel.id,
      actor: { type: 'USER', id: 'tester' },
      idempotencyKey: 'change-payer-2',
    });

    expect(second.success).toBe(true);

    const ops = await prisma.payerChangeOperacao.count({
      where: { matriculaId: matriculaA.id, idempotencyKey: 'change-payer-2' },
    });
    expect(ops).toBe(1);
  });

  test('timeout aplica cancelamento e é idempotente', async () => {
    const contaId = await getContaId();
    const aluno = await prisma.aluno.create({
      data: {
        contaId,
        nome: `Aluno ${randomUUID()}`,
        dataNasc: new Date('2010-01-01T00:00:00.000Z'),
        status: 'ATIVO',
      },
      select: { id: true },
    });

    const matricula = await prisma.matricula.create({
      data: {
        alunoId: aluno.id,
        dataInicio: new Date('2024-01-01T00:00:00.000Z'),
        dataFimContrato: new Date('2025-01-01T00:00:00.000Z'),
        status: 'PENDENTE_TAXA',
        taxaMatricula: new Prisma.Decimal('100.00'),
        vencimentoDia: 5,
      },
      select: { id: true },
    });

    const oldDate = new Date(Date.now() - 1000 * 60 * 60 * 24 * 45);
    await prisma.matricula.update({
      where: { id: matricula.id },
      data: { createdAt: oldDate },
    });

    const result = await applyMatriculaTimeoutJob({ timeoutDays: 30 });
    expect(result.canceladas).toBe(1);

    const updated = await prisma.matricula.findUnique({
      where: { id: matricula.id },
      select: { status: true, timeoutAppliedAt: true },
    });
    expect(updated?.status).toBe('CANCELADA');
    expect(updated?.timeoutAppliedAt).not.toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: {
        contaId,
        action: 'matricula.timeout.applied',
        entityId: matricula.id,
      },
      select: { id: true },
    });
    expect(audit).not.toBeNull();

    const secondRun = await applyMatriculaTimeoutJob({ timeoutDays: 30 });
    expect(secondRun.canceladas).toBe(0);

    const auditCount = await prisma.auditLog.count({
      where: {
        contaId,
        action: 'matricula.timeout.applied',
        entityId: matricula.id,
      },
    });
    expect(auditCount).toBe(1);
  });

  test('bloqueia cobrança para aluno dependente sem responsável financeiro', async () => {
    const contaId = await getContaId();
    const usuario = await prisma.usuario.findUnique({
      where: { email: TEST_ADMIN_EMAIL },
      select: { id: true },
    });
    if (!usuario) throw new Error('Usuário não encontrado');

    const { turmaId, planoId } = await createTurmaEPlano(contaId);
    const aluno = await prisma.aluno.create({
      data: {
        contaId,
        nome: `Aluno Menor ${randomUUID()}`,
        dataNasc: new Date('2015-01-01T00:00:00.000Z'),
        status: 'ATIVO',
      },
      select: { id: true },
    });

    await expect(async () => {
      await criarMatricula({
        contaId,
        alunoId: aluno.id,
        planoId,
        turmaId,
        dataInicio: new Date(),
        dataFimContrato: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
        vencimentoDia: 5,
        taxaMatricula: 0,
        taxaIsenta: true,
        pagarTaxaAgora: false,
        gerarCobrancaTaxa: false,
        criarCobranca: true,
        formaPagamento: FormaPagamento.BOLETO,
        createdById: usuario.id,
        responsavelFinanceiroId: null,
      });
    }).rejects.toThrow('Responsável financeiro é obrigatório para alunos menores de 18 anos.');

    const matriculas = await prisma.matricula.count({ where: { alunoId: aluno.id } });
    expect(matriculas).toBe(0);
  });

  test('falha parcial e reprocessa troca de pagador', async () => {
    const contaId = await getContaId();
    const { alunoA, matriculaA } = await createResponsavelWithTwoAlunos({ contaId });

    const novoResponsavel = await prisma.responsavel.create({
      data: {
        contaId,
        nome: `Responsavel Novo ${randomUUID()}`,
        cpf: String(Math.floor(Math.random() * 90000000000) + 10000000000),
        email: `${randomUUID()}@example.com`,
        telefone: '11999999999',
        financeiro: true,
      },
      select: { id: true },
    });

    await prisma.alunoResponsavel.create({
      data: { alunoId: alunoA.id, responsavelId: novoResponsavel.id, tipoVinculo: 'RESPONSAVEL' },
    });

    const prevMock = process.env.PAYMENTS_PROVIDER_MODE;
    const prevPlaywright = process.env.PLAYWRIGHT_TEST;
    const prevNodeEnv = process.env.NODE_ENV;

    // Cast para evitar erro TS de read-only (é mutável em runtime)
    const mutableEnv = process.env as Record<string, string | undefined>;
    mutableEnv.PAYMENTS_PROVIDER_MODE = 'real';
    mutableEnv.PLAYWRIGHT_TEST = 'false';
    mutableEnv.NODE_ENV = 'development';

    const failed = await changePayer({
      contaId,
      matriculaId: matriculaA.id,
      newResponsavelId: novoResponsavel.id,
      actor: { type: 'USER', id: 'tester' },
      idempotencyKey: 'change-payer-failure',
    });

    expect(failed.success).toBe(false);

    const operacao = await prisma.payerChangeOperacao.findFirst({
      where: { matriculaId: matriculaA.id, status: 'FAILED' },
      select: { id: true },
    });
    if (!operacao) throw new Error('Operação não encontrada');

    mutableEnv.PAYMENTS_PROVIDER_MODE = 'mock';
    mutableEnv.PLAYWRIGHT_TEST = 'true';

    const retried = await retryPayerChange(operacao.id, { type: 'USER', id: 'tester' });
    expect(retried.success).toBe(true);

    const updated = await prisma.matricula.findUnique({
      where: { id: matriculaA.id },
      select: { responsavelFinanceiroId: true },
    });
    expect(updated?.responsavelFinanceiroId).toBe(novoResponsavel.id);

    const retryAudit = await prisma.auditLog.findFirst({
      where: { contaId, action: 'payer.change.retry', entityId: matriculaA.id },
      select: { id: true },
    });
    expect(retryAudit).not.toBeNull();

    // Restaurar env vars
    if (prevMock === undefined) delete mutableEnv.PAYMENTS_PROVIDER_MODE;
    else mutableEnv.PAYMENTS_PROVIDER_MODE = prevMock;

    if (prevPlaywright === undefined) delete mutableEnv.PLAYWRIGHT_TEST;
    else mutableEnv.PLAYWRIGHT_TEST = prevPlaywright;

    if (prevNodeEnv === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = prevNodeEnv;
  });
});

async function createTurmaEPlano(contaId: string) {
  const modalidade = await prisma.modalidade.create({
    data: {
      contaId,
      nome: `Modalidade ${randomUUID()}`,
      status: 'ATIVO',
    },
    select: { id: true },
  });

  const sala = await prisma.sala.create({
    data: {
      contaId,
      nome: `Sala ${randomUUID()}`,
      capacidade: 20,
      status: 'ATIVO',
    },
    select: { id: true },
  });

  const turma = await prisma.turma.create({
    data: {
      contaId,
      nome: `Turma ${randomUUID()}`,
      modalidadeId: modalidade.id,
      salaId: sala.id,
      diasSemana: ['SEG', 'QUA'],
      horaInicio: '08:00',
      horaFim: '09:00',
      capacidade: 20,
      status: 'ATIVO',
    },
    select: { id: true },
  });

  const plano = await prisma.plano.create({
    data: {
      contaId,
      nome: `Plano ${randomUUID()}`,
      valor: new Prisma.Decimal('300.00'),
      periodicidade: 'MENSAL',
      status: 'ATIVO',
    },
    select: { id: true },
  });

  return { turmaId: turma.id, planoId: plano.id };
}

async function createAlunoComResponsavel(contaId: string) {
  const responsavel = await prisma.responsavel.create({
    data: {
      contaId,
      nome: `Responsavel ${randomUUID()}`,
      cpf: String(Math.floor(Math.random() * 90000000000) + 10000000000),
      email: `${randomUUID()}@example.com`,
      telefone: '11999999999',
      financeiro: true,
    },
    select: { id: true },
  });

  const aluno = await prisma.aluno.create({
    data: {
      contaId,
      nome: `Aluno ${randomUUID()}`,
      dataNasc: new Date('2014-01-01T00:00:00.000Z'),
      status: 'ATIVO',
    },
    select: { id: true },
  });

  await prisma.alunoResponsavel.create({
    data: { alunoId: aluno.id, responsavelId: responsavel.id, tipoVinculo: 'RESPONSAVEL' },
  });

  return { alunoId: aluno.id, responsavelId: responsavel.id };
}
