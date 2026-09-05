import { createHash } from 'crypto';
import { BillingMode, EnrollmentCreationOperationStatus, PeriodicidadePlano, Prisma } from '@prisma/client';
import { resolvePayer } from '@alusa/domain';
import {
  compensateStagedEnrollmentFinancialResources,
  stageEnrollmentFinancialResources,
  type StagedEnrollmentFinancialResources,
} from '@alusa/finance';

import { prisma } from '@/src/prisma';
import { runWithTenant } from '@/lib/prisma-tenant';
import {
  formatIsoDate,
  isDateOnlyBefore,
  mapFormaPagamentoToBillingType,
  mapPeriodicidadeToCycle,
  resolveChargeableFirstDueDate,
  resolveEnrollmentFeeDueDate,
} from './recurring-billing';
import {
  previewInitialEnrollmentBilling,
} from './initial-enrollment-billing-preview.service';
import { criarMatricula, type CriarMatriculaInput } from './matricula.service';

export class ImmediateEnrollmentCreationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly requiresReconciliation = false,
    readonly reasonCode?: string,
  ) {
    super(message);
    this.name = 'ImmediateEnrollmentCreationError';
  }
}

function canonicalSnapshot(input: CriarMatriculaInput) {
  // Version the persisted representation: old snapshots omitted financial terms
  // and cannot establish payload equality for a mutating replay.
  // Keep monetary precision: rounding here could make different charges collide.
  // Dates are normalized to UTC; optional persisted values use their service defaults.
  return {
    fingerprintVersion: 2,
    contaId: input.contaId,
    alunoId: input.alunoId,
    turmaId: input.turmaId ?? null,
    comboId: input.comboId ?? null,
    planoId: input.planoId ?? null,
    responsavelFinanceiroId: input.responsavelFinanceiroId ?? null,
    dataInicio: input.dataInicio.toISOString(),
    dataFimContrato: input.dataFimContrato.toISOString(),
    vencimentoDia: input.vencimentoDia,
    taxaMatricula: input.taxaMatricula,
    taxaIsenta: input.taxaIsenta,
    taxaJustificativa: input.taxaJustificativa ?? null,
    pagarTaxaAgora: input.pagarTaxaAgora,
    gerarCobrancaTaxa: input.gerarCobrancaTaxa,
    criarCobranca: input.criarCobranca,
    requiresFinancialProvisioning: input.requiresFinancialProvisioning ?? false,
    billingMode: input.billingMode ?? BillingMode.INDIVIDUAL,
    matriculaFamiliarId: input.matriculaFamiliarId ?? null,
    familyOrderIndex: input.familyOrderIndex ?? null,
    valorMensalidadeOverride: input.valorMensalidadeOverride ?? null,
    jurosMensal: input.jurosMensal ?? null,
    multaPercentual: input.multaPercentual ?? null,
    descontoAntecipado: input.descontoAntecipado ?? null,
    descontoTipo: input.descontoTipo ?? null,
    prazoDesconto: input.prazoDesconto ?? null,
    formaPagamento: input.formaPagamento ?? null,
    formaPagamentoTaxa: input.formaPagamentoTaxa ?? null,
    descontoIds: [...new Set((input.descontoIds ?? []).filter(Boolean))].sort(),
    billingStrategy: input.billingStrategy ?? { kind: 'SEPARATE' },
    modeloId: input.modeloId,
    notificationChannels: input.notificationChannelsConfigured
      ? [...new Set(input.notificationChannels ?? [])].sort()
      : null,
  };
}

