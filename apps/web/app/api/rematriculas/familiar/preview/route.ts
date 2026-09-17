import { NextResponse } from 'next/server';

import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import {
  formatRematriculaFamiliarValidationMessage,
  isRematriculaFamiliarPreviewBusinessError,
  parseRematriculaFamiliarDate,
  rematriculaFamiliarPreviewInputDTOSchema,
} from '@/lib/api/rematricula-familiar-input';
import {
  getRenewalPreviewStudentNames,
  previewRenewalProcessForTenant,
  validateRenewalPreviewReferences,
} from '@/src/server/matriculas/renewal-preview-http.service';
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
  if (
    item.decision === 'REMATRICULAR_AGORA' ||
    item.decision === 'TRANSFERIR_MODALIDADE' ||
    item.decision === 'ALTERAR_PAGADOR' ||
    item.decision === 'REMATRICULAR_SEPARADAMENTE'
  ) {
    if (item.comboId) {
      return {
        decision: 'RENEW' as const,
        sourceEnrollmentId: item.matriculaId,
        target: { type: 'COMBO' as const, targetId: item.comboId, planId: item.planoId ?? item.comboId },
        separateBilling: item.decision === 'REMATRICULAR_SEPARADAMENTE',
      };
    }
    return {
      decision: 'RENEW' as const,
      sourceEnrollmentId: item.matriculaId,
      target: { type: 'CLASS' as const, targetId: item.turmaId ?? '', planId: item.planoId ?? '' },
      separateBilling: item.decision === 'REMATRICULAR_SEPARADAMENTE',
    };
  }

  return {
    decision: item.decision === 'DECIDIR_DEPOIS' ? ('DECIDE_LATER' as const) : ('DO_NOT_CONTINUE' as const),
    sourceEnrollmentId: item.matriculaId,
    target: null,
  };
}

