import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth/session';
import { AsaasEnvError, AsaasHttpError, KycNotApprovedError, buildStandaloneExternalReference, deletePayment, getTodayBrasiliaDateString, handlePaymentWebhook, isAsaasEnabled, readPaymentFullPreflight, resolveOperationalChargePayment, syncPaymentStateFromAsaas, updatePayment, auditLogService, evaluatePaymentActionPolicy, runAsaasPaymentCommand, buildCobrancaAsaasPaymentUpdatePayload, normalizeCobrancaPaymentAdjustmentType, resolveCanonicalDiscountDueDateLimit } from '@alusa/finance';

import { cobrancaMutationResultDTOSchema, cobrancaUpdateInputDTOSchema } from '@/features/financeiro/cobrancas/dtos';
import { mapCobrancaMutationResultToDTO } from '@/features/financeiro/cobrancas/mappers';



import { getEffectiveRemotePaymentStatus, resolveAcademicPaymentOrigin } from '@/features/financeiro/cobrancas/display-status';
import { policyBlockedError } from '@/features/financeiro/cobrancas/mutation-errors';
import { convergeLocalCanceledPayment } from '@/features/financeiro/cobrancas/converge-local-canceled-payment';
import {
  applyImmediateDeletedPaymentConvergence,
  buildDeletedPaymentWebhookPayload,
} from '@/features/financeiro/cobrancas/deleted-payment-webhook';
import { logFinanceApiError } from '@/lib/api/finance-api-response';
import { invalidateChargeResourceCache } from '@/lib/cache/invalidation';




const FINANCIAL_MUTATION_ROLES = new Set(['ADMIN', 'FINANCEIRO']);

function canMutateCobranca(role: string | null | undefined): boolean {
  return Boolean(role && FINANCIAL_MUTATION_ROLES.has(role.toUpperCase()));
}

function invalidDueDateMessage(minimumDueDate: string): string {
  return `Não foi possível atualizar a cobrança. Informe uma data de vencimento igual ou posterior a ${minimumDueDate}. A cobrança permanece inalterada.`;
}

function getProviderMutationMessage(error: AsaasHttpError): string {
  const minimumDueDate = (error.message || '').match(/(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})/)?.[1];

  if (minimumDueDate) {
    return invalidDueDateMessage(minimumDueDate);
  }

  return 'Não foi possível atualizar a cobrança. Confira os dados informados e tente novamente. A cobrança permanece inalterada.';
}

/**
 * PUT /api/cobrancas/[id]
 * Atualiza dados de uma cobrança (valor, vencimento, juros, multa, desconto)
 * Apenas permite edição se status for PENDENTE ou A_VENCER
 */
