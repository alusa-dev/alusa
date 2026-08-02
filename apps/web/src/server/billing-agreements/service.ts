import {
  commitBillingAgreementChange,
  getBillingAgreementView,
  previewBillingAgreementChange,
} from '@alusa/finance/billing-agreements';
import type {
  BillingAgreementChangeInput,
  BillingAllocationDraft,
  BillingAllocationUpdate,
  BillingPayer,
  CommitBillingAgreementChangeInput,
} from '@alusa/finance/billing-agreements/types';
import { resolvePayer } from '@alusa/domain';

import {
  billingAgreementCommitResponseSchema,
  billingAgreementPreviewResponseSchema,
  billingAgreementViewSchema,
  type BillingAgreementCommitRequest,
  type BillingAgreementCommitResponse,
  type BillingAgreementPreviewRequest,
  type BillingAgreementPreviewResponse,
  type BillingAgreementView,
  type BillingPayer as WebBillingPayer,
} from '@/features/cadastro/matriculas/billing-agreements/contracts';
import { runWithTenant } from '@/lib/prisma-tenant';

import {
  mapFinanceAgreementView,
  mapFinanceCommitResult,
  mapFinancePreview,
  toFinanceEffectivePolicy,
  toFinanceProrationPolicy,
} from './mappers';

class BillingAgreementWebError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'BillingAgreementWebError';
    this.code = code;
    this.details = details;
  }
}

type WebServiceContext<TRequest> = {
  contaId: string;
  actorId: string;
  request: TRequest;
};

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

function resolveRecurring(kind: string, recurring?: boolean) {
  return recurring ?? kind === 'TUITION';
}

async function resolveEnrollmentStudents(
  contaId: string,
  enrollmentIds: readonly string[],
  expectedPayer: BillingPayer,
) {
  const uniqueIds = unique(enrollmentIds);
  const enrollments = await runWithTenant(contaId, (tx) =>
    tx.matricula.findMany({
      where: {
        contaId,
        id: { in: uniqueIds },
        aluno: { contaId },
      },
      select: {
        id: true,
        alunoId: true,
        responsavelFinanceiroId: true,
        aluno: { select: { id: true, dataNasc: true } },
      },
    }),
  );

  if (enrollments.length !== uniqueIds.length) {
    throw new BillingAgreementWebError(
      'ENROLLMENT_NOT_FOUND',
      'Uma ou mais matrículas não foram encontradas nesta escola.',
    );
  }

  return new Map(enrollments.map((enrollment) => {
    const payer = resolvePayer({
      alunoId: enrollment.aluno.id,
      alunoDataNasc: enrollment.aluno.dataNasc,
      responsavelFinanceiroId: enrollment.responsavelFinanceiroId,
    });
    if (!payer.success) {
      throw new BillingAgreementWebError(
        'INVALID_INPUT',
        'A matrícula não possui um pagador financeiro válido.',
      );
    }
    if (payer.payer.type !== expectedPayer.type || payer.payer.id !== expectedPayer.id) {
      throw new BillingAgreementWebError(
        'INCOMPATIBLE_AGREEMENTS',
        'A matrícula pertence a outro pagador e deve ser transferida para o acordo correto.',
      );
    }
    return [enrollment.id, enrollment.alunoId];
  }));
}

async function resolveFinancePayer(contaId: string, payer: WebBillingPayer): Promise<BillingPayer> {
  return runWithTenant(contaId, async (tx) => {
    const entity = payer.type === 'RESPONSAVEL'
      ? await tx.responsavel.findFirst({
          where: { id: payer.id, contaId },
          select: { id: true },
        })
      : await tx.aluno.findFirst({
          where: { id: payer.id, contaId },
          select: { id: true },
        });
    if (!entity) {
      throw new BillingAgreementWebError('PAYER_NOT_FOUND', 'Pagador não encontrado nesta escola.');
    }

    const customer = await tx.customer.findFirst({
      where: {
        contaId,
        payerType: payer.type,
        payerId: payer.id,
      },
      select: { asaasCustomerId: true },
    });
    if (!customer?.asaasCustomerId) {
      throw new BillingAgreementWebError(
        'PAYER_CUSTOMER_NOT_PROVISIONED',
        'O cadastro financeiro do novo pagador precisa ser concluído antes da troca.',
      );
    }

    return {
      type: payer.type,
      id: payer.id,
      customerId: customer.asaasCustomerId,
    };
  });
}

function commonFinanceInput(
  context: WebServiceContext<BillingAgreementPreviewRequest>,
) {
  return {
    contaId: context.contaId,
    agreementId: context.request.agreementId,
    actorId: context.actorId,
    reason: context.request.reason,
    paidDecreaseHandling: context.request.paidDecreaseHandling,
    effectivePolicy: toFinanceEffectivePolicy(context.request.effectivePolicy),
    effectiveDate: context.request.effectiveDate,
  };
}

