import type { InvoiceStatus } from '@prisma/client';

import type { CreateInvoiceDTO } from '../dtos/invoices/create-invoice.dto';
import type { CreateInvoiceResultDTO, InvoiceStatusDTO } from '../dtos/invoices/create-invoice-result.dto';
import type { ListInvoicesQueryParsed } from '../dtos/invoices/list-invoices-query.dto';
import type { InvoiceListItemDTO, ListInvoicesResultDTO } from '../dtos/invoices/list-invoices-result.dto';
import type { CreateInvoiceInput, CreateInvoiceOutput } from '../use-cases/create-invoice';
import type { InvoiceListItem, ListInvoicesOutput } from '../use-cases/list-invoices';

function parseDecimalString(value: string): number {
  return parseFloat(value);
}

export function mapCreateInvoiceDTOToInput(
  dto: CreateInvoiceDTO,
  context: { contaId: string; actorId: string }
): CreateInvoiceInput {
  return {
    contaId: context.contaId,
    chargeId: dto.chargeId,
    serviceDescription: dto.serviceDescription,
    observations: dto.observations,
    value: parseDecimalString(dto.value),
    deductions: parseDecimalString(dto.deductions),
    effectiveDate: dto.effectiveDate,
    municipalServiceCode: dto.municipalServiceCode,
    municipalServiceName: dto.municipalServiceName,
    taxes: dto.taxes,
    updatePayment: dto.updatePayment,
    actor: { type: 'USER', id: context.actorId },
  };
}

export function mapCreateInvoiceOutputToDTO(output: CreateInvoiceOutput): CreateInvoiceResultDTO {
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