export async function updateCobrancaRoute(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const rawParams = await params;
  try {
    const user = await getSessionUser();
    if (!user?.contaId) {
      return NextResponse.json({ success: false, error: 'Não autorizado' }, { status: 401 });
    }
    if (!canMutateCobranca(user.role)) {
      return NextResponse.json({ success: false, error: 'Sem permissão' }, { status: 403 });
    }
    const { contaId } = user;

    const { id } = rawParams;
    const parsedBody = cobrancaUpdateInputDTOSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) {
      return NextResponse.json(
        { success: false, error: 'Dados da cobrança inválidos' },
        { status: 400 },
      );
    }
    const body = parsedBody.data;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'ID da cobrança é obrigatório' },
        { status: 400 },
      );
    }

    // Buscar cobrança atual - MULTI-TENANT: filtra por contaId via aluno
    const cobrancaAtual = await prisma.cobranca.findFirst({
      where: { id, matricula: { aluno: { contaId } } },
      include: {
        matricula: {
          include: {
            aluno: true,
          },
        },
      },
    });

    const chargeAtual = !cobrancaAtual
      ? await prisma.charge.findFirst({
          where: { id, contaId },
          select: {
            id: true,
            status: true,
            asaasPaymentId: true,
            value: true,
            dueDate: true,
            description: true,
            billingType: true,
            invoiceUrl: true,
            standaloneInstallmentPlanId: true,
            standaloneSubscriptionId: true,
          },
        })
      : null;

    if (!cobrancaAtual && !chargeAtual) {
      return NextResponse.json(
        { success: false, error: 'Cobrança não encontrada' },
        { status: 404 },
      );
    }

    // Extrair campos editáveis
    const {
      valor,
      vencimento,
      descricao,
      formaPagamento, // não é atualizado por esta rota; existe rota dedicada
      // Campos detalhados de juros
      jurosPercentual,
      jurosValorFixo,
      juros,
      // Campos detalhados de multa
      multaTipo,
      multaPercentual,
      multaValorFixo,
      multa,
      // Campos detalhados de desconto
      descontoTipo,
      descontoPercentual,
      descontoValorFixo,
      descontoPrazoMaximo,
      desconto,
      // Valor final
      valorFinal,
    } = body;

    // Bloquear atualização de formaPagamento por esta rota para manter regras/auditoria
    if (typeof formaPagamento !== 'undefined') {
      return NextResponse.json(
        {
          success: false,
          error: 'Use /api/cobrancas/[id]/forma-pagamento para alterar a forma de pagamento.',
        },
        { status: 400 },
      );
    }

    const parseDateOnly = (value: string | Date) => {
      if (value instanceof Date) return value;
      // Espera YYYY-MM-DD – cria data estável sem shift de fuso
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return new Date(`${value}T12:00:00Z`);
      }
      const d = new Date(value);
      return d;
    };

    const normalizedMultaTipo = normalizeCobrancaPaymentAdjustmentType(multaTipo);
    const normalizedDescontoTipo = normalizeCobrancaPaymentAdjustmentType(descontoTipo);
    const canonicalDescontoPrazoMaximo = resolveCanonicalDiscountDueDateLimit({
      descontoPrazoMaximo,
      normalizedDescontoTipo,
      descontoPercentual,
      descontoValorFixo,
      desconto,
    });
    let asaasCommandJobId: string | null = null;

    // Validações básicas de domínio
    const isNeg = (n: unknown) => typeof n === 'number' && n < 0;
    if (typeof valor !== 'undefined' && isNeg(Number(valor))) {
      return NextResponse.json(
        { success: false, error: 'Valor não pode ser negativo' },
        { status: 400 },
      );
    }
    const percentInRange = (v: unknown) =>
      typeof v === 'number' && v >= 0 && v <= 100;
    if (typeof jurosPercentual !== 'undefined' && !percentInRange(Number(jurosPercentual))) {
      return NextResponse.json(
        { success: false, error: 'Juros percentual deve estar entre 0 e 100' },
        { status: 400 },
      );
    }
    if (typeof multaPercentual !== 'undefined' && !percentInRange(Number(multaPercentual))) {
      return NextResponse.json(
        { success: false, error: 'Multa percentual deve estar entre 0 e 100' },
        { status: 400 },
      );
    }
    if (
      typeof descontoPercentual !== 'undefined' &&
      !percentInRange(Number(descontoPercentual))
    ) {
      return NextResponse.json(
        { success: false, error: 'Desconto percentual deve estar entre 0 e 100' },
        { status: 400 },
      );
    }
    if (
      isNeg(Number(jurosValorFixo)) ||
      isNeg(Number(multaValorFixo)) ||
      isNeg(Number(descontoValorFixo))
    ) {
      return NextResponse.json(
        { success: false, error: 'Valores fixos não podem ser negativos' },
        { status: 400 },
      );
    }

    // O endpoint PUT /v3/payments/{id} do Asaas rejeita cobranças novas com
    // vencimento anterior ao dia corrente. Validamos a fronteira localmente
    // para devolver 422 ao cliente e evitar criar um job que falhará no
    // provedor, sem alterar cobranças locais sem integração com o Asaas.
    const requestedDueDate = vencimento ? String(vencimento).slice(0, 10) : null;
    const providerPaymentId = chargeAtual?.asaasPaymentId ?? cobrancaAtual?.asaasPaymentId ?? null;
    if (
      requestedDueDate &&
      providerPaymentId &&
      isAsaasEnabled() &&
      requestedDueDate < getTodayBrasiliaDateString()
    ) {
      const minimumDueDate = getTodayBrasiliaDateString();
      return NextResponse.json(
        {
          success: false,
          error: invalidDueDateMessage(minimumDueDate),
          code: 'DATA_VENCIMENTO_ASAAS_INVALIDA',
          minimumDueDate,
        },
        { status: 422, headers: { 'cache-control': 'no-store' } },
      );
    }

    if (chargeAtual) {
      const localPolicy = evaluatePaymentActionPolicy({
        entityType: 'CHARGE',
        origin: chargeAtual.standaloneInstallmentPlanId
          ? 'INSTALLMENT'
          : chargeAtual.standaloneSubscriptionId
            ? 'SUBSCRIPTION'
            : 'STANDALONE',
        localStatus: chargeAtual.status,
        billingType: chargeAtual.billingType,
        hasAsaasPaymentId: Boolean(chargeAtual.asaasPaymentId),
        hasInvoiceUrl: Boolean(chargeAtual.invoiceUrl),
        isInstallmentPayment: Boolean(chargeAtual.standaloneInstallmentPlanId),
        isSubscriptionPayment: Boolean(chargeAtual.standaloneSubscriptionId),
      });

      if (!localPolicy.canEdit) {
        return policyBlockedError({
          action: 'EDIT',
          decision: localPolicy.actions.EDIT,
          status: chargeAtual.status,
          source: 'LOCAL',
        });
      }

      if (isAsaasEnabled() && chargeAtual.asaasPaymentId) {
        const currentPayment = await readPaymentFullPreflight(chargeAtual.asaasPaymentId, { contaId });
        const remotePolicy = evaluatePaymentActionPolicy({
          entityType: 'CHARGE',
          origin: chargeAtual.standaloneInstallmentPlanId
            ? 'INSTALLMENT'
            : chargeAtual.standaloneSubscriptionId
              ? 'SUBSCRIPTION'
              : 'STANDALONE',
          localStatus: chargeAtual.status,
          asaasStatus: currentPayment.status,
          billingType: currentPayment.billingType ?? chargeAtual.billingType,
          hasAsaasPaymentId: true,
          hasInvoiceUrl: Boolean(chargeAtual.invoiceUrl || currentPayment.invoiceUrl),
          isInstallmentPayment: Boolean(chargeAtual.standaloneInstallmentPlanId),
          isSubscriptionPayment: Boolean(chargeAtual.standaloneSubscriptionId),
        });

        if (!remotePolicy.canEdit) {
          return policyBlockedError({
            action: 'EDIT',
            decision: remotePolicy.actions.EDIT,
            status: currentPayment.status,
            source: 'ASAAS',
          });
        }

        const updatePayload = buildCobrancaAsaasPaymentUpdatePayload({
          currentPayment,
          changes: {
            valor,
            vencimento,
            descricao,
            jurosPercentual,
            multaValorFixo,
            multaPercentual,
            descontoPercentual,
            descontoValorFixo,
            descontoPrazoMaximo: canonicalDescontoPrazoMaximo,
            desconto,
            normalizedMultaTipo,
            normalizedDescontoTipo,
          },
        });

        const { commandJobId } = await runAsaasPaymentCommand({
          contaId,
          type: 'PAYMENT_UPDATE_COMMAND',
          entityType: 'CHARGE',
          entityId: chargeAtual.id,
          asaasPaymentId: chargeAtual.asaasPaymentId,
          actorId: user.id,
          chargeId: chargeAtual.id,
          providerStatus: currentPayment.status,
          metadata: {
            source: 'PUT /api/cobrancas/[id]',
            changes: {
              valor,
              vencimento,
              descricao,
              jurosPercentual,
              multaTipo: normalizedMultaTipo,
              multaPercentual,
              descontoTipo: normalizedDescontoTipo,
              descontoPercentual,
              descontoValorFixo,
              descontoPrazoMaximo: canonicalDescontoPrazoMaximo,
            },
          },
          run: () => updatePayment(chargeAtual.asaasPaymentId!, updatePayload, { contaId }),
        });
        asaasCommandJobId = commandJobId;
      }

      const chargeAtualizada = await prisma.charge.update({
        where: { id: chargeAtual.id },
        data: {
          ...(valor !== undefined && { value: Number(valor) }),
          ...(vencimento !== undefined && { dueDate: parseDateOnly(vencimento) }),
          ...(descricao !== undefined && { description: descricao }),
          updatedAt: new Date(),
        },
      });

      await auditLogService.record({
        contaId,
        action: 'finance.charge.updated',
        entity: { type: 'Charge', id: chargeAtual.id },
        metadata: {
          asaasPaymentId: chargeAtual.asaasPaymentId,
          commandJobId: asaasCommandJobId,
          previousStatus: chargeAtual.status,
          changes: {
            valor,
            vencimento,
            descricao,
          },
          updatedBy: user.id,
        },
      });

      await invalidateChargeResourceCache({
        contaId,
        cobrancaId: chargeAtual.id,
        reason: 'charge-update',
      });

      return NextResponse.json(
        cobrancaMutationResultDTOSchema.parse(
          mapCobrancaMutationResultToDTO({
            success: true,
            data: chargeAtualizada,
            message:
              'Alteração enviada para processamento financeiro da Alusa. A atualização pode levar alguns instantes para refletir em toda a aplicação.',
          }),
        ),
        { status: 202 },
      );
    }

    if (!cobrancaAtual) {
      return NextResponse.json(
        { success: false, error: 'Cobrança não encontrada' },
        { status: 404 },
      );
    }

    const localPolicy = evaluatePaymentActionPolicy({
      entityType: 'COBRANCA',
      origin: resolveAcademicPaymentOrigin(cobrancaAtual.tipo),
      localStatus: cobrancaAtual.status,
      billingType: cobrancaAtual.formaPagamento,
      hasAsaasPaymentId: Boolean(cobrancaAtual.asaasPaymentId),
      hasInvoiceUrl: Boolean((cobrancaAtual as unknown as { charge?: { invoiceUrl?: string | null } }).charge?.invoiceUrl),
      isInstallmentPayment: cobrancaAtual.tipo === 'PARCELADA',
      isSubscriptionPayment: cobrancaAtual.tipo === 'RECORRENTE',
    });

    if (!localPolicy.canEdit) {
      return policyBlockedError({
        action: 'EDIT',
        decision: localPolicy.actions.EDIT,
        status: cobrancaAtual.status,
        source: 'LOCAL',
      });
    }

    // Se tiver asaasPaymentId, validar/atualizar no Asaas ANTES de mutar o banco local.
    // Se KYC não estiver aprovado, a operação falha sem side-effects locais.
    if (isAsaasEnabled() && cobrancaAtual.asaasPaymentId) {
      const contaIdForAsaas = cobrancaAtual.matricula?.aluno?.contaId;

      if (contaIdForAsaas) {
        const currentPayment = await readPaymentFullPreflight(cobrancaAtual.asaasPaymentId, { contaId: contaIdForAsaas });
        const remotePolicy = evaluatePaymentActionPolicy({
          entityType: 'COBRANCA',
          origin: resolveAcademicPaymentOrigin(cobrancaAtual.tipo),
          localStatus: cobrancaAtual.status,
          asaasStatus: currentPayment.status,
          billingType: currentPayment.billingType ?? cobrancaAtual.formaPagamento,
          hasAsaasPaymentId: true,
          hasInvoiceUrl: Boolean(currentPayment.invoiceUrl),
          isInstallmentPayment: cobrancaAtual.tipo === 'PARCELADA',
          isSubscriptionPayment: cobrancaAtual.tipo === 'RECORRENTE',
        });

        if (!remotePolicy.canEdit) {
          return policyBlockedError({
            action: 'EDIT',
            decision: remotePolicy.actions.EDIT,
            status: currentPayment.status,
            source: 'ASAAS',
          });
        }

        const updatePayload = buildCobrancaAsaasPaymentUpdatePayload({
          currentPayment,
          changes: {
            valor,
            vencimento,
            descricao,
            jurosPercentual,
            multaValorFixo,
            multaPercentual,
            descontoPercentual,
            descontoValorFixo,
            descontoPrazoMaximo: canonicalDescontoPrazoMaximo,
            desconto,
            normalizedMultaTipo,
            normalizedDescontoTipo,
          },
        });

        const { commandJobId } = await runAsaasPaymentCommand({
          contaId: contaIdForAsaas,
          type: 'PAYMENT_UPDATE_COMMAND',
          entityType: 'COBRANCA',
          entityId: cobrancaAtual.id,
          asaasPaymentId: cobrancaAtual.asaasPaymentId,
          actorId: user.id,
          cobrancaId: cobrancaAtual.id,
          providerStatus: currentPayment.status,
          metadata: {
            source: 'PUT /api/cobrancas/[id]',
            changes: {
              valor,
              vencimento,
              descricao,
              jurosPercentual,
              multaTipo: normalizedMultaTipo,
              multaPercentual,
              descontoTipo: normalizedDescontoTipo,
              descontoPercentual,
              descontoValorFixo,
              descontoPrazoMaximo: canonicalDescontoPrazoMaximo,
            },
          },
          run: () => updatePayment(cobrancaAtual.asaasPaymentId!, updatePayload, { contaId: contaIdForAsaas }),
        });
        asaasCommandJobId = commandJobId;
      }
    }

    // Atualizar cobrança - MULTI-TENANT: usar transação para garantir atomicidade
    const cobrancaAtualizada = await prisma.$transaction(async (tx) => {
      // Verificar novamente se o registro pertence à conta (dentro da transação)
      const verified = await tx.cobranca.findFirst({
        where: { id, matricula: { aluno: { contaId } } },
        select: { id: true },
      });
      if (!verified) {
        throw new Error('Cobrança não encontrada');
      }
      return tx.cobranca.update({
        where: { id },
        data: {
          ...(valor !== undefined && { valor }),
          ...(vencimento !== undefined && { vencimento: parseDateOnly(vencimento) }),
          ...(descricao !== undefined && { descricao }),
          // Atualizar campos de juros
          ...(jurosPercentual !== undefined && { jurosPercentual }),
          ...(jurosValorFixo !== undefined && { jurosValorFixo }),
          ...(juros !== undefined && { juros }),
          // Atualizar campos de multa
          ...(normalizedMultaTipo !== undefined && { multaTipo: normalizedMultaTipo }),
          ...(multaPercentual !== undefined && { multaPercentual }),
          ...(multaValorFixo !== undefined && { multaValorFixo }),
          ...(multa !== undefined && { multa }),
          // Atualizar campos de desconto
          ...(normalizedDescontoTipo !== undefined && { descontoTipo: normalizedDescontoTipo }),
          ...(descontoPercentual !== undefined && { descontoPercentual }),
          ...(descontoValorFixo !== undefined && { descontoValorFixo }),
          ...(canonicalDescontoPrazoMaximo !== undefined && {
            descontoPrazoMaximo: canonicalDescontoPrazoMaximo,
          }),
          ...(desconto !== undefined && { desconto }),
          // Valor final
          ...(valorFinal !== undefined && { valorFinal }),
        },
        include: {
          matricula: {
            include: {
              aluno: true,
            },
          },
        },
      });
    });

    await invalidateChargeResourceCache({
      contaId,
      cobrancaId: id,
      reason: 'cobranca-update',
    });

    return NextResponse.json(
      cobrancaMutationResultDTOSchema.parse(
        mapCobrancaMutationResultToDTO({
          success: true,
          data: cobrancaAtualizada,
          ...(asaasCommandJobId ? { commandJobId: asaasCommandJobId } : {}),
          message:
            'Alteração enviada para processamento financeiro da Alusa. A atualização pode levar alguns instantes para refletir em toda a aplicação.',
        }),
      ),
      { status: 202 },
    );
  } catch (error) {
    // KYC não aprovado → 409
    if (error instanceof KycNotApprovedError) {
      return NextResponse.json(
        { success: false, error: 'KYC_NAO_APROVADO' },
        { status: 409 },
      );
    }
    if (error instanceof AsaasEnvError) {
      return NextResponse.json(
        { success: false, error: 'ASAAS_INDISPONIVEL' },
        { status: 503 },
      );
    }
    if (error instanceof AsaasHttpError) {
      const correlationId = logFinanceApiError('PUT /api/cobrancas/[id]', error, {
        providerStatus: error.status,
      });

      if (error.status === 400 || error.status === 422) {
        return NextResponse.json(
          {
            success: false,
            error: getProviderMutationMessage(error),
            code: 'ASAAS_OPERACAO_REJEITADA',
            providerStatus: error.status,
            correlationId,
          },
          { status: 422, headers: { 'cache-control': 'no-store' } },
        );
      }

      if (error.status === 429) {
        return NextResponse.json(
          {
            success: false,
            error: 'A plataforma financeira está temporariamente indisponível. Tente novamente em alguns instantes.',
            code: 'ASAAS_TEMPORARIAMENTE_INDISPONIVEL',
            providerStatus: error.status,
            correlationId,
          },
          { status: 503, headers: { 'cache-control': 'no-store' } },
        );
      }

      if (error.status >= 500) {
        return NextResponse.json(
          {
            success: false,
            error: 'A plataforma financeira não conseguiu processar a alteração.',
            code: 'ASAAS_FALHA_PROCESSAMENTO',
            providerStatus: error.status,
            correlationId,
          },
          { status: 502, headers: { 'cache-control': 'no-store' } },
        );
      }

      return NextResponse.json(
        {
          success: false,
          error: 'A cobrança não pôde ser atualizada na plataforma financeira.',
          code: 'ASAAS_OPERACAO_REJEITADA',
          providerStatus: error.status,
          correlationId,
        },
        { status: error.status >= 400 && error.status < 500 ? 422 : 502, headers: { 'cache-control': 'no-store' } },
      );
    }
    const correlationId = logFinanceApiError('PUT /api/cobrancas/[id]', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Erro ao atualizar cobrança',
        correlationId,
      },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    );
  }
}

