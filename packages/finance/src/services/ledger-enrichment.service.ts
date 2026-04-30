import { prisma } from '@alusa/database';
import type { LedgerEntry } from '../dtos/ledger';
import { parseWithdrawDestination, summarizeWithdrawDestination } from '../use-cases/transfers/recipient-utils';

interface EnrichmentContext {
  contaId: string;
}

interface ChargeSnapshot {
  payerName: string | null;
  description: string | null;
  customerId: string | null;
  cobrancaId: string | null;
  standaloneInstallmentPlanId: string | null;
  standaloneSubscriptionId: string | null;
}

interface InvoiceSnapshot extends ChargeSnapshot {
  invoiceRecordId: string;
}

interface TransferSnapshot {
  transferRequestId: string;
  externalReference: string;
  description: string | null;
  recipientName: string | null;
  recipientDocumentMasked: string | null;
  recipientBank: string | null;
  destinationDetail: string | null;
}

type TransferWebhookBankAccount = {
  ownerName?: string | null;
  cpfCnpj?: string | null;
  bank?: {
    name?: string | null;
    code?: string | null;
  } | null;
};

type TransferWebhookPayload = {
  transfer?: {
    bankAccount?: TransferWebhookBankAccount | null;
  } | null;
};

/**
 * Enriquece entries do ledger com dados locais (chargeName, customerName, metadata).
 * Estritamente read-only. Nunca altera a semântica financeira oficial.
 * Ausência de vínculo local não quebra a linha.
 */
export async function enrichLedgerEntries(
  entries: LedgerEntry[],
  ctx: EnrichmentContext,
): Promise<LedgerEntry[]> {
  const paymentIds = entries
    .map((e) => e.paymentId)
    .filter((id): id is string => Boolean(id));

  const invoiceIds = entries
    .map((e) => e.invoiceId)
    .filter((id): id is string => Boolean(id));

  const transferIds = entries
    .map((e) => e.transferId)
    .filter((id): id is string => Boolean(id));

  if (paymentIds.length === 0 && invoiceIds.length === 0 && transferIds.length === 0) {
    return entries;
  }

  const [chargeMap, invoiceMap, transferMap] = await Promise.all([
    loadChargesByPaymentIds(ctx.contaId, paymentIds),
    loadInvoicesByAsaasInvoiceIds(ctx.contaId, invoiceIds),
    loadTransfersByAsaasTransferIds(ctx.contaId, transferIds),
  ]);

  return entries.map((entry) => {
    const charge = entry.paymentId ? chargeMap.get(entry.paymentId) : undefined;
    const invoice = entry.invoiceId ? invoiceMap.get(entry.invoiceId) : undefined;
    const transfer = entry.transferId ? transferMap.get(entry.transferId) : undefined;
    const linkedCharge = charge ?? invoice;

    if (!linkedCharge && !transfer) return entry;

    return {
      ...entry,
      chargeName:
        linkedCharge?.description
        ?? entry.chargeName
        ?? resolveTransferReference(transfer),
      customerName:
        linkedCharge?.payerName
        ?? entry.customerName
        ?? transfer?.recipientName
        ?? undefined,
      metadata: {
        ...entry.metadata,
        chargeId: linkedCharge?.cobrancaId ?? entry.metadata?.chargeId,
        subscriptionId: linkedCharge?.standaloneSubscriptionId ?? entry.metadata?.subscriptionId,
        invoiceRecordId: invoice?.invoiceRecordId ?? entry.metadata?.invoiceRecordId,
        transferRequestId: transfer?.transferRequestId ?? entry.metadata?.transferRequestId,
        transferExternalReference:
          transfer?.externalReference ?? entry.metadata?.transferExternalReference ?? undefined,
        transferRecipientDocumentMasked:
          transfer?.recipientDocumentMasked ?? entry.metadata?.transferRecipientDocumentMasked ?? undefined,
        transferRecipientBank:
          transfer?.recipientBank ?? entry.metadata?.transferRecipientBank ?? undefined,
      },
    };
  });
}