// Audit identity, renewable preview tokens and preprovisioned remote artifacts
// are deliberately excluded: they do not change the requested enrollment terms.
function fingerprint(snapshot: ReturnType<typeof canonicalSnapshot>) {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

function assertCurrentFingerprintVersion(snapshot: Prisma.JsonValue | null) {
  if (
    !snapshot ||
    typeof snapshot !== 'object' ||
    Array.isArray(snapshot) ||
    snapshot.fingerprintVersion !== 2
  ) {
    throw new ImmediateEnrollmentCreationError(
      'IDEMPOTENCY_LEGACY_REQUIRES_REVIEW',
      'Esta tentativa usa uma confirmação antiga. Consulte seu resultado antes de iniciar outra matrícula.',
      true,
    );
  }
}

function expectsEnrollmentFee(input: CriarMatriculaInput) {
  return input.gerarCobrancaTaxa && !input.taxaIsenta && input.taxaMatricula > 0;
}

function compensationProvesExpectedResourcesRemoved(
  input: CriarMatriculaInput,
  compensation: Awaited<ReturnType<typeof compensateStagedEnrollmentFinancialResources>>,
) {
  return (
    compensation.complete &&
    Boolean(compensation.deletedSubscriptionId) &&
    Boolean(compensation.deletedFirstSubscriptionPaymentId) &&
    (!expectsEnrollmentFee(input) || Boolean(compensation.deletedEnrollmentFeePaymentId))
  );
}

function operationErrorMessage(code: string) {
  const messages: Record<string, string> = {
    DATA_FIM_INVALIDA:
      'A data final do contrato precisa ser igual ou posterior ao primeiro vencimento.',
    KYC_NAO_APROVADO:
      'A conta financeira ainda não está aprovada. Conclua a verificação financeira antes de criar a matrícula.',
    KYC_REJECTED:
      'A conta financeira foi reprovada. Revise a verificação financeira antes de criar a matrícula.',
    SUBACCOUNT_MISSING:
      'A conta financeira ainda não foi configurada. Conclua a configuração antes de criar a matrícula.',
    API_KEY_MISSING:
      'A integração financeira desta escola não está configurada corretamente. Revise as credenciais antes de continuar.',
    API_KEY_INVALID:
      'A integração financeira desta escola não está configurada corretamente. Revise as credenciais antes de continuar.',
    CREDENCIAIS_ASAAS_NAO_CONFIGURADAS:
      'A integração financeira desta escola não está configurada corretamente. Revise as credenciais antes de continuar.',
    WEBHOOK_NOT_READY:
      'As atualizações automáticas do financeiro não estão prontas. Aguarde alguns instantes e tente novamente.',
    FIRST_SUBSCRIPTION_PAYMENT_NOT_CONFIRMED:
      'A primeira mensalidade não foi confirmada pelo financeiro. Nenhuma matrícula foi concluída.',
    REMOTE_SUBSCRIPTION_CONFIRMATION_MISMATCH:
      'A cobrança recorrente não pôde ser confirmada pelo financeiro. Nenhuma matrícula foi concluída.',
    SUBSCRIPTION_RESULT_UNKNOWN:
      'Ainda não foi possível confirmar a criação da cobrança recorrente. A matrícula não foi concluída.',
    SUBSCRIPTION_OPERATION_ALREADY_IN_PROGRESS:
      'Ainda não foi possível confirmar a criação da cobrança recorrente. A matrícula não foi concluída.',
    ENROLLMENT_FEE_RESULT_UNKNOWN:
      'A taxa de matrícula não pôde ser confirmada pelo financeiro. Nenhuma matrícula foi concluída.',
    ENROLLMENT_FEE_DUE_DATE_INVALID:
      'A data de vencimento da taxa de matrícula foi recusada pelo financeiro. Revise as datas e tente novamente.',
    ENROLLMENT_FEE_REJECTED:
      'A taxa de matrícula foi recusada pelo financeiro. Revise os dados da cobrança e tente novamente.',
    ENROLLMENT_FEE_OPERATION_ALREADY_IN_PROGRESS:
      'A taxa de matrícula não pôde ser confirmada pelo financeiro. Nenhuma matrícula foi concluída.',
    REMOTE_ENROLLMENT_FEE_CONFIRMATION_MISMATCH:
      'A taxa de matrícula não pôde ser confirmada pelo financeiro. Nenhuma matrícula foi concluída.',
    PREVIEW_EXPIRADO:
      'O preview da matrícula expirou. Gere um novo preview antes de confirmar.',
    PREVIEW_DESATUALIZADO:
      'O preview da matrícula mudou. Gere um novo preview antes de confirmar.',
    PREVIEW_INCOMPATIVEL:
      'A composição financeira da matrícula mudou. Gere um novo preview antes de confirmar.',
  };
  if (messages[code]) return messages[code];
  return 'Não foi possível criar e confirmar todo o financeiro. Nenhuma matrícula foi concluída.';
}

function classifyLocalCommitFailure(error: unknown) {
  const rawMessage = error instanceof Error ? error.message : String(error);
  if (rawMessage === 'PREVIEW_DESATUALIZADO') {
    return { code: 'PREVIEW_DESATUALIZADO', message: operationErrorMessage('PREVIEW_DESATUALIZADO') };
  }
  if (rawMessage === 'PREVIEW_EXPIRADO') {
    return { code: 'PREVIEW_EXPIRADO', message: operationErrorMessage('PREVIEW_EXPIRADO') };
  }
  if (rawMessage.startsWith('PREVIEW_INCOMPATIVEL:')) {
    return { code: 'PREVIEW_INCOMPATIVEL', message: operationErrorMessage('PREVIEW_INCOMPATIVEL') };
  }
  return { code: 'MATRICULA_COMMIT_FALHOU', message: operationErrorMessage('MATRICULA_COMMIT_FALHOU') };
}

const ENROLLMENT_OPERATION_LEASE_MS = 5 * 60 * 1000;

class EnrollmentOperationLeaseLostError extends Error {}

function withEnrollmentOperationTenant<T>(
  contaId: string,
  callback: (
    operations: Prisma.TransactionClient['enrollmentCreationOperation'],
  ) => Promise<T>,
) {
  return runWithTenant(contaId, (tx) => callback(tx.enrollmentCreationOperation));
}

export async function createImmediateEnrollment(input: CriarMatriculaInput) {
  const uiRequestId = input.uiRequestId?.trim();
  if (!uiRequestId) {
    throw new ImmediateEnrollmentCreationError(
      'IDEMPOTENCY_KEY_OBRIGATORIA',
      'Informe uma chave de idempotência para criar a matrícula.',
    );
  }

  const existing = await withEnrollmentOperationTenant(input.contaId, (operations) =>
    operations.findFirst({ where: { contaId: input.contaId, uiRequestId } }),
  );
  // A retry cannot escape the ledger comparison by turning off billing.
  if (!input.criarCobranca && !existing) {
    return criarMatricula(input);
  }

  if (input.billingStrategy && input.billingStrategy.kind !== 'SEPARATE') {
    throw new ImmediateEnrollmentCreationError(
      'ESTRATEGIA_FINANCEIRA_NAO_SUPORTADA_NO_COMMIT_IMEDIATO',
      'Para concluir a matrícula agora, selecione a criação de uma assinatura separada.',
    );
  }

  const snapshot = canonicalSnapshot(input);
  const requestFingerprint = fingerprint(snapshot);
  if (!existing) {
    const legacyMatricula = await runWithTenant(input.contaId, (tx) =>
      tx.matricula.findFirst({
        where: { contaId: input.contaId, uiRequestId },
        select: { id: true },
      }),
    );
    if (legacyMatricula) assertCurrentFingerprintVersion(null);
  }
  if (existing) {
    assertCurrentFingerprintVersion(existing.requestSnapshot);
    if (existing.requestFingerprint !== requestFingerprint) {
      throw new ImmediateEnrollmentCreationError(
        'IDEMPOTENCY_KEY_REUTILIZADA',
        'Esta confirmação já foi usada com outros dados. Gere um novo preview.',
      );
    }
    if (existing.status === EnrollmentCreationOperationStatus.COMMITTED && existing.matriculaId) {
      const idempotentResult = await criarMatricula(input);
      const monthly = idempotentResult.cobrancas.mensalidade;
      if (monthly?.asaasPaymentId && existing.asaasSubscriptionId) {
        const fee = idempotentResult.cobrancas.taxa;
        return {
          ...idempotentResult,
          immediateFinancialSync: {
            subscription: {
              asaasSubscriptionId: existing.asaasSubscriptionId,
              externalReference: `enrollment-op:${existing.id}:subscription`,
              firstPayment: {
                asaasPaymentId: monthly.asaasPaymentId,
                externalReference: `enrollment-op:${existing.id}:subscription`,
                value: Number(monthly.valor),
                dueDate: formatIsoDate(monthly.vencimento),
                status: monthly.asaasStatus ?? 'PENDING',
                invoiceUrl: null,
                bankSlipUrl: null,
              },
            },
            enrollmentFee:
              fee?.asaasPaymentId
                ? {
                    asaasPaymentId: fee.asaasPaymentId,
                    externalReference: `enrollment-op:${existing.id}:fee`,
                    value: Number(fee.valor),
                    dueDate: formatIsoDate(fee.vencimento),
                    status: fee.asaasStatus ?? 'PENDING',
                    invoiceUrl: null,
                    bankSlipUrl: null,
                  }
                : null,
          },
        };
      }
      return idempotentResult;
    }
    if (
      existing.status === EnrollmentCreationOperationStatus.COMPENSATING ||
      existing.status === EnrollmentCreationOperationStatus.REQUIRES_RECONCILIATION
    ) {
      const recoveryNow = new Date();
      const recoveryClaim = await withEnrollmentOperationTenant(input.contaId, (operations) =>
        operations.updateMany({
          where: {
            id: existing.id,
            contaId: input.contaId,
            version: existing.version,
            status: existing.status,
            OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: recoveryNow } }],
          },
          data: {
            status: EnrollmentCreationOperationStatus.COMPENSATING,
            version: { increment: 1 },
            attempts: { increment: 1 },
            lockedAt: recoveryNow,
            leaseExpiresAt: new Date(recoveryNow.getTime() + ENROLLMENT_OPERATION_LEASE_MS),
          },
        }),
      );
      if (recoveryClaim.count !== 1) {
        throw new ImmediateEnrollmentCreationError(
          'CRIACAO_EM_PROCESSAMENTO',
          'A reconciliação desta matrícula já está em andamento.',
          true,
        );
      }
      const recoveryVersion = existing.version + 1;
      const compensation = await compensateStagedEnrollmentFinancialResources({
        contaId: input.contaId,
        operationId: existing.id,
        asaasSubscriptionId: existing.asaasSubscriptionId,
        firstSubscriptionPaymentId: existing.asaasFirstPaymentId,
        enrollmentFeePaymentId: existing.asaasEnrollmentFeePaymentId,
      });
      const safelyCompensated = compensationProvesExpectedResourcesRemoved(input, compensation);
      await withEnrollmentOperationTenant(input.contaId, (operations) => operations.updateMany({
        where: { id: existing.id, contaId: input.contaId, version: recoveryVersion },
        data: {
          status: safelyCompensated
            ? EnrollmentCreationOperationStatus.COMPENSATED
            : EnrollmentCreationOperationStatus.REQUIRES_RECONCILIATION,
          compensatedAt: safelyCompensated ? new Date() : null,
          result: { compensation } as Prisma.InputJsonValue,
          lockedAt: null,
          leaseExpiresAt: null,
        },
      }));
      throw new ImmediateEnrollmentCreationError(
        safelyCompensated ? 'CRIACAO_ANTERIOR_COMPENSADA' : 'CRIACAO_REQUER_RECONCILIACAO',
        safelyCompensated
          ? 'A tentativa anterior foi desfeita com segurança. Gere uma nova confirmação para tentar novamente.'
          : 'A tentativa anterior precisa de reconciliação técnica antes de uma nova criação.',
        !safelyCompensated,
      );
    }
    if (
      existing.status !== EnrollmentCreationOperationStatus.PROCESSING &&
      existing.status !== EnrollmentCreationOperationStatus.REMOTE_PROVISIONED
    ) {
      throw new ImmediateEnrollmentCreationError(
        'CRIACAO_JA_PROCESSADA',
        'Esta tentativa já foi processada. Gere uma nova confirmação para tentar novamente.',
      );
    }
  }

  const [aluno, plano, combo] = await Promise.all([
    prisma.aluno.findFirst({
      where: { id: input.alunoId, contaId: input.contaId, status: 'ATIVO' },
      select: { id: true, dataNasc: true },
    }),
    input.planoId
      ? prisma.plano.findFirst({
          where: { id: input.planoId, contaId: input.contaId },
          select: { id: true, nome: true, periodicidade: true },
        })
      : null,
    input.comboId
      ? prisma.combo.findFirst({
          where: { id: input.comboId, contaId: input.contaId },
          select: { id: true, nome: true, periodicidade: true },
        })
      : null,
  ]);
  if (!aluno) {
    throw new ImmediateEnrollmentCreationError('ALUNO_NAO_ENCONTRADO', 'Aluno ativo não encontrado.');
  }
  const payer = resolvePayer({
    alunoId: aluno.id,
    alunoDataNasc: aluno.dataNasc,
    responsavelFinanceiroId: input.responsavelFinanceiroId,
  });
  if (!payer.success) {
    throw new ImmediateEnrollmentCreationError(
      'PAGADOR_NAO_ENCONTRADO',
      'Responsável financeiro obrigatório para concluir a matrícula.',
    );
  }

  const periodicidade = (combo?.periodicidade ?? plano?.periodicidade ??
    PeriodicidadePlano.MENSAL) as PeriodicidadePlano;
  const firstDueDate = resolveChargeableFirstDueDate(input.dataInicio, input.vencimentoDia);
  if (isDateOnlyBefore(input.dataFimContrato, firstDueDate)) {
    throw new ImmediateEnrollmentCreationError(
      'DATA_FIM_INVALIDA',
      operationErrorMessage('DATA_FIM_INVALIDA'),
    );
  }

  const billingType = mapFormaPagamentoToBillingType(input.formaPagamento);
  const feeBillingType = mapFormaPagamentoToBillingType(
    input.formaPagamentoTaxa ?? input.formaPagamento,
  );
  if (!billingType || (input.gerarCobrancaTaxa && !input.taxaIsenta && !feeBillingType)) {
    throw new ImmediateEnrollmentCreationError(
      'FORMA_PAGAMENTO_INVALIDA',
      'A forma de pagamento não é suportada pelo financeiro.',
    );
  }

  const preview = await previewInitialEnrollmentBilling(
    {
      contaId: input.contaId,
      billingStrategy: input.billingStrategy ?? { kind: 'SEPARATE' },
      responsavelFinanceiroId: input.responsavelFinanceiroId ?? null,
      dataInicio: input.dataInicio,
      dataFimContrato: input.dataFimContrato,
      formaPagamento: input.formaPagamento ?? 'BOLETO',
      vencimentoDia: input.vencimentoDia,
      descontoIds: input.descontoIds ?? [],
      items: [
        {
          alunoId: input.alunoId,
          turmaId: input.turmaId ?? null,
          comboId: input.comboId ?? null,
          planoId: input.planoId ?? null,
          taxaMatricula: input.taxaMatricula,
          valorMensalidadeOverride: input.valorMensalidadeOverride ?? null,
        },
      ],
    },
    { prisma },
  );
  if (!preview.compatibility.compatible || preview.totals.monthlyTotal <= 0) {
    const blocker = preview.compatibility.blockers[0];
    throw new ImmediateEnrollmentCreationError(
      blocker?.code ?? 'PREVIEW_FINANCEIRO_INVALIDO',
      blocker?.message ?? 'O preview financeiro não permite criar uma assinatura.',
    );
  }
  if (
    input.billingPreview &&
    (input.billingPreview.previewHash.toLowerCase() !== preview.previewHash.toLowerCase() ||
      input.billingPreview.sourceVersion.toLowerCase() !== preview.sourceVersion.toLowerCase())
  ) {
    throw new ImmediateEnrollmentCreationError(
      'PREVIEW_DESATUALIZADO',
      'O preview da matrícula mudou. Revise os valores antes de confirmar.',
    );
  }

  let operation: { id: string };
  let leaseVersion: number;
  const leaseStartedAt = new Date();
  const leaseExpiresAt = new Date(leaseStartedAt.getTime() + ENROLLMENT_OPERATION_LEASE_MS);
  if (existing) {
    const claimed = await withEnrollmentOperationTenant(input.contaId, (operations) => operations.updateMany({
      where: {
        id: existing.id,
        contaId: input.contaId,
        version: existing.version,
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: leaseStartedAt } }],
      },
      data: {
        lockedAt: leaseStartedAt,
        leaseExpiresAt,
        lastAttemptAt: leaseStartedAt,
        attempts: { increment: 1 },
        version: { increment: 1 },
      },
    }));
    if (claimed.count !== 1) {
      throw new ImmediateEnrollmentCreationError(
        'CRIACAO_EM_PROCESSAMENTO',
        'Esta matrícula já está sendo confirmada. Aguarde a conclusão antes de tentar novamente.',
      );
    }
    operation = { id: existing.id };
    leaseVersion = existing.version + 1;
  } else try {
    operation = await withEnrollmentOperationTenant(input.contaId, (operations) => operations.create({
      data: {
        contaId: input.contaId,
        alunoId: input.alunoId,
        uiRequestId,
        requestFingerprint,
        externalReference: `enrollment-op:${input.contaId}:${uiRequestId}`,
        correlationId: uiRequestId,
        status: EnrollmentCreationOperationStatus.PROCESSING,
        requestSnapshot: snapshot as Prisma.InputJsonValue,
        actorId: input.createdById,
        attempts: 1,
        lockedAt: leaseStartedAt,
        leaseExpiresAt,
        lastAttemptAt: leaseStartedAt,
      },
    }));
    leaseVersion = 0;
  } catch (error) {
    if ((error as { code?: string }).code !== 'P2002') throw error;

    const concurrent = await withEnrollmentOperationTenant(input.contaId, (operations) =>
      operations.findFirst({ where: { contaId: input.contaId, uiRequestId } }),
    );
    if (concurrent?.requestFingerprint !== requestFingerprint) {
      throw new ImmediateEnrollmentCreationError(
        'IDEMPOTENCY_KEY_REUTILIZADA',
        'Esta confirmação já foi usada com outros dados. Gere um novo preview.',
      );
    }
    throw new ImmediateEnrollmentCreationError(
      'CRIACAO_EM_PROCESSAMENTO',
      'Esta matrícula já está sendo confirmada. Aguarde a conclusão antes de tentar novamente.',
    );
  }

  const staged = await stageEnrollmentFinancialResources({
    contaId: input.contaId,
    operationId: operation.id,
    idempotencyKey: uiRequestId,
    payer: payer.payer,
    subscription: {
      value: preview.totals.monthlyTotal,
      nextDueDate: formatIsoDate(firstDueDate),
      billingType,
      cycle: mapPeriodicidadeToCycle(periodicidade),
      endDate: formatIsoDate(input.dataFimContrato),
      description: combo?.nome ?? plano?.nome ?? 'Mensalidade',
      discount: input.descontoAntecipado
        ? {
            value: input.descontoAntecipado,
            dueDateLimitDays: input.prazoDesconto ?? 0,
            type: input.descontoTipo ?? 'PERCENTAGE',
          }
        : undefined,
      interest: input.jurosMensal ? { value: input.jurosMensal } : undefined,
      fine: input.multaPercentual
        ? { value: input.multaPercentual, type: 'PERCENTAGE' }
        : undefined,
    },
    enrollmentFee:
      input.gerarCobrancaTaxa && !input.taxaIsenta && preview.totals.enrollmentFeeTotal > 0
        ? {
            value: preview.totals.enrollmentFeeTotal,
            dueDate: formatIsoDate(resolveEnrollmentFeeDueDate(input.dataInicio)),
            billingType: feeBillingType!,
            description: 'Taxa de matrícula',
          }
        : null,
    claimCompensation: async () => {
      const claim = await withEnrollmentOperationTenant(input.contaId, (operations) =>
        operations.updateMany({
          where: {
            id: operation.id,
            contaId: input.contaId,
            version: leaseVersion,
            leaseExpiresAt: { gt: new Date() },
            status: {
              in: [
                EnrollmentCreationOperationStatus.PROCESSING,
                EnrollmentCreationOperationStatus.REMOTE_PROVISIONED,
              ],
            },
          },
          data: { status: EnrollmentCreationOperationStatus.COMPENSATING },
        }),
      );
      return claim.count === 1;
    },
  });

  if (!staged.success) {
    const status = staged.resultUnknown
      ? EnrollmentCreationOperationStatus.REQUIRES_RECONCILIATION
      : EnrollmentCreationOperationStatus.COMPENSATED;
    await withEnrollmentOperationTenant(input.contaId, (operations) => operations.updateMany({
      where: { id: operation.id, contaId: input.contaId, version: leaseVersion },
      data: {
        status,
        lastError: staged.error.slice(0, 2000),
        compensatedAt:
          status === EnrollmentCreationOperationStatus.COMPENSATED ? new Date() : null,
        result: { compensation: staged.compensation } as Prisma.InputJsonValue,
        lockedAt: null,
        leaseExpiresAt: null,
      },
    }));
    throw new ImmediateEnrollmentCreationError(
      staged.resultUnknown ? 'FINANCEIRO_REQUER_RECONCILIACAO' : 'FINANCEIRO_NAO_CONFIRMADO',
      operationErrorMessage(staged.error),
      staged.resultUnknown,
      staged.error,
    );
  }

  const preprovisioned: CriarMatriculaInput['preprovisionedBilling'] = {
    ...staged.data,
    billingType,
    enrollmentFeeBillingType:
      staged.data.enrollmentFee && feeBillingType ? feeBillingType : null,
    cycle: mapPeriodicidadeToCycle(periodicidade),
    nextDueDate: formatIsoDate(firstDueDate),
    endDate: formatIsoDate(input.dataFimContrato),
  };
  let result: Awaited<ReturnType<typeof criarMatricula>>;
  try {
    const remoteStateUpdate = await withEnrollmentOperationTenant(input.contaId, (operations) => operations.updateMany({
      where: {
        id: operation.id,
        contaId: input.contaId,
        version: leaseVersion,
        status: {
          in: [
            EnrollmentCreationOperationStatus.PROCESSING,
            EnrollmentCreationOperationStatus.REMOTE_PROVISIONED,
          ],
        },
      },
      data: {
        status: EnrollmentCreationOperationStatus.REMOTE_PROVISIONED,
        asaasSubscriptionId: staged.data.subscription.asaasSubscriptionId,
        asaasFirstPaymentId: staged.data.subscription.firstPayment.asaasPaymentId,
        asaasEnrollmentFeePaymentId: staged.data.enrollmentFee?.asaasPaymentId ?? null,
        remoteProvisionedAt: new Date(),
      },
    }));
    if (remoteStateUpdate.count !== 1) throw new EnrollmentOperationLeaseLostError();
    result = await criarMatricula({ ...input, preprovisionedBilling: preprovisioned });
  } catch (error) {
    if (error instanceof EnrollmentOperationLeaseLostError) {
      throw new ImmediateEnrollmentCreationError(
        'CRIACAO_EM_PROCESSAMENTO',
        'Esta matrícula está sendo concluída por outra execução. Aguarde antes de tentar novamente.',
      );
    }
    let persistedMatricula: { id: string; asaasSubscriptionId: string | null } | null;
    try {
      persistedMatricula = await runWithTenant(input.contaId, (tx) =>
        tx.matricula.findFirst({
          where: { contaId: input.contaId, uiRequestId },
          select: { id: true, asaasSubscriptionId: true },
        }),
      );
    } catch {
      throw new ImmediateEnrollmentCreationError(
        'RESULTADO_LOCAL_INCERTO',
        'Não foi possível confirmar o resultado local. O financeiro foi preservado para reconciliação segura.',
        true,
      );
    }

    if (persistedMatricula) {
      if (
        persistedMatricula.asaasSubscriptionId !==
        staged.data.subscription.asaasSubscriptionId
      ) {
        throw new ImmediateEnrollmentCreationError(
          'RESULTADO_LOCAL_DIVERGENTE',
          'A matrícula existe, mas o vínculo financeiro precisa de reconciliação técnica.',
          true,
        );
      }
      try {
        result = await criarMatricula(input);
      } catch {
        throw new ImmediateEnrollmentCreationError(
          'RESULTADO_LOCAL_INCERTO',
          'A matrícula foi persistida, mas a leitura do resultado precisa de reconciliação.',
          true,
        );
      }
    } else {
    const compensationClaim = await withEnrollmentOperationTenant(input.contaId, (operations) =>
      operations.updateMany({
        where: {
          id: operation.id,
          contaId: input.contaId,
          version: leaseVersion,
          status: EnrollmentCreationOperationStatus.REMOTE_PROVISIONED,
        },
        data: { status: EnrollmentCreationOperationStatus.COMPENSATING },
      }),
    ).catch(() => ({ count: 0 }));
    if (compensationClaim.count !== 1) {
      throw new ImmediateEnrollmentCreationError(
        'CRIACAO_EM_PROCESSAMENTO',
        'Outra execução assumiu esta matrícula. Os recursos financeiros foram preservados.',
        true,
      );
    }
    const compensation = await compensateStagedEnrollmentFinancialResources({
      contaId: input.contaId,
      operationId: operation.id,
      asaasSubscriptionId: staged.data.subscription.asaasSubscriptionId,
      firstSubscriptionPaymentId: staged.data.subscription.firstPayment.asaasPaymentId,
      enrollmentFeePaymentId: staged.data.enrollmentFee?.asaasPaymentId ?? null,
    });
    const safelyCompensated = compensationProvesExpectedResourcesRemoved(input, compensation);
    const requiresReconciliation = !safelyCompensated;
    const localCommitFailure = classifyLocalCommitFailure(error);
    console.warn('[enrollment-create] Falha no commit local após provisionamento remoto', {
      contaId: input.contaId,
      operationId: operation.id,
      correlationId: uiRequestId,
      failureCode: localCommitFailure.code,
      compensated: safelyCompensated,
      requiresReconciliation,
    });
    await withEnrollmentOperationTenant(input.contaId, (operations) =>
      operations.updateMany({
        where: { id: operation.id, contaId: input.contaId, version: leaseVersion },
        data: {
          status: requiresReconciliation
            ? EnrollmentCreationOperationStatus.REQUIRES_RECONCILIATION
            : EnrollmentCreationOperationStatus.COMPENSATED,
          lastError: (error instanceof Error ? error.message : String(error)).slice(0, 2000),
          compensatedAt: safelyCompensated ? new Date() : null,
          result: { compensation, failureCode: localCommitFailure.code } as Prisma.InputJsonValue,
          lockedAt: null,
          leaseExpiresAt: null,
        },
      }),
    ).catch(() => ({ count: 0 }));
    throw new ImmediateEnrollmentCreationError(
      localCommitFailure.code,
      localCommitFailure.message,
      requiresReconciliation,
      localCommitFailure.code === 'MATRICULA_COMMIT_FALHOU' ? undefined : localCommitFailure.code,
    );
    }
  }

  // A matrícula e os recursos remotos já estão corretos a partir daqui. Uma falha
  // apenas ao finalizar a trilha da saga nunca pode apagar o financeiro confirmado.
  const committedState = await withEnrollmentOperationTenant(input.contaId, (operations) =>
    operations.updateMany({
      where: {
        id: operation.id,
        contaId: input.contaId,
        version: leaseVersion,
        status: EnrollmentCreationOperationStatus.REMOTE_PROVISIONED,
      },
      data: {
        status: EnrollmentCreationOperationStatus.COMMITTED,
        matriculaId: result.matricula.id,
        completedAt: new Date(),
        lockedAt: null,
        leaseExpiresAt: null,
        result: {
          matriculaId: result.matricula.id,
          subscriptionId: staged.data.subscription.asaasSubscriptionId,
          firstPaymentId: staged.data.subscription.firstPayment.asaasPaymentId,
          enrollmentFeePaymentId: staged.data.enrollmentFee?.asaasPaymentId ?? null,
        } as Prisma.InputJsonValue,
      },
    }))
    .catch(() => ({ count: 0 }));
  if (committedState.count !== 1) {
    console.error('[enrollment-create] Matrícula confirmada; saga aguarda convergência', {
      contaId: input.contaId,
      operationId: operation.id,
      matriculaId: result.matricula.id,
      correlationId: uiRequestId,
    });
  }

  return {
    ...result,
    immediateFinancialSync: {
      subscription: staged.data.subscription,
      enrollmentFee: staged.data.enrollmentFee,
    },
  };
}
