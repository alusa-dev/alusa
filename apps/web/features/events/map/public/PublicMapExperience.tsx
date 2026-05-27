'use client';

import type { PublicMapViewModel } from './public-map-adapter';

import { useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, Download, Loader2, MapPin, ShoppingCart, Ticket } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type PublicSeat = PublicMapViewModel['seats'][number];
type PublicObject = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  rotation: number;
  hidden?: boolean;
  data?: Record<string, unknown>;
};
type PublicLevel = { widthPx: number; heightPx: number; name?: string };

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function objectStyle(object: PublicObject) {
  const data = object.data ?? {};
  if (object.type === 'CORRIDOR') return { fill: '#ede9fe', stroke: '#8b5cf6', dash: '7 5' };
  if (object.type === 'STAGE') return { fill: '#111827', stroke: '#111827', dash: undefined };
  if (object.type === 'BLOCKED_AREA') return { fill: '#fee2e2', stroke: '#ef4444', dash: '7 5' };
  if (object.type === 'TEXT') return { fill: 'transparent', stroke: 'transparent', dash: undefined };
  return {
    fill: typeof data.fill === 'string' ? data.fill : '#f8fafc',
    stroke: object.type === 'SECTION' ? '#7c3aed' : '#cbd5e1',
    dash: undefined,
  };
}

function seatClasses(seat: PublicSeat, selected: boolean, interactive: boolean) {
  if (selected) return 'fill-brand-accent stroke-brand-accent';
  if (seat.status === 'AVAILABLE' && interactive) return 'fill-emerald-500 stroke-blue-700';
  if (seat.status === 'HELD') return 'fill-amber-400 stroke-amber-700';
  if (seat.status === 'SOLD') return 'fill-slate-300 stroke-slate-400';
  return 'fill-slate-200 stroke-slate-300';
}

async function parseApiResponse<T>(response: Response): Promise<T> {
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (json as { error?: { message?: string } } | null)?.error?.message ?? 'Não foi possível concluir.';
    throw new Error(message);
  }
  return (json as { data?: T })?.data ?? (json as T);
}

