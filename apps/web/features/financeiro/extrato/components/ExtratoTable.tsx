'use client';

import { Eye } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { LedgerEntry } from '../dtos';
import {
  abbreviateBankName,
  extratoMobileMethodLine,
  formatExtratoDescription,
  formatCurrency,
  formatDate,
  formatStatusLabel,
  transferDocumentForList,
} from '../utils/extrato-formatters';
import { getStatusBadgeVariant } from '../utils/extrato-badges';
import { ExtratoEmptyState } from './ExtratoEmptyState';

interface ExtratoTableProps {
  entries: LedgerEntry[];
  loading?: boolean;
  hasActiveFilters?: boolean;
  onSelect: (_entry: LedgerEntry) => void;
}

export function ExtratoTable({ entries, loading, hasActiveFilters, onSelect }: ExtratoTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] table-fixed divide-y divide-gray-100">
        <thead className="hidden lg:table-header-group">
          <tr className="bg-gray-50">
            <th
              scope="col"
              className="w-[10%] px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase lg:px-6"
            >
              Data
            </th>
            <th
              scope="col"
              className="hidden w-[16%] px-6 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase lg:table-cell"
            >
              Transação
            </th>
            <th
              scope="col"
              className="hidden w-[46%] px-6 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase lg:table-cell"
            >
              Descrição
            </th>
            <th
              scope="col"
              className="hidden w-[14%] px-6 py-3 text-right text-xs font-medium tracking-wider text-gray-500 uppercase lg:table-cell"
            >
              Valor (R$)
            </th>
            <th
              scope="col"
              className="hidden w-[14%] px-6 py-3 text-right text-xs font-medium tracking-wider text-gray-500 uppercase lg:table-cell"
            >
              Saldo (R$)
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 bg-white">
          {loading && (
            <tr>
              <td className="px-6 py-8 text-center text-gray-500" colSpan={5}>
                <div className="flex items-center justify-center gap-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
                  Carregando...
                </div>
              </td>
            </tr>
          )}
          {!loading && entries.length === 0 && (
            <tr>
              <td colSpan={5} className="px-6 py-4 text-center text-gray-500">
                <ExtratoEmptyState hasActiveFilters={hasActiveFilters} />
              </td>
            </tr>
          )}
          {entries.map((entry) => {
            const isPositive = entry.grossValue >= 0;
            const transactionReference = formatTransactionReference(entry);
            const displayName = formatClientName(resolveDisplayCustomer(entry));
            const maskedDoc = transferDocumentForList(entry.metadata?.transferRecipientDocumentMasked);
            const bankFull = entry.metadata?.transferRecipientBank ?? resolveDisplayReference(entry);
            const bankShort = abbreviateBankName(bankFull);
            const statusLabel = formatStatusLabel(entry.status);
            const amountClass = isPositive ? 'text-emerald-600' : 'text-red-600';
            const amountText = `${isPositive ? '+' : '-'} ${formatCurrency(entry.grossValue, { absolute: true })}`;

            return (
              <tr
                key={entry.id}
                className="cursor-pointer transition-colors hover:bg-gray-50 focus-within:bg-gray-50 group"
                tabIndex={0}
                role="link"
                aria-label={`Abrir detalhe da movimentação ${displayName}, ${statusLabel}, ${amountText}`}
                onClick={() => onSelect(entry)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect(entry);
                  }
                }}
              >
                <td className="px-3 py-3 text-sm text-gray-700 sm:py-4 lg:hidden lg:px-6">
                  <div className="flex items-stretch gap-3">
                    <span
                      className={`mt-1.5 hidden h-2 w-2 shrink-0 self-start rounded-full lg:inline-flex ${isPositive ? 'bg-emerald-500' : 'bg-rose-500'}`}
                    />
                    <ul
                      className="m-0 min-w-0 flex-1 list-none space-y-1 p-0"
                      role="list"
                    >
                      <li className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="text-[13px] font-semibold leading-snug text-gray-900 lg:text-sm lg:font-medium">
                          {displayName}
                        </span>
                        <span className={`text-xs font-semibold tabular-nums lg:hidden ${amountClass}`}>
                          {amountText}
                        </span>
                      </li>
                      {maskedDoc ? (
                        <li className="font-mono text-[11px] leading-snug tabular-nums text-gray-600 lg:hidden">
                          {maskedDoc}
                        </li>
                      ) : null}
                      <li className="text-[12px] font-medium leading-snug text-gray-800 lg:hidden">
                        {extratoMobileMethodLine(entry)}
                      </li>
                      <li
                        className="text-[12px] leading-snug text-gray-700 lg:hidden"
                        title={bankFull !== bankShort ? bankFull : undefined}
                      >
                        {bankShort}
                      </li>
                      <li className="text-[12px] leading-snug tabular-nums text-gray-600 lg:hidden">
                        {formatDate(entry.date)}
                      </li>
                    </ul>

                    <div className="flex shrink-0 flex-col items-end justify-between self-stretch lg:hidden">
                      <button
                        type="button"
                        className="-mr-1 -mt-0.5 rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#753CB8] focus-visible:ring-offset-1"
                        aria-label={`Ver detalhes da movimentação de ${displayName}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelect(entry);
                        }}
                      >
                        <Eye className="h-4 w-4 shrink-0" aria-hidden />
                      </button>
                      <Badge
                        variant={getStatusBadgeVariant(entry.status)}
                        size="default"
                        className="max-w-[10.5rem] whitespace-normal text-right text-xs leading-tight"
                      >
                        {statusLabel}
                      </Badge>
                    </div>
                  </div>
                </td>
                <td className="hidden whitespace-nowrap px-4 py-4 text-sm text-gray-600 lg:table-cell lg:px-6">
                  {formatDate(entry.date)}
                </td>
                <td
                  className="hidden max-w-0 truncate whitespace-nowrap px-6 py-4 font-mono text-[11px] tracking-tight text-gray-500 lg:table-cell"
                  title={transactionReference !== '—' ? transactionReference : undefined}
                  aria-label={`ID da transação: ${transactionReference}`}
                >
                  {transactionReference}
                </td>
                <td className="hidden min-w-0 truncate px-6 py-4 text-sm text-gray-700 lg:table-cell" title={entry.description}>
                  <span className="block truncate font-medium text-gray-900">{formatExtratoDescription(entry.description)}</span>
                </td>
                <td className="hidden whitespace-nowrap px-6 py-4 text-right text-sm lg:table-cell">
                  <span className={`font-medium ${isPositive ? 'text-emerald-600' : 'text-red-600'}`}>
                    {amountText}
                  </span>
                </td>
                <td className="hidden whitespace-nowrap px-6 py-4 text-right text-sm font-medium text-emerald-700 lg:table-cell">
                  {entry.balanceAfter != null ? formatCurrency(entry.balanceAfter) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function resolveDisplayCustomer(entry: LedgerEntry): string | null | undefined {
  return entry.customerName ?? entry.metadata?.transferRecipientDocumentMasked;
}

function resolveDisplayReference(entry: LedgerEntry): string {
  return (
    entry.chargeName
    ?? entry.metadata?.transferRecipientBank
    ?? entry.metadata?.transferExternalReference
    ?? '—'
  );
}

function formatTransactionReference(entry: LedgerEntry): string {
  return entry.externalId
    ?? entry.paymentId
    ?? entry.transferId
    ?? entry.externalReference
    ?? entry.id
    ?? '—';
}

function formatClientName(name: string | null | undefined): string {
  if (!name?.trim()) return '—';
  const particles = new Set(['de', 'da', 'do', 'dos', 'das', 'e', 'von', 'van']);
  const parts = name.trim().split(/\s+/);
  const firstName = parts[0];
  const surname = parts.slice(1).find((p) => !particles.has(p.toLowerCase()));
  return surname ? `${firstName} ${surname}` : firstName;
}
