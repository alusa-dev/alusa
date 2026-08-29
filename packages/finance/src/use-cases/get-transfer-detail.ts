import { prisma, loadAsaasCredentials } from '@alusa/database';
import { getTransfer as asaasGetTransfer } from '@alusa/asaas';

import {
  extractOfficialTransferMetadata,
  extractWebhookTransferMetadata,
  mergeTransferMetadata,
  resolveOfficialFeeValue,
  resolveOfficialNetValue,
  resolveRequestedTransferDestinationType,
  resolveTransferMetadata,
  type RequestedTransferDestinationType,
} from './transfers/transfer-metadata';
import { isCancellableAsaasTransfer } from './transfers/asaas-transfer-payload';
import { resolveTransferStatus } from './transfers/transfer-status';

export type GetTransferDetailInput = {
  contaId: string;
  transferId: string;
};

export type TransferTimelineStatus = 'DONE' | 'CURRENT' | 'PENDING' | 'FAILED' | 'CANCELED';

export type TransferTimelineItem = {
  key: string;
  label: string;
  at: string | null;
  status: TransferTimelineStatus;
  detail: string | null;
};

export type TransferOperationalAlert = {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
};

export type TransferDetailRecipient = {
  name: string | null;
  cpfCnpj: string | null;
  bankName: string | null;
  pixKey: string | null;
  agency: string | null;
  account: string | null;
  accountDigit: string | null;
  accountType: string | null;
};

export type GetTransferDetailOutput = {
  id: string;
  externalReference: string;
  asaasTransferId: string | null;
  amount: number;
  feeAmount: number | null;
  netAmount: number;
  status: string;
  operation: 'PIX' | 'TED';
  requestedDestinationType: RequestedTransferDestinationType | null;
  description: string | null;
  scheduleDate: string | null;
  transferDate: string | null;
  createdAt: string;
  statusUpdatedAt: string | null;
  transactionReceiptUrl: string | null;
  endToEndIdentifier: string | null;
  failReason: string | null;
  authorized: boolean | null;
  canCancel: boolean;
  lastWebhookAt: string | null;
  lastReconciledAt: string | null;
  timeline: TransferTimelineItem[];
  operationalAlerts: TransferOperationalAlert[];
  recipient: TransferDetailRecipient;
};

const OPEN_TRANSFER_STATUSES = new Set(['REQUESTED', 'PENDING', 'PROCESSING', 'BLOCKED']);
const TERMINAL_TRANSFER_STATUSES = new Set(['DONE', 'FAILED', 'CANCELED']);
const STALE_WEBHOOK_MS = 30 * 60 * 1000;
const STALE_OPEN_TRANSFER_MS = 2 * 60 * 60 * 1000;

type TransferAuditLog = {
  action: string;
  createdAt: Date;
};

type TransferWebhookLog = {
  evento: string;
  status: string;
  recebidoEm: Date;
  processadoEm: Date | null;
  ultimoErro: string | null;
};

function toIsoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function findFirstAuditAt(auditLogs: TransferAuditLog[], actions: string[]): string | null {
  const found = auditLogs.find((log) => actions.includes(log.action));
  return found ? found.createdAt.toISOString() : null;
}

function transferStatusDetail(status: string) {
  switch (status) {
    case 'DONE':
      return 'A transferência foi concluída com sucesso.';
    case 'FAILED':
      return 'A transferência não foi concluída.';
    case 'BLOCKED':
      return 'A transferência está bloqueada e aguarda regularização.';
    case 'PROCESSING':
      return 'A transferência está sendo processada.';
    case 'CANCELED':
      return 'A transferência foi cancelada.';
    case 'REQUESTED':
      return 'A solicitação foi enviada e aguarda processamento.';
    case 'PENDING':
    default:
      return 'A solicitação aguarda processamento.';
  }
}

