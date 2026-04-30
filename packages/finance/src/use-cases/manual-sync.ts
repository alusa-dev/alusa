import { prisma } from '@alusa/database';
import type { TipoCobranca, StatusCobranca } from '@prisma/client';
import { auditLogService } from '../foundation/audit-log.service';
import { createCharge, type CreateChargeError } from './create-charge';
import { getAsaasPaymentDetails } from './get-asaas-payment-details';
import { formatDate, getCurrentBrasiliaDate, listPayments } from './asaas-ops';
import { syncPaymentStateFromAsaas } from './sync-payment-state-from-asaas';

export class ManualSyncError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ManualSyncError';
  }
}

export type ResendTaxaMatriculaInput = {
  cobrancaId: string;
  contaId: string;
  actorId: string;
};

export type ResendTaxaMatriculaOutput = {
  cobrancaId: string;
  matriculaId: string;
  previousStatus: StatusCobranca;
  newStatus: StatusCobranca;
  newTaxaStatus?: string;
  invoiceUrl?: string | null;
  bankSlipUrl?: string | null;
  pixQrCode?: string | null;
  pixCopyPaste?: string | null;
};

function mapCreateChargeError(error: CreateChargeError): ManualSyncError {
  switch (error) {
    case 'COBRANCA_NAO_ENCONTRADA':
      return new ManualSyncError(404, error, 'Cobrança não encontrada.');
    case 'KYC_NAO_APROVADO':
      return new ManualSyncError(409, error, 'Conta não aprovada para operações financeiras.');
    case 'PAGADOR_NAO_ENCONTRADO':
      return new ManualSyncError(400, error, 'Pagador não encontrado para esta cobrança.');
    case 'PAGADOR_SEM_CPF':
      return new ManualSyncError(400, error, 'O pagador desta cobrança não possui CPF cadastrado.');
    case 'DATA_INVALIDA':
      return new ManualSyncError(422, error, 'A data da cobrança oficial é inválida para criação no Asaas.');
    case 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS':
      return new ManualSyncError(503, error, 'Credenciais do Asaas não configuradas para esta conta.');
    default:
      return new ManualSyncError(502, error, 'Falha ao criar a cobrança oficial no Asaas.');
  }
}

function resolveRepairDueDate(vencimento: Date): string | null {
  const dueDate = formatDate(vencimento);
  const today = getCurrentBrasiliaDate().dateStr;
  return dueDate < today ? today : null;
}

async function resolveOfficialPaymentForResend(params: {
  cobranca: {
    id: string;
    status: StatusCobranca;
    asaasPaymentId: string | null;
    vencimento: Date;
  };
  contaId: string;
  actorId: string;
}) {
  if (params.cobranca.asaasPaymentId) {
    return {
      paymentId: params.cobranca.asaasPaymentId,
      source: 'LOCAL' as const,
      externalReference: `charge:${params.cobranca.id}`,
      dueDateOverride: null,
    };
  }

  const externalReference = `charge:${params.cobranca.id}`;
  const listedPayments = await listPayments({ externalReference, limit: 10 }, { contaId: params.contaId });
  const activeCandidates = (listedPayments.data ?? []).filter(
    (payment) =>
      typeof payment.id === 'string' &&
      payment.id.trim().length > 0 &&
      payment.deleted !== true &&
      payment.status !== 'DELETED',
  );

  if (activeCandidates.length > 1) {
    throw new ManualSyncError(
      409,
      'ASAAS_PAYMENT_DUPLICATED',
      'Existem múltiplos payments oficiais para esta taxa. É necessária revisão manual antes de reenviar.',
      {
        cobrancaId: params.cobranca.id,
        externalReference,
        paymentIds: activeCandidates.map((payment) => payment.id),
      },
    );
  }

  if (activeCandidates[0]) {
    return {
      paymentId: activeCandidates[0].id,
      source: 'ASAAS_LIST' as const,
      externalReference,
      dueDateOverride: null,
    };
  }

  const dueDateOverride = resolveRepairDueDate(params.cobranca.vencimento);
  const createdPayment = await createCharge({
    contaId: params.contaId,
    cobrancaId: params.cobranca.id,
    actor: { type: 'USER', id: params.actorId },
    dueDateOverride: dueDateOverride ?? undefined,
  });

  if (!createdPayment.success) {
    throw mapCreateChargeError(createdPayment.error);
  }

  if (!createdPayment.data.asaasPaymentId) {
    throw new ManualSyncError(
      502,
      'ASAAS_PAYMENT_CREATE_FAILED',
      'O Asaas não retornou um identificador oficial para a cobrança criada.',
      { cobrancaId: params.cobranca.id, externalReference },
    );
  }

  return {
    paymentId: createdPayment.data.asaasPaymentId,
    source: 'ASAAS_CREATE' as const,
    externalReference,
    dueDateOverride,
  };
}

