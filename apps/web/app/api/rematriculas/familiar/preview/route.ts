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

    const responsavel = await prisma.responsavel.findFirst({
      where: { id: body.responsavelId, contaId },
      select: { id: true },
    });
    if (!responsavel) {
      return jsonError(404, 'RESPONSAVEL_NAO_ENCONTRADO', 'Responsável não encontrado.');
    }
    const holderId = body.novoResponsavelId ?? body.responsavelId;
    if (body.novoResponsavelId) {
      const novoResponsavel = await prisma.responsavel.findFirst({
        where: { id: body.novoResponsavelId, contaId },
        select: { id: true },
      });
      if (!novoResponsavel) {
        return jsonError(404, 'NOVO_RESPONSAVEL_NAO_ENCONTRADO', 'Novo responsável não encontrado.');
      }
    }

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
      { prisma },
    );

    const sourceStudents = await prisma.matricula.findMany({
      where: {
        contaId,
        id: { in: body.itens.map((item) => item.matriculaId) },
      },
      select: { id: true, aluno: { select: { nome: true } } },
    });
    const studentNameByEnrollmentId = new Map(
      sourceStudents.map((item) => [item.id, item.aluno.nome]),
    );
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
      return jsonError(422, 'PREVIEW_BLOQUEADO', error.message);
    }

    return jsonError(
      500,
      'ERRO_PREVIEW_REMATRICULA_FAMILIAR',
      error instanceof Error ? error.message : 'Erro ao gerar preview.',
    );
  }
}
