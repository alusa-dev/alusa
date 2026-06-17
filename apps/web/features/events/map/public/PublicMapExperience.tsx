'use client';

import type { PublicMapViewModel } from './public-map-adapter';
import { getSeatGroupSeatWorldCenter, MAP_ARTBOARD_STROKE, MAP_ARTBOARD_STROKE_WIDTH } from '@alusa/domain';

import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, ExternalLink, Loader2, MapPin, ShoppingCart, Ticket, Check, Copy, CreditCard, QrCode, User, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { PublicMapKpiTile } from './PublicMapKpiTile';
import { PublicMapLevelTabs } from './PublicMapLevelTabs';
import { PublicOrderReservationCountdown } from './PublicOrderReservationCountdown';
import {
  publicOrderStatusLabel,
  publicSeatStatusLabel,
  publicSeatTooltip,
} from './public-order-utils';
import {
  filterPublicMapObjectsByLevel,
  filterPublicMapRenderableObjects,
  filterPublicMapSeatsByLevel,
  getDefaultPublicMapLevelId,
  getPublicMapLevelById,
  resolvePublicMapLevels,
  type PublicMapLevelView,
} from './public-map-level-view';
import { PublicMapTextSvg } from './public-map-text-render';
import { PublicMapViewport } from './PublicMapViewport';

import { findCEP } from '@/lib/cep';
import { formatCepBR, formatCpfCnpjBR, isValidCepBR, isValidCpfCnpjBR, onlyDigits } from '@/lib/formatters';