function normalizeMaskedCpfCnpj(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  const digits = trimmed.replace(/\D+/g, '');

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

function resolveWebhookBankName(bank: TransferWebhookBankAccount['bank']): string | null {
  if (!bank) return null;

  const trimmedName = bank.name?.trim();
  if (trimmedName) return trimmedName;

  const trimmedCode = bank.code?.trim();
  if (trimmedCode) return `Banco ${trimmedCode}`;

  return null;
}

function extractTransferWebhookMetadata(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null;

  const bankAccount = (payload as TransferWebhookPayload).transfer?.bankAccount;
  if (!bankAccount) return null;

  const recipientName = bankAccount.ownerName?.trim() || null;
  const recipientDocumentMasked = normalizeMaskedCpfCnpj(bankAccount.cpfCnpj ?? null);
  const recipientBank = resolveWebhookBankName(bankAccount.bank ?? null);

  if (!recipientName && !recipientDocumentMasked && !recipientBank) {
    return null;
  }

  return {
    recipientName,
    recipientDocumentMasked,
    recipientBank,
  };
}

function resolveTransferReference(transfer: TransferSnapshot | undefined): string | undefined {
  if (!transfer) return undefined;

  return transfer.description
    ?? transfer.recipientBank
    ?? transfer.destinationDetail
    ?? transfer.externalReference;
}

async function loadChargesByPaymentIds(
  contaId: string,
  paymentIds: string[],
): Promise<Map<string, ChargeSnapshot>> {
  const unique = [...new Set(paymentIds)];

  if (unique.length === 0) {
    return new Map<string, ChargeSnapshot>();
  }

  const charges = await prisma.charge.findMany({
    where: {
      contaId,
      asaasPaymentId: { in: unique },
    },
    select: {
      asaasPaymentId: true,
      payerName: true,
      description: true,
      customerId: true,
      cobrancaId: true,
      standaloneInstallmentPlanId: true,
      standaloneSubscriptionId: true,
    },
  });

  const map = new Map<string, ChargeSnapshot>();
  for (const c of charges) {
    if (c.asaasPaymentId) {
      map.set(c.asaasPaymentId, {
        payerName: c.payerName,
        description: c.description,
        customerId: c.customerId,
        cobrancaId: c.cobrancaId,
        standaloneInstallmentPlanId: c.standaloneInstallmentPlanId,
        standaloneSubscriptionId: c.standaloneSubscriptionId,
      });
    }
  }

  return map;
}

async function loadInvoicesByAsaasInvoiceIds(
  contaId: string,
  invoiceIds: string[],
): Promise<Map<string, InvoiceSnapshot>> {
  const unique = [...new Set(invoiceIds)];

  if (unique.length === 0) {
    return new Map<string, InvoiceSnapshot>();
  }

  const invoices = await prisma.invoice.findMany({
    where: {
      contaId,
      asaasInvoiceId: { in: unique },
    },
    select: {
      id: true,
      asaasInvoiceId: true,
      charge: {
        select: {
          payerName: true,
          description: true,
          customerId: true,
          cobrancaId: true,
          standaloneInstallmentPlanId: true,
          standaloneSubscriptionId: true,
        },
      },
    },
  });

  const map = new Map<string, InvoiceSnapshot>();
  for (const invoice of invoices) {
    if (invoice.asaasInvoiceId) {
      map.set(invoice.asaasInvoiceId, {
        invoiceRecordId: invoice.id,
        payerName: invoice.charge.payerName,
        description: invoice.charge.description,
        customerId: invoice.charge.customerId,
        cobrancaId: invoice.charge.cobrancaId,
        standaloneInstallmentPlanId: invoice.charge.standaloneInstallmentPlanId,
        standaloneSubscriptionId: invoice.charge.standaloneSubscriptionId,
      });
    }
  }

  return map;
}

async function loadTransfersByAsaasTransferIds(
  contaId: string,
  transferIds: string[],
): Promise<Map<string, TransferSnapshot>> {
  const unique = [...new Set(transferIds)];

  if (unique.length === 0) {
    return new Map<string, TransferSnapshot>();
  }

  const transfers = await prisma.transferRequest.findMany({
    where: {
      contaId,
      asaasTransferId: { in: unique },
    },
    select: {
      id: true,
      asaasTransferId: true,
      externalReference: true,
      description: true,
      destination: true,
      pixTransferSession: {
        select: {
          recipientName: true,
          recipientDocumentMasked: true,
          recipientBank: true,
        },
      },
    },
  });

  const webhooks = await prisma.webhookAsaas.findMany({
    where: {
      contaId,
      asaasTransferId: { in: unique },
    },
    select: {
      asaasTransferId: true,
      payload: true,
      recebidoEm: true,
    },
    orderBy: {
      recebidoEm: 'desc',
    },
  });

  const webhookMap = new Map<string, ReturnType<typeof extractTransferWebhookMetadata>>();
  for (const webhook of webhooks) {
    if (!webhook.asaasTransferId || webhookMap.has(webhook.asaasTransferId)) continue;
    webhookMap.set(webhook.asaasTransferId, extractTransferWebhookMetadata(webhook.payload));
  }

  const map = new Map<string, TransferSnapshot>();
  for (const transfer of transfers) {
    if (transfer.asaasTransferId) {
      const destination = parseWithdrawDestination(transfer.destination);
      const destinationSummary = destination ? summarizeWithdrawDestination(destination) : null;
      const webhook = webhookMap.get(transfer.asaasTransferId);

      map.set(transfer.asaasTransferId, {
        transferRequestId: transfer.id,
        externalReference: transfer.externalReference,
        description: transfer.description?.trim() || null,
        recipientName:
          transfer.pixTransferSession?.recipientName?.trim()
          || webhook?.recipientName
          || (destination?.type === 'BANK_ACCOUNT' ? destination.ownerName : null),
        recipientDocumentMasked:
          transfer.pixTransferSession?.recipientDocumentMasked
          || webhook?.recipientDocumentMasked
          || (destination?.type === 'BANK_ACCOUNT'
            ? normalizeMaskedCpfCnpj(destination.cpfCnpj)
            : null),
        recipientBank:
          transfer.pixTransferSession?.recipientBank
          || webhook?.recipientBank
          || (destination?.type === 'BANK_ACCOUNT' ? `Banco ${destination.bank.code}` : null),
        destinationDetail: destinationSummary?.detail ?? null,
      });
    }
  }

  return map;
}
