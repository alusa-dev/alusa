import { prisma, loadAsaasCredentials } from '@alusa/database';
import { getTransfer as asaasGetTransfer } from '@alusa/asaas';
import type { AsaasTransfer } from '@alusa/asaas';
import type { TransferStatus } from '@prisma/client';
import { NotificationCategory, NotificationSeverity, NotificationType } from '@prisma/client';
import { createNotification } from '@alusa/lib';

import { auditLogService } from '../foundation/audit-log.service';
import type { WithdrawDestination } from '../use-cases/request-withdraw';
import { mergePixRecipientMetadata, parseWithdrawDestination } from '../use-cases/transfers/recipient-utils';
import {
  isAllowedTransition,
  mapTransferStatusToPixTransferSessionStatus,
  resolveTransferStatus,
} from '../use-cases/transfers/transfer-status';

export type TransferWebhookPayload = {
  event: string;
  transfer: {
    id: string;
    status?: string | null;
    externalReference?: string | null;
    effectiveDate?: string | null;
    confirmedDate?: string | null;
    failReason?: string | null;
    description?: string | null;
    authorized?: boolean | null;
    operationType?: string | null;
    type?: string | null;
    transactionReceiptUrl?: string | null;
    bankAccount?: {
      ownerName?: string | null;
      cpfCnpj?: string | null;
      pixAddressKey?: string | null;
      bank?: {
        name?: string | null;
        code?: string | null;
      } | null;
    } | null;
  };
};

function normalizeOptionalString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeMaskedCpfCnpj(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  const digits = value?.replace(/\D+/g, '') ?? '';

  if (digits.length === 11) {
    return `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**`;
  }

  if (digits.length === 14) {
    return `**.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-**`;
  }

  if (trimmed.includes('*')) {
    return trimmed;
  }

  return null;
}

function resolveBankName(bank: { name?: string | null; code?: string | null } | null | undefined): string | null {
  const name = normalizeOptionalString(bank?.name);
  if (name) return name;

  const code = normalizeOptionalString(bank?.code);
  return code ? `Banco ${code}` : null;
}

function maskPixKey(value: string, type: string): string {
  const digits = value.replace(/\D+/g, '');

  if (type === 'PHONE' && digits.length >= 4) {
    return `${digits.slice(0, 2)}••••••${digits.slice(-2)}`;
  }

  if (type === 'CPF' || type === 'CNPJ') {
    return value;
  }

  if (value.includes('@')) {
    const [local, domain] = value.split('@');
    if (local && domain) return `${local.slice(0, 2)}•••@${domain}`;
  }

  if (value.length > 8) return `${value.slice(0, 4)}••••${value.slice(-4)}`;
  return value;
}

function extractOfficialPixRecipientMetadata(
  destination: Extract<WithdrawDestination, { type: 'PIX' }>,
  officialTransfer: AsaasTransfer | null,
  payloadTransfer: TransferWebhookPayload['transfer'],
) {
  const bankAccount = officialTransfer?.bankAccount ?? payloadTransfer.bankAccount;
  if (!bankAccount) return null;

  const recipientName = normalizeOptionalString(bankAccount.ownerName);
  const recipientDocumentMasked = normalizeMaskedCpfCnpj(bankAccount.cpfCnpj);
  const recipientBank = resolveBankName(bankAccount.bank);
  const recipientPixKeyMasked = normalizeOptionalString(bankAccount.pixAddressKey)
    ? maskPixKey(bankAccount.pixAddressKey as string, destination.pixAddressKeyType)
    : destination.recipientPixKeyMasked ?? maskPixKey(destination.pixAddressKey, destination.pixAddressKeyType);

  if (!recipientName && !recipientDocumentMasked && !recipientBank && !recipientPixKeyMasked) {
    return null;
  }

  return {
    recipientName,
    recipientDocumentMasked,
    recipientBank,
    recipientPixKeyMasked,
  };
}

function didPixDestinationChange(
  current: Extract<WithdrawDestination, { type: 'PIX' }>,
  next: Extract<WithdrawDestination, { type: 'PIX' }>,
): boolean {
  return current.recipientName !== next.recipientName
    || current.recipientDocumentMasked !== next.recipientDocumentMasked
    || current.recipientBank !== next.recipientBank
    || current.recipientPixKeyMasked !== next.recipientPixKeyMasked;
}

