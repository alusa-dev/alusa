'use client';

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { CalendarDaysIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import type { LedgerEntry } from '../dtos';
import { formatCurrency, formatDate, formatTypeLabel, formatStatusLabel } from '../utils/extrato-formatters';
import { getTypeBadgeVariant, getStatusBadgeVariant } from '../utils/extrato-badges';
import { ExtratoEmptyState } from './ExtratoEmptyState';

interface ExtratoTableProps {
  entries: LedgerEntry[];
  loading?: boolean;
  hasActiveFilters?: boolean;
  onSelect: (entry: LedgerEntry) => void;
}

export function ExtratoTable({ entries, loading, hasActiveFilters, onSelect }: ExtratoTableProps) {
  const relatedTransferFees = buildRelatedTransferFeeMap(entries);

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-100">
        <thead>
          <tr className="bg-gray-50">
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Cliente
            </th>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[160px]">
              Cobrança
            </th>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Data
            </th>
            <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
              Valor
            </th>
            <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
              Taxa
            </th>
            <th scope="col" className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-[130px]">
              Tipo
            </th>
            <th scope="col" className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-[120px]">
              Status
            </th>
            <th scope="col" className="w-[36px] px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 bg-white">
          {loading && (
            <tr>
              <td className="px-6 py-8 text-gray-500 text-center" colSpan={8}>
                <div className="flex justify-center items-center gap-2">
                  <div className="h-4 w-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                  Carregando...
                </div>
              </td>
            </tr>
          )}
          {!loading && entries.length === 0 && (
            <tr>
              <td colSpan={8} className="px-6 py-4 text-center text-gray-500">
                <ExtratoEmptyState hasActiveFilters={hasActiveFilters} />
              </td>
            </tr>
          )}
          {entries.map((entry) => {
            const isPositive = entry.grossValue >= 0;
            return (
              <tr
                key={entry.id}
                className="cursor-pointer transition-colors hover:bg-gray-50 group"
                onClick={() => onSelect(entry)}
              >
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <span className={`inline-flex h-2 w-2 shrink-0 rounded-full ${isPositive ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                    <div className="min-w-0">
                        <span className="block text-sm font-medium text-gray-900">
                          {formatClientName(resolveDisplayCustomer(entry))}
                        </span>
                      </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 truncate max-w-[160px]">
                  {resolveDisplayReference(entry)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-gray-500 text-sm">
                  <div className="flex items-center gap-2">
                    <CalendarDaysIcon className="h-4 w-4 text-gray-400" />
                    {formatDate(entry.date)}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                  <span className={`font-medium ${isPositive ? 'text-emerald-600' : 'text-red-600'}`}>
                    {isPositive ? '+' : '-'} {formatCurrency(entry.grossValue, { absolute: true })}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-500">
                  {formatFee(entry, relatedTransferFees)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-center">
                  <Badge variant={getTypeBadgeVariant(entry.type)}>
                    {formatTypeLabel(entry.type)}
                  </Badge>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-center">
                  <Badge variant={getStatusBadgeVariant(entry.status)}>
                    {formatStatusLabel(entry.status)}
                  </Badge>
                </td>
                <td className="px-4 py-4 text-right text-slate-300 transition-colors group-hover:text-slate-500">
                  <ChevronRightIcon className="h-4 w-4" />
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
  return entry.chargeName
    ?? entry.metadata?.transferRecipientBank
    ?? entry.metadata?.transferExternalReference
    ?? '—';
}

function buildRelatedTransferFeeMap(entries: LedgerEntry[]): Map<string, number> {
  const feeMap = new Map<string, number>();

  for (const entry of entries) {
    const transferId = entry.transferId?.trim();
    const rawCategory = entry.metadata?.rawCategory;
    if (!transferId) continue;
    if (entry.type !== 'TAXA') continue;
    if (rawCategory !== 'TRANSFER_FEE' && rawCategory !== 'PIX_FEE') continue;

    feeMap.set(transferId, (feeMap.get(transferId) ?? 0) + Math.abs(entry.grossValue));
  }

  return feeMap;
}

function formatFee(entry: LedgerEntry, relatedTransferFees: Map<string, number>): string {
  if (entry.fee > 0) {
    return formatCurrency(entry.fee, { absolute: true });
  }

  if (entry.type === 'TRANSFERENCIA' && entry.transferId) {
    const relatedFee = relatedTransferFees.get(entry.transferId);
    if (relatedFee && relatedFee > 0) {
      return formatCurrency(relatedFee, { absolute: true });
    }
  }

  return '—';
}

function formatClientName(name: string | null | undefined): string {
  if (!name?.trim()) return '—';
  const particles = new Set(['de', 'da', 'do', 'dos', 'das', 'e', 'von', 'van']);
  const parts = name.trim().split(/\s+/);
  const firstName = parts[0];
  const surname = parts.slice(1).find((p) => !particles.has(p.toLowerCase()));
  return surname ? `${firstName} ${surname}` : firstName;
}