function buildTransferTimeline(input: {
  transfer: {
    asaasTransferId: string | null;
    createdAt: Date;
    statusUpdatedAt: Date | null;
    effectiveDate: string | Date | null;
    authorized: boolean | null;
  };
  status: string;
  auditLogs: TransferAuditLog[];
  webhookLogs: TransferWebhookLog[];
  lastReconciledAt: string | null;
}): TransferTimelineItem[] {
  const latestWebhook = input.webhookLogs[0] ?? null;
  const asaasCreatedAt = findFirstAuditAt(input.auditLogs, ['finance.transfer.created']);
  const cancelConfirmedAt = findFirstAuditAt(input.auditLogs, [
    'finance.transfer.canceled',
    'finance.transfer.canceled.locally',
    'finance.transfer.cancel.replayed',
  ]);
  const requestFailedAt = findFirstAuditAt(input.auditLogs, ['finance.transfer.request_failed']);
  const terminalAt =
    toIsoDate(input.transfer.effectiveDate) ??
    cancelConfirmedAt ??
    requestFailedAt ??
    input.transfer.statusUpdatedAt?.toISOString() ??
    null;

  const terminalStatus: TransferTimelineStatus =
    input.status === 'FAILED' ? 'FAILED' : input.status === 'CANCELED' ? 'CANCELED' : 'DONE';

  const items: TransferTimelineItem[] = [
    {
      key: 'requested',
      label: 'Solicitação enviada',
      at: input.transfer.createdAt.toISOString(),
      status: 'DONE',
      detail: 'Solicitação registrada com sucesso.',
    },
    {
      key: 'provider-created',
      label: 'Transferência encaminhada',
      at: asaasCreatedAt ?? (input.transfer.asaasTransferId ? input.transfer.createdAt.toISOString() : null),
      status: input.transfer.asaasTransferId ? 'DONE' : input.status === 'FAILED' ? 'FAILED' : 'PENDING',
      detail: input.transfer.asaasTransferId
        ? 'Transferência enviada para processamento.'
        : 'A transferência ainda aguarda envio para processamento.',
    },
  ];

  if (input.transfer.authorized === false) {
    items.push({
      key: 'authorization',
      label: 'Autorização necessária',
      at: input.transfer.statusUpdatedAt?.toISOString() ?? null,
      status: 'CURRENT',
      detail: 'A transferência aguarda uma autorização para continuar.',
    });
  }

  items.push({
    key: 'webhook',
    label: 'Processamento atualizado',
    at: latestWebhook?.recebidoEm.toISOString() ?? null,
    status: latestWebhook ? (latestWebhook.status === 'PROCESSADO' ? 'DONE' : 'CURRENT') : 'PENDING',
    detail: latestWebhook
      ? `Atualização do processamento recebida${latestWebhook.processadoEm ? ' e processada' : ''}.`
      : 'Aguardando atualização do processamento.',
  });

  if (input.lastReconciledAt) {
    items.push({
      key: 'reconciled',
      label: 'Dados conferidos',
      at: input.lastReconciledAt,
      status: 'DONE',
      detail: 'Os dados foram conferidos com o provedor.',
    });
  }

  items.push({
    key: 'current-status',
    label: TERMINAL_TRANSFER_STATUSES.has(input.status) ? 'Conclusão' : 'Situação atual',
    at: terminalAt,
    status: TERMINAL_TRANSFER_STATUSES.has(input.status) ? terminalStatus : 'CURRENT',
    detail: transferStatusDetail(input.status),
  });

  return items;
}

