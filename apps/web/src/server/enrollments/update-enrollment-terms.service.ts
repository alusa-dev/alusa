import { prisma } from '@/src/prisma';
import { enqueueEnrollmentFinancialCommand } from '@alusa/finance';
import type { UpdateMatriculaJurosMultaInputDTO } from '@/features/enrollments/dtos';
import { mapMatriculaSubscriptionTermsUpdateResultToDTO } from '@/features/enrollments/mappers';
import {
  isFinancialContextEditable,
  resolveMatriculaFinancialContext,
} from './financial-context.service';
import { matriculaRouteRepository } from './enrollment-route.repository';

export type UpdateEnrollmentTermsResult =
  | { kind: 'SUCCESS'; data: Record<string, unknown> }
  | { kind: 'FAILURE'; status: 400 | 404 | 409 | 502; body: Record<string, unknown> };

function failure(
  status: UpdateEnrollmentTermsResult extends infer T
    ? T extends { kind: 'FAILURE'; status: infer S }
      ? S
      : never
    : never,
  code: string,
  message: string,
  details?: unknown,
): UpdateEnrollmentTermsResult {
  return { kind: 'FAILURE', status: status as 400 | 404 | 409 | 502, body: { error: { code, message, details } } };
}

export async function updateEnrollmentTerms(params: {
  matriculaId: string;
  contaId: string;
  userId: string;
  input: UpdateMatriculaJurosMultaInputDTO;
}): Promise<UpdateEnrollmentTermsResult> {
  const { interest, fine, discount } = params.input;
  const matricula = await matriculaRouteRepository.matricula.findFirst({
    where: { id: params.matriculaId, contaId: params.contaId },
    select: {
      id: true,
      asaasSubscriptionId: true,
      jurosMensal: true,
      jurosTipo: true,
      multaPercentual: true,
      multaTipo: true,
      descontoAntecipado: true,
      descontoTipo: true,
      prazoDesconto: true,
    },
  });
  if (!matricula) return failure(404, 'NAO_ENCONTRADO', 'Matrícula não encontrada');

  const financialContext = await resolveMatriculaFinancialContext({
    db: matriculaRouteRepository,
    matriculaId: params.matriculaId,
    contaId: params.contaId,
  });
  const targetSubscriptionId = financialContext?.asaasSubscriptionId ?? matricula.asaasSubscriptionId;
  if (!financialContext || !targetSubscriptionId) {
    return failure(400, 'ASSINATURA_NAO_ENCONTRADA', 'Esta matrícula não possui vínculo financeiro ativo');
  }

  if (!isFinancialContextEditable(financialContext)) {
    return failure(409, 'ASSINATURA_NAO_EDITAVEL', 'O vínculo recorrente não pode ser atualizado no momento.');
  }

  const asaasInterest = interest ? { value: interest.value as number } : undefined;
  const asaasFine = fine ? { value: fine.value as number, type: fine.type } : undefined;
  const asaasDiscount = discount
    ? { value: discount.value, type: discount.type, dueDateLimitDays: discount.dueDateLimitDays ?? 0 }
    : undefined;
  const asaasPayload = {
    ...(asaasInterest ? { interest: asaasInterest } : {}),
    ...(asaasFine ? { fine: asaasFine } : {}),
    ...(asaasDiscount ? { discount: asaasDiscount } : {}),
    updatePendingPayments: true,
  };

  const updateData = {
    ...(interest !== undefined ? { jurosMensal: interest.value > 0 ? interest.value : null, jurosTipo: interest.value > 0 ? 'PERCENTAGE' : null } : {}),
    ...(fine !== undefined ? { multaPercentual: fine.value > 0 ? fine.value : null, multaTipo: fine.value > 0 ? fine.type ?? 'PERCENTAGE' : null } : {}),
    ...(discount !== undefined ? {
      descontoAntecipado: discount.value > 0 ? discount.value : null,
      descontoTipo: discount.value > 0 ? discount.type ?? 'PERCENTAGE' : null,
      prazoDesconto: discount.value > 0 ? discount.dueDateLimitDays ?? 0 : null,
    } : {}),
  };
  const affectedMatriculaIds = financialContext.mode === 'FAMILY'
    ? financialContext.family?.affectedMatriculaIds ?? []
    : financialContext.sharedAgreement?.affectedMatriculaIds ?? [];
  const targets = affectedMatriculaIds.length > 0 ? affectedMatriculaIds : [params.matriculaId];
  const event = await prisma.$transaction(async (tx) => enqueueEnrollmentFinancialCommand(tx, {
    contaId: params.contaId,
    actorId: params.userId,
    dedupeKey: `enrollment-financial-terms:${params.matriculaId}:${JSON.stringify(params.input)}`,
    command: {
      matriculaId: params.matriculaId,
      targetSubscriptionId,
      affectedMatriculaIds: targets,
      localPatchMatriculaIds: targets,
      remotePatch: asaasPayload,
      localPatch: updateData,
      snapshot: {
        ...(interest !== undefined ? { interestValue: asaasInterest?.value ?? null, interestType: asaasInterest ? 'PERCENTAGE' : null } : {}),
        ...(fine !== undefined ? { fineValue: asaasFine?.value ?? null, fineType: asaasFine?.type ?? null } : {}),
        ...(discount !== undefined ? { discountValue: asaasDiscount?.value ?? null, discountType: asaasDiscount?.type ?? null, discountDueDateLimitDays: asaasDiscount?.dueDateLimitDays ?? null } : {}),
      },
    },
  }));
  const expected = {
    jurosMensal: interest === undefined ? (matricula.jurosMensal === null ? null : Number(matricula.jurosMensal)) : updateData.jurosMensal ?? null,
    jurosTipo: interest === undefined ? matricula.jurosTipo : updateData.jurosTipo ?? null,
    multaPercentual: fine === undefined ? (matricula.multaPercentual === null ? null : Number(matricula.multaPercentual)) : updateData.multaPercentual ?? null,
    multaTipo: fine === undefined ? matricula.multaTipo : updateData.multaTipo ?? null,
    descontoAntecipado: discount === undefined ? (matricula.descontoAntecipado === null ? null : Number(matricula.descontoAntecipado)) : updateData.descontoAntecipado ?? null,
    descontoTipo: discount === undefined ? matricula.descontoTipo : updateData.descontoTipo ?? null,
    prazoDesconto: discount === undefined ? matricula.prazoDesconto : updateData.prazoDesconto ?? null,
  };

  return {
    kind: 'SUCCESS' as const,
    data: {
      ...mapMatriculaSubscriptionTermsUpdateResultToDTO({
        interest,
        fine,
        discount,
        updated: expected,
        message: 'Alteração registrada; os termos locais serão projetados após a confirmação do Asaas.',
      }),
      asyncSync: {
        status: 'PENDING',
        operationId: event.id,
        provider: 'ASAAS',
        fields: ['interest', 'fine', 'discount', 'updatePendingPayments', 'pendingPayments'],
        message: 'A atualização financeira será processada e reconciliada automaticamente.',
      },
    },
  };
}