export async function resendTaxaMatricula(
  input: ResendTaxaMatriculaInput,
): Promise<ResendTaxaMatriculaOutput> {
  const cobranca = await prisma.cobranca.findUnique({
    where: { id: input.cobrancaId },
    select: {
      id: true,
      tipo: true,
      status: true,
      vencimento: true,
      asaasPaymentId: true,
      matriculaId: true,
      matricula: {
        select: {
          aluno: { select: { contaId: true } },
          taxaStatus: true,
        },
      },
    },
  });

  if (!cobranca) {
    throw new ManualSyncError(404, 'COBRANCA_NOT_FOUND', 'Cobrança não encontrada.');
  }

  const contaId = cobranca.matricula?.aluno?.contaId ?? null;
  if (!contaId || contaId !== input.contaId) {
    throw new ManualSyncError(403, 'FORBIDDEN', 'Sem permissão para reenviar esta cobrança.');
  }

  if ((cobranca.tipo as TipoCobranca) !== 'TAXA_MATRICULA') {
    throw new ManualSyncError(
      400,
      'INVALID_CHARGE_TYPE',
      'Somente taxa de matrícula pode ser reenviada.',
    );
  }

  const officialPayment = await resolveOfficialPaymentForResend({
    cobranca,
    contaId,
    actorId: input.actorId,
  });

  if (officialPayment.source !== 'LOCAL') {
    await auditLogService.record({
      contaId,
      action: 'finance.manual_resend.payment_reconciled',
      entity: { type: 'Cobranca', id: cobranca.id },
      actor: { type: 'USER', id: input.actorId },
      metadata: {
        source: 'MANUAL_RESEND',
        resolutionSource: officialPayment.source,
        externalReference: officialPayment.externalReference,
        asaasPaymentId: officialPayment.paymentId,
        dueDateOverride: officialPayment.dueDateOverride,
        previousStatus: cobranca.status,
      },
    });
  }

  const syncResult = await syncPaymentStateFromAsaas({
    contaId,
    asaasPaymentId: officialPayment.paymentId,
  });

  if (!syncResult.success) {
    throw new ManualSyncError(
      502,
      'ASAAS_SYNC_FAILED',
      'Falha ao reconciliar a cobrança com o estado oficial do Asaas.',
      {
        cobrancaId: cobranca.id,
        asaasPaymentId: officialPayment.paymentId,
        syncError: syncResult.error,
      },
    );
  }

  let details;
  try {
    details = await getAsaasPaymentDetails({
      contaId,
      paymentId: officialPayment.paymentId,
      includePixQrCode: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao gerar links da cobrança no Asaas.';
    throw new ManualSyncError(502, 'ASAAS_ERROR', message);
  }

  const cobrancaReconciliada = await prisma.cobranca.findUnique({
    where: { id: cobranca.id },
    select: {
      status: true,
      asaasPaymentId: true,
      matricula: {
        select: {
          taxaStatus: true,
        },
      },
    },
  });

  if (details.payment.deleted || details.payment.status === 'DELETED') {
    throw new ManualSyncError(410, 'ASAAS_PAYMENT_DELETED', 'Cobrança removida no Asaas.', {
      cobrancaId: cobranca.id,
      previousStatus: cobranca.status,
      newStatus: cobrancaReconciliada?.status ?? cobranca.status,
      asaasPaymentId: officialPayment.paymentId,
    });
  }

  return {
    cobrancaId: cobranca.id,
    matriculaId: cobranca.matriculaId,
    previousStatus: cobranca.status,
    newStatus: cobrancaReconciliada?.status ?? cobranca.status,
    newTaxaStatus: cobrancaReconciliada?.matricula?.taxaStatus ?? cobranca.matricula?.taxaStatus,
    invoiceUrl: details.payment.invoiceUrl ?? null,
    bankSlipUrl: details.payment.bankSlipUrl ?? details.billingInfo?.bankSlip?.bankSlipUrl ?? null,
    pixQrCode: details.pixQrCode?.encodedImage ?? null,
    pixCopyPaste: details.pixQrCode?.payload ?? null,
  };
}
