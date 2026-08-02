/**
 * Atualização de nota fiscal agendada (Invoice / NFS-e) no Asaas.
 *
 * Endpoint oficial: PUT /v3/invoices/{id}
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasInvoice, UpdateInvoiceInput } from '../types/asaas';

export interface UpdateInvoiceParams {
  apiKey: string;
  id: string;
  data: UpdateInvoiceInput;
}

function supplied<T extends object, K extends keyof T>(value: T, key: K): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export async function updateInvoice(params: UpdateInvoiceParams): Promise<AsaasInvoice> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  if (!params.data.taxes) {
    return client.put<AsaasInvoice>(`/invoices/${params.id}`, params.data);
  }

  // Since 2026-03-31 Asaas replaces the entire `taxes` object on PUT. Reading
  // first protects callers compiled against older clients and deliberately
  // excludes response-only fields such as pisCofinsRetentionType/IBS values.
  const current = await client.get<AsaasInvoice>(`/invoices/${params.id}`);
  const currentTaxes = current.taxes;
  const requested = params.data.taxes;
  const taxes = {
    retainIss: supplied(requested, 'retainIss') ? requested.retainIss : currentTaxes?.retainIss ?? false,
    cofins: supplied(requested, 'cofins') ? requested.cofins : currentTaxes?.cofins ?? null,
    csll: supplied(requested, 'csll') ? requested.csll : currentTaxes?.csll ?? 0,
    inss: supplied(requested, 'inss') ? requested.inss : currentTaxes?.inss ?? 0,
    ir: supplied(requested, 'ir') ? requested.ir : currentTaxes?.ir ?? 0,
    pis: supplied(requested, 'pis') ? requested.pis : currentTaxes?.pis ?? null,
    iss: supplied(requested, 'iss') ? requested.iss : currentTaxes?.iss ?? 0,
    nbsCode: supplied(requested, 'nbsCode') ? requested.nbsCode : currentTaxes?.nbsCode ?? null,
    taxSituationCode:
      supplied(requested, 'taxSituationCode') ? requested.taxSituationCode : currentTaxes?.taxSituationCode ?? null,
    taxClassificationCode:
      supplied(requested, 'taxClassificationCode') ? requested.taxClassificationCode : currentTaxes?.taxClassificationCode ?? null,
    operationIndicatorCode:
      supplied(requested, 'operationIndicatorCode') ? requested.operationIndicatorCode : currentTaxes?.operationIndicatorCode ?? null,
    pisCofinsTaxStatus:
      supplied(requested, 'pisCofinsTaxStatus') ? requested.pisCofinsTaxStatus : currentTaxes?.pisCofinsTaxStatus ?? null,
    operationPis: supplied(requested, 'operationPis') ? requested.operationPis : currentTaxes?.operationPis ?? null,
    operationCofins:
      supplied(requested, 'operationCofins') ? requested.operationCofins : currentTaxes?.operationCofins ?? null,
    useTaxSystemReformNT007:
      supplied(requested, 'useTaxSystemReformNT007')
        ? requested.useTaxSystemReformNT007
        : currentTaxes?.useTaxSystemReformNT007 ?? false,
  };

  return client.put<AsaasInvoice>(`/invoices/${params.id}`, { ...params.data, taxes });
}