function buildOperationalAlerts(input: {
  status: string;
  createdAt: Date;
  asaasTransferId: string | null;
  failReason: string | null;
  transactionReceiptUrl: string | null;
  latestWebhook: TransferWebhookLog | null;
  officialLookupFailed: boolean;
  credentialsMissing: boolean;
  now?: Date;
}): TransferOperationalAlert[] {
  const alerts: TransferOperationalAlert[] = [];
  const now = input.now ?? new Date();
  const ageMs = now.getTime() - input.createdAt.getTime();
  const latestWebhookAgeMs = input.latestWebhook ? now.getTime() - input.latestWebhook.recebidoEm.getTime() : null;

  if (input.credentialsMissing && input.asaasTransferId) {
    alerts.push({
      severity: 'warning',
      code: 'CREDENCIAIS_PROVEDOR_AUSENTES',
      message: 'A consulta oficial não foi executada porque a conta financeira não possui credenciais ativas.',
    });
  }

  if (input.officialLookupFailed) {
    alerts.push({
      severity: 'warning',
      code: 'CONSULTA_PROVEDOR_INDISPONIVEL',
      message: 'Não foi possível confirmar o estado mais recente no provedor financeiro nesta leitura.',
    });
  }

  if (input.status === 'FAILED' && input.failReason) {
    alerts.push({
      severity: 'error',
      code: 'TRANSFERENCIA_FALHOU',
      message: input.failReason,
    });
  }

  if (input.status === 'DONE' && !input.transactionReceiptUrl) {
    alerts.push({
      severity: 'warning',
      code: 'COMPROVANTE_INDISPONIVEL',
      message: 'A transferência foi concluída, mas o comprovante oficial ainda não está disponível.',
    });
  }

  if (OPEN_TRANSFER_STATUSES.has(input.status) && input.asaasTransferId && !input.latestWebhook && ageMs > STALE_WEBHOOK_MS) {
    alerts.push({
      severity: 'warning',
      code: 'WEBHOOK_NAO_RECEBIDO',
      message: 'Ainda não há evento do provedor para esta transferência. A reconciliação deve continuar ativa.',
    });
  }

  if (
    OPEN_TRANSFER_STATUSES.has(input.status) &&
    input.latestWebhook &&
    input.latestWebhook.status !== 'PROCESSADO' &&
    latestWebhookAgeMs !== null &&
    latestWebhookAgeMs > STALE_WEBHOOK_MS
  ) {
    alerts.push({
      severity: input.latestWebhook.status === 'EXAURIDO' ? 'error' : 'warning',
      code: 'WEBHOOK_PENDENTE_PROCESSAMENTO',
      message: 'Existe evento do provedor pendente ou com falha de processamento para esta transferência.',
    });
  }

  if (OPEN_TRANSFER_STATUSES.has(input.status) && ageMs > STALE_OPEN_TRANSFER_MS) {
    alerts.push({
      severity: 'warning',
      code: 'TRANSFERENCIA_ABERTA_ANTIGA',
      message: 'A transferência está aberta há mais tempo que o esperado. Revise webhook, autorização e reconciliação.',
    });
  }

  return alerts;
}

