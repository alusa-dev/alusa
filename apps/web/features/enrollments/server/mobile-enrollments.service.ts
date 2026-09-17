import { Prisma } from '@prisma/client';
import { buildSeatOccupancyWhereClause } from '@alusa/lib/services/matricula-occupancy';

import { runWithTenant, type TenantTransactionClient } from '@/lib/prisma-tenant';
import { PrismaClient } from '@prisma/client';
import { editarMatricula, atualizarDetalhesMatricula } from '@/src/server/matriculas/matricula.service';
import { pausarMatricula, reativarMatricula } from '@/src/server/matriculas/matricula-pausa.service';
import { syncMatriculaStatus } from '@/src/server/matriculas/matricula-sync.service';
import prisma from '@/lib/prisma';

export type MobileEnrollmentActor = {
  userId: string;
  contaId: string;
};

export type MobileEnrollmentClass = {
  id: string;
  name: string;
  schedule: {
    days: string[];
    startTime: string;
    endTime: string;
  };
  occupancy: {
    enrolled: number;
    capacity: number;
  };
  status: 'ATIVO' | 'INATIVO';
};

export type MobileEnrollmentStudent = {
  id: string;
  enrollmentId: string;
  name: string;
  photo: string | null;
};

export type MobileEnrollmentClassDetail = MobileEnrollmentClass & {
  students: MobileEnrollmentStudent[];
};

export class MobileEnrollmentUnauthorizedError extends Error {
  constructor() {
    super('Usuário sem acesso à conta ativa.');
    this.name = 'MobileEnrollmentUnauthorizedError';
  }
}

function assertValidId(value: string) {
  const normalized = value.trim();
  if (!normalized) throw new MobileEnrollmentUnauthorizedError();
  return normalized;
}

async function assertActiveMembership(tx: TenantTransactionClient, actor: MobileEnrollmentActor) {
  const membership = await tx.usuarioConta.findFirst({
    where: {
      usuarioId: actor.userId,
      contaId: actor.contaId,
      status: 'ATIVO',
      usuario: { status: 'ATIVO' },
      conta: { status: 'ATIVO', deletedAt: null },
    },
    select: { id: true },
  });

  if (!membership) throw new MobileEnrollmentUnauthorizedError();
}

async function withAuthorizedTenant<T>(actor: MobileEnrollmentActor, callback: (_tx: TenantTransactionClient, _timezone: string) => Promise<T>) {
  return runWithTenant(actor.contaId, async (tx) => {
    await assertActiveMembership(tx, actor);
    const account = await tx.conta.findFirst({
      where: { id: actor.contaId, status: 'ATIVO', deletedAt: null },
      select: { timezone: true },
    });
    if (!account) throw new MobileEnrollmentUnauthorizedError();
    return callback(tx, account.timezone ?? 'America/Sao_Paulo');
  });
}

function mapClass(turma: {
  id: string;
  nome: string;
  diasSemana: string[];
  horaInicio: string;
  horaFim: string;
  capacidade: number;
  status: string;
}, enrolled: number): MobileEnrollmentClass {
  return {
    id: turma.id,
    name: turma.nome,
    schedule: {
      days: turma.diasSemana,
      startTime: turma.horaInicio,
      endTime: turma.horaFim,
    },
    occupancy: {
      enrolled,
      capacity: turma.capacidade,
    },
    status: turma.status === 'ATIVO' ? 'ATIVO' : 'INATIVO',
  };
}

function classIdsForEnrollment(enrollment: {
  turmaId: string | null;
  matriculaTurmas: Array<{ turmaId: string }>;
}) {
  return new Set([
    ...(enrollment.turmaId ? [enrollment.turmaId] : []),
    ...enrollment.matriculaTurmas.map((item) => item.turmaId),
  ]);
}

function iso(value: Date | null | undefined) {
  return value?.toISOString() ?? null;
}

function numberValue(value: unknown) {
  return value === null || value === undefined ? null : Number(value);
}

