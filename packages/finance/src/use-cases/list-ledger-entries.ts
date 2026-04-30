import { listFinancialTransactions as asaasListFinancialTransactions } from '@alusa/asaas';
import { loadAsaasCredentials } from '@alusa/database';
import type { Result } from '@alusa/shared';
import { err, ok } from '@alusa/shared';

import type { LedgerEntryDTO, ListLedgerEntriesResultDTO } from '../dtos/ledger';
import { mapAsaasTransactionToLedgerEntry } from '../mappers/ledger.mapper';

export type ListLedgerEntriesError =
  | 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
  | 'ERRO_AO_LISTAR_EXTRATO';

export interface ListLedgerEntriesInput {
  contaId: string;
  offset?: number;
  limit?: number;
  startDate?: string;
  finishDate?: string;
  order?: 'asc' | 'desc';
}

export async function listLedgerEntries(
  input: ListLedgerEntriesInput,
): Promise<Result<ListLedgerEntriesResultDTO, ListLedgerEntriesError>> {
  const credentials = await loadAsaasCredentials(input.contaId);
  if (!credentials) return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');

  try {
    const response = await asaasListFinancialTransactions({
      apiKey: credentials.apiKey,
      offset: input.offset,
      limit: input.limit,
      startDate: input.startDate,
      finishDate: input.finishDate,
      order: input.order,
    });

    const entries: LedgerEntryDTO[] = response.data.map(mapAsaasTransactionToLedgerEntry);

    const summary = entries.reduce(
      (acc, entry) => {
        if (entry.sign === 'CREDIT') acc.credits += entry.value;
        else acc.debits += entry.value;

        if (
          entry.category === 'PAYMENT_FEE'
          || entry.category === 'TRANSFER_FEE'
          || entry.category === 'PIX_FEE'
          || entry.category === 'INVOICE_FEE'
          || entry.category === 'DUNNING_FEE'
          || entry.category === 'NOTIFICATION_FEE'
          || entry.category === 'PLAN_FEE'
        ) {
          acc.fees += Math.abs(entry.value);
        }
        return acc;
      },
      { credits: 0, debits: 0, fees: 0, net: 0 },
    );
    summary.net = Number((summary.credits + summary.debits).toFixed(2));
    summary.credits = Number(summary.credits.toFixed(2));
    summary.debits = Number(summary.debits.toFixed(2));
    summary.fees = Number(summary.fees.toFixed(2));

    return ok({
      data: entries,
      hasMore: response.hasMore,
      totalCount: response.totalCount,
      offset: response.offset,
      limit: response.limit,
      summaryScope: 'CURRENT_PAGE',
      summary,
    });
  } catch {
    return err('ERRO_AO_LISTAR_EXTRATO');
  }
}
