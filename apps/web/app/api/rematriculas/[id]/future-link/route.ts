import { NextResponse } from 'next/server';
import { z, ZodError } from 'zod';

import { getSessionUser } from '@/lib/auth/session';
import { prisma } from '@/prisma/client';
import { editRenewalFutureLink } from '@/src/server/matriculas/renewal-process.service';
import { hasRenewalPermission } from '@/src/server/matriculas/renewal-permissions.service';
import { assertPlatformAccessForConta } from '@/src/server/platform-billing/capacity';

const futureLinkSchema = z.object({
  targetClassId: z.string().trim().nullable().optional(),
  targetComboId: z.string().trim().nullable().optional(),
  targetPlanId: z.string().trim().nullable().optional(),
  holderType: z.enum(['STUDENT', 'RESPONSIBLE']).nullable().optional(),
  holderId: z.string().trim().nullable().optional(),
  effectiveAt: z.string().datetime().or(z.string().date()).nullable().optional(),
  firstDueDate: z.string().datetime().or(z.string().date()).nullable().optional(),
  targetContractEndsAt: z.string().datetime().or(z.string().date()).nullable().optional(),
  contractModelId: z.string().trim().nullable().optional(),
  paymentMethod: z.enum(['BOLETO', 'PIX', 'CARTAO_CREDITO']).nullable().optional(),
  enrollmentFeePaymentMethod: z.enum(['BOLETO', 'PIX', 'CARTAO_CREDITO']).nullable().optional(),
  dueDay: z.number().int().min(1).max(28).nullable().optional(),
  enrollmentFeeAmount: z.number().min(0).nullable().optional(),
  enrollmentFeeExempt: z.boolean().nullable().optional(),
  enrollmentFeeJustification: z.string().trim().nullable().optional(),
  feeChargeMoment: z.enum(['CHARGE_ON_CONFIRMATION', 'CHARGE_ON_START', 'EXEMPT']).nullable().optional(),
  feeUnit: z.enum(['NO_FEE', 'PER_STUDENT', 'PER_FAMILY']).nullable().optional(),
  feePurpose: z.enum(['ADMINISTRATIVE_FEE', 'SEAT_RESERVATION', 'ADVANCE_FIRST_TUITION']).nullable().optional(),
  monthlyAmount: z.number().min(0).nullable().optional(),
  lateFeePercent: z.number().min(0).nullable().optional(),
  interestMonthlyPercent: z.number().min(0).nullable().optional(),
  earlyDiscountPercent: z.number().min(0).nullable().optional(),
  earlyDiscountDays: z.number().int().min(0).nullable().optional(),
  reason: z.string().trim().min(1),
});

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, details } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

function parseDate(value?: string | null) {
  if (value === undefined) return undefined;
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('DATA_INVALIDA');
  return date;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado.');
  if (!hasRenewalPermission(user.role, 'renewal.process.edit_future')) {
    return jsonError(403, 'PERMISSAO_NEGADA', 'Usuário não tem permissão para editar próximo ciclo.');
  }
  try {
    await assertPlatformAccessForConta({ contaId: user.contaId, capability: 'ENROLLMENT_WRITE' });
  } catch {
    return jsonError(402, 'PLATFORM_BILLING_ACCESS_RESTRICTED', 'Regularize o plano e faturamento para continuar.');
  }

  try {
    const { id } = await context.params;
    const body = futureLinkSchema.parse(await request.json().catch(() => null));
    const result = await editRenewalFutureLink(
      {
        contaId: user.contaId,
        actorId: user.id,
        processId: id,
        targetClassId: body.targetClassId,
        targetComboId: body.targetComboId,
        targetPlanId: body.targetPlanId,
        holderType: body.holderType,
        holderId: body.holderId,
        effectiveAt: parseDate(body.effectiveAt),
        firstDueDate: parseDate(body.firstDueDate),
        targetContractEndsAt: parseDate(body.targetContractEndsAt),
        contractModelId: body.contractModelId,
        paymentMethod: body.paymentMethod,
        enrollmentFeePaymentMethod: body.enrollmentFeePaymentMethod,
        dueDay: body.dueDay,
        enrollmentFeeAmount: body.enrollmentFeeAmount,
        enrollmentFeeExempt: body.enrollmentFeeExempt,
        enrollmentFeeJustification: body.enrollmentFeeJustification,
        feeChargeMoment: body.feeChargeMoment,
        feeUnit: body.feeUnit,
        feePurpose: body.feePurpose,
        monthlyAmount: body.monthlyAmount,
        lateFeePercent: body.lateFeePercent,
        interestMonthlyPercent: body.interestMonthlyPercent,
        earlyDiscountPercent: body.earlyDiscountPercent,
        earlyDiscountDays: body.earlyDiscountDays,
        reason: body.reason,
      },
      { prisma },
    );

    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonError(400, 'PAYLOAD_INVALIDO', 'Payload inválido.', error.issues);
    }
    if (error instanceof Error && error.message === 'REMATRICULA_NAO_ENCONTRADA') {
      return jsonError(404, 'REMATRICULA_NAO_ENCONTRADA', 'Processo não encontrado.');
    }
    if (error instanceof Error && error.message === 'REMATRICULA_NAO_EDITAVEL') {
      return jsonError(409, 'REMATRICULA_NAO_EDITAVEL', 'Esta rematrícula não pode mais ser editada.');
    }
    if (error instanceof Error && error.message === 'REMATRICULA_NAO_EDITAVEL_APOS_INICIO') {
      return jsonError(
        409,
        'REMATRICULA_NAO_EDITAVEL_APOS_INICIO',
        'Esta rematrícula já chegou à data de início do próximo ciclo.',
      );
    }
    if (error instanceof Error && error.message.endsWith('_OBRIGATORIO')) {
      return jsonError(422, error.message, 'Dados obrigatórios ausentes para editar o próximo ciclo.');
    }
    if (error instanceof Error && error.message.includes('INVALID')) {
      return jsonError(422, error.message, 'Destino futuro inválido para esta conta.');
    }
    return jsonError(
      500,
      'ERRO_EDITAR_PROXIMO_CICLO',
      error instanceof Error ? error.message : 'Erro ao editar próximo ciclo.',
    );
  }
}
