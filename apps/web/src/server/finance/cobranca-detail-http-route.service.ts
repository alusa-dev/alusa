import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth/session';
import { AsaasEnvError, getPayment, isAsaasEnabled, mapAsaasPaymentStatusToCobranca, resolveCobrancaDisplayStatus, resolveLiquidacaoFromAsaasPayment, resolveOperationalChargePayment, mapOperationalStatusToCobrancaDisplay, resolveStandaloneChargeTipo } from '@alusa/finance';
import type { LiquidacaoStatus, StatusCobranca } from '@prisma/client';
import { cobrancaDetailResultDTOSchema } from '@/features/financeiro/cobrancas/dtos';
import { mapCobrancaDetailResultToDTO } from '@/features/financeiro/cobrancas/mappers';
import {
  buildAcademicAsaasData,
  buildStandaloneAsaasData,
  mapBillingTypeToFormaPagamento,
  shouldFetchAcademicAsaasDetail,
  shouldFetchStandaloneAsaasDetail,
  toNullableNumber,
} from '@/src/server/finance/asaas-payment-detail-policy';
import {
  mapPaymentRulesToCobrancaFields,
  paymentRulesFromParticipantSnapshot,
  type CobrancaPaymentRules,
} from '@/features/financeiro/cobrancas/payment-rules';
import { recordAsaasReadDecision } from '@/src/server/finance/asaas-read-observability';
import { getEffectiveRemotePaymentStatus, resolveAcademicDisplayedStatus, resolveStandaloneDisplayedStatus, resolveStandaloneLiquidacaoStatus } from '@/features/financeiro/cobrancas/display-status';



import { logFinanceApiError } from '@/lib/api/finance-api-response';
import { buildChargeDetailCacheKey } from '@/lib/cache/invalidation';
import { getTenantCacheAdapter } from '@/lib/cache/server-cache';
import { isCacheLayerEnabled } from '@/lib/cache/tenant-cache';
import { privateJson } from '@/lib/private-cache';

const CHARGE_DETAIL_CACHE_SECONDS = 20;
const CHARGE_DETAIL_STALE_SECONDS = 40;

async function findEventPaymentRulesForCharge(params: {
  contaId: string;
  chargeId: string;
  installmentPlanId?: string | null;
  asaasPaymentId?: string | null;
}): Promise<CobrancaPaymentRules | null> {
  const participant = await prisma.eventParticipant.findFirst({
    where: {
      contaId: params.contaId,
      OR: [
        { standaloneChargeId: params.chargeId },
        ...(params.installmentPlanId ? [{ standaloneChargeId: params.installmentPlanId }] : []),
        ...(params.asaasPaymentId ? [{ asaasPaymentId: params.asaasPaymentId }] : []),
      ],
    },
    select: { registrationPaymentRules: true },
  });

  return paymentRulesFromParticipantSnapshot(participant?.registrationPaymentRules);
}

/**
 * GET /api/cobrancas/[id]
 * Retorna detalhes completos de uma cobrança específica
 *
 * ADR: GET é READ-ONLY. Não escreve no banco.
 * Status e valores são refletidos apenas via webhook.
 */