export type MobileEnrollmentDetail = {
  id: string;
  status: string;
  financialStatus: string;
  contractStatus: string;
  startDate: string;
  endDate: string | null;
  contractEndDate: string;
  paymentDay: number;
  enrollmentFee: number;
  enrollmentFeeStatus: string;
  enrollmentFeeExempt: boolean;
  paymentMethod: string | null;
  enrollmentFeePaymentMethod: string | null;
  interestPercent: number | null;
  finePercent: number | null;
  discountPercent: number | null;
  discountLimitDays: number | null;
  pause: {
    active: boolean;
    startedAt: string | null;
    expectedReturnAt: string | null;
    keepsSeat: boolean;
    chargesDuringPause: boolean;
    reason: string | null;
  };
  integration: { status: string; warning: string | null };
  student: { id: string; name: string; photo: string | null; cpf: string | null; email: string | null; phone: string | null; customer: string | null };
  responsible: { id: string; name: string; email: string | null; phone: string | null } | null;
  class: { id: string; name: string; modality: string; days: string[]; startTime: string; endTime: string } | null;
  classes: Array<{ id: string; name: string; modality: string; days: string[]; startTime: string; endTime: string }>;
  plan: { id: string; name: string; value: number; frequency: string } | null;
  combo: { id: string; name: string; value: number; frequency: string } | null;
  contracts: Array<{ id: string; status: string; signedAt: string | null; createdAt: string }>;
  charges: Array<{ id: string; description: string; type: string; status: string; amount: number; dueDate: string; paidAt: string | null; paymentMethod: string; createdAt: string }>;
  options: {
    plans: Array<{ id: string; name: string; value: number; frequency: string }>;
    classes: Array<{ id: string; name: string }>;
  };
};

