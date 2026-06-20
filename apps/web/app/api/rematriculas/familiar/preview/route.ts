import { NextResponse } from 'next/server';

import { getSessionUser } from '@/lib/auth/session';
import {
  formatRematriculaFamiliarValidationMessage,
  isRematriculaFamiliarPreviewBusinessError,
  parseRematriculaFamiliarDate,
  rematriculaFamiliarPreviewInputSchema,
} from '@/lib/api/rematricula-familiar-input';
import { prisma } from '@/prisma/client';
import { previewRenewalProcess } from '@/src/server/matriculas/renewal-process.service';
import { ZodError } from 'zod';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO', 'RECEPCAO']);

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, details } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

function mapDecision(item: {
  decision: string;
  matriculaId: string;
  turmaId?: string | null;
  planoId?: string | null;
  comboId?: string | null;
}) {
  if (item.decision === 'REMATRICULAR_AGORA') {
    if (item.comboId) {
      return {
        decision: 'RENEW' as const,
        sourceEnrollmentId: item.matriculaId,
        target: { type: 'COMBO' as const, targetId: item.comboId, planId: item.planoId ?? item.comboId },
      };
    }
    return {
      decision: 'RENEW' as const,
      sourceEnrollmentId: item.matriculaId,
      target: { type: 'CLASS' as const, targetId: item.turmaId ?? '', planId: item.planoId ?? '' },
    };
  }

  return {
    decision: item.decision === 'DECIDIR_DEPOIS' ? ('DECIDE_LATER' as const) : ('DO_NOT_CONTINUE' as const),
    sourceEnrollmentId: item.matriculaId,
    target: null,
  };
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado.');
  if (!allowedRoles.has(String(user.role).toUpperCase())) {
    return jsonError(403, 'PERMISSAO_NEGADA', 'Usuário não tem permissão para rematrícula familiar.');
  }

  try {
    const raw = await request.json().catch(() => null);
    const body = rematriculaFamiliarPreviewInputSchema.parse(raw);
    const contaId = body.contaId?.trim() || user.contaId;

    if (contaId !== user.contaId) {
      return jsonError(403, 'CONTA_INVALIDA', 'Conta informada não pertence ao usuário.');
    }

    const dataInicio = parseRematriculaFamiliarDate(body.dataInicio);
    const targetPeriodId = body.targetPeriodId ?? String(dataInicio.getUTCFullYear());
    const campaignId = body.campaignId ?? null;
    if (campaignId) {
      const campaign = await prisma.rematriculaCampanha.findFirst({
        where: { id: campaignId, contaId, targetPeriodId },
        select: { id: true },
      });
      if (!campaign) {
        return jsonError(404, 'CAMPANHA_NAO_ENCONTRADA', 'Campanha não encontrada para este período.');
      }
    }

    const preview = await previewRenewalProcess(
      {
        contaId,
        actorId: user.id,
        origin: campaignId ? 'CAMPAIGN' : 'STANDALONE',
        campaignId,
        targetPeriodId,
        holderType: 'RESPONSIBLE',
        holderId: body.responsavelId,
        items: body.itens.map(mapDecision),
        effectiveAt: dataInicio,
        targetContractEndsAt: parseRematriculaFamiliarDate(body.dataFimContrato),
        contractModelId: body.contratoModeloId,
        financialTerms: {
          paymentMethod: body.formaPagamento,
          enrollmentFeePaymentMethod: body.formaPagamentoTaxa ?? body.formaPagamento,
          dueDay: body.vencimentoDia,
          enrollmentFeeAmount: body.taxaMatricula,
          enrollmentFeeExempt: body.taxaIsenta,
          feeChargeMoment: 'CHARGE_ON_START',
          feeUnit: body.taxaMatricula > 0 ? 'PER_STUDENT' : 'NO_FEE',
          feePurpose: 'ADMINISTRATIVE_FEE',
        },
      },
      { prisma },
    );

    return NextResponse.json(
      {
        previewId: preview.previewHash,
        previewHash: preview.previewHash,
        blocks: preview.blockers,
        warnings: preview.warnings,
        sourceBillingAction: 'NONE',
        financialGroups: preview.futureFinancialAgreement
          ? [
              {
                compatibilityKey: `${body.responsavelId}:${preview.effectiveAt}`,
                totalAmount: preview.monthlyTotal,
                items: preview.targetEnrollments.map((item) => ({
                  sourceEnrollmentId: item.sourceEnrollmentId,
                  alunoNome: '',
                  amount: 0,
                })),
              },
            ]
          : [],
        reenrollNow: preview.targetEnrollments.map((item) => item.sourceEnrollmentId),
        notContinuing: body.itens
          .filter((item) => item.decision === 'NAO_CONTINUARA')
          .map((item) => item.matriculaId),
        decideLater: body.itens
          .filter((item) => item.decision === 'DECIDIR_DEPOIS')
          .map((item) => item.matriculaId),
      },
      { status: 201, headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonError(
        400,
        'PAYLOAD_INVALIDO',
        formatRematriculaFamiliarValidationMessage(error.issues),
        error.issues,
      );
    }

    if (error instanceof Error && isRematriculaFamiliarPreviewBusinessError(error.message)) {
      return jsonError(422, 'PREVIEW_BLOQUEADO', error.message);
    }

    return jsonError(
      500,
      'ERRO_PREVIEW_REMATRICULA_FAMILIAR',
      error instanceof Error ? error.message : 'Erro ao gerar preview.',
    );
  }
}
