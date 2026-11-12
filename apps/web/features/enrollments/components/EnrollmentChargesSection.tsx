'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ExternalLink } from '@/components/icons/icons';
import { Badge, type StatusType } from '@/components/ui/badge';
import type { StatusCobranca } from '@prisma/client';

export type EnrollmentChargeRow = {
  id: string;
  tipo: string;
  status: StatusCobranca;
  valor: number;
  vencimento: string;
  formaPagamento: string;
  descricao?: string | null;
  competenciaInicio?: string;
  dataPagamento?: string | null;
  asaasPaymentId?: string | null;
  origin?: 'ACADEMIC' | 'STANDALONE';
};

const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});
const date = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function formatDate(value?: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : date.format(parsed);
}

function formatPaymentMethod(value: string) {
  const labels: Record<string, string> = {
    CARTAO: 'Cartão de crédito',
    CARTAO_CREDITO: 'Cartão de crédito',
    CREDIT_CARD: 'Cartão de crédito',
    BOLETO: 'Boleto',
    PIX: 'Pix',
    DINHEIRO: 'Dinheiro',
    UNDEFINED: 'Não informado',
    INDEFINIDO: 'Não informado',
  };
  return labels[value] ?? value.replaceAll('_', ' ');
}

function getChargeDescription(charge: EnrollmentChargeRow) {
  if (charge.descricao?.trim()) return charge.descricao;
  if (charge.tipo === 'TAXA_MATRICULA') return 'Taxa de matrícula';
  return 'Mensalidade da assinatura';
}

export function EnrollmentChargesSection({
  charges,
  subscriptionId,
}: {
  charges: EnrollmentChargeRow[];
  subscriptionId: string | null;
}) {
  const [open, setOpen] = useState(true);
  const [page, setPage] = useState(1);
  const uniqueCharges = new Map<string, EnrollmentChargeRow>();
  for (const charge of charges.filter((item) => item.tipo === 'MENSALIDADE')) {
    const identity = charge.asaasPaymentId ?? `${charge.vencimento.slice(0, 10)}:${charge.valor}`;
    const current = uniqueCharges.get(identity);
    if (!current || (charge.origin === 'STANDALONE' && current.origin !== 'STANDALONE')) {
      uniqueCharges.set(identity, charge);
    }
  }
  const subscriptionCharges = [...uniqueCharges.values()];
  const pageSize = 4;
  const totalPages = Math.max(1, Math.ceil(subscriptionCharges.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageCharges = subscriptionCharges
    .sort((a, b) => new Date(b.vencimento).getTime() - new Date(a.vencimento).getTime())
    .slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          Cobranças
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
        <span className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-500">
          {subscriptionCharges.length}{' '}
          {subscriptionCharges.length === 1 ? 'registro' : 'registros'}
        </span>
      </button>

      {open ? (
        <div className="border-t border-slate-200 bg-white">
          {pageCharges.length ? (
            <div className="divide-y divide-slate-200">
              {pageCharges.map((charge) => {
                return (
                  <div
                    key={`${charge.origin ?? 'ACADEMIC'}:${charge.id}`}
                    className="grid grid-cols-2 items-center gap-x-4 gap-y-2 px-5 py-4 text-sm lg:grid-cols-[minmax(100px,1fr)_minmax(180px,2.8fr)_minmax(120px,1.6fr)_minmax(100px,1.3fr)_minmax(80px,1fr)_minmax(64px,0.7fr)]"
                  >
                    <span className="font-semibold tabular-nums text-blue-700">
                      {currency.format(charge.valor)}
                    </span>
                    <span className="min-w-0 text-slate-800">
                      <span className="block break-words">{getChargeDescription(charge)}</span>
                    </span>
                    <span className="text-slate-700">{formatPaymentMethod(charge.formaPagamento)}</span>
                    <span className="text-slate-700">{formatDate(charge.vencimento)}</span>
                    <span>
                      <Badge status={charge.status as unknown as StatusType} size="sm" />
                    </span>
                    <Link
                      href={`/charges/${charge.id}`}
                      className="inline-flex items-center gap-1 text-brand-accent hover:underline"
                    >
                      Abrir <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="px-5 py-8 text-center text-sm text-slate-500">
              Nenhuma cobrança de assinatura vinculada a esta matrícula.
            </p>
          )}
          {subscriptionCharges.length > pageSize ? (
            <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3">
              <span className="text-xs text-slate-500">
                Página {currentPage} de {totalPages}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Página anterior de cobranças"
                  disabled={currentPage === 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 px-2 text-xs text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Anterior
                </button>
                <button
                  type="button"
                  aria-label="Próxima página de cobranças"
                  disabled={currentPage === totalPages}
                  onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 px-2 text-xs text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Próxima
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : null}
          <div className="border-t border-slate-200 bg-slate-50 px-5 py-4">
            {subscriptionId ? (
              <Link
                href={`/charges/subscriptions/${subscriptionId}`}
                className="text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                Visualizar todas as cobranças
              </Link>
            ) : (
              <span className="text-sm text-slate-400" aria-disabled="true">
                Assinatura indisponível
              </span>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
