import { prisma } from '@alusa/database';
import type { InvoiceStatus } from '@prisma/client';

export type ListInvoicesInput = {
  contaId: string;
  limit?: number;
  offset?: number;
  status?: InvoiceStatus;
};

export type InvoiceListItem = {
  id: string;
  chargeId: string;
  externalReference: string;
  asaasInvoiceId: string | null;
  status: InvoiceStatus;
  statusUpdatedAt: string;
  number: string | null;
  pdfUrl: string | null;
  xmlUrl: string | null;
  createdAt: string;
};

export type ListInvoicesOutput = {
  items: InvoiceListItem[];
  total: number;
};

type InvoiceRecord = {
  id: string;
  chargeId: string;
  externalReference: string;
  asaasInvoiceId: string | null;
  status: InvoiceStatus;
  statusUpdatedAt: Date;
  number: string | null;
  pdfUrl: string | null;
  xmlUrl: string | null;
  createdAt: Date;
};

export async function listInvoices(input: ListInvoicesInput): Promise<ListInvoicesOutput> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);

  const where: { contaId: string; status?: InvoiceStatus } = { contaId: input.contaId };
  if (input.status) where.status = input.status;

  const [items, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      select: {
        id: true,
        chargeId: true,
        externalReference: true,
        asaasInvoiceId: true,
        status: true,
        statusUpdatedAt: true,
        number: true,
        pdfUrl: true,
        xmlUrl: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.invoice.count({ where }),
  ]);

  const typedItems = items as InvoiceRecord[];

  return {
    items: typedItems.map((invoice) => ({
      id: invoice.id,
      chargeId: invoice.chargeId,
      externalReference: invoice.externalReference,
      asaasInvoiceId: invoice.asaasInvoiceId ?? null,
      status: invoice.status,
      statusUpdatedAt: invoice.statusUpdatedAt.toISOString(),
      number: invoice.number ?? null,
      pdfUrl: invoice.pdfUrl ?? null,
      xmlUrl: invoice.xmlUrl ?? null,
      createdAt: invoice.createdAt.toISOString(),
    })),
    total,
  };
}