type PublicSeat = PublicMapViewModel['seats'][number];
type PublicSeatGroup = NonNullable<PublicMapViewModel['seatGroups']>[number];
type PublicObject = {
  id: string;
  levelId?: string | null;
  sectionId?: string | null;
  type: string;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  rotation: number;
  hidden?: boolean;
  data?: Record<string, unknown>;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function createCheckoutKey() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function objectStyle(object: PublicObject) {
  const data = object.data ?? {};
  if (object.type === 'CORRIDOR') return { fill: '#ede9fe', stroke: '#8b5cf6', dash: '7 5' };
  if (object.type === 'STAGE') return { fill: '#111827', stroke: '#111827', dash: undefined };
  if (object.type === 'BLOCKED_AREA') return { fill: '#fee2e2', stroke: '#ef4444', dash: '7 5' };
  if (object.type === 'TEXT') return { fill: 'transparent', stroke: 'transparent', dash: undefined };
  if (object.type === 'SECTION') {
    const fillEnabled = data.fillEnabled === true;
    return {
      fill: fillEnabled && typeof data.fill === 'string' ? data.fill : 'transparent',
      stroke: fillEnabled ? '#7c3aed' : 'transparent',
      dash: undefined,
    };
  }
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
  const panelLevels = useMemo(
    () => resolvePublicMapLevels(map.levels as PublicMapLevelView[]),
    [map.levels],
  );
  const [activeLevelId, setActiveLevelId] = useState(() => getDefaultPublicMapLevelId(panelLevels));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [step, setStep] = useState<'SELECTION' | 'IDENTIFICATION' | 'PAYMENT_METHOD' | 'CONFIRMATION'>('SELECTION');
  
  // Form states
  const [buyerName, setBuyerName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [buyerDocument, setBuyerDocument] = useState('');
  const [buyerPostalCode, setBuyerPostalCode] = useState('');
  const [buyerAddress, setBuyerAddress] = useState('');
  const [buyerAddressNumber, setBuyerAddressNumber] = useState('');
  const [buyerComplement, setBuyerComplement] = useState('');
  const [buyerProvince, setBuyerProvince] = useState('');
  const [buyerCity, setBuyerCity] = useState('');
  const [buyerState, setBuyerState] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'PIX' | 'CREDIT_CARD' | 'BOLETO'>('PIX');
  const [checkoutKey, setCheckoutKey] = useState(createCheckoutKey);
  
  // Component UX states
  const [isCepLoading, setIsCepLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedStatusLink, setCopiedStatusLink] = useState(false);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [isSyncingPayment, setIsSyncingPayment] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<{
    orderId: string;
    accessToken: string;
    ticketsUrl: string | null;
    ticketsHtmlUrl?: string | null;
    invoiceUrl: string | null;
    status: string;
    expiresAt: string;
    statusUrl?: string | null;
    items: Array<{ ticketCode: string; seatLabel: string; sectionName: string }>;
    pixQrCode: { encodedImage: string; payload: string; expirationDate: string } | null;
  } | null>(null);

  useEffect(() => {
    setActiveLevelId((current) => {
      if (current && panelLevels.some((level) => level.id === current)) return current;
      return getDefaultPublicMapLevelId(panelLevels);
    });
  }, [panelLevels]);

  const activeLevel = useMemo(
    () => getPublicMapLevelById(panelLevels, activeLevelId),
    [activeLevelId, panelLevels],
  );
  const levelObjects = useMemo(
    () =>
      filterPublicMapRenderableObjects(
        { seatGroups: map.seatGroups, seats: map.seats },
        map.objects as PublicObject[],
        activeLevel.id,
      ),
    [activeLevel.id, map.objects, map.seatGroups, map.seats],
  );
  const levelSeats = useMemo(
    () => filterPublicMapSeatsByLevel(seats, activeLevel.id),
    [activeLevel.id, seats],
  );
  const seatGroupById = useMemo(() => {
    return new Map((map.seatGroups ?? []).map((group) => [group.id, group as PublicSeatGroup]));
  }, [map.seatGroups]);
  const selectedSeats = useMemo(
    () => seats.filter((seat) => selectedIds.includes(seat.id)),
    [seats, selectedIds],
  );
  const total = selectedSeats.reduce((sum, seat) => sum + seat.unitPrice, 0);

  const isIdentificationValid = useMemo(() => {
    return (
      buyerName.trim().length > 0 &&
      buyerEmail.trim().length > 0 &&
      isValidCpfCnpjBR(buyerDocument) &&
      isValidCepBR(buyerPostalCode) &&
      buyerAddress.trim().length > 0 &&
      buyerAddressNumber.trim().length > 0 &&
      buyerProvince.trim().length > 0
    );
  }, [buyerName, buyerEmail, buyerDocument, buyerPostalCode, buyerAddress, buyerAddressNumber, buyerProvince]);

  function toggleSeat(seat: PublicSeat) {
    if (seat.status !== 'AVAILABLE' || mode === 'preview') return;
    if (step === 'CONFIRMATION') return;
    
    // Auto return to first step when updating selection
    if (step !== 'SELECTION') {
      setStep('SELECTION');
    }

    setSelectedIds((current) => {
      setCheckoutKey(createCheckoutKey());
      return current.includes(seat.id) ? current.filter((seatId) => seatId !== seat.id) : [...current, seat.id];
    });
    setError(null);
  }

  async function handleCepBlur() {
    const raw = onlyDigits(buyerPostalCode);
    if (raw.length === 8) {
      setIsCepLoading(true);
      try {
        const d = await findCEP(raw);
        setBuyerAddress(d.logradouro || '');
        setBuyerProvince(d.bairro || '');
        setBuyerCity(d.cidade || '');
        setBuyerState(d.uf || '');
      } catch (e) {
        console.warn('Erro ao buscar CEP', e);
      } finally {
        setIsCepLoading(false);
      }
    }
  }

  function copyStatusLink() {
    const href =
      order?.statusUrl && typeof window !== 'undefined'
        ? new URL(order.statusUrl, window.location.origin).toString()
        : typeof window !== 'undefined'
          ? window.location.href
          : '';
    if (!href) return;
    navigator.clipboard.writeText(href);
    setCopiedStatusLink(true);
    setTimeout(() => setCopiedStatusLink(false), 2000);
  }

  async function handleSyncPayment() {
    if (!order) return;
    setIsSyncingPayment(true);
    setError(null);
    try {
      const result = await parseApiResponse<{
        synced: boolean;
        order: {
          orderId: string;
          status: string;
          ticketsUrl: string | null;
          ticketsHtmlUrl?: string | null;
          invoiceUrl: string | null;
          expiresAt: string | null;
          items: Array<{ ticketCode: string | null; seatLabel: string; sectionName: string }>;
        };
      }>(
        await fetch(
          `/api/public/event-map-orders/${order.orderId}/sync-payment?token=${encodeURIComponent(order.accessToken)}`,
          { method: 'POST' },
        ),
      );
      setOrder((current) =>
        current
          ? {
              ...current,
              status: result.order.status,
              ticketsUrl: result.order.ticketsUrl,
              ticketsHtmlUrl: result.order.ticketsHtmlUrl,
              invoiceUrl: result.order.invoiceUrl,
              expiresAt: result.order.expiresAt ?? current.expiresAt,
              items: result.order.items.map((item) => ({
                ticketCode: item.ticketCode ?? '',
                seatLabel: item.seatLabel,
                sectionName: item.sectionName,
              })),
            }
          : current,
      );
    } catch (syncError) {
      setError((syncError as Error).message);
    } finally {
      setIsSyncingPayment(false);
    }
  }

  function resetCheckoutFlow() {
    setOrder(null);
    setStep('SELECTION');
    setPollTimedOut(false);
    setError(null);
    setCheckoutKey(createCheckoutKey());
  }

  function copyPixPayload() {
    if (order?.pixQrCode?.payload) {
      navigator.clipboard.writeText(order.pixQrCode.payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function stepIndex(s: string) {
    if (s === 'SELECTION') return 1;
    if (s === 'IDENTIFICATION') return 2;
    return 3;
  }

  function stepLabel(s: string) {
    if (s === 'SELECTION') return 'Seleção';
    if (s === 'IDENTIFICATION') return 'Identificação';
    return 'Pagamento';
  }

  async function handleCheckout() {
    setIsSubmitting(true);
    setError(null);
    try {
      const reservation = await parseApiResponse<{ reservationId: string; holdToken: string }>(
        await fetch(`/api/public/event-maps/${map.publicSlug}/reserve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ seatIds: selectedIds, checkoutKey, buyerName, buyerEmail }),
        }),
      );

      const checkout = await parseApiResponse<{
        orderId: string;
        accessToken: string;
        ticketsUrl: string | null;
        ticketsHtmlUrl?: string | null;
        invoiceUrl: string | null;
        status: string;
        expiresAt: string;
        statusUrl?: string | null;
        items: Array<{ ticketCode: string; seatLabel: string; sectionName: string }>;
        pixQrCode: { encodedImage: string; payload: string; expirationDate: string } | null;
      }>(
        await fetch(`/api/public/event-maps/${map.publicSlug}/checkout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reservationId: reservation.reservationId,
            holdToken: reservation.holdToken,
            buyerName,
            buyerEmail,
            buyerDocument: onlyDigits(buyerDocument),
            buyerAddress,
            buyerAddressNumber,
            buyerComplement: buyerComplement || null,
            buyerProvince,
            buyerPostalCode: onlyDigits(buyerPostalCode),
            paymentMethod,
          }),
        }),
      );

      setOrder(checkout);
      if (checkout.statusUrl && typeof window !== 'undefined') {
        window.history.replaceState(null, '', checkout.statusUrl);
      }
      setSeats((current) =>
        current.map((seat) => (selectedIds.includes(seat.id) ? { ...seat, status: 'HELD' } : seat)),
      );
      setSelectedIds([]);
      setCheckoutKey(createCheckoutKey());
      setStep('CONFIRMATION');
    } catch (checkoutError) {
      setError((checkoutError as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  }

  useEffect(() => {
    if (!order || order.status !== 'PAYMENT_PENDING') return;

    const orderId = order.orderId;
    const accessToken = order.accessToken;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();

    async function pollStatus() {
      if (Date.now() - startedAt > 12 * 60 * 1000) {
        if (!cancelled) setPollTimedOut(true);
        return;
      }

      try {
        const status = await parseApiResponse<{
          orderId: string;
          ticketsUrl: string | null;
          ticketsHtmlUrl?: string | null;
          invoiceUrl: string | null;
          status: string;
          expiresAt: string | null;
          items: Array<{ ticketCode: string | null; seatLabel: string; sectionName: string }>;
        }>(
          await fetch(`/api/public/event-map-orders/${orderId}/status?token=${encodeURIComponent(accessToken)}`),
        );

        if (cancelled) return;
        setOrder((current) =>
          current
            ? {
                ...current,
                status: status.status,
                ticketsUrl: status.ticketsUrl,
                ticketsHtmlUrl: status.ticketsHtmlUrl,
                invoiceUrl: status.invoiceUrl,
                expiresAt: status.expiresAt ?? current.expiresAt,
                items: status.items.map((item) => ({
                  ticketCode: item.ticketCode ?? '',
                  seatLabel: item.seatLabel,
                  sectionName: item.sectionName,
                })),
              }
            : current,
        );

        if (status.status === 'PAYMENT_PENDING') {
          timeoutId = setTimeout(pollStatus, 7000);
        }
      } catch (pollError) {
        if (!cancelled) {
          console.warn('Falha ao atualizar status do pedido público', pollError);
          timeoutId = setTimeout(pollStatus, 12000);
        }
      }
    }

    timeoutId = setTimeout(pollStatus, 5000);
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [order?.accessToken, order?.orderId, order?.status]);

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-3 py-4 sm:gap-4 sm:px-4 sm:py-5 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-accent sm:text-xs">
              {mode === 'preview' ? 'Pré-visualização' : 'Mapa público'}
            </p>
            <h1 className="mt-1 text-xl font-semibold text-slate-950 sm:text-2xl">{map.event.name}</h1>
            <div className="mt-2 flex flex-col gap-1 text-sm text-slate-600 sm:flex-row sm:flex-wrap sm:gap-x-4 sm:gap-y-1">
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
          <div className="grid w-full grid-cols-3 gap-1.5 sm:max-w-md sm:gap-2 md:ml-auto">
            <PublicMapKpiTile
              title="Assentos"
              value={String(seats.length)}
              description="Capacidade do mapa"
            />
            <PublicMapKpiTile
              title="Livres"
              value={String(seats.filter((seat) => seat.status === 'AVAILABLE').length)}
              description="Disponíveis para compra"
            />
            <PublicMapKpiTile
              title="Seleção"
              value={formatCurrency(total)}
              description={selectedSeats.length > 0 ? `${selectedSeats.length} assento(s) escolhido(s)` : 'Nenhum assento selecionado'}
            />
          </div>
        </div>
      </header>

      <div
        className={`mx-auto grid max-w-7xl gap-3 px-3 py-4 sm:gap-4 sm:px-4 sm:py-5 lg:grid-cols-[minmax(0,1fr)_360px]${
          mode === 'public' && step === 'SELECTION' && selectedSeats.length > 0 ? ' pb-24 lg:pb-5' : ''
        }`}
      >
        <section className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-3 py-3 sm:px-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-slate-950">{map.name}</h2>
                <p className="text-xs text-slate-500">
                  {activeLevel.name}
                  {panelLevels.length > 1 ? (
                    <span className="text-slate-400">
                      {' '}
                      · {levelSeats.length} assentos · {levelSeats.filter((seat) => seat.status === 'AVAILABLE').length} livres
                    </span>
                  ) : null}
                </p>
              </div>
              <PublicMapLevelTabs
                levels={panelLevels}
                activeLevelId={activeLevel.id}
                onLevelChange={setActiveLevelId}
              />
            </div>
            {mode === 'public' ? (
              <div className="mt-3 grid grid-cols-2 gap-1.5 text-xs sm:flex sm:flex-wrap sm:gap-2">
                {(['AVAILABLE', 'HELD', 'SOLD', 'BLOCKED'] as const).map((statusKey) => (
                  <span
                    key={statusKey}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-600"
                  >
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${
                        statusKey === 'AVAILABLE'
                          ? 'bg-emerald-500'
                          : statusKey === 'HELD'
                            ? 'bg-amber-400'
                            : statusKey === 'SOLD'
                              ? 'bg-slate-300'
                              : 'bg-rose-300'
                      }`}
                      aria-hidden
                    />
                    {publicSeatStatusLabel(statusKey)}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <PublicMapViewport
            artboardWidth={activeLevel.widthPx}
            artboardHeight={activeLevel.heightPx}
            levelId={activeLevel.id}
            ariaLabel={`Mapa de assentos de ${map.event.name} — ${activeLevel.name}`}
          >
              <rect
                data-map-background
                x={0}
                y={0}
                width={activeLevel.widthPx}
                height={activeLevel.heightPx}
                fill="#fff"
                stroke={MAP_ARTBOARD_STROKE}
                strokeWidth={MAP_ARTBOARD_STROKE_WIDTH}
              />
              {levelObjects.map((object) => {
                const style = objectStyle(object);
                const width = object.width ?? 0;
                const height = object.height ?? 0;
                const cx = object.x + width / 2;
                const cy = object.y + height / 2;
                if (object.type === 'TEXT') {
                  return <PublicMapTextSvg key={object.id} object={object} />;
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
              {levelSeats.map((seat) => {
                const selected = selectedIds.includes(seat.id);
                const group = seat.groupId ? seatGroupById.get(seat.groupId) : null;
                const center = group ? getSeatGroupSeatWorldCenter(group, seat) : { x: seat.x, y: seat.y };
                const rotation = group ? group.rotation : seat.rotation;
                const radius = Math.max((group?.seatWidth ?? seat.size ?? 28) / 2, 8);
                const interactive = mode === 'public';
                return (
                  <g key={seat.id} transform={`rotate(${rotation} ${center.x} ${center.y})`}>
                    {interactive ? (
                      <title>{publicSeatTooltip(seat.status, seat.displayLabel, seat.sectionName)}</title>
                    ) : null}
                    <circle
                      data-public-seat
                      data-testid={`public-seat-${seat.technicalCode}`}
                      cx={center.x}
                      cy={center.y}
                      r={radius}
                      strokeWidth={selected ? 4 : 2}
                      className={`${seatClasses(seat, selected, interactive)} ${seat.status === 'AVAILABLE' && interactive ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                      onClick={() => toggleSeat(seat)}
                    />
                    <text
                      x={center.x}
                      y={center.y + 4}
                      textAnchor="middle"
                      className="pointer-events-none select-none fill-white text-[12px] font-semibold"
                    >
                      {seat.displayLabel}
                    </text>
                  </g>
                );
              })}
          </PublicMapViewport>
        </section>

        <aside className="space-y-4">
          {mode === 'preview' ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Esta é uma prévia privada. O checkout fica habilitado somente no link público publicado.
            </div>
          ) : null}

          {step !== 'CONFIRMATION' && (
            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <span>Passo {stepIndex(step)} de 3</span>
                <span className="text-brand-accent">{stepLabel(step)}</span>
              </div>
              <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                <div 
                  className="h-full bg-brand-accent transition-all duration-300 ease-in-out" 
                  style={{ width: `${(stepIndex(step) / 3) * 100}%` }}
                />
              </div>
            </section>
          )}

          {step === 'SELECTION' && (
            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-4 w-4 text-brand-accent" />
                <h2 className="text-sm font-semibold text-slate-950">Assentos selecionados</h2>
              </div>
              <div className="mt-3">
                {selectedSeats.length === 0 ? (
                  <p className="rounded-lg bg-slate-50 px-3 py-4 text-sm text-slate-500">Selecione assentos disponíveis no mapa.</p>
                ) : (
                  <div className="max-h-[182px] overflow-y-auto pr-1 space-y-2">
                    {selectedSeats.map((seat) => (
                      <div key={seat.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm">
                        <span>
                          <strong>{seat.displayLabel}</strong>
                          <span className="ml-2 text-slate-500">{seat.sectionName}</span>
                        </span>
                        <span className="font-medium">{formatCurrency(seat.unitPrice)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-sm">
                <span className="text-slate-500">Total</span>
                <strong className="text-base">{formatCurrency(total)}</strong>
              </div>
              {selectedSeats.length > 0 && (
                <Button
                  type="button"
                  className="mt-4 w-full bg-brand-accent text-white hover:bg-brand-accent/90"
                  onClick={() => setStep('IDENTIFICATION')}
                >
                  Continuar compra
                </Button>
              )}
            </section>
          )}

          {step === 'IDENTIFICATION' && (
            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                <User className="h-4 w-4 text-brand-accent" />
                <h2 className="text-sm font-semibold text-slate-950">Dados de Faturamento</h2>
              </div>
              <div className="mt-3 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-700">
                <strong>Resumo:</strong> {selectedSeats.length} {selectedSeats.length === 1 ? 'assento selecionado' : 'assentos selecionados'} ({selectedSeats.map(s => s.displayLabel).join(', ')}) — <strong>{formatCurrency(total)}</strong>
              </div>
              <div className="mt-4 space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="public-map-buyer-name">Nome Completo</Label>
                  <Input
                    id="public-map-buyer-name"
                    value={buyerName}
                    onChange={(event) => setBuyerName(event.target.value)}
                    placeholder="Seu nome"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="public-map-buyer-email">E-mail</Label>
                  <Input
                    id="public-map-buyer-email"
                    type="email"
                    value={buyerEmail}
                    onChange={(event) => setBuyerEmail(event.target.value)}
                    placeholder="nome@email.com"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="public-map-buyer-document">CPF ou CNPJ</Label>
                  <Input
                    id="public-map-buyer-document"
                    value={buyerDocument}
                    onChange={(event) => setBuyerDocument(formatCpfCnpjBR(event.target.value))}
                    placeholder="000.000.000-00"
                  />
                </div>

                <div className="border-t border-slate-100 pt-3">
                  <p className="text-xs font-semibold text-slate-550 uppercase tracking-wider mb-2">Endereço de Cobrança</p>
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="public-map-buyer-cep">CEP</Label>
                      <div className="relative">
                        <Input
                          id="public-map-buyer-cep"
                          value={buyerPostalCode}
                          onChange={(event) => setBuyerPostalCode(formatCepBR(event.target.value))}
                          onBlur={handleCepBlur}
                          placeholder="00000-000"
                        />
                        {isCepLoading && (
                          <div className="absolute right-3 top-2.5">
                            <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div className="col-span-2 space-y-1.5">
                        <Label htmlFor="public-map-buyer-address">Rua / Av</Label>
                        <Input
                          id="public-map-buyer-address"
                          value={buyerAddress}
                          onChange={(event) => setBuyerAddress(event.target.value)}
                          placeholder="Logradouro"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="public-map-buyer-number">Número</Label>
                        <Input
                          id="public-map-buyer-number"
                          value={buyerAddressNumber}
                          onChange={(event) => setBuyerAddressNumber(event.target.value)}
                          placeholder="123"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="public-map-buyer-complement">Complemento (opcional)</Label>
                      <Input
                        id="public-map-buyer-complement"
                        value={buyerComplement}
                        onChange={(event) => setBuyerComplement(event.target.value)}
                        placeholder="Apto, Bloco..."
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="public-map-buyer-province">Bairro</Label>
                      <Input
                        id="public-map-buyer-province"
                        value={buyerProvince}
                        onChange={(event) => setBuyerProvince(event.target.value)}
                        placeholder="Bairro"
                      />
                    </div>

                    {buyerCity && (
                      <div className="grid grid-cols-3 gap-2 text-xs text-slate-500 bg-slate-50 p-2 rounded-lg border border-slate-100">
                        <div className="col-span-2">
                          <strong>Cidade:</strong> {buyerCity}
                        </div>
                        <div>
                          <strong>UF:</strong> {buyerState}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-1/3"
                    onClick={() => setStep('SELECTION')}
                  >
                    Voltar
                  </Button>
                  <Button
                    type="button"
                    className="w-2/3 bg-brand-accent text-white hover:bg-brand-accent/90"
                    disabled={!isIdentificationValid}
                    onClick={() => setStep('PAYMENT_METHOD')}
                  >
                    Avançar
                  </Button>
                </div>
              </div>
            </section>
          )}

          {step === 'PAYMENT_METHOD' && (
            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                <CreditCard className="h-4 w-4 text-brand-accent" />
                <h2 className="text-sm font-semibold text-slate-950">Escolha a Forma de Pagamento</h2>
              </div>
              <div className="mt-3 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-700">
                <strong>Resumo:</strong> {selectedSeats.length} {selectedSeats.length === 1 ? 'assento' : 'assentos'} ({selectedSeats.map(s => s.displayLabel).join(', ')}) — <strong>{formatCurrency(total)}</strong>
              </div>
              <div className="mt-4 space-y-3">
                <button
                  type="button"
                  onClick={() => setPaymentMethod('PIX')}
                  className={`w-full flex items-center justify-between p-3 rounded-lg border text-left transition-all ${paymentMethod === 'PIX' ? 'border-brand-accent bg-purple-50/20 text-brand-accent' : 'border-slate-200 hover:border-slate-300 bg-white'}`}
                >
                  <div className="flex items-center gap-3">
                    <QrCode className="h-5 w-5 text-brand-accent" />
                    <div>
                      <strong className="block text-sm text-slate-950">Pix</strong>
                      <span className="text-xs text-slate-500">Código Copia e Cola ou QR Code</span>
                    </div>
                  </div>
                  {paymentMethod === 'PIX' && <Check className="h-4 w-4" />}
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentMethod('CREDIT_CARD')}
                  className={`w-full flex items-center justify-between p-3 rounded-lg border text-left transition-all ${paymentMethod === 'CREDIT_CARD' ? 'border-brand-accent bg-purple-50/20 text-brand-accent' : 'border-slate-200 hover:border-slate-300 bg-white'}`}
                >
                  <div className="flex items-center gap-3">
                    <CreditCard className="h-5 w-5 text-brand-accent" />
                    <div>
                      <strong className="block text-sm text-slate-950">Cartão de Crédito</strong>
                      <span className="text-xs text-slate-500">Pague no cartão via Asaas</span>
                    </div>
                  </div>
                  {paymentMethod === 'CREDIT_CARD' && <Check className="h-4 w-4" />}
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentMethod('BOLETO')}
                  className={`w-full flex items-center justify-between p-3 rounded-lg border text-left transition-all ${paymentMethod === 'BOLETO' ? 'border-brand-accent bg-purple-50/20 text-brand-accent' : 'border-slate-200 hover:border-slate-300 bg-white'}`}
                >
                  <div className="flex items-center gap-3">
                    <Ticket className="h-5 w-5 text-brand-accent" />
                    <div>
                      <strong className="block text-sm text-slate-950">Boleto Bancário</strong>
                      <span className="text-xs text-slate-500">Compensação em até 1 dia útil</span>
                    </div>
                  </div>
                  {paymentMethod === 'BOLETO' && <Check className="h-4 w-4" />}
                </button>

                {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

                <div className="flex gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-1/3"
                    onClick={() => setStep('IDENTIFICATION')}
                    disabled={isSubmitting}
                  >
                    Voltar
                  </Button>
                  <Button
                    type="button"
                    className="w-2/3 bg-brand-accent text-white hover:bg-brand-accent/90"
                    disabled={isSubmitting}
                    onClick={handleCheckout}
                  >
                    {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ticket className="h-4 w-4" />}
                    Confirmar e Reservar
                  </Button>
                </div>
              </div>
            </section>
          )}

          {step === 'CONFIRMATION' && order && (
            <div className="space-y-4">
              <section
                className={`rounded-lg border bg-white p-4 shadow-sm ${
                  order.status === 'CONFIRMED'
                    ? 'border-emerald-200'
                    : order.status === 'EXPIRED' || order.status === 'CANCELLED' || order.status === 'REFUNDED'
                      ? 'border-rose-200'
                      : 'border-amber-200'
                }`}
              >
                <div
                  className={`flex items-center gap-2 ${
                    order.status === 'CONFIRMED'
                      ? 'text-emerald-700'
                      : order.status === 'EXPIRED' || order.status === 'CANCELLED' || order.status === 'REFUNDED'
                        ? 'text-rose-700'
                        : 'text-amber-700'
                  }`}
                >
                  {order.status === 'CONFIRMED' ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : order.status === 'EXPIRED' || order.status === 'CANCELLED' || order.status === 'REFUNDED' ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  )}
                  <h2 className="text-sm font-semibold">
                    {order.status === 'CONFIRMED'
                      ? 'Pagamento confirmado!'
                      : order.status === 'EXPIRED' || order.status === 'CANCELLED' || order.status === 'REFUNDED'
                        ? publicOrderStatusLabel(order.status)
                        : 'Reserva criada!'}
                  </h2>
                </div>
                <p className="mt-2 text-sm text-slate-650">
                  {order.status === 'CONFIRMED'
                    ? 'Seus ingressos foram emitidos e já podem ser baixados.'
                    : order.status === 'EXPIRED' || order.status === 'CANCELLED' || order.status === 'REFUNDED'
                      ? 'Esta reserva não está mais disponível. Selecione novos assentos no mapa.'
                      : 'Complete o pagamento para garantir seus ingressos.'}
                </p>
                {order.status === 'PAYMENT_PENDING' ? (
                  <PublicOrderReservationCountdown expiresAt={order.expiresAt} className="mt-2 text-xs" />
                ) : null}
                {order.status === 'CONFIRMED' && order.ticketsUrl ? (
                  <div className="mt-3 flex flex-col gap-2">
                    <Button asChild className="w-full bg-emerald-700 text-white hover:bg-emerald-800">
                      <a href={order.ticketsUrl} target="_blank" rel="noreferrer">
                        <Ticket className="h-4 w-4" />
                        Baixar ingressos (PDF)
                      </a>
                    </Button>
                    {order.ticketsHtmlUrl ? (
                      <Button asChild variant="outline" className="w-full">
                        <a href={order.ticketsHtmlUrl} target="_blank" rel="noreferrer">
                          Ver ingressos online
                        </a>
                      </Button>
                    ) : null}
                  </div>
                ) : order.status === 'PAYMENT_PENDING' ? (
                  <div className="mt-2 rounded-lg bg-slate-50 p-3 text-center border border-slate-100">
                    <strong className="block text-sm text-slate-900">{formatDate(order.expiresAt)}</strong>
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                      Prazo para pagamento
                    </span>
                  </div>
                ) : null}
              </section>

              {order.status === 'PAYMENT_PENDING' ? (
                <div className="rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-2 text-xs text-amber-900">
                  <strong>Guarde este link</strong> para retornar ao pedido após o pagamento.
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2 h-8"
                    onClick={copyStatusLink}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {copiedStatusLink ? 'Link copiado' : 'Copiar link do pedido'}
                  </Button>
                </div>
              ) : null}

              {pollTimedOut && order.status === 'PAYMENT_PENDING' ? (
                <p className="text-sm text-slate-600 rounded-lg bg-slate-50 px-3 py-2">
                  A confirmação está demorando. Se você já pagou, use &quot;Já paguei&quot; abaixo.
                </p>
              ) : null}

              {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

              {order.status !== 'CONFIRMED' &&
              order.status !== 'EXPIRED' &&
              order.status !== 'CANCELLED' &&
              order.status !== 'REFUNDED' &&
              paymentMethod === 'PIX' &&
              order.pixQrCode ? (
                <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm text-center space-y-4">
                  <div className="flex items-center gap-1.5 justify-center text-brand-accent font-semibold text-sm">
                    <QrCode className="h-4 w-4" />
                    <span>Pague com Pix</span>
                  </div>

                  <div className="mx-auto flex justify-center border border-slate-100 rounded-lg p-2 bg-white max-w-[200px]">
                    <img
                      src={`data:image/png;base64,${order.pixQrCode.encodedImage}`}
                      alt="QR Code Pix"
                      className="h-44 w-44"
                    />
                  </div>

                  <div className="text-left space-y-1.5">
                    <Label htmlFor="pix-copia-cola" className="text-xs text-slate-500">Código Copia e Cola</Label>
                    <div className="flex gap-2">
                      <Input
                        id="pix-copia-cola"
                        readOnly
                        value={order.pixQrCode.payload}
                        className="bg-slate-50 text-xs font-mono select-all truncate flex-1"
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        className="h-10 w-10 flex-shrink-0"
                        onClick={copyPixPayload}
                      >
                        {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>

                  {order.invoiceUrl && (
                    <div className="pt-2 border-t border-slate-100">
                      <a
                        href={order.invoiceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-slate-500 hover:text-brand-accent underline inline-flex items-center gap-1"
                      >
                        Visualizar cobrança completa no Asaas <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  )}
                </section>
              ) : order.status === 'PAYMENT_PENDING' ? (
                <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm space-y-3">
                  <h3 className="font-semibold text-sm text-slate-900">Finalize seu Pagamento</h3>
                  <p className="text-xs text-slate-600">
                    {paymentMethod === 'CREDIT_CARD'
                      ? 'Preencha os dados do cartão de crédito no ambiente seguro do Asaas.'
                      : 'Visualize o boleto bancário oficial do Asaas para efetuar o pagamento.'}
                  </p>
                  {order.invoiceUrl ? (
                    <Button asChild className="w-full bg-brand-accent text-white hover:bg-brand-accent/90">
                      <a href={order.invoiceUrl} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-4 w-4" />
                        Ir para o Pagamento
                      </a>
                    </Button>
                  ) : (
                    <p className="text-xs text-amber-700">Cobrança criada sem link público de pagamento.</p>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={isSyncingPayment}
                    onClick={handleSyncPayment}
                  >
                    {isSyncingPayment ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    Já paguei — verificar agora
                  </Button>
                </section>
              ) : null}

              {order.status === 'CONFIRMED' ? (
                <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <h3 className="text-sm font-semibold text-slate-950">Ingressos emitidos</h3>
                  <div className="mt-3 space-y-2">
                    {order.items.map((item) => (
                      <div
                        key={`${item.sectionName}-${item.seatLabel}`}
                        className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm"
                      >
                        <span>
                          <strong>{item.seatLabel}</strong>
                          <span className="ml-2 text-slate-500">{item.sectionName}</span>
                        </span>
                        <span className="font-mono text-xs text-slate-500">{item.ticketCode}</span>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {order.status === 'EXPIRED' || order.status === 'CANCELLED' || order.status === 'REFUNDED' ? (
                <Button type="button" className="w-full bg-brand-accent text-white" onClick={resetCheckoutFlow}>
                  Nova compra no mapa
                </Button>
              ) : null}
            </div>
          )}
        </aside>
      </div>

      {mode === 'public' && step === 'SELECTION' && selectedSeats.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-3 py-3 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur-sm pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] lg:hidden">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-slate-500">
                {selectedSeats.length} {selectedSeats.length === 1 ? 'assento' : 'assentos'}
              </p>
              <p className="text-lg font-semibold text-slate-950">{formatCurrency(total)}</p>
            </div>
            <Button
              type="button"
              className="shrink-0 bg-brand-accent px-5 text-white hover:bg-brand-accent/90"
              onClick={() => setStep('IDENTIFICATION')}
            >
              Continuar
            </Button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
