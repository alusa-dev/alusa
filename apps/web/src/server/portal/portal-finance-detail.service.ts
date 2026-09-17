import {
  AsaasEnvError,
  getPayment,
  isAsaasEnabled,
  syncPaymentStateFromAsaas,
  type AsaasPayment,
} from '@alusa/finance';
import {
  buildPortalStandaloneChargeOwnershipWhere,
  mapChargeStatusToPortalStatus,
  resolvePortalScopedPayerIds,
} from '@/features/portal/finance-standalone';
import {
  buildAcademicAsaasData,
  buildStandaloneAsaasData,
  shouldFetchAcademicAsaasDetail,
  shouldFetchStandaloneAsaasDetail,
} from '@/src/server/finance/asaas-payment-detail-policy';
import { recordAsaasReadDecision } from '@/src/server/finance/asaas-read-observability';
import { resolveAcademicDisplayedStatus } from '@/src/server/finance/academic-payment-history';
import { buildChargeDisplayStatusDTO } from '@/lib/finance/charge-display-status';
import {
  findPortalAcademicCobranca,
  findPortalPaymentId,
  findPortalStandaloneCharge,
} from './portal-read.service';

function resolveInvoiceUrl(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function resolveAsaasStatus(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return null;
}

export async function getPortalFinanceDetail(params: {
  id: string;
  contaId: string;
  alunoIds: string[];
  responsavelId?: string | null;
  forceRefresh: boolean;
}) {
  const cobranca = await findPortalAcademicCobranca({
    cobrancaId: params.id,
    contaId: params.contaId,
    alunoIds: params.alunoIds,
  });

  let standaloneCharge: Awaited<ReturnType<typeof findPortalStandaloneCharge>> = null;
  if (!cobranca) {
    const payerScope = await resolvePortalScopedPayerIds(
      params.contaId,
      params.alunoIds,
      params.responsavelId,
    );
    const ownershipWhere = buildPortalStandaloneChargeOwnershipWhere(payerScope);
    if (ownershipWhere) {
      standaloneCharge = await findPortalStandaloneCharge({
        contaId: params.contaId,
        chargeId: params.id,
        ownershipWhere,
      });
    }
  }

  if (!cobranca && !standaloneCharge) return null;

  const asaasActive = isAsaasEnabled();
  const asaasPaymentId = cobranca?.asaasPaymentId ?? standaloneCharge?.asaasPaymentId ?? null;
  const shouldFetchRemote = params.forceRefresh && (
    cobranca
      ? shouldFetchAcademicAsaasDetail({
          forceRefresh: params.forceRefresh,
          isAsaasActive: asaasActive,
          cobranca: cobranca as unknown as Record<string, unknown>,
        })
      : standaloneCharge
        ? shouldFetchStandaloneAsaasDetail({
            forceRefresh: params.forceRefresh,
            isAsaasActive: asaasActive,
            charge: standaloneCharge as unknown as Record<string, unknown>,
          })
        : false
  );

  let asaasData: AsaasPayment | null = null;
  if (asaasActive && asaasPaymentId && shouldFetchRemote) {
    recordAsaasReadDecision('portal_financeiro_detail', params.forceRefresh ? 'fresh_remote' : 'remote');
    try {
      asaasData = await getPayment(asaasPaymentId, { contaId: params.contaId });
    } catch (error: unknown) {
      if (error instanceof AsaasEnvError) {
        console.warn('[Portal Financeiro] Integração Asaas indisponível:', error.message);
      } else {
        console.error('[Portal Financeiro] Erro ao consultar Asaas:', error);
      }
    }
  } else {
    recordAsaasReadDecision('portal_financeiro_detail', 'local');
  }

  const localAsaasData = cobranca
    ? buildAcademicAsaasData(cobranca as unknown as Record<string, unknown>)
    : standaloneCharge
      ? buildStandaloneAsaasData(standaloneCharge as unknown as Record<string, unknown>)
      : null;
  const effectiveAsaasData = asaasData ?? localAsaasData;
  const invoiceUrl =
    resolveInvoiceUrl(asaasData?.invoiceUrl) ??
    resolveInvoiceUrl(standaloneCharge?.invoiceUrl) ??
    resolveInvoiceUrl(
      effectiveAsaasData && 'invoiceUrl' in effectiveAsaasData ? effectiveAsaasData.invoiceUrl : null,
    );
  const transactionReceiptUrl = asaasData?.transactionReceiptUrl ?? null;

  if (cobranca) {
    const remoteStatus = resolveAsaasStatus(
      asaasData?.status,
      effectiveAsaasData && 'status' in effectiveAsaasData ? effectiveAsaasData.status : null,
      cobranca.asaasStatus,
    );
    const localStatus = resolveAcademicDisplayedStatus({
      localCobrancaStatus: cobranca.status,
      remotePaymentStatus: remoteStatus,
      dueDate: cobranca.vencimento,
    });
    return {
      id: cobranca.id,
      tipo: cobranca.tipo,
      valor: Number(cobranca.valor),
      vencimento: cobranca.vencimento.toISOString(),
      status: localStatus,
      displayStatus: buildChargeDisplayStatusDTO({
        localStatus,
        asaasStatus: remoteStatus,
        liquidacaoStatus: cobranca.liquidacaoStatus,
        hasAsaasLink: Boolean(cobranca.asaasPaymentId || cobranca.asaasStatus || cobranca.liquidacaoStatus),
      }),
      asaasStatus: remoteStatus,
      liquidacaoStatus: cobranca.liquidacaoStatus,
      formaPagamento: cobranca.formaPagamento,
      asaasId: cobranca.asaasId,
      asaasPaymentId: cobranca.asaasPaymentId,
      invoiceUrl,
      bankSlipUrl: asaasData?.bankSlipUrl ?? (cobranca as unknown as { bankSlipUrl?: string | null }).bankSlipUrl ?? null,
      bankSlipCancelledAt: (cobranca as unknown as { bankSlipCancelledAt?: Date | null }).bankSlipCancelledAt?.toISOString() ?? null,
      identificationField: (cobranca as unknown as { identificationField?: string | null }).identificationField ?? null,
      barCode: (cobranca as unknown as { barCode?: string | null }).barCode ?? null,
      nossoNumero: (cobranca as unknown as { nossoNumero?: string | null }).nossoNumero ?? null,
      transactionReceiptUrl,
      descricao: cobranca.descricao,
      valorJuros: cobranca.juros ? Number(cobranca.juros) : null,
      valorMulta: cobranca.multa ? Number(cobranca.multa) : null,
      valorDesconto: cobranca.desconto ? Number(cobranca.desconto) : null,
      asaasData: effectiveAsaasData,
      matricula: {
        aluno: {
          nome: cobranca.matricula.aluno.nome,
          cpf: cobranca.matricula.aluno.cpf,
          email: cobranca.matricula.aluno.email,
          telefone: cobranca.matricula.aluno.telefone,
        },
        turma: cobranca.matricula.turma
          ? { nome: cobranca.matricula.turma.nome, modalidade: { nome: cobranca.matricula.turma.modalidade.nome } }
          : null,
        responsavelFinanceiro: cobranca.matricula.responsavelFinanceiro
          ? {
              hasSavedCard: Boolean(
                cobranca.matricula.responsavelFinanceiro.creditCardBrand &&
                  cobranca.matricula.responsavelFinanceiro.creditCardLast4,
              ),
              creditCardBrand: cobranca.matricula.responsavelFinanceiro.creditCardBrand,
              creditCardLast4: cobranca.matricula.responsavelFinanceiro.creditCardLast4,
              creditCardExpiryMonth: cobranca.matricula.responsavelFinanceiro.creditCardExpiryMonth,
              creditCardExpiryYear: cobranca.matricula.responsavelFinanceiro.creditCardExpiryYear,
            }
          : null,
      },
      pagamentos: cobranca.pagamentos.map((payment) => ({
        id: payment.id,
        dataPagamento: payment.dataPagamento?.toISOString() ?? null,
        valorPago: Number(payment.valorPago),
        status: payment.status,
        formaPagamento: payment.formaPagamento,
      })),
    };
  }

  const standalone = standaloneCharge;
  if (!standalone) return null;

  const remoteStatus = resolveAsaasStatus(
    asaasData?.status,
    effectiveAsaasData && 'status' in effectiveAsaasData ? effectiveAsaasData.status : null,
    standalone.asaasStatus,
  );
  const localStatus = remoteStatus
    ? resolveAcademicDisplayedStatus({
        localCobrancaStatus: mapChargeStatusToPortalStatus(standalone.status, standalone.dueDate),
        remotePaymentStatus: remoteStatus,
        dueDate: standalone.dueDate ?? new Date(),
      })
    : mapChargeStatusToPortalStatus(standalone.status, standalone.dueDate);

  return {
    id: standalone.id,
    tipo: 'AVULSA',
    valor: Number(standalone.value ?? 0),
    vencimento: (standalone.dueDate ?? new Date()).toISOString(),
    status: localStatus,
    displayStatus: buildChargeDisplayStatusDTO({
      localStatus,
      asaasStatus: remoteStatus,
      liquidacaoStatus: standalone.liquidacaoStatus,
      hasAsaasLink: Boolean(standalone.asaasPaymentId),
    }),
    asaasStatus: remoteStatus,
    liquidacaoStatus: standalone.liquidacaoStatus,
    formaPagamento: standalone.billingType,
    asaasId: standalone.asaasPaymentId,
    asaasPaymentId: standalone.asaasPaymentId,
    invoiceUrl: invoiceUrl ?? standalone.invoiceUrl,
    bankSlipUrl: asaasData?.bankSlipUrl ?? standalone.bankSlipUrl,
    bankSlipCancelledAt: standalone.bankSlipCancelledAt?.toISOString() ?? null,
    identificationField: standalone.identificationField,
    barCode: standalone.barCode,
    nossoNumero: standalone.nossoNumero,
    transactionReceiptUrl,
    descricao: standalone.description,
    valorJuros: null,
    valorMulta: null,
    valorDesconto: null,
    asaasData: effectiveAsaasData,
    matricula: {
      aluno: {
        nome: standalone.payerName ?? 'Pagador não identificado',
        cpf: null,
        email: null,
        telefone: null,
      },
      turma: null,
      responsavelFinanceiro: null,
    },
    pagamentos: [],
  };
}

export async function syncPortalFinanceDetail(params: {
  id: string;
  contaId: string;
  alunoIds: string[];
  responsavelId?: string | null;
}) {
  const paymentId = await findPortalPaymentId({ ...params, chargeId: params.id });
  if (!paymentId) return { ok: false as const, kind: 'NOT_FOUND' as const };

  const result = await syncPaymentStateFromAsaas({
    contaId: params.contaId,
    asaasPaymentId: paymentId,
    intent: 'UI_FALLBACK_SYNC',
  });
  if (!result.success) return { ok: false as const, kind: 'PROVIDER_ERROR' as const, error: result.error };
  return {
    ok: true as const,
    asaasPaymentId: result.asaasPaymentId,
    paymentStatus: result.paymentStatus,
    appliedEvent: result.appliedEvent,
  };
}