function mapEnrollmentDetail(enrollment: {
  id: string;
  status: string;
  statusFinanceiro: string;
  statusContrato: string;
  dataInicio: Date;
  dataFim: Date | null;
  dataFimContrato: Date;
  vencimentoDia: number;
  taxaMatricula: unknown;
  taxaStatus: string;
  taxaIsenta: boolean;
  formaPagamento: string | null;
  formaPagamentoTaxa: string | null;
  jurosMensal: unknown;
  multaPercentual: unknown;
  descontoAntecipado: unknown;
  prazoDesconto: number | null;
  pausaAtiva: boolean;
  dataInicioPausa: Date | null;
  dataRetornoPrevista: Date | null;
  manterVaga: boolean;
  cobrarDurantePausa: boolean;
  motivoPausa: string | null;
  integrationStatus: string;
  warningCode: string | null;
  aluno: { id: string; nome: string; foto: string | null; cpf: string | null; email: string | null; telefone: string | null; asaasCustomerId: string | null };
  responsavelFinanceiro: { id: string; nome: string; email: string | null; telefone: string | null } | null;
  turma: { id: string; nome: string; diasSemana: string[]; horaInicio: string; horaFim: string; modalidade: { nome: string } } | null;
  matriculaTurmas: Array<{ turma: { id: string; nome: string; diasSemana: string[]; horaInicio: string; horaFim: string; modalidade: { nome: string } } }>;
  plano: { id: string; nome: string; valor: unknown; periodicidade: string } | null;
  combo: { id: string; nome: string; valor: unknown; periodicidade: string } | null;
  contratos: Array<{ id: string; status: string; assinadoEm: Date | null; createdAt: Date }>;
  cobrancas: Array<{ id: string; descricao: string | null; tipo: string; status: string; valor: unknown; vencimento: Date; dataPagamento: Date | null; formaPagamento: string; createdAt: Date }>;
}): MobileEnrollmentDetail {
  const mapClass = (item: NonNullable<typeof enrollment.turma>) => ({ id: item.id, name: item.nome, modality: item.modalidade.nome, days: item.diasSemana, startTime: item.horaInicio, endTime: item.horaFim });
  return {
    id: enrollment.id,
    status: enrollment.status,
    financialStatus: enrollment.statusFinanceiro,
    contractStatus: enrollment.statusContrato,
    startDate: enrollment.dataInicio.toISOString(),
    endDate: iso(enrollment.dataFim),
    contractEndDate: enrollment.dataFimContrato.toISOString(),
    paymentDay: enrollment.vencimentoDia,
    enrollmentFee: Number(enrollment.taxaMatricula),
    enrollmentFeeStatus: enrollment.taxaStatus,
    enrollmentFeeExempt: enrollment.taxaIsenta,
    paymentMethod: enrollment.formaPagamento,
    enrollmentFeePaymentMethod: enrollment.formaPagamentoTaxa,
    interestPercent: numberValue(enrollment.jurosMensal),
    finePercent: numberValue(enrollment.multaPercentual),
    discountPercent: numberValue(enrollment.descontoAntecipado),
    discountLimitDays: enrollment.prazoDesconto,
    pause: { active: enrollment.pausaAtiva, startedAt: iso(enrollment.dataInicioPausa), expectedReturnAt: iso(enrollment.dataRetornoPrevista), keepsSeat: enrollment.manterVaga, chargesDuringPause: enrollment.cobrarDurantePausa, reason: enrollment.motivoPausa },
    integration: { status: enrollment.integrationStatus, warning: enrollment.warningCode },
    student: { id: enrollment.aluno.id, name: enrollment.aluno.nome, photo: enrollment.aluno.foto, cpf: enrollment.aluno.cpf, email: enrollment.aluno.email, phone: enrollment.aluno.telefone, customer: enrollment.aluno.asaasCustomerId },
    responsible: enrollment.responsavelFinanceiro ? { id: enrollment.responsavelFinanceiro.id, name: enrollment.responsavelFinanceiro.nome, email: enrollment.responsavelFinanceiro.email, phone: enrollment.responsavelFinanceiro.telefone } : null,
    class: enrollment.turma ? mapClass(enrollment.turma) : null,
    classes: enrollment.matriculaTurmas.map((item) => mapClass(item.turma)),
    plan: enrollment.plano ? { id: enrollment.plano.id, name: enrollment.plano.nome, value: Number(enrollment.plano.valor), frequency: enrollment.plano.periodicidade } : null,
    combo: enrollment.combo ? { id: enrollment.combo.id, name: enrollment.combo.nome, value: Number(enrollment.combo.valor), frequency: enrollment.combo.periodicidade } : null,
    contracts: enrollment.contratos.map((contract) => ({ id: contract.id, status: contract.status, signedAt: iso(contract.assinadoEm), createdAt: contract.createdAt.toISOString() })),
    charges: enrollment.cobrancas.map((charge) => ({ id: charge.id, description: charge.descricao || 'Cobrança', type: charge.tipo, status: charge.status, amount: Number(charge.valor), dueDate: charge.vencimento.toISOString(), paidAt: iso(charge.dataPagamento), paymentMethod: charge.formaPagamento, createdAt: charge.createdAt.toISOString() })),
    options: { plans: [], classes: [] },
  };
}