export async function POST(request: Request) {
  const auth = await resolveTenantSession();
  if (!auth.ok) {
    return jsonError(
      auth.reason === 'CONTA_MISMATCH' ? 403 : 401,
      auth.reason === 'CONTA_MISMATCH' ? 'CONTA_INVALIDA' : 'NAO_AUTENTICADO',
      auth.reason === 'CONTA_MISMATCH' ? 'Conta informada não pertence ao usuário.' : 'Usuário não autenticado.',
    );
  }
  if (!allowedRoles.has(String(auth.role).toUpperCase())) {
    return jsonError(403, 'PERMISSAO_NEGADA', 'Usuário não tem permissão para rematrícula familiar.');
  }

  const user = { id: auth.userId, contaId: auth.contaId, role: auth.role };

  try {
    const raw = await request.json().catch(() => null);
    const body = rematriculaFamiliarPreviewInputDTOSchema.parse(raw);
    const contaId = body.contaId?.trim() || user.contaId;

    if (contaId !== user.contaId) {
      return jsonError(403, 'CONTA_INVALIDA', 'Conta informada não pertence ao usuário.');
    }

    const holderId = body.novoResponsavelId ?? body.responsavelId;

    const hasPayerChangeDecision = body.itens.some((item) => item.decision === 'ALTERAR_PAGADOR');
    if (hasPayerChangeDecision !== Boolean(body.novoResponsavelId)) {
      return jsonError(
        422,
        'RESPONSAVEL_INCONSISTENTE',
        'A alteração de pagador exige selecionar um novo responsável e só pode ser usada com essa decisão.',
      );
    }
    const renewedDecisions = body.itens
      .filter((item) => ['REMATRICULAR_AGORA', 'TRANSFERIR_MODALIDADE', 'ALTERAR_PAGADOR', 'REMATRICULAR_SEPARADAMENTE'].includes(item.decision))
      .map((item) => item.decision);
    if (hasPayerChangeDecision && renewedDecisions.some((decision) => decision !== 'ALTERAR_PAGADOR')) {
      return jsonError(
        422,
        'ALTERACAO_PAGADOR_MISTA_NAO_SUPORTADA',
        'A alteração de pagador deve ser confirmada em uma rematrícula separada para não alterar os demais vínculos da família.',
      );
    }

    const dataInicio = parseRematriculaFamiliarDate(body.dataInicio);
    const targetPeriodId = body.targetPeriodId ?? String(dataInicio.getUTCFullYear());
    const campaignId = body.campaignId ?? null;
    const references = await validateRenewalPreviewReferences({ contaId, responsavelId: body.responsavelId, novoResponsavelId: body.novoResponsavelId, campaignId, targetPeriodId });
    if (!references.ok) return jsonError(404, references.code, references.message);

    const preview = await previewRenewalProcessForTenant(
      {
        contaId,
        actorId: user.id,
        origin: campaignId ? 'CAMPAIGN' : 'STANDALONE',
        campaignId,
        targetPeriodId,
        holderType: 'RESPONSIBLE',
        holderId,
        sourceHolderId: body.responsavelId,
        futureBillingStrategy: body.futureBillingStrategy,
        descontos: body.descontos,
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
          enrollmentFeeJustification: body.taxaJustificativa ?? null,
          feeChargeMoment: 'CHARGE_ON_START',
          feeUnit: body.taxaMatricula > 0 ? 'PER_STUDENT' : 'NO_FEE',
          feePurpose: 'ADMINISTRATIVE_FEE',
          lateFeePercent: body.multaPercentual ?? null,
          interestMonthlyPercent: body.jurosMensal ?? null,
          earlyDiscountPercent: body.descontoAntecipado,
          earlyDiscountType: body.descontoTipo ?? 'PERCENTAGE',
          earlyDiscountDays: body.prazoDesconto,
          notificationChannels: body.notificationChannels,
          notificationChannelsConfigured: body.notificationChannelsConfigured,
        },
      },
    );

    const studentNameByEnrollmentId = await getRenewalPreviewStudentNames({ contaId, matriculaIds: body.itens.map((item) => item.matriculaId) });
    const financialGroupsByKey = new Map<string, {
      totalAmount: number;
      items: Array<{ sourceEnrollmentId: string; alunoNome: string; amount: number }>;
    }>();
    for (const target of preview.targetEnrollments) {
      const key = target.separateBilling ? `ITEM:${target.sourceEnrollmentId}` : 'SHARED';
      const group = financialGroupsByKey.get(key) ?? { totalAmount: 0, items: [] };
      group.totalAmount += target.monthlyAmount;
      group.items.push({
        sourceEnrollmentId: target.sourceEnrollmentId,
        alunoNome: studentNameByEnrollmentId.get(target.sourceEnrollmentId) ?? '',
        amount: target.monthlyAmount,
      });
      financialGroupsByKey.set(key, group);
    }

    return NextResponse.json(
      {
        previewId: preview.previewHash,
        previewHash: preview.previewHash,
        sourceVersion: preview.sourceVersion,
        blocks: preview.blockers,
        warnings: preview.warnings,
        sourceBillingAction: 'NONE',
        financialGroups: Array.from(financialGroupsByKey.entries()).map(([key, group]) => ({
          compatibilityKey: `${holderId}:${preview.effectiveAt}:${key}`,
          totalAmount: group.totalAmount,
          items: group.items,
        })),
        futureAgreementCandidates: preview.futureAgreementCandidates,
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
    if (error instanceof Error && error.message === 'Data inválida.') {
      return jsonError(400, 'DATA_INVALIDA', 'Informe uma data de rematrícula válida.');
    }
    if (error instanceof ZodError) {
      return jsonError(
        400,
        'PAYLOAD_INVALIDO',
        formatRematriculaFamiliarValidationMessage(error.issues),
        error.issues,
      );
    }

    if (error instanceof Error && isRematriculaFamiliarPreviewBusinessError(error.message)) {
      return jsonError(422, 'PREVIEW_BLOQUEADO', 'O preview não pode ser gerado para esta composição.');
    }

    return jsonError(
      500,
      'ERRO_PREVIEW_REMATRICULA_FAMILIAR',
      'Erro ao gerar preview.',
    );
  }
}