async function mapWebChangeToFinance(
  context: WebServiceContext<BillingAgreementPreviewRequest>,
): Promise<BillingAgreementChangeInput> {
  const { request } = context;
  const common = commonFinanceInput(context);

  switch (request.operation) {
    case 'ADD_ALLOCATION': {
      const agreement = await getBillingAgreementView({
        contaId: context.contaId,
        agreementId: request.agreementId,
      });
      if (agreement.agreement.contaId !== context.contaId) {
        throw new BillingAgreementWebError('TENANT_MISMATCH', 'Acordo financeiro não encontrado.');
      }
      const students = await resolveEnrollmentStudents(
        context.contaId,
        request.allocations.map((allocation) => allocation.matriculaId),
        agreement.agreement.payer,
      );
      const allocations: BillingAllocationDraft[] = request.allocations.map((allocation) => {
        const studentId = students.get(allocation.matriculaId);
        if (!studentId) {
          throw new BillingAgreementWebError(
            'ENROLLMENT_NOT_FOUND',
            'Matrícula não encontrada nesta escola.',
          );
        }
        return {
          clientId: allocation.allocationId,
          enrollmentId: allocation.matriculaId,
          studentId,
          kind: allocation.kind,
          recurring: resolveRecurring(allocation.kind, allocation.recurring),
          baseAmountCents: allocation.baseAmountCents,
          discountAmountCents: allocation.discountAmountCents,
          netAmountCents: allocation.baseAmountCents - allocation.discountAmountCents,
          validFrom: allocation.validFrom,
          validUntil: allocation.validUntil ?? null,
          prorationPolicy: toFinanceProrationPolicy(request.effectivePolicy),
        };
      });
      return { ...common, kind: request.operation, allocations };
    }
    case 'UPDATE_ALLOCATION': {
      const allocations: BillingAllocationUpdate[] = request.allocations.map((allocation) => {
        if (!allocation.allocationId) {
          throw new BillingAgreementWebError('INVALID_INPUT', 'Informe a alocação que será alterada.');
        }
        return {
          allocationId: allocation.allocationId,
          recurring: resolveRecurring(allocation.kind, allocation.recurring),
          baseAmountCents: allocation.baseAmountCents,
          discountAmountCents: allocation.discountAmountCents,
          netAmountCents: allocation.baseAmountCents - allocation.discountAmountCents,
          validFrom: allocation.validFrom,
          validUntil: allocation.validUntil ?? null,
          prorationPolicy: toFinanceProrationPolicy(request.effectivePolicy),
        };
      });
      return { ...common, kind: request.operation, allocations };
    }
    case 'REMOVE_ALLOCATION':
    case 'PAUSE_ALLOCATION':
      return { ...common, kind: request.operation, allocationIds: unique(request.allocationIds) };
    case 'RESUME_ALLOCATION':
      return {
        ...common,
        kind: request.operation,
        allocationIds: unique(request.allocationIds),
        nextDueDate: request.nextDueDate,
      };
    case 'TRANSFER_ALLOCATION':
      return {
        ...common,
        kind: request.operation,
        allocationIds: unique(request.allocationIds),
        targetAgreementId: request.targetAgreementId,
      };
    case 'PAUSE_AGREEMENT':
      return { ...common, kind: request.operation };
    case 'RESUME_AGREEMENT':
      return { ...common, kind: request.operation, nextDueDate: request.nextDueDate };
    case 'CHANGE_PAYER':
      return {
        ...common,
        kind: request.operation,
        newPayer: await resolveFinancePayer(context.contaId, request.newPayer),
      };
    case 'CANCEL_AGREEMENT':
      return { ...common, kind: request.operation };
  }
}

async function resolveAgreementPresentation(view: Awaited<ReturnType<typeof getBillingAgreementView>>) {
  const contaId = view.agreement.contaId;
  return runWithTenant(contaId, async (tx) => {
    const payerName = view.agreement.payer.type === 'RESPONSAVEL'
      ? (await tx.responsavel.findFirst({
          where: { id: view.agreement.payer.id, contaId },
          select: { nome: true },
        }))?.nome
      : (await tx.aluno.findFirst({
          where: { id: view.agreement.payer.id, contaId },
          select: { nome: true },
        }))?.nome;
    const studentIds = unique(view.allocations.map((allocation) => allocation.studentId));
    const students = await tx.aluno.findMany({
      where: { contaId, id: { in: studentIds } },
      select: { id: true, nome: true },
    });
    return {
      payerName: payerName ?? 'Pagador',
      studentNames: new Map(students.map((student) => [student.id, student.nome])),
    };
  });
}

export async function previewBillingAgreementWeb(
  context: WebServiceContext<BillingAgreementPreviewRequest>,
): Promise<BillingAgreementPreviewResponse> {
  const input = await mapWebChangeToFinance(context);
  const preview = await previewBillingAgreementChange(input);
  return billingAgreementPreviewResponseSchema.parse(mapFinancePreview(preview));
}

export async function commitBillingAgreementWeb(
  context: WebServiceContext<BillingAgreementCommitRequest>,
): Promise<BillingAgreementCommitResponse> {
  const change = await mapWebChangeToFinance({
    ...context,
    request: context.request,
  });
  const input: CommitBillingAgreementChangeInput = {
    ...change,
    uiRequestId: context.request.idempotencyKey,
    previewHash: context.request.previewHash,
    previewExpiresAt: context.request.previewExpiresAt,
    expectedAgreementVersion: context.request.expectedVersion,
  };
  const result = await commitBillingAgreementChange(input);
  return billingAgreementCommitResponseSchema.parse(mapFinanceCommitResult(result));
}

export async function getBillingAgreementWeb(input: {
  contaId: string;
  agreementId: string;
}): Promise<BillingAgreementView> {
  const view = await getBillingAgreementView(input);
  if (view.agreement.contaId !== input.contaId) {
    throw new BillingAgreementWebError('TENANT_MISMATCH', 'Acordo financeiro não encontrado.');
  }
  const presentation = await resolveAgreementPresentation(view);
  return billingAgreementViewSchema.parse(mapFinanceAgreementView({ view, ...presentation }));
}