export function PublicMapExperience({
  map,
  mode = 'public',
}: {
  map: PublicMapViewModel;
  mode?: 'public' | 'preview';
}) {
  const [seats, setSeats] = useState<PublicSeat[]>(map.seats);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [buyerName, setBuyerName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [buyerDocument, setBuyerDocument] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<{
    orderId: string;
    accessToken: string;
    ticketsUrl: string;
    items: Array<{ ticketCode: string; seatLabel: string; sectionName: string }>;
  } | null>(null);

  const level = ((map.levels as PublicLevel[])[0] ?? { widthPx: 1440, heightPx: 900 }) as PublicLevel;
  const objects = (map.objects as PublicObject[]).filter((object) => !object.hidden);
  const selectedSeats = useMemo(
    () => seats.filter((seat) => selectedIds.includes(seat.id)),
    [seats, selectedIds],
  );
  const total = selectedSeats.reduce((sum, seat) => sum + seat.unitPrice, 0);
  const canCheckout = mode === 'public' && selectedSeats.length > 0 && buyerName.trim() && buyerEmail.trim();

  function toggleSeat(seat: PublicSeat) {
    if (seat.status !== 'AVAILABLE' || mode === 'preview') return;
    setSelectedIds((current) =>
      current.includes(seat.id) ? current.filter((seatId) => seatId !== seat.id) : [...current, seat.id],
    );
    setError(null);
  }

  async function handleCheckout() {
    if (!canCheckout) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const reservation = await parseApiResponse<{ reservationId: string; holdToken: string }>(
        await fetch(`/api/public/event-maps/${map.publicSlug}/reserve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ seatIds: selectedIds, buyerName, buyerEmail }),
        }),
      );

      const checkout = await parseApiResponse<{
        orderId: string;
        accessToken: string;
        ticketsUrl: string;
        items: Array<{ ticketCode: string; seatLabel: string; sectionName: string }>;
      }>(
        await fetch(`/api/public/event-maps/${map.publicSlug}/checkout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reservationId: reservation.reservationId,
            holdToken: reservation.holdToken,
            buyerName,
            buyerEmail,
            buyerDocument,
          }),
        }),
      );

      setOrder(checkout);
      setSeats((current) =>
        current.map((seat) => (selectedIds.includes(seat.id) ? { ...seat, status: 'SOLD' } : seat)),
      );
      setSelectedIds([]);
    } catch (checkoutError) {
      setError((checkoutError as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-accent">
              {mode === 'preview' ? 'Pré-visualização' : 'Mapa público'}
            </p>
            <h1 className="mt-1 truncate text-2xl font-semibold text-slate-950">{map.event.name}</h1>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-4 w-4" />
                {formatDate(map.event.startsAt)}
              </span>
              {map.event.locationName ? (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-4 w-4" />
                  {map.event.locationName}
                </span>
              ) : null}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <strong className="block text-slate-950">{seats.length}</strong>
              <span className="text-xs text-slate-500">assentos</span>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <strong className="block text-emerald-700">{seats.filter((seat) => seat.status === 'AVAILABLE').length}</strong>
              <span className="text-xs text-slate-500">livres</span>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <strong className="block text-slate-950">{formatCurrency(total)}</strong>
              <span className="text-xs text-slate-500">seleção</span>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-950">{map.name}</h2>
            <p className="text-xs text-slate-500">{level.name ?? 'Ambiente principal'}</p>
          </div>
          <div className="overflow-auto bg-slate-50 p-4">
            <svg
              data-testid="public-event-map-canvas"
              viewBox={`0 0 ${level.widthPx} ${level.heightPx}`}
              className="min-h-[520px] w-full rounded-lg bg-white"
              role="img"
              aria-label={`Mapa de assentos de ${map.event.name}`}
            >
              <rect x={0} y={0} width={level.widthPx} height={level.heightPx} fill="#fff" stroke="#cbd5e1" />
              {objects.map((object) => {
                const style = objectStyle(object);
                const width = object.width ?? 0;
                const height = object.height ?? 0;
                const cx = object.x + width / 2;
                const cy = object.y + height / 2;
                if (object.type === 'TEXT') {
                  const text = typeof object.data?.text === 'string' ? object.data.text : 'Texto';
                  return (
                    <text
                      key={object.id}
                      x={object.x}
                      y={object.y}
                      transform={`rotate(${object.rotation} ${object.x} ${object.y})`}
                      fill="#111827"
                      fontSize={Number(object.data?.fontSize ?? 18)}
                    >
                      {text}
                    </text>
                  );
                }
                return (
                  <rect
                    key={object.id}
                    x={object.x}
                    y={object.y}
                    width={width}
                    height={height}
                    rx={object.type === 'CORRIDOR' ? 0 : 6}
                    fill={style.fill}
                    stroke={style.stroke}
                    strokeWidth={object.type === 'CORRIDOR' ? 2 : 1.5}
                    strokeDasharray={style.dash}
                    transform={`rotate(${object.rotation} ${cx} ${cy})`}
                  />
                );
              })}
              {seats.map((seat) => {
                const selected = selectedIds.includes(seat.id);
                const radius = Math.max((seat.size ?? 28) / 2, 8);
                const interactive = mode === 'public';
                return (
                  <g key={seat.id} transform={`rotate(${seat.rotation} ${seat.x} ${seat.y})`}>
                    <circle
                      data-testid={`public-seat-${seat.technicalCode}`}
                      cx={seat.x}
                      cy={seat.y}
                      r={radius}
                      strokeWidth={selected ? 4 : 2}
                      className={`${seatClasses(seat, selected, interactive)} ${seat.status === 'AVAILABLE' && interactive ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                      onClick={() => toggleSeat(seat)}
                    />
                    <text
                      x={seat.x}
                      y={seat.y + 4}
                      textAnchor="middle"
                      className="pointer-events-none select-none fill-white text-[12px] font-semibold"
                    >
                      {seat.displayLabel}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </section>

        <aside className="space-y-4">
          {mode === 'preview' ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Esta é uma prévia privada. O checkout fica habilitado somente no link público publicado.
            </div>
          ) : null}

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-brand-accent" />
              <h2 className="text-sm font-semibold text-slate-950">Assentos selecionados</h2>
            </div>
            <div className="mt-3 space-y-2">
              {selectedSeats.length === 0 ? (
                <p className="rounded-lg bg-slate-50 px-3 py-4 text-sm text-slate-500">Selecione assentos disponíveis no mapa.</p>
              ) : (
                selectedSeats.map((seat) => (
                  <div key={seat.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm">
                    <span>
                      <strong>{seat.displayLabel}</strong>
                      <span className="ml-2 text-slate-500">{seat.sectionName}</span>
                    </span>
                    <span className="font-medium">{formatCurrency(seat.unitPrice)}</span>
                  </div>
                ))
              )}
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-sm">
              <span className="text-slate-500">Total</span>
              <strong className="text-base">{formatCurrency(total)}</strong>
            </div>
          </section>

          {order ? (
            <section className="rounded-lg border border-emerald-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-emerald-700">
                <CheckCircle2 className="h-5 w-5" />
                <h2 className="text-sm font-semibold">Compra confirmada</h2>
              </div>
              <p className="mt-2 text-sm text-slate-600">Seus ingressos foram gerados em PDF.</p>
              <Button asChild className="mt-4 w-full bg-brand-accent text-white hover:bg-brand-accent/90">
                <a href={order.ticketsUrl} target="_blank" rel="noreferrer">
                  <Download className="h-4 w-4" />
                  Baixar ingressos
                </a>
              </Button>
            </section>
          ) : (
            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2">
                <Ticket className="h-4 w-4 text-brand-accent" />
                <h2 className="text-sm font-semibold text-slate-950">Checkout básico</h2>
              </div>
              <div className="mt-4 space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="public-map-buyer-name">Nome</Label>
                  <Input id="public-map-buyer-name" value={buyerName} onChange={(event) => setBuyerName(event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="public-map-buyer-email">E-mail</Label>
                  <Input
                    id="public-map-buyer-email"
                    type="email"
                    value={buyerEmail}
                    onChange={(event) => setBuyerEmail(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="public-map-buyer-document">Documento</Label>
                  <Input
                    id="public-map-buyer-document"
                    value={buyerDocument}
                    onChange={(event) => setBuyerDocument(event.target.value)}
                  />
                </div>
                {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
                <Button
                  type="button"
                  className="w-full bg-brand-accent text-white hover:bg-brand-accent/90"
                  disabled={!canCheckout || isSubmitting}
                  onClick={handleCheckout}
                >
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ticket className="h-4 w-4" />}
                  Confirmar compra
                </Button>
              </div>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}