/**
 * DELETE /api/cobrancas/[id]
 * Solicita cancelamento de uma cobrança quando ela ainda está em aberto no fluxo financeiro
 * Não remove localmente: aguarda confirmação via webhook do Asaas.
 */
export async function deleteCobrancaRoute(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const rawParams = await params;
  try {
    const user = await getSessionUser();
    if (!user?.contaId) {
      return NextResponse.json({ success: false, error: 'Não autorizado' }, { status: 401 });
    }
    if (!canMutateCobranca(user.role)) {
      return NextResponse.json({ success: false, error: 'Sem permissão' }, { status: 403 });
    }
    const { contaId } = user;

    const { id } = rawParams;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'ID da cobrança é obrigatório' },
        { status: 400 },
      );
    }

    // Buscar cobrança acadêmica - MULTI-TENANT: filtra por contaId via aluno
    const cobranca = await prisma.cobranca.findFirst({
      where: { id, matricula: { aluno: { contaId } } },
      include: {
        matricula: {
          include: {
            aluno: {
              select: { contaId: true },
            },
          },
        },
      },
    });

    // Se não encontrou cobrança acadêmica, tentar Charge (standalone)
    if (!cobranca) {
      const charge = await prisma.charge.findFirst({
        where: { id, contaId },
        select: {
          id: true,
          status: true,
          asaasPaymentId: true,
          externalReference: true,
          billingType: true,
          invoiceUrl: true,
          standaloneInstallmentPlanId: true,
          standaloneSubscriptionId: true,
        },
      });

      if (!charge) {
        const operationalCharge = await resolveOperationalChargePayment(contaId, id);
        if (!operationalCharge) {
          return NextResponse.json(
            { success: false, error: 'Cobrança não encontrada' },
            { status: 404 },
          );
        }

        if (!isAsaasEnabled() || !operationalCharge.asaasPaymentId) {
          return NextResponse.json(
            { success: false, error: 'Cobrança sem integração Asaas' },
            { status: 400 },
          );
        }

        const localPolicy = evaluatePaymentActionPolicy({
          entityType: 'COBRANCA',
          origin: 'EVENT',
          localStatus: operationalCharge.localStatus,
          billingType: operationalCharge.billingType,
          hasAsaasPaymentId: true,
          hasInvoiceUrl: Boolean(operationalCharge.invoiceUrl),
        });

        if (!localPolicy.canCancel) {
          return policyBlockedError({
            action: 'CANCEL',
            decision: localPolicy.actions.CANCEL,
            status: operationalCharge.localStatus,
            source: 'LOCAL',
          });
        }

        let asaasCommandJobId: string | null = null;
        let remoteStatusBeforeCommand: string | null = null;

        try {
          const payment = await readPaymentFullPreflight(operationalCharge.asaasPaymentId, { contaId });
          const effectivePaymentStatus = getEffectiveRemotePaymentStatus(payment) ?? payment.status;
          remoteStatusBeforeCommand = effectivePaymentStatus;
          const remotePolicy = evaluatePaymentActionPolicy({
            entityType: 'COBRANCA',
            origin: 'EVENT',
            localStatus: operationalCharge.localStatus,
            asaasStatus: effectivePaymentStatus,
            billingType: payment.billingType ?? operationalCharge.billingType,
            hasAsaasPaymentId: true,
            hasInvoiceUrl: Boolean(operationalCharge.invoiceUrl || payment.invoiceUrl),
          });

          if (!remotePolicy.canCancel && effectivePaymentStatus !== 'DELETED') {
            return policyBlockedError({
              action: 'CANCEL',
              decision: remotePolicy.actions.CANCEL,
              status: effectivePaymentStatus,
              source: 'ASAAS',
            });
          }

          if (effectivePaymentStatus === 'DELETED') {
            let localStateConverged = false;
            try {
              localStateConverged = await applyImmediateDeletedPaymentConvergence(contaId, payment);
              await convergeLocalCanceledPayment({
                contaId,
                chargeId: operationalCharge.operationalId,
                asaasPaymentId: operationalCharge.asaasPaymentId,
                actorId: user.id,
                reason: 'Cobrança já estava cancelada no Asaas',
              });
              localStateConverged = true;
            } catch (webhookError) {
              console.warn('[DELETE /api/cobrancas/[id]] Falha ao reconciliar cobrança já deletada (event)', {
                operationalId: operationalCharge.operationalId,
                asaasPaymentId: operationalCharge.asaasPaymentId,
                error: webhookError instanceof Error ? webhookError.message : String(webhookError),
              });
            }

            return NextResponse.json(
              cobrancaMutationResultDTOSchema.parse(
                mapCobrancaMutationResultToDTO({
                  success: true,
                  pending: !localStateConverged,
                  message: localStateConverged
                    ? 'Cobrança já estava cancelada no Asaas e foi sincronizada localmente.'
                    : 'Cobrança já estava cancelada no Asaas.',
                }),
              ),
              { status: localStateConverged ? 200 : 202 },
            );
          }
        } catch (readErr) {
          if (readErr instanceof KycNotApprovedError) throw readErr;
          console.warn('[DELETE /api/cobrancas/[id]] Read-before-write falhou (event), seguindo com delete', {
            asaasPaymentId: operationalCharge.asaasPaymentId,
            error: readErr instanceof Error ? readErr.message : String(readErr),
          });
        }

        const { result: deletedPayment, commandJobId } = await runAsaasPaymentCommand({
          contaId,
          type: 'PAYMENT_CANCEL_COMMAND',
          entityType: 'CHARGE',
          entityId: operationalCharge.operationalId,
          asaasPaymentId: operationalCharge.asaasPaymentId,
          actorId: user.id,
          providerStatus: remoteStatusBeforeCommand,
          metadata: {
            source: 'DELETE /api/cobrancas/[id]',
            origin: 'EVENT',
            previousLocalStatus: operationalCharge.localStatus,
          },
          run: () => deletePayment(operationalCharge.asaasPaymentId!, { contaId }),
        });
        asaasCommandJobId = commandJobId;

        let localStateConverged = false;
          try {
            const webhookResult = await handlePaymentWebhook(
              contaId,
              buildDeletedPaymentWebhookPayload(deletedPayment),
            );
            localStateConverged = webhookResult.success;
          } catch (webhookError) {
          console.warn('[DELETE /api/cobrancas/[id]] Falha ao aplicar convergência imediata (event)', {
            operationalId: operationalCharge.operationalId,
            asaasPaymentId: operationalCharge.asaasPaymentId,
            error: webhookError instanceof Error ? webhookError.message : String(webhookError),
          });
        }

        if (!localStateConverged) {
          try {
            await syncPaymentStateFromAsaas({
              contaId,
              asaasPaymentId: operationalCharge.asaasPaymentId,
              eventName: 'PAYMENT_DELETED',
            });
          } catch (syncError) {
            console.warn('[DELETE /api/cobrancas/[id]] Falha ao sincronizar estado (event)', {
              operationalId: operationalCharge.operationalId,
              asaasPaymentId: operationalCharge.asaasPaymentId,
              error: syncError instanceof Error ? syncError.message : String(syncError),
            });
          }
        }

        await convergeLocalCanceledPayment({
          contaId,
          chargeId: operationalCharge.operationalId,
          asaasPaymentId: operationalCharge.asaasPaymentId,
          actorId: user.id,
          reason: 'Cancelada no Asaas pelo endpoint de cobranças',
        });
        localStateConverged = true;

        await auditLogService.record({
          contaId,
          action: 'finance.charge.cancel_requested',
          entity: { type: 'Charge', id: operationalCharge.operationalId },
          metadata: {
            asaasPaymentId: operationalCharge.asaasPaymentId,
            commandJobId: asaasCommandJobId,
            origin: 'EVENT',
            statusBefore: operationalCharge.localStatus,
            requestedBy: user.id,
          },
        });

        await invalidateChargeResourceCache({
          contaId,
          cobrancaId: operationalCharge.operationalId,
          reason: 'charge-delete-event',
        });

        return NextResponse.json(
          cobrancaMutationResultDTOSchema.parse(
            mapCobrancaMutationResultToDTO({
              success: true,
              pending: !localStateConverged,
              message: localStateConverged
                ? 'Cobrança cancelada e sincronizada com o Asaas.'
                : 'Solicitação enviada. O status será atualizado via webhook do Asaas.',
            }),
          ),
          { status: localStateConverged ? 200 : 202 },
        );
      }

      if (!isAsaasEnabled() || !charge.asaasPaymentId) {
        return NextResponse.json(
          { success: false, error: 'Cobrança sem integração Asaas' },
          { status: 400 },
        );
      }

      const localPolicy = evaluatePaymentActionPolicy({
        entityType: 'CHARGE',
        origin: charge.standaloneInstallmentPlanId
          ? 'INSTALLMENT'
          : charge.standaloneSubscriptionId
            ? 'SUBSCRIPTION'
            : 'STANDALONE',
        localStatus: charge.status,
        billingType: charge.billingType,
        hasAsaasPaymentId: Boolean(charge.asaasPaymentId),
        hasInvoiceUrl: Boolean(charge.invoiceUrl),
        isInstallmentPayment: Boolean(charge.standaloneInstallmentPlanId),
        isSubscriptionPayment: Boolean(charge.standaloneSubscriptionId),
      });

      if (!localPolicy.canCancel) {
        return policyBlockedError({
          action: 'CANCEL',
          decision: localPolicy.actions.CANCEL,
          status: charge.status,
          source: 'LOCAL',
        });
      }

      let asaasCommandJobId: string | null = null;
      let remoteStatusBeforeCommand: string | null = null;

      // Read-before-write: conferir status atual no Asaas (tolerante a falha)
      try {
        const payment = await readPaymentFullPreflight(charge.asaasPaymentId, { contaId });
        const effectivePaymentStatus = getEffectiveRemotePaymentStatus(payment) ?? payment.status;
        remoteStatusBeforeCommand = effectivePaymentStatus;
        const remotePolicy = evaluatePaymentActionPolicy({
          entityType: 'CHARGE',
          origin: charge.standaloneInstallmentPlanId
            ? 'INSTALLMENT'
            : charge.standaloneSubscriptionId
              ? 'SUBSCRIPTION'
              : 'STANDALONE',
          localStatus: charge.status,
          asaasStatus: effectivePaymentStatus,
          billingType: payment.billingType ?? charge.billingType,
          hasAsaasPaymentId: true,
          hasInvoiceUrl: Boolean(charge.invoiceUrl || payment.invoiceUrl),
          isInstallmentPayment: Boolean(charge.standaloneInstallmentPlanId),
          isSubscriptionPayment: Boolean(charge.standaloneSubscriptionId),
        });

        if (!remotePolicy.canCancel && effectivePaymentStatus !== 'DELETED') {
          return policyBlockedError({
            action: 'CANCEL',
            decision: remotePolicy.actions.CANCEL,
            status: effectivePaymentStatus,
            source: 'ASAAS',
          });
        }

        if (effectivePaymentStatus === 'DELETED') {
          let localStateConverged = false;
            try {
              localStateConverged = await applyImmediateDeletedPaymentConvergence(
                contaId,
                payment,
                charge.externalReference ?? buildStandaloneExternalReference({ chargeId: charge.id }),
              );
              await convergeLocalCanceledPayment({
                contaId,
                chargeId: charge.id,
                asaasPaymentId: charge.asaasPaymentId,
                actorId: user.id,
                reason: 'Cobrança já estava cancelada no Asaas',
              });
              localStateConverged = true;
            } catch (webhookError) {
              console.warn('[DELETE /api/cobrancas/[id]] Falha ao reconciliar cobrança já deletada (standalone)', {
                chargeId: charge.id,
                asaasPaymentId: charge.asaasPaymentId,
              error: webhookError instanceof Error ? webhookError.message : String(webhookError),
            });
          }

          return NextResponse.json(
            cobrancaMutationResultDTOSchema.parse(
              mapCobrancaMutationResultToDTO({
                success: true,
                pending: !localStateConverged,
                message: localStateConverged
                  ? 'Cobrança já estava cancelada no Asaas e foi sincronizada localmente.'
                  : 'Cobrança já estava cancelada no Asaas.',
              }),
            ),
            { status: localStateConverged ? 200 : 202 },
          );
        }
      } catch (readErr) {
        if (readErr instanceof KycNotApprovedError) throw readErr;
        console.warn('[DELETE /api/cobrancas/[id]] Read-before-write falhou (standalone), seguindo com delete', {
          asaasPaymentId: charge.asaasPaymentId,
          error: readErr instanceof Error ? readErr.message : String(readErr),
        });
      }

      const { result: deletedPayment, commandJobId } = await runAsaasPaymentCommand({
        contaId,
        type: 'PAYMENT_CANCEL_COMMAND',
        entityType: 'CHARGE',
        entityId: charge.id,
        asaasPaymentId: charge.asaasPaymentId,
        actorId: user.id,
        chargeId: charge.id,
        providerStatus: remoteStatusBeforeCommand,
        metadata: {
          source: 'DELETE /api/cobrancas/[id]',
          previousLocalStatus: charge.status,
        },
        run: () => deletePayment(charge.asaasPaymentId!, { contaId }),
      });
      asaasCommandJobId = commandJobId;

      let localStateConverged = false;

        try {
          const webhookResult = await handlePaymentWebhook(
            contaId,
            buildDeletedPaymentWebhookPayload(
              deletedPayment,
            charge.externalReference ?? buildStandaloneExternalReference({ chargeId: charge.id }),
          ),
          );
          localStateConverged = webhookResult.success;
        } catch (webhookError) {
        console.warn('[DELETE /api/cobrancas/[id]] Falha ao aplicar convergência imediata (standalone)', {
          chargeId: charge.id,
          asaasPaymentId: charge.asaasPaymentId,
          error: webhookError instanceof Error ? webhookError.message : String(webhookError),
        });
      }

      if (!localStateConverged) {
        try {
          await syncPaymentStateFromAsaas({
            contaId,
            asaasPaymentId: charge.asaasPaymentId,
            eventName: 'PAYMENT_DELETED',
          });
        } catch (syncError) {
          console.warn('[DELETE /api/cobrancas/[id]] Falha ao sincronizar estado (standalone)', {
            chargeId: charge.id,
            asaasPaymentId: charge.asaasPaymentId,
            error: syncError instanceof Error ? syncError.message : String(syncError),
          });
        }
      }

      await convergeLocalCanceledPayment({
        contaId,
        chargeId: charge.id,
        asaasPaymentId: charge.asaasPaymentId,
        actorId: user.id,
        reason: 'Cancelada no Asaas pelo endpoint de cobranças',
      });
      localStateConverged = true;

      await auditLogService.record({
        contaId,
        action: 'finance.charge.cancel_requested',
        entity: { type: 'Charge', id: charge.id },
        metadata: {
          asaasPaymentId: charge.asaasPaymentId,
          commandJobId: asaasCommandJobId,
          statusBefore: charge.status,
          requestedBy: user.id,
        },
      });

      await invalidateChargeResourceCache({
        contaId,
        cobrancaId: charge.id,
        reason: 'charge-delete-standalone',
      });

      return NextResponse.json(
        cobrancaMutationResultDTOSchema.parse(
          mapCobrancaMutationResultToDTO({
            success: true,
            pending: !localStateConverged,
            message: localStateConverged
              ? 'Cobrança cancelada e sincronizada com o Asaas.'
              : 'Solicitação enviada. O status será atualizado via webhook do Asaas.',
          }),
        ),
        { status: localStateConverged ? 200 : 202 },
      );
    }

    const contaIdForDelete = cobranca.matricula?.aluno?.contaId;
    if (!isAsaasEnabled() || !cobranca.asaasPaymentId || !contaIdForDelete) {
      return NextResponse.json(
        { success: false, error: 'Cobrança sem integração Asaas' },
        { status: 400 },
      );
    }

    const localPolicy = evaluatePaymentActionPolicy({
      entityType: 'COBRANCA',
      origin: resolveAcademicPaymentOrigin(cobranca.tipo),
      localStatus: cobranca.status,
      billingType: cobranca.formaPagamento,
      hasAsaasPaymentId: Boolean(cobranca.asaasPaymentId),
      hasInvoiceUrl: Boolean((cobranca as unknown as { charge?: { invoiceUrl?: string | null } }).charge?.invoiceUrl),
      isInstallmentPayment: cobranca.tipo === 'PARCELADA',
      isSubscriptionPayment: cobranca.tipo === 'RECORRENTE',
    });

    if (!localPolicy.canCancel) {
      return policyBlockedError({
        action: 'CANCEL',
        decision: localPolicy.actions.CANCEL,
        status: cobranca.status,
        source: 'LOCAL',
      });
    }

    let asaasCommandJobId: string | null = null;
    let remoteStatusBeforeCommand: string | null = null;

    // Read-before-write: conferir status atual no Asaas (tolerante a falha)
    try {
      const payment = await readPaymentFullPreflight(cobranca.asaasPaymentId, { contaId: contaIdForDelete });
      const effectivePaymentStatus = getEffectiveRemotePaymentStatus(payment) ?? payment.status;
      remoteStatusBeforeCommand = effectivePaymentStatus;
      const remotePolicy = evaluatePaymentActionPolicy({
        entityType: 'COBRANCA',
        origin: resolveAcademicPaymentOrigin(cobranca.tipo),
        localStatus: cobranca.status,
        asaasStatus: effectivePaymentStatus,
        billingType: payment.billingType ?? cobranca.formaPagamento,
        hasAsaasPaymentId: true,
        hasInvoiceUrl: Boolean(payment.invoiceUrl),
        isInstallmentPayment: cobranca.tipo === 'PARCELADA',
        isSubscriptionPayment: cobranca.tipo === 'RECORRENTE',
      });

      if (!remotePolicy.canCancel && effectivePaymentStatus !== 'DELETED') {
        return policyBlockedError({
          action: 'CANCEL',
          decision: remotePolicy.actions.CANCEL,
          status: effectivePaymentStatus,
          source: 'ASAAS',
        });
      }

      if (effectivePaymentStatus === 'DELETED') {
        let localStateConverged = false;
          try {
            localStateConverged = await applyImmediateDeletedPaymentConvergence(contaIdForDelete, payment);
            await convergeLocalCanceledPayment({
              contaId: contaIdForDelete,
              cobrancaId: cobranca.id,
              asaasPaymentId: cobranca.asaasPaymentId,
              actorId: user.id,
              reason: 'Cobrança já estava cancelada no Asaas',
            });
            localStateConverged = true;
          } catch (webhookError) {
            console.warn('[DELETE /api/cobrancas/[id]] Falha ao reconciliar cobrança já deletada (cobranca)', {
              cobrancaId: cobranca.id,
              asaasPaymentId: cobranca.asaasPaymentId,
            error: webhookError instanceof Error ? webhookError.message : String(webhookError),
          });
        }

        await invalidateChargeResourceCache({
          contaId: contaIdForDelete,
          cobrancaId: cobranca.id,
          reason: 'charge-already-deleted',
        });

        return NextResponse.json(
          cobrancaMutationResultDTOSchema.parse(
            mapCobrancaMutationResultToDTO({
              success: true,
              pending: !localStateConverged,
              message: localStateConverged
                ? 'Cobrança já estava cancelada no Asaas e foi sincronizada localmente.'
                : 'Cobrança já estava cancelada no Asaas.',
            }),
          ),
          { status: localStateConverged ? 200 : 202 },
        );
      }
    } catch (readErr) {
      // Se getPayment falhar (ex: rede), prosseguir com deletePayment
      // O deletePayment falhará com erro claro se o pagamento não puder ser cancelado
      console.warn('[DELETE /api/cobrancas/[id]] Read-before-write falhou, seguindo com delete', {
        asaasPaymentId: cobranca.asaasPaymentId,
        error: readErr instanceof Error ? readErr.message : String(readErr),
      });
    }

    const { result: deletedPayment, commandJobId } = await runAsaasPaymentCommand({
      contaId: contaIdForDelete,
      type: 'PAYMENT_CANCEL_COMMAND',
      entityType: 'COBRANCA',
      entityId: cobranca.id,
      asaasPaymentId: cobranca.asaasPaymentId,
      actorId: user.id,
      cobrancaId: cobranca.id,
      providerStatus: remoteStatusBeforeCommand,
      metadata: {
        source: 'DELETE /api/cobrancas/[id]',
        previousLocalStatus: cobranca.status,
      },
      run: () => deletePayment(cobranca.asaasPaymentId!, { contaId: contaIdForDelete }),
    });
    asaasCommandJobId = commandJobId;

    let localStateConverged = false;

      try {
        const webhookResult = await handlePaymentWebhook(
          contaIdForDelete,
          buildDeletedPaymentWebhookPayload(deletedPayment),
        );
        localStateConverged = webhookResult.success;
      } catch (webhookError) {
      console.warn('[DELETE /api/cobrancas/[id]] Falha ao aplicar convergência imediata (cobranca)', {
        cobrancaId: cobranca.id,
        asaasPaymentId: cobranca.asaasPaymentId,
        error: webhookError instanceof Error ? webhookError.message : String(webhookError),
        });
      }

      await convergeLocalCanceledPayment({
        contaId: contaIdForDelete,
        cobrancaId: cobranca.id,
        asaasPaymentId: cobranca.asaasPaymentId,
        actorId: user.id,
        reason: 'Cancelada no Asaas pelo endpoint de cobranças',
      });
      localStateConverged = true;

      if (!localStateConverged) {
        await prisma.cobranca.update({
        where: { id: cobranca.id },
        data: { status: 'CANCELAMENTO_PENDENTE' },
      });
    }

    await prisma.logFinanceiro.create({
      data: {
        contaId,
        usuarioId: user.id,
        cobrancaId: cobranca.id,
        acao: 'DELETAR',
        detalhes: {
          asaasPaymentId: cobranca.asaasPaymentId,
          commandJobId: asaasCommandJobId,
          statusBefore: cobranca.status,
          statusAfter: localStateConverged ? 'CANCELADO' : 'CANCELAMENTO_PENDENTE',
          requestedBy: user.id,
        },
      },
    });

    await auditLogService.record({
      contaId,
      action: 'finance.cobranca.cancel_requested',
      entity: { type: 'Cobranca', id: cobranca.id },
      metadata: {
        asaasPaymentId: cobranca.asaasPaymentId,
        commandJobId: asaasCommandJobId,
        statusBefore: cobranca.status,
        requestedBy: user.id,
      },
    });

    if (!localStateConverged) {
      try {
        await syncPaymentStateFromAsaas({
          contaId: contaIdForDelete,
          asaasPaymentId: cobranca.asaasPaymentId,
          eventName: 'PAYMENT_DELETED',
        });
      } catch (syncError) {
        console.warn('[DELETE /api/cobrancas/[id]] Falha ao sincronizar estado (cobranca)', {
          cobrancaId: cobranca.id,
          asaasPaymentId: cobranca.asaasPaymentId,
          error: syncError instanceof Error ? syncError.message : String(syncError),
        });
      }
    }

    await invalidateChargeResourceCache({
      contaId: contaIdForDelete,
      cobrancaId: cobranca.id,
      reason: 'charge-delete-academic',
    });

    return NextResponse.json(
      cobrancaMutationResultDTOSchema.parse(
        mapCobrancaMutationResultToDTO({
          success: true,
          pending: !localStateConverged,
          message: localStateConverged
            ? 'Cobrança cancelada e sincronizada com o Asaas.'
            : 'Solicitação enviada. O status será atualizado via webhook do Asaas.',
        }),
      ),
      { status: localStateConverged ? 200 : 202 },
    );
  } catch (error) {
    // KYC não aprovado → 409
    if (error instanceof KycNotApprovedError) {
      return NextResponse.json(
        { success: false, error: 'KYC_NAO_APROVADO' },
        { status: 409 },
      );
    }
    const correlationId = logFinanceApiError('DELETE /api/cobrancas/[id]', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Erro ao remover cobrança',
        correlationId,
      },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    );
  }
}
