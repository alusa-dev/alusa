import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { resetDb } from '../../utils/reset-db';
import { previewRenewalProcess } from '@/src/server/enrollments/renewal-process.service';

const routeMocks = vi.hoisted(() => ({
  prisma: null as unknown,
  resolveTenantSession: vi.fn(),
  assertPlatformAccessForConta: vi.fn(),
  guardFinancialAccountOr412: vi.fn(),
  logEnrollmentOperationalEvent: vi.fn(),
}));

vi.mock('@/src/prisma', () => ({ prisma: routeMocks.prisma }));
vi.mock('@/lib/api/with-tenant-session', () => ({ resolveTenantSession: routeMocks.resolveTenantSession }));
vi.mock('@/src/server/platform-billing/capacity', () => ({
  assertStudentCapacity: vi.fn().mockResolvedValue(undefined),
  assertPlatformAccessForConta: routeMocks.assertPlatformAccessForConta,
}));
vi.mock('@/lib/finance/financial-account-gate', () => ({ guardFinancialAccountOr412: routeMocks.guardFinancialAccountOr412 }));
vi.mock('@/lib/observability/api-logger', () => ({ logEnrollmentOperationalEvent: routeMocks.logEnrollmentOperationalEvent }));

const db = new PrismaClient();
routeMocks.prisma = db;
const { postRematriculasRoute } = await import('@/src/server/enrollments/renewal-http-route.service');

const hasDb = Boolean(process.env.DATABASE_URL?.startsWith('postgres'));
const describeIf = hasDb ? describe : describe.skip;

