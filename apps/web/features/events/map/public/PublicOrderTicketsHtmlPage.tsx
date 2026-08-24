'use client';

import { CalendarDays, ExternalLink, Ticket } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { InfoCallout } from '@/components/ui/info-callout';

import type { PublicOrderTicketsDTO } from '@alusa/lib/events/map/event-map.service';

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function PublicOrderTicketsHtmlPage({
  order,
  token,
}: {
  order: PublicOrderTicketsDTO;
  token: string;
}) {
  const pdfUrl = `/api/public/event-map-orders/${order.id}/tickets?token=${encodeURIComponent(token)}`;

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10 text-slate-950 sm:py-12">
      <section className="mx-auto max-w-2xl rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="border-b border-slate-100 pb-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-accent">Ingressos online</p>
          <h1 className="mt-2 text-2xl font-semibold leading-tight tracking-tight sm:text-[1.7rem]">{order.event.name}</h1>
          <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-slate-600">
            <CalendarDays className="h-4 w-4" />
            {formatDate(order.event.startsAt)}
          </p>
          <p className="mt-2 text-sm text-slate-500">
            <span className="font-medium text-slate-600">Comprador:</span> {order.buyerName}
          </p>
        </div>

        <div className="mt-6 space-y-2.5">
          {order.items.map((item) => (
            <article
              key={item.id}
              className="rounded-lg border border-slate-200 bg-white p-3.5 sm:p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">
                    {item.seatLabel}
                    <span className="ml-2 text-slate-500">{item.sectionName}</span>
                  </p>
                  <p className="mt-2 break-all font-mono text-[11px] leading-relaxed text-slate-500">{item.ticketCode}</p>
                </div>
                <span className="shrink-0 text-sm font-medium text-slate-700">{formatCurrency(item.unitPrice)}</span>
              </div>
              <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-2.5">
                <span className="text-xs text-slate-500">Status</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    item.ticketStatus === 'VALID'
                      ? 'bg-emerald-50 text-emerald-700'
                      : item.ticketStatus === 'USED'
                        ? 'bg-slate-100 text-slate-600'
                        : 'bg-amber-50 text-amber-700'
                  }`}
                >
                  {item.ticketStatus === 'VALID' ? 'Válido' : item.ticketStatus === 'USED' ? 'Utilizado' : item.ticketStatus}
                </span>
              </div>
            </article>
          ))}
        </div>

        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
          <Button asChild className="bg-emerald-700 text-white hover:bg-emerald-800 sm:flex-1">
            <a href={pdfUrl} target="_blank" rel="noreferrer">
              <Ticket className="h-4 w-4" />
              Baixar PDF oficial
            </a>
          </Button>
          {order.map.publicSlug ? (
            <Button asChild variant="outline" className="sm:flex-1">
              <a href={`/m/${order.map.publicSlug}`}>
                <ExternalLink className="h-4 w-4" />
                Voltar ao mapa
              </a>
            </Button>
          ) : null}
        </div>

        <InfoCallout variant="info" size="sm" className="mt-5">
          Esta página é uma alternativa ao PDF. Na entrada do evento, apresente o ingresso oficial ou o código do assento.
        </InfoCallout>
      </section>
    </main>
  );
}