function formatBRL(value: number | null | undefined): string | null {
  if (value == null) return null;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatBRTDateTime(date: Date): string {
  const formatted = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
  // Output: "25/03/2026, 14:32" → "25/03/2026 às 14:32"
  return formatted.replace(', ', ' às ');
}

function resolveNotificationRecipient(
  parsedDest: WithdrawDestination | null,
  pixMeta: { recipientName: string | null } | null,
): string | null {
  if (pixMeta?.recipientName) return pixMeta.recipientName;
  if (parsedDest?.type === 'PIX') return parsedDest.recipientName ?? null;
  if (parsedDest?.type === 'BANK_ACCOUNT') return parsedDest.ownerName;
  return null;
}

function resolveOperationLabel(
  parsedDest: WithdrawDestination | null,
  officialOp: string | null | undefined,
): string {
  const op = officialOp ?? (parsedDest?.type === 'PIX' ? 'PIX' : 'TED');
  return op === 'PIX' ? 'PIX' : 'TED';
}

function buildTransferDoneMessage(params: {
  value: number | null | undefined;
  netValue: number | null | undefined;
  feeValue: number | null | undefined;
  recipient: string | null;
  operation: string;
  datetime: Date;
}): string {
  const lines: string[] = ['Transferência realizada com sucesso.', ''];

  const displayValue = params.netValue ?? params.value;
  if (displayValue != null) {
    lines.push(`**Valor enviado:** ${formatBRL(displayValue)}`);
  }
  if (params.feeValue) {
    lines.push(`**Taxa:** ${formatBRL(params.feeValue)}`);
  }
  if (params.recipient) {
    lines.push(`**Destinatário:** ${params.recipient}`);
  }
  lines.push(`**Método:** ${params.operation}`);
  lines.push(`**Data e hora:** ${formatBRTDateTime(params.datetime)}`);

  return lines.join('\n');
}

function buildTransferFailedMessage(params: {
  value: number | null | undefined;
  recipient: string | null;
  operation: string;
  failReason: string | null;
  datetime: Date;
}): string {
  const lines: string[] = ['A transferência não pôde ser concluída.', ''];

  if (params.value != null) {
    lines.push(`**Valor:** ${formatBRL(params.value)}`);
  }
  if (params.recipient) {
    lines.push(`**Destinatário:** ${params.recipient}`);
  }
  lines.push(`**Método:** ${params.operation}`);
  lines.push(`**Data e hora:** ${formatBRTDateTime(params.datetime)}`);
  if (params.failReason) {
    lines.push(`**Motivo:** ${params.failReason}`);
  }

  return lines.join('\n');
}

function buildTransferCancelledMessage(params: {
  value: number | null | undefined;
  recipient: string | null;
  operation: string;
  datetime: Date;
}): string {
  const lines: string[] = ['A transferência foi cancelada.', ''];

  if (params.value != null) {
    lines.push(`**Valor:** ${formatBRL(params.value)}`);
  }
  if (params.recipient) {
    lines.push(`**Destinatário:** ${params.recipient}`);
  }
  lines.push(`**Método:** ${params.operation}`);
  lines.push(`**Data e hora:** ${formatBRTDateTime(params.datetime)}`);

  return lines.join('\n');
}

async function fetchOfficialTransfer(contaId: string, transferId: string): Promise<AsaasTransfer | null> {
  const credentials = await loadAsaasCredentials(contaId);
  if (!credentials) return null;

  try {
    return await asaasGetTransfer({
      apiKey: credentials.apiKey,
      id: transferId,
    });
  } catch (error) {
    console.warn('[finance][handleTransferWebhook][official-transfer-fetch-failed]', {
      contaId,
      transferId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function handleTransferWebhook(
  contaId: string,
  payload: TransferWebhookPayload
): Promise<{ success: boolean; error?: string }> {
  try {
    let externalReference = payload.transfer.externalReference ?? null;
    const transferRequestId =
      externalReference && externalReference.startsWith('transfer:')
        ? externalReference.slice('transfer:'.length)
        : null;

    let transferRequest = await prisma.transferRequest.findFirst({
      where: {
        contaId,
        OR: [
          { asaasTransferId: payload.transfer.id },
          ...(externalReference ? [{ externalReference }] : []),
          ...(transferRequestId ? [{ id: transferRequestId }] : []),
        ],
      },
      select: { id: true, status: true, asaasTransferId: true, externalReference: true, destination: true },
    });

    const officialTransfer = await fetchOfficialTransfer(contaId, payload.transfer.id);

    if (!transferRequest && officialTransfer?.externalReference) {
      externalReference = officialTransfer.externalReference;
      const officialTransferRequestId = officialTransfer.externalReference.startsWith('transfer:')
        ? officialTransfer.externalReference.slice('transfer:'.length)
        : null;

      transferRequest = await prisma.transferRequest.findFirst({
        where: {
          contaId,
          OR: [
            { asaasTransferId: payload.transfer.id },
            { externalReference: officialTransfer.externalReference },
            ...(officialTransferRequestId ? [{ id: officialTransferRequestId }] : []),
          ],
        },
        select: { id: true, status: true, asaasTransferId: true, externalReference: true, destination: true },
      });
    }

    if (!transferRequest) {
      return { success: true };
    }

    const effectiveTransfer = officialTransfer ?? payload.transfer;
    const nextStatus = resolveTransferStatus({
      asaasStatus: effectiveTransfer.status,
      event: payload.event,
    });

    // Log proeminente para falhas — visibilidade operacional imediata
    if (nextStatus === 'FAILED') {
      const failReason = officialTransfer?.failReason ?? payload.transfer.failReason;
      console.error('[finance][handleTransferWebhook][transfer-failed]', {
        contaId,
        transferRequestId: transferRequest.id,
        asaasTransferId: payload.transfer.id,
        event: payload.event,
        failReason: failReason ?? 'unknown',
        rawAsaasStatus: effectiveTransfer.status,
      });
    }

    // State regression guard: não permitir transições inválidas
    if (nextStatus && !isAllowedTransition(transferRequest.status as TransferStatus, nextStatus)) {
      console.warn('[finance][handleTransferWebhook][state-regression-blocked]', {
        contaId,
        transferRequestId: transferRequest.id,
        asaasTransferId: payload.transfer.id,
        event: payload.event,
        currentStatus: transferRequest.status,
        attemptedStatus: nextStatus,
      });

      await auditLogService.record({
        contaId,
        action: 'finance.webhook.transfer_state_regression_blocked',
        entity: { type: 'TransferRequest', id: transferRequest.id },
        metadata: {
          event: payload.event,
          asaasTransferId: payload.transfer.id,
          currentStatus: transferRequest.status,
          attemptedStatus: nextStatus,
          asaasStatus: effectiveTransfer.status ?? null,
          statusSource: officialTransfer ? 'ASAAS_GET' : 'WEBHOOK_PAYLOAD',
        },
      });

      return { success: true };
    }

    const parsedDestination = parseWithdrawDestination(transferRequest.destination);
    const pixDestination = parsedDestination?.type === 'PIX' ? parsedDestination : null;
    const officialPixMetadata = pixDestination
      ? extractOfficialPixRecipientMetadata(pixDestination, officialTransfer, payload.transfer)
      : null;
    const nextPixDestination = pixDestination
      ? mergePixRecipientMetadata(pixDestination, officialPixMetadata)
      : null;

    const updates: {
      status?: TransferStatus;
      statusUpdatedAt?: Date;
      asaasTransferId?: string;
      destination?: object;
      rawAsaasStatus?: string;
      authorized?: boolean;
      failReason?: string | null;
      transactionReceiptUrl?: string | null;
      effectiveDate?: string | null;
      endToEndIdentifier?: string | null;
      feeValue?: number | null;
      netValue?: number | null;
    } = {};

    if (!transferRequest.asaasTransferId) {
      updates.asaasTransferId = payload.transfer.id;
    }

    // Persistir campos oficiais do Asaas
    const rawStatus = (officialTransfer?.status ?? payload.transfer.status) as string | undefined;
    if (rawStatus) {
      updates.rawAsaasStatus = rawStatus;
    }

    const authorizedValue = officialTransfer?.authorized ?? payload.transfer.authorized;
    if (typeof authorizedValue === 'boolean') {
      updates.authorized = authorizedValue;
    }

    const failReasonValue = officialTransfer?.failReason ?? payload.transfer.failReason;
    updates.failReason = failReasonValue?.trim() || null;

    const receiptUrl = officialTransfer?.transactionReceiptUrl ?? payload.transfer.transactionReceiptUrl;
    updates.transactionReceiptUrl = receiptUrl?.trim() || null;

    const effectiveDateValue = officialTransfer?.effectiveDate ?? payload.transfer.effectiveDate;
    updates.effectiveDate = effectiveDateValue?.trim() || null;

    const endToEndValue = officialTransfer?.endToEndIdentifier ?? null;
    if (endToEndValue !== undefined) {
      updates.endToEndIdentifier = endToEndValue;
    }

    const transferFee = officialTransfer?.transferFee;
    if (transferFee !== undefined) {
      updates.feeValue = transferFee;
    }

    const net = officialTransfer?.netValue;
    if (net !== undefined) {
      updates.netValue = net;
    }

    if (pixDestination && nextPixDestination?.type === 'PIX' && didPixDestinationChange(pixDestination, nextPixDestination)) {
      updates.destination = nextPixDestination as unknown as object;
    }

    if (nextStatus && transferRequest.status !== nextStatus) {
      updates.status = nextStatus;
      updates.statusUpdatedAt = new Date();
    }

    const nextPixTransferSessionStatus = nextStatus ? mapTransferStatusToPixTransferSessionStatus(nextStatus) : null;
    const pixSessionUpdates: {
      status?: 'DONE' | 'FAILED';
      recipientName?: string;
      recipientDocumentMasked?: string;
      recipientBank?: string;
      recipientPixKeyMasked?: string;
    } = {};

    if (nextPixTransferSessionStatus) {
      pixSessionUpdates.status = nextPixTransferSessionStatus;
    }

    if (officialPixMetadata?.recipientName) {
      pixSessionUpdates.recipientName = officialPixMetadata.recipientName;
    }

    if (officialPixMetadata?.recipientDocumentMasked) {
      pixSessionUpdates.recipientDocumentMasked = officialPixMetadata.recipientDocumentMasked;
    }

    if (officialPixMetadata?.recipientBank) {
      pixSessionUpdates.recipientBank = officialPixMetadata.recipientBank;
    }

    if (officialPixMetadata?.recipientPixKeyMasked) {
      pixSessionUpdates.recipientPixKeyMasked = officialPixMetadata.recipientPixKeyMasked;
    }

    const shouldUpdateTransferRequest = Object.keys(updates).length > 0;
    const shouldUpdatePixSession = Object.keys(pixSessionUpdates).length > 0;

    if (shouldUpdateTransferRequest) {
      await prisma.transferRequest.update({ where: { id: transferRequest.id }, data: updates });
    }

    if (shouldUpdatePixSession) {
      await prisma.pixTransferSession.updateMany({
        where: {
          contaId,
          confirmTransferRequestId: transferRequest.id,
        },
        data: pixSessionUpdates,
      });
    }

    if (shouldUpdateTransferRequest || shouldUpdatePixSession) {
      await auditLogService.record({
        contaId,
        action: 'finance.webhook.transfer_status_changed',
        entity: { type: 'TransferRequest', id: transferRequest.id },
        metadata: {
          event: payload.event,
          asaasTransferId: payload.transfer.id,
          externalReference: transferRequest.externalReference,
          asaasStatus: effectiveTransfer.status ?? payload.transfer.status,
          previousStatus: transferRequest.status,
          nextStatus: nextStatus ?? null,
          statusSource: officialTransfer ? 'ASAAS_GET' : 'WEBHOOK_PAYLOAD',
          failReason: officialTransfer?.failReason ?? payload.transfer.failReason ?? null,
          effectiveDate: officialTransfer?.effectiveDate ?? payload.transfer.effectiveDate ?? null,
          recipientMetadataSynced: Boolean(officialPixMetadata),
          transactionReceiptUrl:
            officialTransfer?.transactionReceiptUrl ?? payload.transfer.transactionReceiptUrl ?? null,
        },
      });
    }

    if (nextStatus === 'DONE' || nextStatus === 'FAILED' || nextStatus === 'CANCELED') {
      const notifRecipient = resolveNotificationRecipient(parsedDestination, officialPixMetadata);
      const notifOperation = resolveOperationLabel(
        parsedDestination,
        officialTransfer?.operationType,
      );
      const notifNow = new Date();

      if (nextStatus === 'DONE') {
        const doneMessage = buildTransferDoneMessage({
          value: officialTransfer?.value ?? null,
          netValue: updates.netValue ?? null,
          feeValue: updates.feeValue ?? null,
          recipient: notifRecipient,
          operation: notifOperation,
          datetime: notifNow,
        });

        await createNotification({
          contaId,
          type: NotificationType.TRANSFER_DONE,
          category: NotificationCategory.SYSTEM,
          severity: NotificationSeverity.SUCCESS,
          title: 'Transferência realizada',
          message: doneMessage,
          dedupeKey: `transfer:done:${transferRequest.id}`,
          entityType: 'TransferRequest',
          entityId: transferRequest.id,
          sourceType: 'WEBHOOK',
          sourceId: payload.transfer.id,
          metadata: {
            webhookEvent: payload.event,
            externalReference: transferRequest.externalReference,
            effectiveDate: updates.effectiveDate ?? null,
          },
        }).catch((err: unknown) => {
          console.warn('[finance][handleTransferWebhook][notify-done-failed]', { contaId, transferId: transferRequest.id, err });
        });
      }

      if (nextStatus === 'FAILED') {
        const failReason = officialTransfer?.failReason ?? payload.transfer.failReason ?? null;
        const failedMessage = buildTransferFailedMessage({
          value: officialTransfer?.value ?? null,
          recipient: notifRecipient,
          operation: notifOperation,
          failReason,
          datetime: notifNow,
        });

        await createNotification({
          contaId,
          type: NotificationType.TRANSFER_FAILED,
          category: NotificationCategory.SYSTEM,
          severity: NotificationSeverity.CRITICAL,
          title: 'Envio não processado',
          message: failedMessage,
          dedupeKey: `transfer:failed:${transferRequest.id}`,
          entityType: 'TransferRequest',
          entityId: transferRequest.id,
          sourceType: 'WEBHOOK',
          sourceId: payload.transfer.id,
          metadata: {
            webhookEvent: payload.event,
            externalReference: transferRequest.externalReference,
            failReason,
          },
        }).catch((err: unknown) => {
          console.warn('[finance][handleTransferWebhook][notify-failed-failed]', { contaId, transferId: transferRequest.id, err });
        });
      }

      if (nextStatus === 'CANCELED') {
        const cancelledMessage = buildTransferCancelledMessage({
          value: officialTransfer?.value ?? null,
          recipient: notifRecipient,
          operation: notifOperation,
          datetime: notifNow,
        });

        await createNotification({
          contaId,
          type: NotificationType.TRANSFER_CANCELLED,
          category: NotificationCategory.SYSTEM,
          severity: NotificationSeverity.WARNING,
          title: 'Transferência cancelada',
          message: cancelledMessage,
          dedupeKey: `transfer:cancelled:${transferRequest.id}`,
          entityType: 'TransferRequest',
          entityId: transferRequest.id,
          sourceType: 'WEBHOOK',
          sourceId: payload.transfer.id,
          metadata: {
            webhookEvent: payload.event,
            externalReference: transferRequest.externalReference,
          },
        }).catch((err: unknown) => {
          console.warn('[finance][handleTransferWebhook][notify-cancelled-failed]', { contaId, transferId: transferRequest.id, err });
        });
      }
    }

    return { success: true };
  } catch (error) {
    console.error('[finance][handleTransferWebhook]', error);
    return { success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' };
  }
}
