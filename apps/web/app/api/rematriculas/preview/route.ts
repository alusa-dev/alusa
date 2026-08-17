import { NextResponse } from 'next/server';
import { z, ZodError } from 'zod';

import { getSessionUser } from '@/lib/auth/session';
import { prisma } from '@/prisma/client';
import { previewRenewalProcess } from '@/src/server/matriculas/renewal-process.service';
import { hasRenewalPermission } from '@/src/server/matriculas/renewal-permissions.service';
import { assertPlatformAccessForConta } from '@/src/server/platform-billing/capacity';

const renewalItemSchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('RENEW'),
    sourceEnrollmentId: z.string().trim().min(1),
    target: z.object({
      type: z.enum(['CLASS', 'COMBO']),
      targetId: z.string().trim().min(1),
      planId: z.string().trim().min(1),
    }),
  }),
  z.object({
    decision: z.enum(['DECIDE_LATER', 'DO_NOT_CONTINUE']),
    sourceEnrollmentId: z.string().trim().min(1),
    target: z.null(),
  }),
]);

const previewSchema = z.object({
  origin: z.enum(['CAMPAIGN', 'STANDALONE']).default('STANDALONE'),
  campaignId: z.string().trim().nullable().optional(),
  targetPeriodId: z.string().trim().min(1),
  targetPeriodStartsAt: z.string().datetime().or(z.string().date()).nullable().optional(),
  holderType: z.enum(['STUDENT', 'RESPONSIBLE']),
  holderId: z.string().trim().min(1),
  futureBillingStrategy: z
    .object({
      mode: z.enum(['SEPARATE', 'UNIFY_EXISTING']),
      agreementId: z.string().trim().nullable().optional(),
    })
    .optional(),
  descontos: z.array(z.object({ id: z.string().trim().min(1), cumulativo: z.boolean().optional() })).optional(),
  items: z.array(renewalItemSchema).min(1),
  effectiveAt: z.string().datetime().or(z.string().date()).nullable().optional(),
  firstDueDate: z.string().datetime().or(z.string().date()).nullable().optional(),
  contractModelId: z.string().trim().nullable().optional(),
  financialTerms: z
    .object({
      paymentMethod: z.enum(['BOLETO', 'PIX', 'CARTAO_CREDITO']).nullable().optional(),
      enrollmentFeePaymentMethod: z.enum(['BOLETO', 'PIX', 'CARTAO_CREDITO']).nullable().optional(),
      dueDay: z.number().int().min(1).max(31).nullable().optional(),
      enrollmentFeeAmount: z.number().nonnegative().nullable().optional(),
      enrollmentFeeExempt: z.boolean().nullable().optional(),
      feeChargeMoment: z.enum(['CHARGE_ON_CONFIRMATION', 'CHARGE_ON_START', 'EXEMPT']).optional(),
      feeUnit: z.enum(['NO_FEE', 'PER_STUDENT', 'PER_FAMILY']).optional(),
      feePurpose: z
        .enum(['ADMINISTRATIVE_FEE', 'SEAT_RESERVATION', 'ADVANCE_FIRST_TUITION'])
        .optional(),
      earlyDiscountPercent: z.number().nonnegative().nullable().optional(),
      earlyDiscountDays: z.number().int().nonnegative().nullable().optional(),
    })
    .nullable()
    .optional(),
});

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, details } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

function parseDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado.');
  if (!hasRenewalPermission(user.role, 'renewal.process.confirm')) {
    return jsonError(403, 'PERMISSAO_NEGADA', 'Usuário não tem permissão para rematrículas.');
  }
  try {
    await assertPlatformAccessForConta({ contaId: user.contaId, capability: 'ENROLLMENT_WRITE' });
  } catch {
    return jsonError(402, 'PLATFORM_BILLING_ACCESS_RESTRICTED', 'Regularize o plano e faturamento para continuar.');
  }

  try {
    const raw = await request.json().catch(() => null);
    const body = previewSchema.parse(raw);
    const preview = await previewRenewalProcess(
      {
        contaId: user.contaId,
        actorId: user.id,
        origin: body.origin,
        campaignId: body.campaignId,
        targetPeriodId: body.targetPeriodId,
        targetPeriodStartsAt: parseDate(body.targetPeriodStartsAt),
        holderType: body.holderType,
        holderId: body.holderId,
        futureBillingStrategy: body.futureBillingStrategy,
        descontos: body.descontos,
        items: body.items,
        effectiveAt: parseDate(body.effectiveAt),
        firstDueDate: parseDate(body.firstDueDate),
        contractModelId: body.contractModelId,
        financialTerms: body.financialTerms,
      },
      { prisma },
    );

    return NextResponse.json(preview, { status: 200, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonError(400, 'PAYLOAD_INVALIDO', 'Payload inválido.', error.issues);
    }

    return jsonError(
      500,
      'ERRO_PREVIEW_REMATRICULA',
      error instanceof Error ? error.message : 'Erro ao gerar preview.',
    );
  }
}
