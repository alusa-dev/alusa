import { Prisma, PrismaClient, StatusMatricula, Status } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';

export const prisma = new PrismaClient();

export const TEST_CONTA_CPF = '12345678901';
export const TEST_ADMIN_EMAIL = 'primeiro@example.com';
export const TEST_ADMIN_PASSWORD = 'SenhaFort3!';

export async function registerAndLogin(page: Page) {
  await page.goto('/register');
  await page.fill('[data-testid="register-escolaNome"]', 'Escola Teste');
  await page.fill('[data-testid="register-cpfCnpj"]', TEST_CONTA_CPF);
  await page.fill('[data-testid="register-nome"]', 'Admin Teste');
  await page.fill('[data-testid="register-email"]', TEST_ADMIN_EMAIL);
  await page.fill('[data-testid="register-senha"]', TEST_ADMIN_PASSWORD);
  await page.click('[data-testid="register-submit"]');
  await page.waitForURL('**/dashboard');
}

export async function getContaId() {
  const conta = await prisma.conta.findFirst({ where: { cpfCnpj: TEST_CONTA_CPF }, select: { id: true } });
  if (!conta) throw new Error('Conta não encontrada');
  return conta.id;
}

export async function createAlunoWithMatriculaAndSubscription(params: {
  contaId: string;
  alunoNome?: string;
  statusMatricula?: StatusMatricula;
  asaasSubscriptionId?: string;
  dataNasc?: Date;
}) {
  const aluno = await prisma.aluno.create({
    data: {
      contaId: params.contaId,
      nome: params.alunoNome ?? `Aluno ${randomUUID()}`,
      dataNasc: params.dataNasc ?? new Date('2005-01-01T00:00:00.000Z'),
      status: Status.ATIVO,
    },
    select: { id: true, nome: true },
  });

  const matricula = await prisma.matricula.create({
    data: {
      alunoId: aluno.id,
      dataInicio: new Date(),
      dataFimContrato: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
      status: params.statusMatricula ?? StatusMatricula.ATIVA,
      taxaMatricula: new Prisma.Decimal('100.00'),
      asaasSubscriptionId: params.asaasSubscriptionId ?? null,
    },
    select: { id: true },
  });

  const contrato = await prisma.contrato.create({
    data: {
      matriculaId: matricula.id,
      arquivoPdfUrl: 'https://example.com/contrato.pdf',
      hashPdf: createHash('sha256').update(randomUUID()).digest('hex'),
    },
    select: { id: true },
  });

  const subscriptionId = params.asaasSubscriptionId ?? `sub-${randomUUID()}`;

  const subscription = await prisma.subscription.create({
    data: {
      contaId: params.contaId,
      contratoId: contrato.id,
      matriculaId: matricula.id,
      externalReference: `subscription:${randomUUID()}`,
      status: 'ACTIVE',
      asaasSubscriptionId: subscriptionId,
    },
    select: { id: true },
  });

  await prisma.matricula.update({
    where: { id: matricula.id },
    data: { asaasSubscriptionId: subscriptionId },
  });

  return { alunoId: aluno.id, alunoNome: aluno.nome, matriculaId: matricula.id, subscriptionId, subscriptionDbId: subscription.id };
}

export async function createResponsavelWithTwoAlunos(params: { contaId: string; customerId?: string }) {
  const responsavel = await prisma.responsavel.create({
    data: {
      contaId: params.contaId,
      nome: `Responsavel ${randomUUID()}`,
      cpf: String(Math.floor(Math.random() * 90000000000) + 10000000000),
      email: `${randomUUID()}@example.com`,
      telefone: '11999999999',
      financeiro: true,
      asaasCustomerId: params.customerId ?? `cust-${randomUUID()}`,
    },
    select: { id: true, asaasCustomerId: true },
  });

  const alunoA = await prisma.aluno.create({
    data: {
      contaId: params.contaId,
      nome: `Aluno A ${randomUUID()}`,
      dataNasc: new Date('2012-01-01T00:00:00.000Z'),
      status: Status.ATIVO,
    },
    select: { id: true, nome: true },
  });

  const alunoB = await prisma.aluno.create({
    data: {
      contaId: params.contaId,
      nome: `Aluno B ${randomUUID()}`,
      dataNasc: new Date('2013-01-01T00:00:00.000Z'),
      status: Status.ATIVO,
    },
    select: { id: true, nome: true },
  });

  await prisma.alunoResponsavel.createMany({
    data: [
      { alunoId: alunoA.id, responsavelId: responsavel.id, tipoVinculo: 'RESPONSAVEL' },
      { alunoId: alunoB.id, responsavelId: responsavel.id, tipoVinculo: 'RESPONSAVEL' },
    ],
  });

  const matriculaA = await prisma.matricula.create({
    data: {
      alunoId: alunoA.id,
      responsavelFinanceiroId: responsavel.id,
      dataInicio: new Date(),
      dataFimContrato: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
      status: StatusMatricula.ATIVA,
      taxaMatricula: new Prisma.Decimal('100.00'),
    },
    select: { id: true },
  });

  const matriculaB = await prisma.matricula.create({
    data: {
      alunoId: alunoB.id,
      responsavelFinanceiroId: responsavel.id,
      dataInicio: new Date(),
      dataFimContrato: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
      status: StatusMatricula.ATIVA,
      taxaMatricula: new Prisma.Decimal('100.00'),
    },
    select: { id: true },
  });

  return { responsavel, alunoA, alunoB, matriculaA, matriculaB };
}

export async function createTurmaWithMatricula(params: { contaId: string; capacidade?: number }) {
  const modalidade = await prisma.modalidade.create({
    data: {
      contaId: params.contaId,
      nome: `Modalidade ${randomUUID()}`,
      status: 'ATIVO',
    },
    select: { id: true },
  });

  const sala = await prisma.sala.create({
    data: {
      contaId: params.contaId,
      nome: `Sala ${randomUUID()}`,
      capacidade: params.capacidade ?? 1,
      status: 'ATIVO',
    },
    select: { id: true },
  });

  const turma = await prisma.turma.create({
    data: {
      contaId: params.contaId,
      nome: `Turma ${randomUUID()}`,
      modalidadeId: modalidade.id,
      salaId: sala.id,
      diasSemana: ['SEG', 'QUA'],
      horaInicio: '08:00',
      horaFim: '09:00',
      capacidade: params.capacidade ?? 1,
      status: 'ATIVO',
    },
    select: { id: true },
  });

  const aluno = await prisma.aluno.create({
    data: {
      contaId: params.contaId,
      nome: `Aluno ${randomUUID()}`,
      dataNasc: new Date('2008-01-01T00:00:00.000Z'),
      status: Status.ATIVO,
    },
    select: { id: true },
  });

  const matricula = await prisma.matricula.create({
    data: {
      alunoId: aluno.id,
      turmaId: turma.id,
      dataInicio: new Date(),
      dataFimContrato: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
      status: StatusMatricula.ATIVA,
      taxaMatricula: new Prisma.Decimal('100.00'),
    },
    select: { id: true },
  });

  return { turma, aluno, matricula };
}

export async function createWebhookAuthToken(params: { contaId: string; token: string }) {
  const financeProfile = await prisma.financeProfile.upsert({
    where: { contaId: params.contaId },
    update: {},
    create: { contaId: params.contaId },
    select: { id: true },
  });

  const tokenHash = createHash('sha256').update(params.token).digest('hex');

  await prisma.asaasAccount.create({
    data: {
      financeProfileId: financeProfile.id,
      webhookAuthTokenHash: tokenHash,
    },
  });
}
