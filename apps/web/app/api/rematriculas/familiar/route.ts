import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

import { getSessionUser } from '@/lib/auth/session';
import {
  formatRematriculaFamiliarValidationMessage,
  parseRematriculaFamiliarDate,
  rematriculaFamiliarCommitInputSchema,
} from '@/lib/api/rematricula-familiar-input';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import { prisma } from '@/prisma/client';
import {
  confirmRenewalProcess,
  previewRenewalProcess,
} from '@/src/server/matriculas/renewal-process.service';
import { assertPlatformAccessForConta } from '@/src/server/platform-billing/capacity';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO', 'RECEPCAO']);

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, details } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

function parseDate(value: string) {
  return parseRematriculaFamiliarDate(value);
}

function sanitizeMessage(message: string) {
  return message
    .replace(/Asaas/gi, 'serviço financeiro')
    .replace(/webhooks?/gi, 'confirmações automáticas')
    .replace(/provedor/gi, 'serviço financeiro');
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
    await assertPlatformAccessForConta({ contaId: user.contaId, capability: 'ENROLLMENT_WRITE' });
  } catch {
    return jsonError(402, 'PLATFORM_BILLING_ACCESS_RESTRICTED', 'Regularize o plano e faturamento para continuar.');
  }

  try {
    const raw = await request.json().catch(() => null);
    const body = rematriculaFamiliarCommitInputSchema.parse(raw);
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

    if (body.contratoModeloId) {
      const modelo = await prisma.contratoModelo.findFirst({
        where: { id: body.contratoModeloId, contaId, status: 'ATIVO' },
        select: { id: true },
      });
      if (!modelo) {
        return jsonError(422, 'CONTRATO_MODELO_INVALIDO', 'Modelo de contrato não encontrado.');
      }
    }

    const gate = await guardFinancialAccountOr412(contaId);
    if (!gate.ok) return gate.response;

    const dataInicio = parseDate(body.dataInicio);
    const dataFimContrato = parseDate(body.dataFimContrato);
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
    const renewalInput = {
      contaId,
      actorId: user.id,
      origin: campaignId ? ('CAMPAIGN' as const) : ('STANDALONE' as const),
      campaignId,
      targetPeriodId,
      targetPeriodStartsAt: dataInicio,
      holderType: 'RESPONSIBLE' as const,
      holderId,
      sourceHolderId: body.responsavelId,
      futureBillingStrategy: body.futureBillingStrategy,
      descontos: body.descontos,
      items: body.itens.map(mapDecision),
      effectiveAt: dataInicio,
      targetContractEndsAt: dataFimContrato,
      contractModelId: body.contratoModeloId,
      financialTerms: {
        paymentMethod: body.formaPagamento,
        enrollmentFeePaymentMethod: body.formaPagamentoTaxa ?? body.formaPagamento,
        dueDay: body.vencimentoDia,
        enrollmentFeeAmount: body.taxaMatricula,
        enrollmentFeeExempt: body.taxaIsenta,
        feeChargeMoment: 'CHARGE_ON_START' as const,
        feeUnit: body.taxaMatricula > 0 ? ('PER_STUDENT' as const) : ('NO_FEE' as const),
        feePurpose: 'ADMINISTRATIVE_FEE' as const,
        earlyDiscountPercent: body.descontoAntecipado,
        earlyDiscountDays: body.prazoDesconto,
      },
    };
    const preview = await previewRenewalProcess(renewalInput, { prisma });
    if (preview.blockers.length > 0) {
      return jsonError(422, 'PREVIEW_BLOQUEADO', preview.blockers[0]?.message ?? 'Preview bloqueado.', {
        blockers: preview.blockers,
      warnings: preview.warnings,
      futureAgreementCandidates: preview.futureAgreementCandidates,
      });
    }

    if (body.previewHash && body.previewHash !== preview.previewHash) {
      return jsonError(
        409,
        'TRANSICAO_DESATUALIZADA',
        'O estado da composição mudou. Gere um novo preview antes de confirmar.',
      );
    }
    if (body.sourceVersion && body.sourceVersion !== preview.sourceVersion) {
      return jsonError(
        409,
        'TRANSICAO_DESATUALIZADA',
        'O estado das matrículas mudou. Gere um novo preview antes de confirmar.',
      );
    }

    const result = await confirmRenewalProcess(
      {
        ...renewalInput,
        previewHash: preview.previewHash,
        sourceVersion: preview.sourceVersion,
        idempotencyKey: body.uiRequestId,
      },
      { prisma },
    );

    const confirmedItems = await prisma.rematriculaItem.findMany({
      where: { contaId, processoId: result.processId },
      include: {
        matriculaOrigem: { select: { alunoId: true, aluno: { select: { nome: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const requestedDecisionByEnrollmentId = new Map(
      body.itens.map((item) => [item.matriculaId, item.decision]),
    );

    return NextResponse.json(
      {
        familyId: result.processId,
        transitionId: result.processId,
        status: result.status,
        step: preview.renewCount > 0 ? 'FUTURE_CYCLE_PREPARED' : 'DECISIONS_SAVED',
        academicStatus: preview.renewCount > 0 ? 'SCHEDULED' : 'NO_TARGET_ENROLLMENT',
        sourceBillingStatus: 'CURRENT_UNCHANGED',
        targetBillingStatus: preview.renewCount > 0 ? 'SCHEDULED' : 'NOT_APPLICABLE',
        contractStatus: body.contratoModeloId ? 'WAITING_SIGNATURE' : 'NOT_SELECTED',
        previewHash: preview.previewHash,
        sourceVersion: preview.sourceVersion,
        warnings: preview.warnings,
        results: confirmedItems.map((item) => ({
          matriculaId: item.matriculaOrigemId,
          alunoId: item.matriculaOrigem.alunoId,
          alunoNome: item.matriculaOrigem.aluno.nome,
          decision:
            item.decision === 'RENEW'
              ? requestedDecisionByEnrollmentId.get(item.matriculaOrigemId) ?? 'REMATRICULAR_AGORA'
              : item.decision === 'DECIDE_LATER'
                ? 'DECIDIR_DEPOIS'
                : 'NAO_CONTINUARA',
          status: item.decision === 'RENEW' ? 'pending' : 'success',
          novaMatriculaId: item.matriculaFuturaId,
        })),
      },
      { status: 202, headers: { 'cache-control': 'no-store' } },
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

    if (error instanceof Error && error.message === 'TRANSICAO_DESATUALIZADA') {
      return jsonError(
        409,
        'TRANSICAO_DESATUALIZADA',
        'O estado da composição mudou. Gere um novo preview antes de confirmar.',
      );
    }

    console.error('[POST /api/rematriculas/familiar]', error);
    return jsonError(
      500,
      'ERRO_REMATRICULA_FAMILIAR',
      sanitizeMessage(error instanceof Error ? error.message : 'Erro ao criar rematrícula familiar.'),
    );
  }
}
