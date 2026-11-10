import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { resetDb } from '../../utils/reset-db';
import { criarMatricula, MatriculaConflictError } from '@/src/server/enrollments/enrollment.service';
import { runWithTenant } from '@/lib/prisma-tenant';
import { reativarMatricula, regularizarPausaVencida } from '@/src/server/enrollments/enrollment-pause.service';
import { formalizePendingAcademicTransfer, registerPendingAcademicTransfer } from '@/src/server/enrollments/academic-transfer.service';

const hasDb = Boolean(process.env.DATABASE_URL?.startsWith('postgres'));
const describeIf = hasDb ? describe : describe.skip;

describeIf('academic transfer origin concurrency', () => {
  const db = new PrismaClient();
  let contaId: string;
  let pauseActorId: string;
  let sourceLinkId: string;
  let destinationLinkIds: string[];
  let destinationMatriculaIds: string[];
  let serviceTransferFixture: {
    studentId: string;
    sourceLinkId: string;
    targetClassIds: string[];
    contractModelId: string;
  };
  let pendingTransferFixture: { sourceLinkId: string; destinationLinkId: string };
  let crossTenantFixture: {
    otherContaId: string;
    sourceLinkId: string;
    destinationLinkId: string;
    pausedMatriculaId: string;
  };
  let invalidConstraintFixture: {
    pendingSourceLinkId: string;
    pendingDestinationLinkId: string;
    formalizedSourceLinkId: string;
    formalizedDestinationLinkId: string;
  };

  beforeAll(async () => {
    await resetDb(db);
    const now = new Date();
    const conta = await db.conta.create({ data: { nome: 'Transferência concorrente' } });
    contaId = conta.id;
    const pauseActor = await db.usuario.create({
      data: {
        contaId,
        nome: 'Administrador de pausa concorrente',
        email: 'academic-pause-race-admin@example.test',
        senhaHash: 'test-only-hash',
        role: 'ADMIN',
      },
    });
    pauseActorId = pauseActor.id;
    const modality = await db.modalidade.create({ data: { contaId, nome: 'Curso transferível' } });
    const student = await db.aluno.create({ data: { contaId, nome: 'Aluno de transferência', dataNasc: new Date('2010-01-01') } });
    const enrollments = await Promise.all(['origem', 'destino-a', 'destino-b'].map((label) => db.matricula.create({
      data: {
        contaId,
        alunoId: student.id,
        dataInicio: now,
        dataFimContrato: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
        status: 'ATIVA',
        statusFinanceiro: 'PENDENTE_TAXA',
        statusContrato: 'AGUARDANDO_ASSINATURA',
        taxaMatricula: new Prisma.Decimal(0),
        taxaIsenta: true,
        uiRequestId: `academic-transfer-${label}`,
      },
    })));
    const links = await Promise.all(enrollments.map((enrollment) => db.matriculaVinculoAcademico.create({
      data: { contaId, matriculaId: enrollment.id, modalidadeId: modality.id },
    })));
    sourceLinkId = links[0]!.id;
    destinationMatriculaIds = enrollments.slice(1).map((enrollment) => enrollment.id);
    destinationLinkIds = links.slice(1).map((link) => link.id);

    const transferStudent = await db.aluno.create({
      data: { contaId, nome: 'Aluno corrida serviço', dataNasc: new Date('2000-01-01') },
    });
    const [sourceCourse, targetCourseB, targetCourseC] = await Promise.all([
      db.modalidade.create({ data: { contaId, nome: 'Curso origem serviço' } }),
      db.modalidade.create({ data: { contaId, nome: 'Curso destino B serviço' } }),
      db.modalidade.create({ data: { contaId, nome: 'Curso destino C serviço' } }),
    ]);
    const year = new Date('2026-01-01T00:00:00.000Z');
    const cycleEnd = new Date('2099-12-31T00:00:00.000Z');
    const [sourceCycle, cycleB, cycleC] = await Promise.all([
      db.cicloAcademico.create({ data: { contaId, modalidadeId: sourceCourse.id, nome: 'Origem 2026', sequencia: 1, dataInicio: year, dataFim: cycleEnd } }),
      db.cicloAcademico.create({ data: { contaId, modalidadeId: targetCourseB.id, nome: 'Destino B 2099', sequencia: 1, dataInicio: new Date('2099-01-01T00:00:00.000Z'), dataFim: cycleEnd } }),
      db.cicloAcademico.create({ data: { contaId, modalidadeId: targetCourseC.id, nome: 'Destino C 2099', sequencia: 1, dataInicio: new Date('2099-01-01T00:00:00.000Z'), dataFim: cycleEnd } }),
    ]);
    const room = await db.sala.create({ data: { contaId, nome: 'Sala transferência serviço', capacidade: 30 } });
    const targetClasses = await Promise.all([
      db.turma.create({ data: { contaId, nome: 'Destino B', modalidadeId: targetCourseB.id, cicloAcademicoId: cycleB.id, salaId: room.id, diasSemana: ['TERCA'], horaInicio: '10:00', horaFim: '11:00', capacidade: 30 } }),
      db.turma.create({ data: { contaId, nome: 'Destino C', modalidadeId: targetCourseC.id, cicloAcademicoId: cycleC.id, salaId: room.id, diasSemana: ['QUARTA'], horaInicio: '10:00', horaFim: '11:00', capacidade: 30 } }),
    ]);
    const sourceEnrollment = await db.matricula.create({
      data: {
        contaId, alunoId: transferStudent.id, turmaId: null, dataInicio: year, dataFimContrato: cycleEnd,
        status: 'ATIVA', statusFinanceiro: 'ADIMPLENTE', statusContrato: 'AGUARDANDO_ASSINATURA',
        taxaMatricula: new Prisma.Decimal(0), taxaIsenta: true, taxaStatus: 'ISENTO',
        uiRequestId: 'academic-transfer-service-source',
      },
    });
    const sourceLink = await db.matriculaVinculoAcademico.create({
      data: { contaId, matriculaId: sourceEnrollment.id, modalidadeId: sourceCourse.id, cicloAcademicoId: sourceCycle.id, vigenciaIniciadaEm: year },
    });
    const contractModel = await db.contratoModelo.create({
      data: {
        contaId, nome: 'Modelo integração transferência', versao: 1,
        arquivoPdfUrl: 'https://example.invalid/contract.pdf', hashSha256: 'a'.repeat(64),
      },
    });
    await db.contratoModeloCampo.createMany({
      data: [
        { contaId, modeloId: contractModel.id, tipo: 'ASSINATURA', papel: 'ESCOLA', pagina: 1, x: 0.1, y: 0.1, largura: 0.2, altura: 0.05 },
        { contaId, modeloId: contractModel.id, tipo: 'ASSINATURA', papel: 'RESPONSAVEL_OU_ALUNO', pagina: 1, x: 0.5, y: 0.1, largura: 0.2, altura: 0.05 },
      ],
    });
    serviceTransferFixture = {
      studentId: transferStudent.id,
      sourceLinkId: sourceLink.id,
      targetClassIds: targetClasses.map((turma) => turma.id),
      contractModelId: contractModel.id,
    };

    const pendingStudent = await db.aluno.create({
      data: { contaId, nome: 'Aluno transferência pendente', dataNasc: new Date('2000-01-01') },
    });
    const [pendingSourceCourse, pendingDestinationCourse] = await Promise.all([
      db.modalidade.create({ data: { contaId, nome: 'Curso origem pendente' } }),
      db.modalidade.create({ data: { contaId, nome: 'Curso destino pendente' } }),
    ]);
    const [pendingSourceCycle, pendingDestinationCycle] = await Promise.all([
      db.cicloAcademico.create({ data: { contaId, modalidadeId: pendingSourceCourse.id, nome: 'Origem pendente 2025', sequencia: 1, dataInicio: new Date('2025-01-01'), dataFim: new Date('2025-12-31') } }),
      db.cicloAcademico.create({ data: { contaId, modalidadeId: pendingDestinationCourse.id, nome: 'Destino pendente 2026', sequencia: 1, dataInicio: new Date('2026-01-01'), dataFim: new Date('2026-12-31') } }),
    ]);
    const [pendingSourceMatricula, pendingDestinationMatricula] = await Promise.all([
      db.matricula.create({ data: { contaId, alunoId: pendingStudent.id, dataInicio: new Date('2025-01-01'), dataFimContrato: new Date('2027-12-31'), status: 'ATIVA', statusFinanceiro: 'ADIMPLENTE', statusContrato: 'AGUARDANDO_ASSINATURA', taxaMatricula: new Prisma.Decimal(0), taxaIsenta: true, taxaStatus: 'ISENTO', uiRequestId: 'academic-transfer-pending-source' } }),
      db.matricula.create({ data: { contaId, alunoId: pendingStudent.id, dataInicio: new Date('2026-01-01'), dataFimContrato: new Date('2027-12-31'), status: 'ATIVA', statusFinanceiro: 'ADIMPLENTE', statusContrato: 'AGUARDANDO_ASSINATURA', taxaMatricula: new Prisma.Decimal(0), taxaIsenta: true, taxaStatus: 'ISENTO', uiRequestId: 'academic-transfer-pending-destination' } }),
    ]);
    const [pendingSourceLink, pendingDestinationLink] = await Promise.all([
      db.matriculaVinculoAcademico.create({ data: { contaId, matriculaId: pendingSourceMatricula.id, modalidadeId: pendingSourceCourse.id, cicloAcademicoId: pendingSourceCycle.id, vigenciaIniciadaEm: new Date('2025-01-01'), classificacao: 'PRIMEIRO_INGRESSO' } }),
      db.matriculaVinculoAcademico.create({ data: { contaId, matriculaId: pendingDestinationMatricula.id, modalidadeId: pendingDestinationCourse.id, cicloAcademicoId: pendingDestinationCycle.id, vigenciaIniciadaEm: new Date('2026-01-01'), classificacao: 'PRIMEIRO_INGRESSO' } }),
    ]);
    pendingTransferFixture = { sourceLinkId: pendingSourceLink.id, destinationLinkId: pendingDestinationLink.id };

    const otherConta = await db.conta.create({ data: { nome: 'Tenant secundário transferência' } });
    const crossTenantSourceStudent = await db.aluno.create({
      data: { contaId, nome: 'Aluno origem tenant principal', dataNasc: new Date('2000-01-01') },
    });
    const crossTenantDestinationStudent = await db.aluno.create({
      data: { contaId: otherConta.id, nome: 'Aluno destino tenant secundário', dataNasc: new Date('2000-01-01') },
    });
    const [crossSourceCourse, crossDestinationCourse] = await Promise.all([
      db.modalidade.create({ data: { contaId, nome: 'Curso origem cross-tenant' } }),
      db.modalidade.create({ data: { contaId: otherConta.id, nome: 'Curso destino cross-tenant' } }),
    ]);
    const [crossSourceCycle, crossDestinationCycle] = await Promise.all([
      db.cicloAcademico.create({ data: { contaId, modalidadeId: crossSourceCourse.id, nome: 'Ciclo origem cross-tenant', sequencia: 1, dataInicio: new Date('2025-01-01'), dataFim: new Date('2026-12-31') } }),
      db.cicloAcademico.create({ data: { contaId: otherConta.id, modalidadeId: crossDestinationCourse.id, nome: 'Ciclo destino cross-tenant', sequencia: 1, dataInicio: new Date('2026-01-01'), dataFim: new Date('2027-12-31') } }),
    ]);
    const [crossSourceMatricula, crossDestinationMatricula, pausedOtherTenantMatricula] = await Promise.all([
      db.matricula.create({ data: { contaId, alunoId: crossTenantSourceStudent.id, dataInicio: new Date('2025-01-01'), dataFimContrato: new Date('2027-12-31'), status: 'ATIVA', statusFinanceiro: 'ADIMPLENTE', statusContrato: 'AGUARDANDO_ASSINATURA', taxaMatricula: new Prisma.Decimal(0), taxaIsenta: true, taxaStatus: 'ISENTO', uiRequestId: 'academic-transfer-cross-tenant-source' } }),
      db.matricula.create({ data: { contaId: otherConta.id, alunoId: crossTenantDestinationStudent.id, dataInicio: new Date('2026-01-01'), dataFimContrato: new Date('2027-12-31'), status: 'ATIVA', statusFinanceiro: 'ADIMPLENTE', statusContrato: 'AGUARDANDO_ASSINATURA', taxaMatricula: new Prisma.Decimal(0), taxaIsenta: true, taxaStatus: 'ISENTO', uiRequestId: 'academic-transfer-cross-tenant-destination' } }),
      db.matricula.create({ data: { contaId: otherConta.id, alunoId: crossTenantDestinationStudent.id, dataInicio: new Date('2025-01-01'), dataFimContrato: new Date('2027-12-31'), dataInicioPausa: new Date('2026-01-01'), dataRetornoPrevista: new Date('2026-01-31'), status: 'PAUSADA', statusFinanceiro: 'SUSPENSO', statusContrato: 'AGUARDANDO_ASSINATURA', pausaAtiva: true, manterVaga: true, cobrarDurantePausa: false, taxaMatricula: new Prisma.Decimal(0), taxaIsenta: true, taxaStatus: 'ISENTO', uiRequestId: 'academic-pause-cross-tenant-target' } }),
    ]);
    const [crossSourceLink, crossDestinationLink] = await Promise.all([
      db.matriculaVinculoAcademico.create({ data: { contaId, matriculaId: crossSourceMatricula.id, modalidadeId: crossSourceCourse.id, cicloAcademicoId: crossSourceCycle.id, vigenciaIniciadaEm: new Date('2025-01-01'), classificacao: 'PRIMEIRO_INGRESSO' } }),
      db.matriculaVinculoAcademico.create({ data: { contaId: otherConta.id, matriculaId: crossDestinationMatricula.id, modalidadeId: crossDestinationCourse.id, cicloAcademicoId: crossDestinationCycle.id, vigenciaIniciadaEm: new Date('2026-01-01'), classificacao: 'PRIMEIRO_INGRESSO' } }),
    ]);
    await db.matriculaOperacao.create({
      data: { contaId: otherConta.id, matriculaId: pausedOtherTenantMatricula.id, tipo: 'PAUSA', origem: 'USER', status: 'SINCRONIZADO', observacao: 'Pausa para cenário cross-tenant.' },
    });
    crossTenantFixture = {
      otherContaId: otherConta.id,
      sourceLinkId: crossSourceLink.id,
      destinationLinkId: crossDestinationLink.id,
      pausedMatriculaId: pausedOtherTenantMatricula.id,
    };

    const constraintStudent = await db.aluno.create({
      data: { contaId, nome: 'Aluno constraints transferência', dataNasc: new Date('2000-01-01') },
    });
    const constraintCourses = await Promise.all(['pendente origem', 'pendente destino', 'formalizada origem', 'formalizada destino'].map((label) =>
      db.modalidade.create({ data: { contaId, nome: `Curso constraint ${label}` } }),
    ));
    const constraintEnrollments = await Promise.all(constraintCourses.map((_, index) => db.matricula.create({
      data: {
        contaId,
        alunoId: constraintStudent.id,
        dataInicio: new Date('2025-01-01'),
        dataFimContrato: new Date('2027-12-31'),
        status: 'ATIVA',
        statusFinanceiro: 'ADIMPLENTE',
        statusContrato: 'AGUARDANDO_ASSINATURA',
        taxaMatricula: new Prisma.Decimal(0),
        taxaIsenta: true,
        taxaStatus: 'ISENTO',
        uiRequestId: `academic-transfer-constraint-${index}`,
      },
    })));
    const constraintLinks = await Promise.all(constraintEnrollments.map((enrollment, index) => db.matriculaVinculoAcademico.create({
      data: { contaId, matriculaId: enrollment.id, modalidadeId: constraintCourses[index]!.id },
    })));
    invalidConstraintFixture = {
      pendingSourceLinkId: constraintLinks[0]!.id,
      pendingDestinationLinkId: constraintLinks[1]!.id,
      formalizedSourceLinkId: constraintLinks[2]!.id,
      formalizedDestinationLinkId: constraintLinks[3]!.id,
    };
  }, 30_000);

  afterAll(async () => { await db.$disconnect(); });

  it('serializes competing formalizations and rolls back the losing destination update', async () => {
    const attempts = destinationLinkIds.map((destinoVinculoId) => db.$transaction(async (tx) => {
      await tx.matriculaVinculoAcademico.update({
        where: { uq_matricula_vinculo_academico_conta_id: { contaId, id: destinoVinculoId } },
        data: { classificacao: 'TRANSFERENCIA', classificacaoOrigem: 'TRANSFERENCIA_FORMAL' },
      });
      return tx.transferenciaAcademicaVinculo.create({
        data: {
          contaId,
          origemVinculoId: sourceLinkId,
          destinoVinculoId,
          motivo: 'Concorrência de formalização de transferência.',
          formalizadaEm: new Date(),
          formalizadaPor: 'admin-test',
        },
      });
    }));

    const results = await Promise.allSettled(attempts);
    expect(results.filter((result) => result.status === 'fulfilled'), JSON.stringify(results.map((result) => result.status === 'rejected' ? String(result.reason) : 'fulfilled'))).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const requestIds = await db.matricula.findMany({
      where: { id: { in: destinationMatriculaIds } },
      select: { uiRequestId: true },
    });
    expect(new Set(requestIds.map((row) => row.uiRequestId)).size).toBe(2);
    expect(await db.transferenciaAcademicaVinculo.count({ where: { contaId, origemVinculoId: sourceLinkId } })).toBe(1);
    const destinations = await db.matriculaVinculoAcademico.findMany({ where: { id: { in: destinationLinkIds } }, select: { classificacao: true } });
    expect(destinations.filter((link) => link.classificacao === 'TRANSFERENCIA')).toHaveLength(1);
  });

  it('returns a stable transfer conflict from the real enrollment service and leaves no losing artifacts', async () => {
    process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
    const startDate = new Date('2099-01-01T00:00:00.000Z');
    const endDate = new Date('2099-12-31T00:00:00.000Z');
    const attempts = serviceTransferFixture.targetClassIds.map((turmaId, index) => criarMatricula({
      contaId,
      alunoId: serviceTransferFixture.studentId,
      turmaId,
      dataInicio: startDate,
      dataFimContrato: endDate,
      vencimentoDia: 10,
      taxaMatricula: 0,
      taxaIsenta: true,
      pagarTaxaAgora: false,
      gerarCobrancaTaxa: false,
      criarCobranca: false,
      createdById: 'integration-admin',
      modeloId: serviceTransferFixture.contractModelId,
      uiRequestId: `academic-transfer-service-race-${index}`,
      transferenciaOrigemVinculoId: serviceTransferFixture.sourceLinkId,
      transferenciaMotivo: 'Transferência entre cursos documentada.',
    }));

    const results = await Promise.allSettled(attempts);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(MatriculaConflictError);
    expect(rejected[0]!.reason).toMatchObject({ code: 'TRANSFERENCIA_ORIGEM_INVALIDA' });

    const attemptsIds = [`academic-transfer-service-race-0`, `academic-transfer-service-race-1`];
    const enrollments = await db.matricula.findMany({
      where: { contaId, alunoId: serviceTransferFixture.studentId, uiRequestId: { in: attemptsIds } },
      select: { id: true, contratoAtualId: true },
    });
    expect(enrollments).toHaveLength(1);
    const destinationLinks = await db.matriculaVinculoAcademico.count({
      where: { contaId, matriculaId: { in: enrollments.map((item) => item.id) } },
    });
    expect(destinationLinks).toBe(1);
    const createdLink = await db.matriculaVinculoAcademico.findFirstOrThrow({
      where: { contaId, matriculaId: enrollments[0]!.id },
      select: { classificacao: true, classificacaoMotivo: true, classificacaoOrigem: true },
    });
    expect(createdLink).toEqual({
      classificacao: 'TRANSFERENCIA',
      classificacaoMotivo: 'TRANSFER_FORMALIZADA',
      classificacaoOrigem: 'TRANSFERENCIA_FORMAL',
    });
    expect(await db.contrato.count({ where: { contaId, matriculaId: { in: enrollments.map((item) => item.id) } } })).toBe(1);
    expect(await db.transferenciaAcademicaVinculo.count({ where: { contaId, origemVinculoId: serviceTransferFixture.sourceLinkId, status: 'FORMALIZADA' } })).toBe(1);
  }, 30_000);

  it('persists pending evidence and formalization with classification audits and the same origin/destination relation', async () => {
    const pending = await runWithTenant(contaId, (tx) => registerPendingAcademicTransfer({
      tx,
      contaId,
      sourceLinkId: pendingTransferFixture.sourceLinkId,
      destinationLinkId: pendingTransferFixture.destinationLinkId,
      reason: 'Documentos de transferência pendente recebidos.',
      actorId: 'admin-pending',
    }));
    expect(pending.status).toBe('PENDENTE');

    let [pendingRelation, destination] = await Promise.all([
      db.transferenciaAcademicaVinculo.findFirstOrThrow({ where: { contaId, id: pending.id } }),
      db.matriculaVinculoAcademico.findFirstOrThrow({ where: { contaId, id: pendingTransferFixture.destinationLinkId } }),
    ]);
    expect(pendingRelation).toMatchObject({
      origemVinculoId: pendingTransferFixture.sourceLinkId,
      destinoVinculoId: pendingTransferFixture.destinationLinkId,
      status: 'PENDENTE', solicitadaPor: 'admin-pending', formalizadaEm: null, formalizadaPor: null,
    });
    expect(destination.classificacao).toBe('HISTORICO_INDETERMINADO');

    await runWithTenant(contaId, (tx) => formalizePendingAcademicTransfer({
      tx, contaId, destinationLinkId: pendingTransferFixture.destinationLinkId, actorId: 'admin-formalizer',
    }));
    [pendingRelation, destination] = await Promise.all([
      db.transferenciaAcademicaVinculo.findFirstOrThrow({ where: { contaId, id: pending.id } }),
      db.matriculaVinculoAcademico.findFirstOrThrow({ where: { contaId, id: pendingTransferFixture.destinationLinkId } }),
    ]);
    expect(pendingRelation).toMatchObject({
      origemVinculoId: pendingTransferFixture.sourceLinkId,
      destinoVinculoId: pendingTransferFixture.destinationLinkId,
      status: 'FORMALIZADA', formalizadaPor: 'admin-formalizer',
    });
    expect(pendingRelation.formalizadaEm).toBeInstanceOf(Date);
    expect(destination.classificacao).toBe('TRANSFERENCIA');
    const audits = await db.matriculaClassificacaoAudit.findMany({
      where: { contaId, vinculoAcademicoId: pendingTransferFixture.destinationLinkId },
      orderBy: { createdAt: 'asc' },
      select: { de: true, para: true, motivo: true, autorId: true },
    });
    expect(audits).toEqual([
      expect.objectContaining({ de: 'PRIMEIRO_INGRESSO', para: 'HISTORICO_INDETERMINADO', autorId: 'admin-pending' }),
      expect.objectContaining({ de: 'HISTORICO_INDETERMINADO', para: 'TRANSFERENCIA', autorId: 'admin-formalizer' }),
    ]);
    expect(audits.every((audit) => audit.motivo === 'Documentos de transferência pendente recebidos.')).toBe(true);
  }, 30_000);

  it('serializes manual indeterminate classification against transfer formalization without divergence', async () => {
    const student = await db.aluno.create({ data: { contaId, nome: 'Aluno concorrência classificação', dataNasc: new Date('2000-01-01') } });
    const [sourceCourse, destinationCourse] = await Promise.all([
      db.modalidade.create({ data: { contaId, nome: 'Curso origem concorrência manual' } }),
      db.modalidade.create({ data: { contaId, nome: 'Curso destino concorrência manual' } }),
    ]);
    const start = new Date('2025-01-01T00:00:00.000Z');
    const end = new Date('2027-12-31T00:00:00.000Z');
    const [sourceCycle, destinationCycle] = await Promise.all([
      db.cicloAcademico.create({ data: { contaId, modalidadeId: sourceCourse.id, nome: 'Origem 2025 concorrência', sequencia: 1, dataInicio: start, dataFim: end } }),
      db.cicloAcademico.create({ data: { contaId, modalidadeId: destinationCourse.id, nome: 'Destino 2026 concorrência', sequencia: 1, dataInicio: new Date('2026-01-01T00:00:00.000Z'), dataFim: end } }),
    ]);
    const [sourceEnrollment, destinationEnrollment] = await Promise.all([
      db.matricula.create({ data: { contaId, alunoId: student.id, dataInicio: start, dataFimContrato: end, status: 'ATIVA', statusFinanceiro: 'ADIMPLENTE', statusContrato: 'AGUARDANDO_ASSINATURA', taxaMatricula: new Prisma.Decimal(0), taxaIsenta: true, taxaStatus: 'ISENTO', uiRequestId: 'academic-transfer-cas-source' } }),
      db.matricula.create({ data: { contaId, alunoId: student.id, dataInicio: new Date('2026-01-01T00:00:00.000Z'), dataFimContrato: end, status: 'ATIVA', statusFinanceiro: 'ADIMPLENTE', statusContrato: 'AGUARDANDO_ASSINATURA', taxaMatricula: new Prisma.Decimal(0), taxaIsenta: true, taxaStatus: 'ISENTO', uiRequestId: 'academic-transfer-cas-destination' } }),
    ]);
    const [sourceLink, destinationLink] = await Promise.all([
      db.matriculaVinculoAcademico.create({ data: { contaId, matriculaId: sourceEnrollment.id, modalidadeId: sourceCourse.id, cicloAcademicoId: sourceCycle.id, vigenciaIniciadaEm: start, classificacao: 'PRIMEIRO_INGRESSO' } }),
      db.matriculaVinculoAcademico.create({ data: { contaId, matriculaId: destinationEnrollment.id, modalidadeId: destinationCourse.id, cicloAcademicoId: destinationCycle.id, classificacao: 'PRIMEIRO_INGRESSO' } }),
    ]);
    const pending = await runWithTenant(contaId, (tx) => registerPendingAcademicTransfer({
      tx, contaId, sourceLinkId: sourceLink.id, destinationLinkId: destinationLink.id,
      reason: 'Documentação para transferência recebida.', actorId: 'admin-transfer-request',
    }));

    let markRead!: () => void;
    let continueManual!: () => void;
    const manualHasReadSnapshot = new Promise<void>((resolve) => { markRead = resolve; });
    const allowManualUpdate = new Promise<void>((resolve) => { continueManual = resolve; });
    const manualReason = 'Histórico mantido indeterminado por revisão manual.';
    const manualClassificationAttempt = runWithTenant(contaId, async (tx) => {
      const current = await tx.matriculaVinculoAcademico.findFirstOrThrow({
        where: { id: destinationLink.id, contaId }, select: { id: true, classificacao: true },
      });
      const transfer = await tx.transferenciaAcademicaVinculo.findFirstOrThrow({
        where: { id: pending.id, contaId }, select: { status: true },
      });
      expect(current.classificacao).toBe('HISTORICO_INDETERMINADO');
      expect(transfer.status).toBe('PENDENTE');
      markRead();
      await allowManualUpdate;

      const changed = await tx.matriculaVinculoAcademico.updateMany({
        where: { id: current.id, contaId, classificacao: current.classificacao },
        data: { classificacao: 'HISTORICO_INDETERMINADO', classificacaoOrigem: 'MANUAL_ADMIN', classificacaoMotivo: manualReason },
      });
      if (changed.count !== 1) throw Object.assign(new Error('A classificação foi alterada por outra operação.'), { code: 'CLASSIFICACAO_CONCORRENTE' });
      await tx.matriculaClassificacaoAudit.create({
        data: { contaId, vinculoAcademicoId: current.id, de: current.classificacao, para: 'HISTORICO_INDETERMINADO', motivo: manualReason, autorId: 'admin-manual' },
      });
    });

    await manualHasReadSnapshot;
    let formalizationFailure: unknown;
    try {
      await runWithTenant(contaId, (tx) => formalizePendingAcademicTransfer({
        tx, contaId, destinationLinkId: destinationLink.id, actorId: 'admin-formalizer-concurrent',
      }));
    } catch (error) {
      formalizationFailure = error;
    } finally {
      continueManual();
    }
    expect(formalizationFailure).toBeUndefined();
    await expect(manualClassificationAttempt).rejects.toMatchObject({ code: 'CLASSIFICACAO_CONCORRENTE' });

    const [relation, destination, audits] = await Promise.all([
      db.transferenciaAcademicaVinculo.findFirstOrThrow({ where: { contaId, id: pending.id } }),
      db.matriculaVinculoAcademico.findFirstOrThrow({ where: { contaId, id: destinationLink.id } }),
      db.matriculaClassificacaoAudit.findMany({ where: { contaId, vinculoAcademicoId: destinationLink.id }, orderBy: { createdAt: 'asc' }, select: { de: true, para: true, motivo: true, autorId: true } }),
    ]);
    expect(relation).toMatchObject({ status: 'FORMALIZADA', origemVinculoId: sourceLink.id, destinoVinculoId: destinationLink.id, formalizadaPor: 'admin-formalizer-concurrent' });
    expect(relation.formalizadaEm).toBeInstanceOf(Date);
    expect(destination).toMatchObject({ classificacao: 'TRANSFERENCIA', classificacaoOrigem: 'TRANSFERENCIA_FORMAL', classificacaoMotivo: 'TRANSFER_FORMALIZADA' });
    expect(audits).toEqual([
      expect.objectContaining({ de: 'PRIMEIRO_INGRESSO', para: 'HISTORICO_INDETERMINADO', autorId: 'admin-transfer-request' }),
      expect.objectContaining({ de: 'HISTORICO_INDETERMINADO', para: 'TRANSFERENCIA', autorId: 'admin-formalizer-concurrent' }),
    ]);
    expect(audits.some((audit) => audit.motivo === manualReason)).toBe(false);
  }, 30_000);

  it('rejects cross-tenant transfer and pause regularization attempts without persistent writes', async () => {
    await expect(runWithTenant(contaId, (tx) => registerPendingAcademicTransfer({
      tx,
      contaId,
      sourceLinkId: crossTenantFixture.sourceLinkId,
      destinationLinkId: crossTenantFixture.destinationLinkId,
      reason: 'Tentativa cross-tenant deve falhar.',
      actorId: 'integration-admin',
    }))).rejects.toMatchObject({ code: 'VINCULO_NAO_ENCONTRADO', statusCode: 404 });

    expect(await db.transferenciaAcademicaVinculo.findFirst({
      where: { contaId, origemVinculoId: crossTenantFixture.sourceLinkId }, select: { id: true },
    })).toBeNull();
    expect(await db.transferenciaAcademicaVinculo.findFirst({
      where: { contaId: crossTenantFixture.otherContaId, destinoVinculoId: crossTenantFixture.destinationLinkId }, select: { id: true },
    })).toBeNull();
    const destination = await db.matriculaVinculoAcademico.findFirstOrThrow({
      where: { contaId: crossTenantFixture.otherContaId, id: crossTenantFixture.destinationLinkId },
      select: { classificacao: true },
    });
    expect(destination.classificacao).toBe('PRIMEIRO_INGRESSO');

    await expect(runWithTenant(contaId, (tx) => regularizarPausaVencida({
      tx,
      contaId,
      matriculaId: crossTenantFixture.pausedMatriculaId,
      actorId: 'integration-admin',
      motivo: 'Tentativa cross-tenant deve falhar.',
    }))).rejects.toMatchObject({ code: 'MATRICULA_NOT_FOUND', statusCode: 404 });

    expect(await db.matriculaOperacao.count({
      where: { contaId: crossTenantFixture.otherContaId, matriculaId: crossTenantFixture.pausedMatriculaId, tipo: 'REGULARIZACAO_PAUSA' },
    })).toBe(0);
    expect(await db.matriculaOperacao.count({
      where: { contaId: crossTenantFixture.otherContaId, matriculaId: crossTenantFixture.pausedMatriculaId, tipo: 'PAUSA' },
    })).toBe(1);
  }, 30_000);

  it('serializes concurrent pause regularization requests as an idempotent operation', async () => {
    const student = await db.aluno.create({ data: { contaId, nome: 'Aluno regularização idempotente', dataNasc: new Date('2000-01-01') } });
    const now = new Date();
    const matricula = await db.matricula.create({
      data: {
        contaId,
        alunoId: student.id,
        dataInicio: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000),
        dataFimContrato: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
        dataInicioPausa: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        dataRetornoPrevista: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
        status: 'PAUSADA',
        statusFinanceiro: 'SUSPENSO',
        statusContrato: 'AGUARDANDO_ASSINATURA',
        pausaAtiva: true,
        manterVaga: true,
        cobrarDurantePausa: false,
        taxaMatricula: new Prisma.Decimal(0),
        taxaIsenta: true,
        taxaStatus: 'ISENTO',
        uiRequestId: 'academic-pause-idempotency',
      },
    });
    const pauseOperation = await db.matriculaOperacao.create({
      data: {
        contaId,
        matriculaId: matricula.id,
        tipo: 'PAUSA',
        origem: 'USER',
        status: 'SINCRONIZADO',
        observacao: 'Pausa do teste de concorrência.',
      },
    });

    const attempts = await Promise.all([
      runWithTenant(contaId, (tx) => regularizarPausaVencida({
        tx, contaId, matriculaId: matricula.id, actorId: pauseActorId, motivo: 'Regularização concorrente da pausa.'
      })),
      runWithTenant(contaId, (tx) => regularizarPausaVencida({
        tx, contaId, matriculaId: matricula.id, actorId: pauseActorId, motivo: 'Regularização concorrente da pausa.'
      })),
    ]);

    expect(attempts[0]!.id).toBe(attempts[1]!.id);
    expect(await db.matriculaOperacao.count({
      where: { contaId, matriculaId: matricula.id, tipo: 'REGULARIZACAO_PAUSA', metadata: { path: ['pausaOperacaoId'], equals: pauseOperation.id } },
    })).toBe(1);
  }, 30_000);

  it('keeps pause regularization and reactivation race in a coherent local-only state', async () => {
    const student = await db.aluno.create({ data: { contaId, nome: 'Aluno corrida reativação', dataNasc: new Date('2000-01-01') } });
    const now = new Date();
    const matricula = await db.matricula.create({
      data: {
        contaId,
        alunoId: student.id,
        dataInicio: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000),
        dataFimContrato: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
        dataInicioPausa: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        dataRetornoPrevista: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
        status: 'PAUSADA',
        statusFinanceiro: 'SUSPENSO',
        statusContrato: 'AGUARDANDO_ASSINATURA',
        pausaAtiva: true,
        manterVaga: true,
        cobrarDurantePausa: false,
        asaasSubscriptionId: null,
        taxaMatricula: new Prisma.Decimal(0),
        taxaIsenta: true,
        taxaStatus: 'ISENTO',
        uiRequestId: 'academic-pause-reactivation-race',
      },
    });
    const pauseOperation = await db.matriculaOperacao.create({
      data: {
        contaId,
        matriculaId: matricula.id,
        tipo: 'PAUSA',
        origem: 'USER',
        status: 'SINCRONIZADO',
        observacao: 'Pausa do teste de corrida de reativação.',
      },
    });

    const [regularization, reactivation] = await Promise.allSettled([
      runWithTenant(contaId, (tx) => regularizarPausaVencida({
        tx, contaId, matriculaId: matricula.id, actorId: pauseActorId, motivo: 'Regularização concorrente para reativação.'
      })),
      reativarMatricula({
        prisma: db,
        contaId,
        matriculaId: matricula.id,
        actorId: pauseActorId,
        dataRetornoEfetiva: now.toISOString().slice(0, 10),
        nextDueDate: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      }),
    ]);

    expect(regularization.status).toBe('fulfilled');
    const final = await db.matricula.findFirstOrThrow({
      where: { id: matricula.id, contaId },
      select: { status: true, pausaAtiva: true },
    });
    const [pauseCount, regularizationCount, reactivationOperations] = await Promise.all([
      db.matriculaOperacao.count({ where: { contaId, matriculaId: matricula.id, tipo: 'PAUSA' } }),
      db.matriculaOperacao.count({
        where: { contaId, matriculaId: matricula.id, tipo: 'REGULARIZACAO_PAUSA', metadata: { path: ['pausaOperacaoId'], equals: pauseOperation.id } },
      }),
      db.matriculaOperacao.findMany({ where: { contaId, matriculaId: matricula.id, tipo: 'REATIVACAO' }, select: { payloadRecebido: true } }),
    ]);
    expect(pauseCount).toBe(1);
    expect(regularizationCount).toBe(1);
    if (reactivation.status === 'fulfilled') {
      expect(reactivation.value.asaasAction).toBe('LOCAL_ONLY');
      expect(final).toEqual({ status: 'ATIVA', pausaAtiva: false });
      expect(reactivationOperations).toHaveLength(1);
      expect(reactivationOperations[0]!.payloadRecebido).toMatchObject({ asaasAction: 'LOCAL_ONLY' });
    } else {
      expect(reactivation.reason).toMatchObject({ code: 'PAUSA_PRAZO_VENCIDO_REGULARIZACAO_OBRIGATORIA' });
      expect(final).toEqual({ status: 'PAUSADA', pausaAtiva: true });
      expect(reactivationOperations).toHaveLength(0);
    }
  }, 30_000);

  it('enforces transfer status and formalization consistency in PostgreSQL and rolls back invalid rows', async () => {
    const invalidTransfers = [
      {
        status: 'PENDENTE' as const,
        origemVinculoId: invalidConstraintFixture.pendingSourceLinkId,
        destinoVinculoId: invalidConstraintFixture.pendingDestinationLinkId,
        solicitadaPor: 'admin-test',
        formalizadaEm: new Date(),
        formalizadaPor: 'admin-test',
      },
      {
        status: 'FORMALIZADA' as const,
        origemVinculoId: invalidConstraintFixture.formalizedSourceLinkId,
        destinoVinculoId: invalidConstraintFixture.formalizedDestinationLinkId,
        solicitadaPor: null,
        formalizadaEm: null,
        formalizadaPor: null,
      },
    ];

    for (const invalid of invalidTransfers) {
      const failure = await db.$transaction((tx) => tx.transferenciaAcademicaVinculo.create({
        data: {
          contaId,
          origemVinculoId: invalid.origemVinculoId,
          destinoVinculoId: invalid.destinoVinculoId,
          status: invalid.status,
          solicitadaPor: invalid.solicitadaPor,
          formalizadaEm: invalid.formalizadaEm,
          formalizadaPor: invalid.formalizadaPor,
          motivo: 'Tentativa inválida para validar CHECK de persistência.',
        },
      })).then(() => null, (error: unknown) => error);
      expect(String(failure)).toContain('ck_transferencia_academica_status_formalizacao');
      expect(await db.transferenciaAcademicaVinculo.findFirst({
        where: { contaId, origemVinculoId: invalid.origemVinculoId, destinoVinculoId: invalid.destinoVinculoId },
        select: { id: true },
      })).toBeNull();
    }
  }, 30_000);
});
