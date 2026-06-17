'use client';

import { CalendarDays, ExternalLink, Ticket } from 'lucide-react';

import { Button } from '@/components/ui/button';

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
    <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-950">
      <section className="mx-auto max-w-2xl rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="border-b border-slate-100 pb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-accent">Ingressos online</p>
          <h1 className="mt-1 text-2xl font-semibold">{order.event.name}</h1>
          <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-slate-600">
            <CalendarDays className="h-4 w-4" />
            {formatDate(order.event.startsAt)}
          </p>
          <p className="mt-1 text-sm text-slate-500">Comprador: {order.buyerName}</p>
        </div>

        <div className="mt-4 space-y-3">
          {order.items.map((item) => (
            <article
              key={item.id}
              className="rounded-lg border border-slate-200 bg-slate-50 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {item.seatLabel}
                    <span className="ml-2 text-slate-500">{item.sectionName}</span>
                  </p>
                  <p className="mt-1 font-mono text-xs text-slate-600">{item.ticketCode}</p>
                </div>
                <span className="text-sm font-medium text-slate-700">{formatCurrency(item.unitPrice)}</span>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Status: {item.ticketStatus === 'VALID' ? 'Válido' : item.ticketStatus === 'USED' ? 'Utilizado' : item.ticketStatus}
              </p>
            </article>
          ))}
        </div>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Button asChild className="bg-emerald-700 text-white hover:bg-emerald-800">
            <a href={pdfUrl} target="_blank" rel="noreferrer">
              <Ticket className="h-4 w-4" />
              Baixar PDF oficial
            </a>
          </Button>
          {order.map.publicSlug ? (
            <Button asChild variant="outline">
              <a href={`/m/${order.map.publicSlug}`}>
                <ExternalLink className="h-4 w-4" />
                Voltar ao mapa
              </a>
            </Button>
          ) : null}
        </div>

        <p className="mt-4 text-xs text-slate-500">
          Esta página é uma alternativa ao PDF. Na entrada do evento, apresente o ingresso oficial ou o código do assento.
        </p>
      </section>
    </main>
  );
}