export async function getTransferDetail(input: GetTransferDetailInput): Promise<GetTransferDetailOutput> {
  const transfer = await prisma.transferRequest.findFirst({
    where: {
      id: input.transferId,
      contaId: input.contaId,
    },
    select: {
      id: true,
      externalReference: true,
      asaasTransferId: true,
      value: true,
      feeValue: true,
      netValue: true,
      endToEndIdentifier: true,
      destination: true,
      description: true,
      scheduleDate: true,
      status: true,
      statusUpdatedAt: true,
      createdAt: true,
      resolvedOperation: true,
      transactionReceiptUrl: true,
      failReason: true,
      authorized: true,
      effectiveDate: true,
      pixTransferSession: {
        select: {
          recipientName: true,
          recipientDocumentMasked: true,
          recipientBank: true,
          recipientPixKeyMasked: true,
        },
      },
    },
  });

  if (!transfer) {
    throw new Error('TRANSFER_NAO_ENCONTRADA');
  }

  const webhookLogs = transfer.asaasTransferId
    ? await prisma.webhookAsaas.findMany({
        where: {
          contaId: input.contaId,
          asaasTransferId: transfer.asaasTransferId,
        },
        orderBy: { recebidoEm: 'desc' },
        take: 5,
        select: {
          evento: true,
          status: true,
          recebidoEm: true,
          processadoEm: true,
          ultimoErro: true,
          payload: true,
        },
      })
    : [];

  const auditLogs = await prisma.auditLog.findMany({
    where: {
      contaId: input.contaId,
      entityType: 'TransferRequest',
      entityId: transfer.id,
    },
    orderBy: { createdAt: 'asc' },
    select: {
      action: true,
      createdAt: true,
    },
  });

  let officialTransfer: Awaited<ReturnType<typeof asaasGetTransfer>> | null = null;
  let officialLookupFailed = false;
  let credentialsMissing = false;
  if (transfer.asaasTransferId) {
    const credentials = await loadAsaasCredentials(input.contaId);
    if (credentials?.apiKey) {
      try {
        officialTransfer = await asaasGetTransfer({
          apiKey: credentials.apiKey,
          id: transfer.asaasTransferId,
        });
      } catch (error) {
        console.warn('[finance][getTransferDetail][official-transfer]', {
          contaId: input.contaId,
          transferId: transfer.id,
          asaasTransferId: transfer.asaasTransferId,
          error: error instanceof Error ? error.message : String(error),
        });
        officialLookupFailed = true;
      }
    } else {
      credentialsMissing = true;
    }
  }

  const baseMetadata = resolveTransferMetadata(
    transfer.destination,
    transfer.description ?? null,
    transfer.resolvedOperation,
  );
  const sessionMetadata = transfer.pixTransferSession
    ? {
        recipientName: transfer.pixTransferSession.recipientName ?? null,
        cpfCnpjMasked: transfer.pixTransferSession.recipientDocumentMasked ?? null,
        bankName: transfer.pixTransferSession.recipientBank ?? null,
        pixKeyMasked: transfer.pixTransferSession.recipientPixKeyMasked ?? null,
      }
    : null;
  const latestWebhook = webhookLogs[0] ?? null;
  const webhookMetadata = extractWebhookTransferMetadata(latestWebhook?.payload ?? null);
  const officialMetadata = extractOfficialTransferMetadata(officialTransfer);
  const metadata = mergeTransferMetadata(baseMetadata, sessionMetadata, webhookMetadata, officialMetadata);
  const amount = officialTransfer?.value ?? Number(transfer.value);
  const canCancel = officialTransfer
    ? isCancellableAsaasTransfer(officialTransfer)
    : transfer.status === 'REQUESTED' || transfer.status === 'PENDING';

  const resolvedStatus = resolveTransferStatus({ asaasStatus: officialTransfer?.status }) ?? transfer.status;
  const transactionReceiptUrl = officialTransfer?.transactionReceiptUrl ?? transfer.transactionReceiptUrl ?? null;
  const failReason = officialTransfer?.failReason?.trim() ?? transfer.failReason ?? null;
  const lastReconciledAt = findFirstAuditAt(auditLogs, ['finance.transfer.reconciled_from_asaas']);

  return {
    id: transfer.id,
    externalReference: officialTransfer?.externalReference ?? transfer.externalReference,
    asaasTransferId: transfer.asaasTransferId ?? officialTransfer?.id ?? null,
    amount,
    feeAmount: resolveOfficialFeeValue(officialTransfer, webhookMetadata, amount) ?? (transfer.feeValue !== null ? Number(transfer.feeValue) : null),
    netAmount: resolveOfficialNetValue(officialTransfer, webhookMetadata, amount) ?? (transfer.netValue !== null ? Number(transfer.netValue) : amount),
    status: resolvedStatus,
    operation: metadata.operation,
    requestedDestinationType: resolveRequestedTransferDestinationType(transfer.destination),
    description: officialTransfer?.description?.trim() || transfer.description || null,
    scheduleDate: officialTransfer?.scheduleDate ?? transfer.scheduleDate?.toISOString() ?? null,
    transferDate: officialTransfer?.effectiveDate ?? transfer.effectiveDate ?? transfer.statusUpdatedAt?.toISOString() ?? null,
    createdAt: transfer.createdAt.toISOString(),
    statusUpdatedAt: transfer.statusUpdatedAt?.toISOString() ?? null,
    transactionReceiptUrl,
    endToEndIdentifier: officialTransfer?.endToEndIdentifier ?? transfer.endToEndIdentifier ?? null,
    failReason,
    authorized: typeof officialTransfer?.authorized === 'boolean' ? officialTransfer.authorized : transfer.authorized ?? null,
    canCancel,
    lastWebhookAt: latestWebhook?.recebidoEm.toISOString() ?? null,
    lastReconciledAt,
    timeline: buildTransferTimeline({
      transfer: {
        asaasTransferId: transfer.asaasTransferId ?? officialTransfer?.id ?? null,
        createdAt: transfer.createdAt,
        statusUpdatedAt: transfer.statusUpdatedAt,
        effectiveDate: officialTransfer?.effectiveDate ?? transfer.effectiveDate ?? null,
        authorized: typeof officialTransfer?.authorized === 'boolean' ? officialTransfer.authorized : transfer.authorized ?? null,
      },
      status: resolvedStatus,
      auditLogs,
      webhookLogs,
      lastReconciledAt,
    }),
    operationalAlerts: buildOperationalAlerts({
      status: resolvedStatus,
      createdAt: transfer.createdAt,
      asaasTransferId: transfer.asaasTransferId ?? officialTransfer?.id ?? null,
      failReason,
      transactionReceiptUrl,
      latestWebhook,
      officialLookupFailed,
      credentialsMissing,
    }),
    recipient: {
      name: metadata.recipientName,
      cpfCnpj: metadata.cpfCnpjMasked,
      bankName: metadata.bankName,
      pixKey: metadata.pixKeyMasked,
      agency: metadata.agency,
      account: metadata.account,
      accountDigit: metadata.accountDigit,
      accountType: metadata.accountType,
    },
  };
}