export async function getMobileEnrollment(actor: MobileEnrollmentActor, enrollmentId: string) {
  const normalizedId = assertValidId(enrollmentId);
  return withAuthorizedTenant(actor, async (tx) => {
    const [enrollment, plans, classes] = await Promise.all([tx.matricula.findFirst({
      where: { id: normalizedId, contaId: actor.contaId, aluno: { contaId: actor.contaId } },
      select: {
        id: true, status: true, statusFinanceiro: true, statusContrato: true, dataInicio: true, dataFim: true, dataFimContrato: true, vencimentoDia: true,
        taxaMatricula: true, taxaStatus: true, taxaIsenta: true, formaPagamento: true, formaPagamentoTaxa: true, jurosMensal: true, multaPercentual: true,
        descontoAntecipado: true, prazoDesconto: true, pausaAtiva: true, dataInicioPausa: true, dataRetornoPrevista: true, manterVaga: true,
        cobrarDurantePausa: true, motivoPausa: true, integrationStatus: true, warningCode: true,
        aluno: { select: { id: true, nome: true, foto: true, cpf: true, email: true, telefone: true, asaasCustomerId: true } },
        responsavelFinanceiro: { select: { id: true, nome: true, email: true, telefone: true } },
        turma: { select: { id: true, nome: true, diasSemana: true, horaInicio: true, horaFim: true, modalidade: { select: { nome: true } } } },
        matriculaTurmas: { orderBy: { createdAt: 'asc' }, select: { turma: { select: { id: true, nome: true, diasSemana: true, horaInicio: true, horaFim: true, modalidade: { select: { nome: true } } } } } },
        plano: { select: { id: true, nome: true, valor: true, periodicidade: true } },
        combo: { select: { id: true, nome: true, valor: true, periodicidade: true } },
        contratos: { orderBy: { createdAt: 'desc' }, select: { id: true, status: true, assinadoEm: true, createdAt: true } },
        cobrancas: { orderBy: { vencimento: 'desc' }, take: 50, select: { id: true, descricao: true, tipo: true, status: true, valor: true, vencimento: true, dataPagamento: true, formaPagamento: true, createdAt: true } },
      },
    }), tx.plano.findMany({ where: { contaId: actor.contaId, status: 'ATIVO' }, orderBy: { nome: 'asc' }, select: { id: true, nome: true, valor: true, periodicidade: true } }), tx.turma.findMany({ where: { contaId: actor.contaId, status: 'ATIVO' }, orderBy: { nome: 'asc' }, select: { id: true, nome: true } })]);
    return enrollment ? { ...mapEnrollmentDetail(enrollment), options: { plans: plans.map((plan) => ({ id: plan.id, name: plan.nome, value: Number(plan.valor), frequency: plan.periodicidade })), classes: classes.map((item) => ({ id: item.id, name: item.nome })) } } : null;
  });
}

export async function updateMobileEnrollment(input: { actor: MobileEnrollmentActor; enrollmentId: string; data: { dataFimContrato?: string; vencimentoDia?: number; turmaId?: string | null; planoId?: string | null; comboId?: string | null } }) {
  await assertMobileEnrollmentAccess(input.actor, input.enrollmentId);
  if (input.data.turmaId !== undefined || input.data.planoId !== undefined || input.data.comboId !== undefined) {
    await editarMatricula({ matriculaId: input.enrollmentId, contaId: input.actor.contaId, createdById: input.actor.userId, ...input.data, motivo: 'Atualização feita pelo aplicativo' });
  }
  if (input.data.dataFimContrato !== undefined || input.data.vencimentoDia !== undefined) {
    await atualizarDetalhesMatricula({ id: input.enrollmentId, contaId: input.actor.contaId, actorId: input.actor.userId, ...input.data, metadata: { source: 'mobile' } });
  }
}

export async function updateMobileEnrollmentPayment(input: { actor: MobileEnrollmentActor; enrollmentId: string; paymentMethod: 'BOLETO' | 'PIX' | 'CARTAO_CREDITO' | 'INDEFINIDO' }) {
  const detail = await getMobileEnrollment(input.actor, input.enrollmentId);
  if (!detail) throw new MobileEnrollmentNotFoundError();
  if (detail.paymentMethod === input.paymentMethod) return;
  const current = await prisma.matricula.findFirst({ where: { id: input.enrollmentId, contaId: input.actor.contaId, aluno: { contaId: input.actor.contaId } }, select: { asaasSubscriptionId: true } });
  if (!current?.asaasSubscriptionId) throw new Error('Esta matrícula ainda não possui uma forma de pagamento recorrente disponível para alteração.');
  const { updateSubscription, projectConfirmedBillingAgreementSnapshot } = await import('@alusa/finance');
  const billingType: 'BOLETO' | 'PIX' | 'CREDIT_CARD' | 'UNDEFINED' = input.paymentMethod === 'CARTAO_CREDITO' ? 'CREDIT_CARD' : input.paymentMethod === 'INDEFINIDO' ? 'UNDEFINED' : input.paymentMethod;
  await updateSubscription(current.asaasSubscriptionId, { billingType, updatePendingPayments: true }, { contaId: input.actor.contaId });
  await projectConfirmedBillingAgreementSnapshot({ contaId: input.actor.contaId, asaasSubscriptionId: current.asaasSubscriptionId, billingType });
  await runWithTenant(input.actor.contaId, (tx) => tx.matricula.update({ where: { id: input.enrollmentId }, data: { formaPagamento: input.paymentMethod } }));
}

