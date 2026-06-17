import type { InvoiceStatus, Prisma } from '@prisma/client';

import { getFiscalPrisma } from './fiscal-prisma';

export async function recordInvoiceAuditEvent(input: {
  contaId: string;
  invoiceId: string;
  action: string;
  fromStatus?: InvoiceStatus | null;
  toStatus?: InvoiceStatus | null;
  metadata?: Prisma.InputJsonObject;
  correlationId?: string;
}): Promise<void> {
  const prisma = getFiscalPrisma();
  await prisma.invoiceAuditEvent.create({
    data: {
      contaId: input.contaId,
      invoiceId: input.invoiceId,
      action: input.action,
      fromStatus: input.fromStatus ?? undefined,
      toStatus: input.toStatus ?? undefined,
      metadata: input.metadata ?? undefined,
      correlationId: input.correlationId,
    },
  });
}
