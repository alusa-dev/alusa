import type { InvoiceStatus } from '@prisma/client';

import type { CreateInvoiceResultDTO, InvoiceStatusDTO } from '../dtos/invoices/create-invoice-result.dto';
import type { ListInvoicesQueryParsed } from '../dtos/invoices/list-invoices-query.dto';
import type { InvoiceListItemDTO, ListInvoicesResultDTO } from '../dtos/invoices/list-invoices-result.dto';
import type { ScheduleChargeInvoiceOutput } from '../use-cases/schedule-charge-invoice';
import type { InvoiceListItem, ListInvoicesOutput } from '../use-cases/list-invoices';

export function mapCreateInvoiceOutputToDTO(output: ScheduleChargeInvoiceOutput): CreateInvoiceResultDTO {
  return {
    id: output.invoiceId,
    chargeId: output.chargeId,
    externalReference: output.externalReference,
    asaasInvoiceId: output.asaasInvoiceId,
    status: output.status as InvoiceStatusDTO,
    statusUpdatedAt: output.statusUpdatedAt,
    pdfUrl: output.pdfUrl,
    xmlUrl: output.xmlUrl,
    number: output.number,
    createdAt: output.createdAt,
  };
}

export function mapInvoiceToListItemDTO(item: InvoiceListItem): InvoiceListItemDTO {
  return {
    id: item.id,
    chargeId: item.chargeId,
    externalReference: item.externalReference,
    asaasInvoiceId: item.asaasInvoiceId,
    status: item.status as InvoiceStatusDTO,
    statusUpdatedAt: item.statusUpdatedAt,
    number: item.number,
    pdfUrl: item.pdfUrl,
    xmlUrl: item.xmlUrl,
    createdAt: item.createdAt,
  };
}

export function mapListInvoicesOutputToDTO(
  output: ListInvoicesOutput,
  query: ListInvoicesQueryParsed
): ListInvoicesResultDTO {
  return {
    items: output.items.map(mapInvoiceToListItemDTO),
    total: output.total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.ceil(output.total / query.pageSize),
  };
}

export function mapListInvoicesQueryToInput(
  query: ListInvoicesQueryParsed,
  contaId: string
): { contaId: string; limit: number; offset: number; status?: InvoiceStatus } {
  return {
    contaId,
    limit: query.pageSize,
    offset: (query.page - 1) * query.pageSize,
    status: query.status ? (query.status as InvoiceStatus) : undefined,
  };
}