async function assertMobileEnrollmentAccess(actor: MobileEnrollmentActor, enrollmentId: string) {
  const detail = await getMobileEnrollment(actor, enrollmentId);
  if (!detail) throw new MobileEnrollmentNotFoundError();
}

export class MobileEnrollmentNotFoundError extends Error {
  constructor() { super('Matrícula não encontrada.'); this.name = 'MobileEnrollmentNotFoundError'; }
}

export async function executeMobileEnrollmentAction(input: { actor: MobileEnrollmentActor; enrollmentId: string; action: 'PAUSE' | 'REACTIVATE' | 'CANCEL'; reason?: string; startDate?: string; returnDate?: string; nextDueDate?: string }) {
  await assertMobileEnrollmentAccess(input.actor, input.enrollmentId);
  if (input.action === 'PAUSE') {
    return pausarMatricula({ prisma: prisma as PrismaClient, matriculaId: input.enrollmentId, contaId: input.actor.contaId, actorId: input.actor.userId, motivoPausa: input.reason || 'Pausa solicitada pelo aplicativo', dataInicioPausa: input.startDate || new Date().toISOString().slice(0, 10), dataRetornoPrevista: input.returnDate, manterVaga: true, cobrarDurantePausa: false });
  }
  if (input.action === 'REACTIVATE') {
    const date = input.returnDate || new Date().toISOString().slice(0, 10);
    return reativarMatricula({ prisma: prisma as PrismaClient, matriculaId: input.enrollmentId, contaId: input.actor.contaId, actorId: input.actor.userId, dataRetornoEfetiva: date, nextDueDate: input.nextDueDate || date });
  }
  return syncMatriculaStatus({ prisma: prisma as PrismaClient, matriculaId: input.enrollmentId, contaId: input.actor.contaId, targetStatus: 'CANCELADA', actorId: input.actor.userId, motivo: input.reason || 'Encerramento solicitado pelo aplicativo' });
}

export async function deleteMobileEnrollment(input: { actor: MobileEnrollmentActor; enrollmentId: string }) {
  await assertMobileEnrollmentAccess(input.actor, input.enrollmentId);
  return runWithTenant(input.actor.contaId, async (tx) => {
    const enrollment = await tx.matricula.findFirst({ where: { id: input.enrollmentId, contaId: input.actor.contaId }, select: { id: true, matriculaFamiliarId: true, asaasSubscriptionId: true } });
    if (!enrollment) throw new MobileEnrollmentNotFoundError();
    const [charges, payments, subscriptions, installmentPlans, contracts] = await Promise.all([
      tx.cobranca.count({ where: { matriculaId: input.enrollmentId } }),
      tx.pagamento.count({ where: { cobranca: { matriculaId: input.enrollmentId } } }),
      tx.subscription.count({ where: { matriculaId: input.enrollmentId } }),
      tx.installmentPlan.count({ where: { matriculaId: input.enrollmentId } }),
      tx.contrato.count({ where: { matriculaId: input.enrollmentId, contaId: input.actor.contaId } }),
    ]);
    if (charges || payments || subscriptions || installmentPlans || contracts || enrollment.matriculaFamiliarId || enrollment.asaasSubscriptionId) {
      throw new Error('Esta matrícula possui histórico ou vínculos ativos. Para preservar os registros, encerre a matrícula em vez de excluí-la.');
    }
    await tx.matricula.delete({ where: { id: input.enrollmentId } });
    return { deleted: true };
  });
}