export async function getCobrancaDetailRoute(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const rawParams = await params;
  try {
    const user = await getSessionUser();
    if (!user?.contaId) {
      return NextResponse.json({ success: false, error: 'Não autorizado' }, { status: 401 });
    }
    const { contaId } = user;
    const forceRefresh = new URL(_req.url).searchParams.get('fresh') === '1';
    const asaasActive = isAsaasEnabled();

    const { id } = rawParams;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'ID da cobrança é obrigatório' },
        { status: 400 },
      );
    }

    const cacheKey = buildChargeDetailCacheKey(contaId, id);
    const canUseDetailCache = isCacheLayerEnabled() && !forceRefresh;
    if (canUseDetailCache) {
      const cached = await getTenantCacheAdapter().get<unknown>(cacheKey);
      if (cached.body && (cached.state === 'HIT' || cached.state === 'STALE')) {
        return privateJson(cached.body, {
          maxAgeSeconds: CHARGE_DETAIL_CACHE_SECONDS,
          staleWhileRevalidateSeconds: CHARGE_DETAIL_STALE_SECONDS,
          cacheState: cached.state,
        });
      }
    }

    const respondDetail = async (body: unknown) => {
      if (!canUseDetailCache) {
        return NextResponse.json(body, { headers: { 'cache-control': 'no-store' } });
      }

      await getTenantCacheAdapter()
        .set(cacheKey, body, {
          ttlSeconds: CHARGE_DETAIL_CACHE_SECONDS,
          staleWhileRevalidateSeconds: CHARGE_DETAIL_STALE_SECONDS,
        })
        .catch((error) => {
          console.warn('[GET /api/cobrancas/[id]] Falha ao gravar cache de detalhe', {
            contaId,
            cobrancaId: id,
            error: error instanceof Error ? error.message : String(error),
          });
        });

      return privateJson(body, {
        maxAgeSeconds: CHARGE_DETAIL_CACHE_SECONDS,
        staleWhileRevalidateSeconds: CHARGE_DETAIL_STALE_SECONDS,
        cacheState: 'MISS',
      });
    };

    // Buscar cobrança com relações necessárias - MULTI-TENANT: filtra por contaId via aluno
    const cobranca = await prisma.cobranca.findFirst({
      where: { id, matricula: { aluno: { contaId } } },
      include: {
        matricula: {
          include: {
            aluno: true,
            plano: true,
            turma: {
              include: {
                sala: true,
                modalidade: true,
              },
            },
          },
        },
        pagamentos: {
          orderBy: { createdAt: 'desc' },
        },
        charge: {
          select: {
            status: true,
            asaasStatus: true,
            invoiceUrl: true,
            billingType: true,
            bankSlipUrl: true,
            identificationField: true,
            barCode: true,
            nossoNumero: true,
          },
        },
      },
    });

    // Se não encontrar em Cobranca, tentar buscar em Charge (standalone) - MULTI-TENANT
    if (!cobranca) {
      const charge = await prisma.charge.findFirst({
        where: { id, contaId },
        include: {
          customer: true,
        },
      });

      if (charge) {
        let remoteAsaasData = null;
        const standaloneAsaasPaymentId =
          typeof charge.asaasPaymentId === 'string' && charge.asaasPaymentId.trim().length > 0
            ? charge.asaasPaymentId
            : null;
        const shouldFetchStandaloneRemote = Boolean(
          standaloneAsaasPaymentId &&
            shouldFetchStandaloneAsaasDetail({ forceRefresh, isAsaasActive: asaasActive, charge }),
        );

        if (shouldFetchStandaloneRemote) {
          recordAsaasReadDecision('cobranca_detail', forceRefresh ? 'fresh_remote' : 'remote');
          try {
            remoteAsaasData = await getPayment(standaloneAsaasPaymentId!, { contaId: charge.contaId });
          } catch (error) {
            if (!(error instanceof AsaasEnvError)) {
              console.error('[GET /api/cobrancas/[id]] Erro ao buscar dados do Asaas (Charge):', error);
            }
          }
        } else {
          recordAsaasReadDecision('cobranca_detail', 'local');
        }

        const asaasData = remoteAsaasData ?? buildStandaloneAsaasData(charge);
        const participantPaymentRules = await findEventPaymentRulesForCharge({
          contaId,
          chargeId: charge.id,
          installmentPlanId: charge.standaloneInstallmentPlanId,
          asaasPaymentId: charge.asaasPaymentId,
        });
        const effectivePaymentRules: CobrancaPaymentRules | null =
          charge.interestValue != null || charge.fineValue != null || charge.discountValue != null
            ? {
                interestValue: charge.interestValue == null ? null : Number(charge.interestValue),
                fineValue: charge.fineValue == null ? null : Number(charge.fineValue),
                fineType: charge.fineType,
                discountValue: charge.discountValue == null ? null : Number(charge.discountValue),
                discountType: charge.discountType,
                discountDueDateLimitDays: charge.discountDueDateLimitDays,
              }
            : participantPaymentRules;

        const remotePaymentStatus = getEffectiveRemotePaymentStatus(remoteAsaasData ?? asaasData);

        const effectiveStatus = resolveStandaloneDisplayedStatus({
          localChargeStatus: charge.status,
          remotePaymentStatus,
          dueDate: charge.dueDate,
        });

        const effectivePaymentDate =
          remoteAsaasData?.paymentDate ?? remoteAsaasData?.clientPaymentDate ?? null;
        const effectiveLiquidacaoStatus = resolveStandaloneLiquidacaoStatus({
          displayedStatus: effectiveStatus,
          remotePaymentStatus,
          creditDate: remoteAsaasData?.creditDate ?? null,
          billingType: remoteAsaasData?.billingType ?? charge.billingType ?? null,
        }) ?? charge.liquidacaoStatus ?? null;
        const standaloneDisplayStatus = resolveCobrancaDisplayStatus({
          status: effectiveStatus as StatusCobranca,
          liquidacaoStatus: effectiveLiquidacaoStatus,
          asaasStatus: remotePaymentStatus,
        });
        const effectiveFormaPagamento =
          mapBillingTypeToFormaPagamento(
            (remoteAsaasData?.billingType as string | null | undefined) ?? charge.billingType,
          ) ?? 'INDEFINIDO';
        const standaloneTipo = resolveStandaloneChargeTipo({
          standaloneInstallmentPlanId: charge.standaloneInstallmentPlanId,
          standaloneSubscriptionId: charge.standaloneSubscriptionId,
          externalReference: charge.externalReference,
          familyGroupId: charge.familyGroupId,
          description: charge.description,
        });
        const standaloneDescricao =
          charge.description ??
          (standaloneTipo === 'RECORRENTE'
            ? 'Assinatura recorrente'
            : standaloneTipo === 'PARCELADA'
              ? 'Parcela'
              : 'Cobrança avulsa');

        return respondDetail(
          cobrancaDetailResultDTOSchema.parse(
            mapCobrancaDetailResultToDTO({
              success: true,
              data: {
                id: charge.id,
                tipo: standaloneTipo,
                status: effectiveStatus,
                valor: charge.value != null ? Number(charge.value) : 0,
                vencimento: charge.dueDate?.toISOString() ?? new Date().toISOString(),
                dataPagamento: effectivePaymentDate,
                descricao: standaloneDescricao,
                formaPagamento: effectiveFormaPagamento,
                atrasado: effectiveStatus === 'ATRASADO',
                asaasPaymentId: charge.asaasPaymentId,
                valorBruto: charge.value != null ? Number(charge.value) : 0,
                valorLiquido: toNullableNumber(remoteAsaasData?.netValue ?? asaasData?.netValue),
                taxaAsaas:
                  (remoteAsaasData?.netValue ?? asaasData?.netValue) != null &&
                  (remoteAsaasData?.value ?? asaasData?.value) != null
                    ? Number(remoteAsaasData?.value ?? asaasData?.value) -
                      Number(remoteAsaasData?.netValue ?? asaasData?.netValue)
                    : null,
                ...mapPaymentRulesToCobrancaFields(effectivePaymentRules),
                liquidacaoStatus: effectiveLiquidacaoStatus,
                displayStatus: standaloneDisplayStatus,
                invoiceUrl:
                  typeof charge.invoiceUrl === 'string'
                    ? charge.invoiceUrl
                    : (remoteAsaasData?.invoiceUrl ?? null),
                bankSlipUrl: charge.bankSlipUrl ?? remoteAsaasData?.bankSlipUrl ?? null,
                identificationField: charge.identificationField ?? null,
                barCode: charge.barCode ?? null,
                nossoNumero: charge.nossoNumero ?? null,
                matricula: {
                  id: charge.id,
                  codigo: 'AVULSA',
                  aluno: {
                    id: charge.customerId ?? charge.id,
                    nome: charge.payerName ?? 'Cliente',
                    cpf: null,
                    email: null,
                    telefone: null,
                    responsavelFinanceiro: null,
                  },
                  plano: {
                    id: 'avulsa',
                    nome: 'Cobrança Avulsa',
                    periodicidade: 'AVULSA',
                  },
                  combo: null,
                },
                pagamentos: [],
                asaasData,
                origin: 'STANDALONE',
              },
            }),
          ),
        );
      }

      const operationalCharge = await resolveOperationalChargePayment(contaId, id);
      if (operationalCharge) {
        let remoteAsaasData = null;
        const eventAsaasPaymentId =
          typeof operationalCharge.asaasPaymentId === 'string' &&
          operationalCharge.asaasPaymentId.trim().length > 0
            ? operationalCharge.asaasPaymentId
            : null;
        const shouldFetchEventRemote = Boolean(eventAsaasPaymentId && asaasActive);

        if (shouldFetchEventRemote && eventAsaasPaymentId) {
          recordAsaasReadDecision('cobranca_detail', forceRefresh ? 'fresh_remote' : 'remote');
          try {
            remoteAsaasData = await getPayment(eventAsaasPaymentId, { contaId });
          } catch (error) {
            if (!(error instanceof AsaasEnvError)) {
              console.error('[GET /api/cobrancas/[id]] Erro ao buscar dados do Asaas (Event):', error);
            }
          }
        } else {
          recordAsaasReadDecision('cobranca_detail', 'local');
        }

        const remotePaymentStatus = getEffectiveRemotePaymentStatus(remoteAsaasData);
        const localDisplayStatus = mapOperationalStatusToCobrancaDisplay(operationalCharge.localStatus);
        const effectiveStatus = remotePaymentStatus
          ? mapAsaasPaymentStatusToCobranca(remotePaymentStatus, {
              dueDate: operationalCharge.dueDate,
            })
          : localDisplayStatus;
        const effectivePaymentDate =
          remoteAsaasData?.paymentDate ??
          remoteAsaasData?.clientPaymentDate ??
          operationalCharge.paidAt?.toISOString() ??
          null;
        const effectiveLiquidacaoStatus = resolveStandaloneLiquidacaoStatus({
          displayedStatus: effectiveStatus,
          remotePaymentStatus,
          creditDate: remoteAsaasData?.creditDate ?? null,
          billingType: remoteAsaasData?.billingType ?? operationalCharge.billingType ?? null,
        });
        const eventDisplayStatus = resolveCobrancaDisplayStatus({
          status: effectiveStatus as StatusCobranca,
          liquidacaoStatus: effectiveLiquidacaoStatus,
          asaasStatus: remotePaymentStatus,
        });
        const effectiveFormaPagamento =
          mapBillingTypeToFormaPagamento(
            (remoteAsaasData?.billingType as string | null | undefined) ??
              operationalCharge.billingType,
          ) ?? 'INDEFINIDO';
        const asaasData =
          remoteAsaasData ??
          (eventAsaasPaymentId
            ? {
                id: eventAsaasPaymentId,
                status: operationalCharge.localStatus === 'PAID' ? 'CONFIRMED' : 'PENDING',
                billingType: operationalCharge.billingType,
                invoiceUrl: operationalCharge.invoiceUrl,
              }
            : null);

        return respondDetail(
          cobrancaDetailResultDTOSchema.parse(
            mapCobrancaDetailResultToDTO({
              success: true,
              data: {
                id: operationalCharge.operationalId,
                tipo: 'EVENTO',
                status: effectiveStatus,
                valor: operationalCharge.value,
                vencimento:
                  operationalCharge.dueDate?.toISOString() ??
                  new Date().toISOString(),
                dataPagamento: effectivePaymentDate,
                descricao: operationalCharge.description,
                formaPagamento: effectiveFormaPagamento,
                atrasado: effectiveStatus === 'ATRASADO',
                asaasPaymentId: operationalCharge.asaasPaymentId,
                valorBruto: operationalCharge.value,
                valorLiquido: toNullableNumber(remoteAsaasData?.netValue),
                taxaAsaas:
                  remoteAsaasData?.netValue != null && remoteAsaasData?.value != null
                    ? Number(remoteAsaasData.value) - Number(remoteAsaasData.netValue)
                    : null,
                liquidacaoStatus: effectiveLiquidacaoStatus,
                displayStatus: eventDisplayStatus,
                invoiceUrl:
                  operationalCharge.invoiceUrl ??
                  remoteAsaasData?.invoiceUrl ??
                  null,
                eventId: operationalCharge.eventId,
                matricula: {
                  id: operationalCharge.operationalId,
                  codigo: 'EVENTO',
                  aluno: {
                    id: operationalCharge.alunoId ?? operationalCharge.operationalId,
                    nome: operationalCharge.payerName,
                    cpf: null,
                    email: null,
                    telefone: null,
                    responsavelFinanceiro: null,
                  },
                  plano: {
                    id: 'evento',
                    nome: 'Evento',
                    periodicidade: 'AVULSA',
                  },
                  combo: null,
                },
                pagamentos: [],
                asaasData,
                origin: 'EVENT',
                eventDetails: operationalCharge.eventDetails ?? null,
              },
            }),
          ),
        );
      }

      return NextResponse.json(
        { success: false, error: 'Cobrança não encontrada' },
        { status: 404 },
      );
    }

    // Calcular se está atrasado (comparação date-only para evitar fuso)
    const toDateOnly = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const hoje = toDateOnly(new Date());
    const vencimento = toDateOnly(new Date(cobranca.vencimento));
    const atrasado = cobranca.status !== 'PAGO' && cobranca.status !== 'CANCELADO' && vencimento < hoje;

    // Buscar informações adicionais do Asaas se houver asaasPaymentId
    let remoteAsaasData = null;
    const contaIdForAsaas = cobranca.matricula?.aluno?.contaId;
    const academicAsaasPaymentId =
      typeof cobranca.asaasPaymentId === 'string' && cobranca.asaasPaymentId.trim().length > 0
        ? cobranca.asaasPaymentId
        : null;
    const shouldFetchAcademicRemote = Boolean(
      academicAsaasPaymentId &&
        shouldFetchAcademicAsaasDetail({
          forceRefresh,
          isAsaasActive: asaasActive && Boolean(contaIdForAsaas),
          cobranca: cobranca as unknown as Record<string, unknown>,
        }) &&
        contaIdForAsaas,
    );

    if (shouldFetchAcademicRemote) {
      recordAsaasReadDecision('cobranca_detail', forceRefresh ? 'fresh_remote' : 'remote');
      try {
        remoteAsaasData = await getPayment(academicAsaasPaymentId!, { contaId: contaIdForAsaas! });
      } catch (error) {
        if (error instanceof AsaasEnvError) {
          console.warn('[GET /api/cobrancas/[id]] Integração Asaas indisponível:', error.message);
        } else {
          console.error('[GET /api/cobrancas/[id]] Erro ao buscar dados do Asaas:', error);
        }
      }
    } else {
      recordAsaasReadDecision('cobranca_detail', 'local');
    }

    const effectiveCobranca = cobranca;

    const asaasData =
      remoteAsaasData ?? buildAcademicAsaasData(effectiveCobranca as unknown as Record<string, unknown>);
    const remotePaymentStatus = getEffectiveRemotePaymentStatus(remoteAsaasData ?? asaasData);

    const remoteBillingTypeForForma =
      (remoteAsaasData?.billingType as string | null | undefined) ??
      (asaasData?.billingType as string | null | undefined);
    const effectiveFormaPagamento =
      typeof remoteBillingTypeForForma === 'string' &&
      remoteBillingTypeForForma.trim().toUpperCase() === 'RECEIVED_IN_CASH'
        ? 'INDEFINIDO'
        : cobranca.formaPagamento && cobranca.formaPagamento !== 'INDEFINIDO'
          ? cobranca.formaPagamento
          : (mapBillingTypeToFormaPagamento(remoteBillingTypeForForma) ?? cobranca.formaPagamento);

    // Buscar InstallmentPlan se cobrança for do tipo PARCELADA
    let installmentPlanId: string | null = null;
    if (cobranca.tipo === 'PARCELADA' && cobranca.matriculaId) {
      const installmentPlan = await prisma.installmentPlan.findFirst({
        where: { matriculaId: cobranca.matriculaId },
        select: { id: true },
      });
      installmentPlanId = installmentPlan?.id ?? null;
    }

    // Buscar Subscription se cobrança for do tipo MENSALIDADE ou RECORRENTE
    let subscriptionId: string | null = null;
    if ((cobranca.tipo === 'MENSALIDADE' || cobranca.tipo === 'RECORRENTE') && cobranca.matriculaId) {
      const subscription = await prisma.subscription.findFirst({
        where: { matriculaId: cobranca.matriculaId },
        select: { id: true },
      });
      subscriptionId = subscription?.id ?? null;
    }

    const effectiveStatus = resolveAcademicDisplayedStatus({
      localCobrancaStatus: effectiveCobranca.status,
      localChargeStatus: effectiveCobranca.charge?.status ?? null,
      remotePaymentStatus,
      dueDate: effectiveCobranca.vencimento,
    });

    const storedLiquidacao = (effectiveCobranca as unknown as { liquidacaoStatus?: LiquidacaoStatus | null })
      .liquidacaoStatus;
    const computedLiquidacaoStatus = resolveLiquidacaoFromAsaasPayment({
      asaasStatus: remotePaymentStatus,
      creditDate:
        (remoteAsaasData?.creditDate as string | null | undefined) ??
        (asaasData?.creditDate as string | null | undefined) ??
        null,
      billingType:
        (remoteAsaasData?.billingType as string | null | undefined) ??
        (asaasData?.billingType as string | null | undefined) ??
        null,
    });
    const shouldPreferComputedLiquidacao =
      Boolean(remoteAsaasData) ||
      ['RECEIVED_IN_CASH', 'CONFIRMED', 'RECEIVED'].includes(
        String(remotePaymentStatus ?? '').toUpperCase(),
      );
    const effectiveLiquidacaoStatus: LiquidacaoStatus =
      shouldPreferComputedLiquidacao
        ? computedLiquidacaoStatus
        : (storedLiquidacao ?? computedLiquidacaoStatus);

    const displayStatus = resolveCobrancaDisplayStatus({
      status: effectiveStatus as StatusCobranca,
      liquidacaoStatus: effectiveLiquidacaoStatus,
      asaasStatus: remotePaymentStatus,
    });

    const { charge: _academicCharge, ...cobrancaDetail } = effectiveCobranca;

    return respondDetail(
      cobrancaDetailResultDTOSchema.parse(
        mapCobrancaDetailResultToDTO({
          success: true,
          data: {
            ...cobrancaDetail,
            formaPagamento: effectiveFormaPagamento,
            status: effectiveStatus,
            valor: Number(effectiveCobranca.valor),
            atrasado: effectiveStatus === 'ATRASADO' || (effectiveStatus === 'PENDENTE' && atrasado),
            asaasData,
            installmentPlanId,
            subscriptionId,
            valorBruto: Number(effectiveCobranca.valor),
            valorLiquido: toNullableNumber(
              (effectiveCobranca as unknown as { asaasNetValue?: unknown }).asaasNetValue,
            ),
            taxaAsaas: toNullableNumber(
              (effectiveCobranca as unknown as { asaasFeeValue?: unknown }).asaasFeeValue,
            ),
            liquidacaoStatus: effectiveLiquidacaoStatus,
            displayStatus,
          },
        }),
      ),
    );
  } catch (error) {
    const correlationId = logFinanceApiError('GET /api/cobrancas/[id]', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Erro ao buscar detalhes da cobrança',
        correlationId,
      },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    );
  }
}