describeIf('campaign renewal with future contract materialization', () => {
  let contaId: string;
  let sourceEnrollmentId: string;
  let destinationClassId: string;
  let planId: string;
  let studentId: string;
  let contractModelId: string;
  let campaignId: string;

  beforeAll(async () => {
    await resetDb(db);
    const account = await db.conta.create({ data: { nome: 'Renewal contract regression', timezone: 'America/Manaus' } });
    contaId = account.id;
    routeMocks.resolveTenantSession.mockResolvedValue({ ok: true, contaId, userId: 'renewal-test-actor', role: 'ADMIN' });
    routeMocks.assertPlatformAccessForConta.mockResolvedValue(undefined);
    routeMocks.guardFinancialAccountOr412.mockResolvedValue({ ok: true });
    const modality = await db.modalidade.create({ data: { contaId, nome: 'Annual renewal course' } });
    const room = await db.sala.create({ data: { contaId, nome: 'Annual renewal room', capacidade: 20 } });
    const sourceClass = await db.turma.create({
      data: {
        contaId, nome: 'Source 2026 class', modalidadeId: modality.id, salaId: room.id,
        diasSemana: ['SEGUNDA'], horaInicio: '08:00', horaFim: '09:00', capacidade: 20,
      },
    });
    const destinationClass = await db.turma.create({
      data: {
        contaId, nome: 'Destination 2027 class', modalidadeId: modality.id, salaId: room.id,
        diasSemana: ['TERCA'], horaInicio: '08:00', horaFim: '09:00', capacidade: 20,
      },
    });
    destinationClassId = destinationClass.id;
    const plan = await db.plano.create({
      data: { contaId, nome: 'Renewal card plan', valor: new Prisma.Decimal('150.00'), periodicidade: 'MENSAL' },
    });
    planId = plan.id;
    const student = await db.aluno.create({
      data: {
        contaId, nome: 'Regression Student', dataNasc: new Date('2000-01-01T00:00:00.000Z'),
        email: 'adult-student@example.test', telefone: '92999999999',
        consentimentoComunicacoes: true,
        dataConsentimentoComunicacoes: new Date('2026-01-01T00:00:00.000Z'),
        versaoConsentimentoComunicacoes: '2026-09-05',
        origemConsentimentoComunicacoes: 'ALUNO_WIZARD',
      },
    });
    studentId = student.id;
    const source = await db.matricula.create({
      data: {
        contaId, alunoId: student.id,
        turmaId: sourceClass.id, planoId: planId, dataInicio: new Date('2026-10-10T00:00:00.000Z'),
        dataFimContrato: new Date('2026-12-31T00:00:00.000Z'),
        status: 'ATIVA', statusFinanceiro: 'INADIMPLENTE', statusContrato: 'AGUARDANDO_ASSINATURA',
        taxaMatricula: new Prisma.Decimal(80), taxaIsenta: false, taxaStatus: 'PENDENTE',
        formaPagamento: 'CARTAO_CREDITO', formaPagamentoTaxa: 'CARTAO_CREDITO',
        asaasSubscriptionId: 'renewal-contract-source-subscription',
      },
    });
    sourceEnrollmentId = source.id;
    await db.cobranca.createMany({
      data: [
        {
          contaId, matriculaId: source.id, tipo: 'MENSALIDADE', descricao: 'Overdue source charge',
          competenciaInicio: new Date('2026-08-01T00:00:00.000Z'), competenciaFim: new Date('2026-08-31T00:00:00.000Z'),
          valor: new Prisma.Decimal(150), vencimento: new Date('2026-08-05T00:00:00.000Z'),
          formaPagamento: 'CARTAO_CREDITO', status: 'ATRASADO', asaasPaymentId: 'renewal-contract-overdue-payment',
        },
        {
          contaId, matriculaId: source.id, tipo: 'MENSALIDADE', descricao: 'Upcoming source charge',
          competenciaInicio: new Date('2026-12-01T00:00:00.000Z'), competenciaFim: new Date('2026-12-31T00:00:00.000Z'),
          valor: new Prisma.Decimal(150), vencimento: new Date('2026-12-05T00:00:00.000Z'),
          formaPagamento: 'CARTAO_CREDITO', status: 'A_VENCER', asaasPaymentId: 'renewal-contract-upcoming-payment',
        },
      ],
    });
    await db.matriculaVinculoAcademico.create({
      data: { contaId, matriculaId: source.id, modalidadeId: modality.id, vigenciaIniciadaEm: source.dataInicio },
    });

    const model = await db.contratoModelo.create({
      data: {
        contaId, nome: 'Renewal regression contract', status: 'ATIVO', versao: 1,
        arquivoPdfUrl: 'https://example.invalid/renewal-contract.pdf', hashSha256: 'a'.repeat(64), tamanhoBytes: 5175,
      },
    });
    contractModelId = model.id;
    await db.contratoModeloCampo.createMany({
      data: [
        { contaId, modeloId: model.id, tipo: 'ASSINATURA', papel: 'ESCOLA', pagina: 1, x: 0.1, y: 0.1, largura: 0.2, altura: 0.05 },
        { contaId, modeloId: model.id, tipo: 'ASSINATURA', papel: 'RESPONSAVEL_OU_ALUNO', pagina: 1, x: 0.5, y: 0.1, largura: 0.2, altura: 0.05 },
      ],
    });
    const existingContract = await db.contrato.create({
      data: {
        contaId,
        matriculaId: source.id,
        modeloId: model.id,
        arquivoPdfUrl: model.arquivoPdfUrl,
        hashPdf: model.hashSha256,
        status: 'PENDENTE',
      },
    });
    await db.matricula.update({ where: { id: source.id }, data: { contratoAtualId: existingContract.id } });
    await db.subscription.create({
      data: {
        contaId,
        matriculaId: source.id,
        contratoId: existingContract.id,
        externalReference: 'renewal-contract-source-subscription-ref',
        status: 'ACTIVE',
        asaasSubscriptionId: 'renewal-contract-source-subscription',
      },
    });
    const campaign = await db.rematriculaCampanha.create({
      data: {
        contaId, targetPeriodId: '2027', nome: 'Annual renewal 2027',
        campaignStartsAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    campaignId = campaign.id;
    const decoyStudent = await db.aluno.create({
      data: { contaId, nome: 'Unrelated campaign participant', dataNasc: new Date('2000-01-01T00:00:00.000Z') },
    });
    const decoyEnrollment = await db.matricula.create({
      data: {
        contaId, alunoId: decoyStudent.id, turmaId: sourceClass.id, planoId: planId,
        dataInicio: new Date('2026-01-01T00:00:00.000Z'),
        dataFimContrato: new Date('2026-12-31T00:00:00.000Z'),
        status: 'ATIVA', statusFinanceiro: 'ADIMPLENTE', statusContrato: 'ATIVO',
        taxaMatricula: new Prisma.Decimal(0), taxaIsenta: true, taxaStatus: 'ISENTO',
      },
    });
    await db.rematriculaParticipante.create({
      data: {
        contaId, campanhaId: campaign.id, matriculaOrigemId: decoyEnrollment.id,
        alunoId: decoyStudent.id,
      },
    });
  }, 30_000);

  afterAll(async () => {
    await db.$disconnect();
  });

  it('blocks an inactive contract model configuration before creating any renewal rows', async () => {
    const invalidModel = await db.contratoModelo.create({
      data: {
        contaId, nome: 'Contract model missing required fields', status: 'ATIVO', versao: 2,
        arquivoPdfUrl: 'https://example.invalid/invalid-contract.pdf', hashSha256: 'b'.repeat(64),
      },
    });
    const input = {
      contaId,
      actorId: 'renewal-contract-test-actor',
      origin: 'CAMPAIGN' as const,
      campaignId,
      targetPeriodId: '2027',
      targetPeriodStartsAt: new Date('2027-01-01T00:00:00.000Z'),
      holderType: 'STUDENT' as const,
      holderId: studentId,
      contractModelId: invalidModel.id,
      effectiveAt: new Date('2027-01-01T00:00:00.000Z'),
      targetContractEndsAt: new Date('2027-12-31T00:00:00.000Z'),
      items: [{ decision: 'RENEW' as const, sourceEnrollmentId, target: { type: 'CLASS' as const, targetId: destinationClassId, planId } }],
      financialTerms: {
        paymentMethod: 'CARTAO_CREDITO' as const,
        enrollmentFeePaymentMethod: 'CARTAO_CREDITO' as const,
        dueDay: 5,
        enrollmentFeeAmount: 80,
        enrollmentFeeExempt: false,
        feeChargeMoment: 'CHARGE_ON_START' as const,
        feeUnit: 'PER_STUDENT' as const,
        feePurpose: 'ADMINISTRATIVE_FEE' as const,
      },
    };
    const preview = await previewRenewalProcess(input, { prisma: db });
    expect(preview.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'CONTRACT_MODEL_SIGNATURE_FIELDS_REQUIRED' }),
    ]));

    const response = await postRematriculasRoute(new NextRequest('http://localhost:3000/api/rematriculas', {
      method: 'POST',
      body: JSON.stringify({
        contaId, campaignId, targetPeriodId: '2027', matriculaId: sourceEnrollmentId,
        uiRequestId: 'campaign-renewal-invalid-contract-model',
        dataInicio: '2027-01-01T00:00:00.000Z', dataFimContrato: '2027-12-31T00:00:00.000Z',
        planoId: planId, turmaId: destinationClassId, contractModelId: invalidModel.id,
        formaPagamento: 'CARTAO_CREDITO', formaPagamentoTaxa: 'CARTAO_CREDITO',
        vencimentoDia: 5, taxaMatricula: 80, taxaIsenta: false,
        overrideReason: 'Authorized for regression validation',
      }),
    }));
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe('PREVIEW_BLOQUEADO');
    expect(await db.rematriculaProcesso.count({ where: { contaId } })).toBe(0);
    expect(await db.matricula.count({ where: { contaId, rematriculadaDeId: sourceEnrollmentId } })).toBe(0);
  });

  it('creates an annual campaign renewal through POST with late-year legacy dates, contract model, fee, and card payment', async () => {
    const input = {
      contaId,
      actorId: 'renewal-contract-test-actor',
      origin: 'CAMPAIGN' as const,
      campaignId,
      targetPeriodId: '2027',
      targetPeriodStartsAt: new Date('2027-01-01T00:00:00.000Z'),
      holderType: 'STUDENT' as const,
      holderId: studentId,
      contractModelId,
      effectiveAt: new Date('2027-01-01T00:00:00.000Z'),
      targetContractEndsAt: new Date('2027-12-31T00:00:00.000Z'),
      items: [{
        decision: 'RENEW' as const,
        sourceEnrollmentId,
        target: { type: 'CLASS' as const, targetId: destinationClassId, planId },
      }],
      financialTerms: {
        paymentMethod: 'CARTAO_CREDITO' as const,
        enrollmentFeePaymentMethod: 'CARTAO_CREDITO' as const,
        dueDay: 10,
        enrollmentFeeAmount: 80,
        enrollmentFeeExempt: false,
        feeChargeMoment: 'CHARGE_ON_START' as const,
        feeUnit: 'PER_STUDENT' as const,
        feePurpose: 'ADMINISTRATIVE_FEE' as const,
      },
      idempotencyKey: 'campaign-renewal-contract-create-regression',
    };
    const preview = await previewRenewalProcess(input, { prisma: db });
    expect(preview.blockers).toEqual([]);

    const response = await postRematriculasRoute(new NextRequest('http://localhost:3000/api/rematriculas', {
      method: 'POST',
      body: JSON.stringify({
        contaId,
        campaignId,
        targetPeriodId: '2027',
        matriculaId: sourceEnrollmentId,
        uiRequestId: input.idempotencyKey,
        dataInicio: '2027-01-01T00:00:00.000Z',
        dataFimContrato: '2027-12-31T00:00:00.000Z',
        planoId: planId,
        turmaId: destinationClassId,
        contractModelId,
        formaPagamento: 'CARTAO_CREDITO',
        formaPagamentoTaxa: 'CARTAO_CREDITO',
        vencimentoDia: 10,
        taxaMatricula: 80,
        taxaIsenta: false,
        overrideReason: 'Authorized for regression validation',
      }),
    }));
    const responseBody = await response.json();
    const loggedError = routeMocks.logEnrollmentOperationalEvent.mock.calls.at(-1)?.[1] as Error | undefined;
    if (loggedError) console.log('captured renewal failure:', loggedError.name, loggedError.message);
    expect(response.status).toBe(200);
    expect(responseBody).toMatchObject({ status: 'PENDING', novaMatricula: { dataInicio: '2027-01-01T00:00:00.000Z' } });
    expect(routeMocks.logEnrollmentOperationalEvent).not.toHaveBeenCalled();

    const process = await db.rematriculaProcesso.findFirstOrThrow({
      where: { contaId, idempotencyKey: input.idempotencyKey },
      include: { itens: true, contratos: { include: { contrato: true } }, financeiros: true },
    });
    expect(process.itens).toHaveLength(1);
    expect(process.financeiros).toHaveLength(1);
    expect(process.financeiros[0]?.enrollmentFeeTotal.toNumber()).toBe(80);
    expect(process.contratos[0]?.status).toBe('WAITING_SIGNATURE');
    expect(process.contratos[0]?.contrato?.matriculaId).toBe(process.itens[0]?.matriculaFuturaId);
    const futureEnrollmentId = process.itens[0]?.matriculaFuturaId;
    expect(futureEnrollmentId).toBeTruthy();
    const future = await db.matricula.findFirstOrThrow({ where: { id: futureEnrollmentId!, contaId } });
    expect(future).toMatchObject({
      dataInicio: new Date('2027-01-01T00:00:00.000Z'),
      formaPagamento: 'CARTAO_CREDITO',
      statusContrato: 'AGUARDANDO_ASSINATURA',
    });
    expect(Number(future.taxaMatricula)).toBe(80);
    await expect(db.contractWhatsAppNotification.count({ where: { contaId, contratoId: process.contratos[0]?.contratoId ?? undefined } })).resolves.toBe(1);
  }, 30_000);
});