const occupancyWhere = (timezone: string): Prisma.MatriculaWhereInput => ({
  AND: [buildSeatOccupancyWhereClause(new Date(), timezone) as Prisma.MatriculaWhereInput],
});

export async function listMobileEnrollmentClasses(actor: MobileEnrollmentActor) {
  return withAuthorizedTenant(actor, async (tx, timezone) => {
    const turmas = await tx.turma.findMany({
      where: { contaId: actor.contaId },
      orderBy: [{ status: 'asc' }, { nome: 'asc' }],
      select: {
        id: true,
        nome: true,
        diasSemana: true,
        horaInicio: true,
        horaFim: true,
        capacidade: true,
        status: true,
      },
    });

    if (!turmas.length) return { classes: [] satisfies MobileEnrollmentClass[] };

    const turmaIds = turmas.map((turma) => turma.id);
    const enrollments = await tx.matricula.findMany({
      where: {
        contaId: actor.contaId,
        aluno: { contaId: actor.contaId },
        ...occupancyWhere(timezone),
        OR: [
          { turma: { contaId: actor.contaId, id: { in: turmaIds } } },
          { matriculaTurmas: { some: { contaId: actor.contaId, turmaId: { in: turmaIds } } } },
        ],
      },
      select: {
        id: true,
        turmaId: true,
        matriculaTurmas: {
          where: { contaId: actor.contaId, turmaId: { in: turmaIds } },
          select: { turmaId: true },
        },
      },
    });

    const enrolledByClass = new Map<string, Set<string>>();
    for (const enrollment of enrollments) {
      for (const turmaId of classIdsForEnrollment(enrollment)) {
        const enrolled = enrolledByClass.get(turmaId) ?? new Set<string>();
        enrolled.add(enrollment.id);
        enrolledByClass.set(turmaId, enrolled);
      }
    }

    return {
      classes: turmas.map((turma) => mapClass(turma, enrolledByClass.get(turma.id)?.size ?? 0)),
    };
  });
}

export async function getMobileEnrollmentClass(actor: MobileEnrollmentActor, classId: string) {
  const normalizedClassId = assertValidId(classId);

  return withAuthorizedTenant(actor, async (tx, timezone) => {
    const turma = await tx.turma.findFirst({
      where: { id: normalizedClassId, contaId: actor.contaId },
      select: {
        id: true,
        nome: true,
        diasSemana: true,
        horaInicio: true,
        horaFim: true,
        capacidade: true,
        status: true,
      },
    });
    if (!turma) return null;

    const enrollments = await tx.matricula.findMany({
      where: {
        contaId: actor.contaId,
        aluno: { contaId: actor.contaId },
        ...occupancyWhere(timezone),
        OR: [
          { turma: { contaId: actor.contaId, id: normalizedClassId } },
          { matriculaTurmas: { some: { contaId: actor.contaId, turmaId: normalizedClassId } } },
        ],
      },
      orderBy: { aluno: { nome: 'asc' } },
      select: {
        id: true,
        aluno: { select: { id: true, nome: true, foto: true } },
      },
    });

    const uniqueStudents = new Map<string, MobileEnrollmentStudent>();
    for (const enrollment of enrollments) {
      uniqueStudents.set(enrollment.aluno.id, {
        id: enrollment.aluno.id,
        enrollmentId: enrollment.id,
        name: enrollment.aluno.nome,
        photo: enrollment.aluno.foto,
      });
    }

    const students = [...uniqueStudents.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    return {
      class: {
        ...mapClass(turma, enrollments.length),
        students,
      } satisfies MobileEnrollmentClassDetail,
    };
  });
}
