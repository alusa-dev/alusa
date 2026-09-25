'use client';

import type { PublicMapViewModel } from './public-map-adapter';
import { MAP_ARTBOARD_STROKE, MAP_ARTBOARD_STROKE_WIDTH } from '@alusa/domain';
import bwipjs from '@bwip-js/browser';

import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, CircleAlert, ExternalLink, Loader2, MapPin, ShoppingCart, Ticket, Check, Copy, CreditCard, QrCode, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BrandWordmark } from '@/components/brand/BrandWordmark';

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

import { formatCpfCnpjBR, formatPhoneBR, isValidCpfCnpjBR, isValidPhoneBR, onlyDigits } from '@/lib/formatters';

type PublicSeat = PublicMapViewModel['seats'][number];
type PublicMapOrderState = {
  orderId: string;
  accessToken: string;
  ticketsUrl: string | null;
  invoiceUrl: string | null;
  status: string;
  paymentStatus?: string | null;
  refundRequestUrl?: string | null;
  ticketFulfillmentLastError?: string | null;
  ticketFulfillmentStatus: 'PENDING' | 'ISSUED' | 'FAILED' | 'REQUIRES_RECONCILIATION';
  expiresAt: string | null;
  statusUrl?: string | null;
  paymentMethod: 'PIX' | 'CREDIT_CARD' | 'BOLETO' | null;
  bankSlipCode: string | null;
  bankSlipBarcode: string | null;
  items: Array<{ ticketCode: string | null; seatLabel: string; sectionName: string }>;
  pixQrCode: { encodedImage: string; payload: string; expirationDate: string } | null;
};
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
  initialOrder = null,
}: {
  map: PublicMapViewModel;
  mode?: 'public' | 'preview';
  initialOrder?: PublicMapOrderState | null;
}) {
  const [seats, setSeats] = useState<PublicSeat[]>(map.seats);
  const panelLevels = useMemo(
    () => resolvePublicMapLevels(map.levels as PublicMapLevelView[]),
    [map.levels],
  );
  const [activeLevelId, setActiveLevelId] = useState(() => getDefaultPublicMapLevelId(panelLevels));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [step, setStep] = useState<'SELECTION' | 'IDENTIFICATION' | 'PAYMENT_METHOD' | 'CONFIRMATION'>(
    initialOrder ? 'CONFIRMATION' : 'SELECTION',
  );
  
  // Form states
  const [buyerName, setBuyerName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [buyerDocument, setBuyerDocument] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'PIX' | 'CREDIT_CARD' | 'BOLETO'>(
    initialOrder?.paymentMethod ?? 'PIX',
  );
  const [checkoutKey, setCheckoutKey] = useState(createCheckoutKey);
  
  // Component UX states
  const [copied, setCopied] = useState(false);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [isSyncingPayment, setIsSyncingPayment] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<PublicMapOrderState | null>(initialOrder);
  const bankSlipBarcodeSvg = useMemo(() => {
    const barcodeDigits = order?.bankSlipBarcode?.replace(/\D/g, '');
    if (!barcodeDigits || !/^\d{44}$/.test(barcodeDigits)) return null;
    try {
      return bwipjs.toSVG({
        bcid: 'interleaved2of5',
        text: barcodeDigits,
        width: 103,
        height: 13,
        scaleX: 1,
        scaleY: 1,
        paddingwidth: 14,
      });
    } catch {
      return null;
    }
  }, [order?.bankSlipBarcode]);

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
        { seats: map.seats },
        map.objects as PublicObject[],
        activeLevel.id,
      ),
    [activeLevel.id, map.objects, map.seats],
  );
  const levelSeats = useMemo(
    () => filterPublicMapSeatsByLevel(seats, activeLevel.id),
    [activeLevel.id, seats],
  );
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
      isValidPhoneBR(buyerPhone)
    );
  }, [buyerName, buyerEmail, buyerDocument, buyerPhone]);

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
          ticketFulfillmentStatus: 'PENDING' | 'ISSUED' | 'FAILED' | 'REQUIRES_RECONCILIATION';
          ticketsUrl: string | null;
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
              ticketFulfillmentStatus: result.order.ticketFulfillmentStatus,
              ticketsUrl: result.order.ticketsUrl,
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

  function copyPaymentCode(code: string) {
    if (code) {
      navigator.clipboard.writeText(code);
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
        invoiceUrl: string | null;
        status: string;
        paymentStatus?: string | null;
        ticketFulfillmentStatus: 'PENDING' | 'ISSUED' | 'FAILED' | 'REQUIRES_RECONCILIATION';
        expiresAt: string;
        statusUrl?: string | null;
        items: Array<{ ticketCode: string; seatLabel: string; sectionName: string }>;
        pixQrCode: { encodedImage: string; payload: string; expirationDate: string } | null;
        bankSlipCode: string | null;
        bankSlipBarcode: string | null;
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
            buyerPhone: onlyDigits(buyerPhone),
            paymentMethod,
          }),
        }),
      );

      setOrder({ ...checkout, paymentMethod });
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

  const currentOrderId = order?.orderId;
  const currentOrderAccessToken = order?.accessToken;
  const currentOrderStatus = order?.status;
  const currentOrderPaymentStatus = order?.paymentStatus;
  const currentTicketFulfillmentStatus = order?.ticketFulfillmentStatus;
  const currentTicketFulfillmentError = order?.ticketFulfillmentLastError;

  useEffect(() => {
    if (
      !currentOrderId
      || !currentOrderAccessToken
      || (currentOrderStatus !== 'PAYMENT_PENDING'
        && !(currentOrderStatus === 'CONFIRMED'
          && currentTicketFulfillmentStatus !== 'ISSUED'
          && currentTicketFulfillmentStatus !== 'REQUIRES_RECONCILIATION')
        && !(currentOrderStatus === 'CONFIRMED'
          && currentTicketFulfillmentError?.startsWith('ASSENTOS_INDISPONIVEIS:')
          && currentOrderPaymentStatus !== 'REFUND_DENIED'
          && currentOrderPaymentStatus !== 'REFUNDED'))
    ) return;

    const orderId = currentOrderId;
    const accessToken = currentOrderAccessToken;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();
    let pollAttempt = 0;
    let inFlightController: AbortController | null = null;

    const schedulePoll = (delayMs: number) => {
      if (cancelled) return;
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(pollStatus, delayMs);
    };

    const nextPollDelay = (baseMs: number) => {
      const jitter = Math.round(baseMs * (Math.random() * 0.2 - 0.1));
      return Math.max(1000, baseMs + jitter);
    };

    async function pollStatus() {
      timeoutId = null;
      if (Date.now() - startedAt > 12 * 60 * 1000) {
        if (!cancelled) setPollTimedOut(true);
        return;
      }
      if (document.visibilityState === 'hidden') {
        schedulePoll(30_000);
        return;
      }

      try {
        inFlightController = new AbortController();
        const status = await parseApiResponse<{
          orderId: string;
          ticketsUrl: string | null;
          invoiceUrl: string | null;
          status: string;
          paymentStatus: string | null;
          refundRequestUrl: string | null;
          ticketFulfillmentLastError: string | null;
          ticketFulfillmentStatus: 'PENDING' | 'ISSUED' | 'FAILED' | 'REQUIRES_RECONCILIATION';
          expiresAt: string | null;
          items: Array<{ ticketCode: string | null; seatLabel: string; sectionName: string }>;
        }>(
          await fetch(`/api/public/event-map-orders/${orderId}/status?token=${encodeURIComponent(accessToken)}`, {
            signal: inFlightController.signal,
            cache: 'no-store',
          }),
        );

        if (cancelled) return;
        setOrder((current) =>
          current
            ? {
                ...current,
                status: status.status,
                paymentStatus: status.paymentStatus,
                refundRequestUrl: status.refundRequestUrl,
                ticketFulfillmentLastError: status.ticketFulfillmentLastError,
                ticketFulfillmentStatus: status.ticketFulfillmentStatus,
                ticketsUrl: status.ticketsUrl,
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

        if (
          status.status === 'PAYMENT_PENDING'
          || (status.status === 'CONFIRMED'
            && status.ticketFulfillmentStatus !== 'ISSUED'
            && status.ticketFulfillmentStatus !== 'REQUIRES_RECONCILIATION')
          || (status.status === 'CONFIRMED'
            && status.ticketFulfillmentLastError?.startsWith('ASSENTOS_INDISPONIVEIS:')
            && status.paymentStatus !== 'REFUND_DENIED'
            && status.paymentStatus !== 'REFUNDED')
        ) {
          const baseDelay = Math.min(30_000, 5000 * (2 ** Math.min(pollAttempt, 3)));
          pollAttempt += 1;
          schedulePoll(nextPollDelay(baseDelay));
        }
      } catch (pollError) {
        if (!cancelled && !(pollError instanceof DOMException && pollError.name === 'AbortError')) {
          console.warn('Falha ao atualizar status do pedido público', pollError);
          const baseDelay = Math.min(30_000, 12_000 * (2 ** Math.min(pollAttempt, 2)));
          pollAttempt += 1;
          schedulePoll(nextPollDelay(baseDelay));
        }
      } finally {
        inFlightController = null;
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = null;
        return;
      }
      schedulePoll(500);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    schedulePoll(5000);
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      inFlightController?.abort();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentOrderAccessToken, currentOrderId, currentOrderPaymentStatus, currentOrderStatus, currentTicketFulfillmentError, currentTicketFulfillmentStatus]);

  const ticketsIssued =
    order?.status === 'CONFIRMED'
    && order.ticketFulfillmentStatus === 'ISSUED'
    && Boolean(order.ticketsUrl);
  const ticketFulfillmentNeedsReconciliation =
    order?.status === 'CONFIRMED'
    && order.ticketFulfillmentStatus === 'REQUIRES_RECONCILIATION';
  const isPublicFlow = mode === 'public';
  const isPublicSelectionView = mode === 'public' && step === 'SELECTION';
  const paymentOptions = [
    { value: 'PIX' as const, label: 'Pix', desktopLabel: 'Pagar no PIX', description: 'Código Copia e Cola ou QR Code', icon: QrCode },
    { value: 'CREDIT_CARD' as const, label: 'Cartão de Crédito', desktopLabel: 'Pagar no cartão de crédito ou débito', description: 'Pague no cartão via Asaas', icon: CreditCard },
    { value: 'BOLETO' as const, label: 'Boleto Bancário', desktopLabel: 'Pagar no boleto', description: 'Compensação em até 1 dia útil', icon: Ticket },
  ];
  const paymentMethodInfo = {
    PIX: {
      description: 'Após confirmar, você poderá pagar com o QR Code ou o código Pix nesta página.',
    },
    CREDIT_CARD: {
      description: 'Após confirmar, você poderá concluir o pagamento com cartão no ambiente seguro do Asaas.',
    },
    BOLETO: {
      description: 'O boleto será gerado após confirmar. A compensação pode levar até 1 dia útil.',
    },
  }[paymentMethod];

  return (
    <div className={isPublicFlow ? 'flex h-dvh flex-col overflow-hidden lg:bg-slate-100' : undefined}>
    <main className={`relative ${isPublicFlow ? 'bg-white lg:!bg-slate-100' : 'bg-slate-100'} text-slate-950 ${
      isPublicFlow
        ? 'flex min-h-0 flex-1 flex-col overflow-hidden lg:min-h-0 lg:flex-1'
        : step === 'IDENTIFICATION'
          ? 'min-h-screen lg:flex lg:h-dvh lg:flex-col lg:overflow-hidden'
          : 'min-h-screen'
    }`}>
      {isPublicFlow && step === 'CONFIRMATION' && order ? (
        <div className="absolute inset-x-0 top-4 z-10 hidden justify-center bg-transparent lg:flex">
          <BrandWordmark className="h-7 w-auto" />
        </div>
      ) : null}
      <header className={`shrink-0 border-b ${step === 'SELECTION' ? 'border-slate-200 bg-white lg:border-transparent lg:bg-[#3e1f63]' : 'border-transparent bg-slate-100'} ${step !== 'SELECTION' ? 'lg:hidden' : ''}`}>
        <div className="flex items-center justify-between gap-4 bg-[#3e1f63] px-4 py-3 lg:hidden">
          <BrandWordmark variant="white" className="h-6 w-auto" />
          <nav aria-label={`Etapa ${stepIndex(step)} de 3: ${stepLabel(step)}`} className="flex items-center gap-3">
              {[1, 2, 3].map((stepNumber) => {
                const isComplete = stepNumber < stepIndex(step);
                const isCurrent = stepNumber === stepIndex(step);
                return (
                  <div key={stepNumber} className="flex items-center">
                    <span
                      aria-current={isCurrent ? 'step' : undefined}
                      aria-label={`${stepNumber}. ${stepNumber === 1 ? 'Seleção' : stepNumber === 2 ? 'Identificação' : 'Pagamento'}${isCurrent ? ', etapa atual' : isComplete ? ', concluída' : ''}`}
                      className={`relative z-10 block rounded-full transition-[width,height,background-color] duration-200 ${
                        isCurrent
                          ? 'h-2.5 w-2.5 bg-white'
                          : isComplete
                            ? 'h-1.5 w-1.5 bg-white/90'
                            : 'h-1.5 w-1.5 bg-white/50'
                      }`}
                    />
                  </div>
                );
              })}
          </nav>
        </div>
        <div className="mx-auto hidden max-w-7xl items-center justify-between gap-8 px-4 py-4 lg:flex">
          <BrandWordmark variant="white" className="h-8 w-auto" />
          <div className="min-w-0 text-right">
            {mode === 'preview' ? (
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70 sm:text-xs">
                Pré-visualização
              </p>
            ) : null}
            <h1 className="mt-1 text-xl font-semibold text-white sm:text-2xl">{map.event.name}</h1>
            <div className="mt-2 flex flex-wrap justify-end gap-x-4 gap-y-1 text-sm text-white/80">
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays aria-hidden="true" className="h-4 w-4" />
                {formatDate(map.event.startsAt)}
              </span>
              {map.event.locationName ? (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin aria-hidden="true" className="h-4 w-4" />
                  {map.event.locationName}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <div
        className={`mx-auto grid w-full max-w-7xl ${step === 'IDENTIFICATION' ? 'lg:grid-cols-1 lg:place-items-center' : isPublicFlow && step === 'PAYMENT_METHOD' ? 'lg:grid-cols-[minmax(0,360px)_minmax(0,448px)] lg:items-center lg:justify-center' : isPublicFlow && step === 'CONFIRMATION' ? 'lg:grid-cols-1 lg:place-items-center' : 'lg:grid-cols-[minmax(0,1fr)_360px]'}${
          isPublicSelectionView
            ? ' min-h-0 flex-1 grid-rows-[minmax(0,1fr)] overflow-hidden lg:min-h-0 lg:flex-1 lg:grid-rows-[minmax(0,1fr)] lg:gap-4 lg:overflow-visible lg:px-3 lg:py-4'
            : isPublicFlow
              ? ` min-h-0 flex-1 grid-rows-[minmax(0,1fr)] gap-3 overflow-hidden px-3 py-3 ${step === 'PAYMENT_METHOD' ? 'lg:my-auto lg:flex-none lg:grid-rows-none lg:items-stretch lg:overflow-visible' : step !== 'SELECTION' ? 'lg:min-h-0 lg:flex-1 lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden' : 'lg:flex-none lg:grid-rows-none lg:gap-4 lg:overflow-visible'} lg:px-3 lg:py-4`
              : ' gap-3 px-3 py-4 sm:gap-4 sm:px-4 sm:py-5'
        }`}
      >
        <section className={`min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm ${
          isPublicFlow && step !== 'SELECTION' ? 'hidden' : ''
        } ${
          isPublicSelectionView
            ? 'flex min-h-0 flex-col rounded-none border-0 bg-transparent shadow-none lg:rounded-xl lg:border-[1px] lg:border-slate-300 lg:bg-white lg:shadow-[rgba(17,12,46,0.15)_0px_48px_100px_0px]'
            : ''
        }`}>
          <div className="shrink-0 border-b border-slate-100 bg-white px-3 py-3 sm:px-4">
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
            fillAvailable={step === 'IDENTIFICATION' || isPublicSelectionView}
            fillAvailableOnMobile={isPublicSelectionView}
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
                    rx={6}
                    fill={style.fill}
                    stroke={style.stroke}
                    strokeWidth={1.5}
                    strokeDasharray={style.dash}
                    transform={`rotate(${object.rotation} ${cx} ${cy})`}
                  />
                );
              })}
              {levelSeats.map((seat) => {
                const selected = selectedIds.includes(seat.id);
                const center = { x: seat.x, y: seat.y };
                const rotation = seat.rotation;
                const radius = Math.max((seat.size ?? 28) / 2, 8);
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

        {isPublicFlow && step === 'PAYMENT_METHOD' ? (
          <section className="hidden h-[416px] w-full max-w-[360px] flex-col rounded-xl bg-white p-6 lg:flex">
            <div>
              <h2 className="text-xl font-semibold text-slate-950">Resumo do pedido</h2>
              <p className="mt-1 text-sm text-slate-600">
                {selectedSeats.length} {selectedSeats.length === 1 ? 'assento selecionado' : 'assentos selecionados'}
              </p>
            </div>
            <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain border-y border-slate-100 py-4 pr-3">
              {selectedSeats.map((seat) => (
                <div key={seat.id} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{seat.displayLabel}</p>
                    <p className="truncate text-xs text-slate-500">{seat.sectionName}</p>
                  </div>
                  <span className="shrink-0 text-slate-700">{formatCurrency(seat.unitPrice)}</span>
                </div>
              ))}
            </div>
            <div className="mt-auto flex items-center justify-between pt-4 text-sm">
              <span className="text-slate-600">Total</span>
              <strong className="text-base text-slate-950">{formatCurrency(total)}</strong>
            </div>
          </section>
        ) : null}

        <aside className={`space-y-4 ${isPublicSelectionView ? 'hidden lg:block' : ''} ${isPublicFlow && step !== 'SELECTION' ? 'min-h-0 h-full overflow-y-auto overscroll-contain' : ''} ${step === 'IDENTIFICATION' || (isPublicFlow && step !== 'SELECTION') ? `lg:mx-auto lg:flex lg:h-auto lg:max-h-full lg:min-h-0 lg:w-full ${step === 'CONFIRMATION' && paymentMethod === 'BOLETO' && order?.status === 'PAYMENT_PENDING' ? 'lg:max-w-[960px]' : step === 'CONFIRMATION' && paymentMethod === 'PIX' && order?.pixQrCode ? 'lg:max-w-[800px]' : 'lg:max-w-md'} lg:flex-col lg:justify-center lg:overflow-y-auto` : ''}`}>
          {mode === 'preview' ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Esta é uma prévia privada. O checkout fica habilitado somente no link público publicado.
            </div>
          ) : null}

          {step === 'SELECTION' && (
            <>
              <section className="hidden rounded-xl border-0 bg-white p-6 shadow-none lg:block">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-semibold text-slate-950">Assentos selecionados</h2>
                    </div>
                    <p className="mt-1 text-sm leading-5 text-slate-600">
                      Escolha seus lugares no mapa para continuar.
                    </p>
                  </div>
                  <div
                    className="flex shrink-0 items-center gap-2 py-1"
                    role="group"
                    aria-label={`Etapa ${stepIndex(step)} de 3: ${stepLabel(step)}`}
                  >
                    {[1, 2, 3].map((stepNumber) => (
                      <span
                        key={stepNumber}
                        aria-current={stepNumber === stepIndex(step) ? 'step' : undefined}
                        aria-label={`${stepNumber}. ${stepNumber === 1 ? 'Seleção' : stepNumber === 2 ? 'Identificação' : 'Pagamento'}${stepNumber === stepIndex(step) ? ', etapa atual' : ''}`}
                        className={`block rounded-full transition-[width,height,background-color] duration-200 ${stepNumber === stepIndex(step) ? 'h-2.5 w-2.5 bg-slate-500' : 'h-1.5 w-1.5 bg-slate-200'}`}
                      />
                    ))}
                  </div>
                </div>
                <div className="mt-4 border-t border-slate-200" aria-hidden="true" />
                <div className="mt-5">
                  {selectedSeats.length === 0 ? (
                    <p className="rounded-lg bg-slate-100 px-3 py-4 text-sm text-slate-600">
                      Selecione assentos disponíveis no mapa.
                    </p>
                  ) : (
                    <div className="max-h-[182px] space-y-2 overflow-y-auto pr-1">
                      {selectedSeats.map((seat) => (
                        <div key={seat.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-100 px-3 py-2.5 text-sm">
                          <span className="min-w-0">
                            <strong>{seat.displayLabel}</strong>
                            <span className="ml-2 text-slate-500">{seat.sectionName}</span>
                          </span>
                          <span className="shrink-0 font-medium">{formatCurrency(seat.unitPrice)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="mt-5 flex items-center justify-between border-t border-slate-200 pt-4 text-sm">
                  <span className="text-slate-600">Total</span>
                  <strong className="text-base text-slate-950">{formatCurrency(total)}</strong>
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

              <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm lg:hidden">
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
            </>
          )}

          {step === 'IDENTIFICATION' && (
            <section className={`border-0 bg-transparent p-4 shadow-none ${step === 'IDENTIFICATION' ? 'lg:min-h-0 lg:flex-none lg:overflow-visible lg:rounded-xl lg:bg-white lg:p-6 lg:shadow-none' : 'lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:rounded-lg lg:border lg:border-slate-200 lg:bg-white lg:p-4 lg:shadow-sm'}`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950 lg:text-xl">Preencha os dados</h2>
                  <p className="mt-1 text-sm leading-5 text-slate-600">Falta pouco! Preencha seus dados para seguir com a compra.</p>
                </div>
                <div
                  className="hidden shrink-0 items-center gap-2 py-0.5 lg:flex"
                  role="group"
                  aria-label={`Etapa ${stepIndex(step)} de 3: ${stepLabel(step)}`}
                >
                  {[1, 2, 3].map((stepNumber) => (
                    <span
                      key={stepNumber}
                      aria-current={stepNumber === stepIndex(step) ? 'step' : undefined}
                      aria-label={`${stepNumber}. ${stepNumber === 1 ? 'Seleção' : stepNumber === 2 ? 'Identificação' : 'Pagamento'}${stepNumber === stepIndex(step) ? ', etapa atual' : ''}`}
                      className={`block rounded-full transition-[width,height,background-color] duration-200 ${stepNumber === stepIndex(step) ? 'h-2.5 w-2.5 bg-slate-500' : 'h-1.5 w-1.5 bg-slate-200'}`}
                    />
                  ))}
                </div>
              </div>
              <div className="mt-4 hidden border-t border-slate-200 lg:block" aria-hidden="true" />
              <div className="mt-5 space-y-4">
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="public-map-buyer-name">Nome Completo</Label>
                    <Input
                      id="public-map-buyer-name"
                      value={buyerName}
                      onChange={(event) => setBuyerName(event.target.value)}
                      placeholder="Seu nome"
                      className="h-11 border-transparent bg-slate-100 shadow-none focus:border-[#3e1f63] focus:bg-transparent focus:ring-0 focus-visible:ring-0 lg:h-10"
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
                      className="h-11 border-transparent bg-slate-100 shadow-none focus:border-[#3e1f63] focus:bg-transparent focus:ring-0 focus-visible:ring-0 lg:h-10"
                    />
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="public-map-buyer-document">CPF ou CNPJ</Label>
                    <Input
                      id="public-map-buyer-document"
                      value={buyerDocument}
                      onChange={(event) => setBuyerDocument(formatCpfCnpjBR(event.target.value))}
                      placeholder="000.000.000-00"
                      className="h-11 border-transparent bg-slate-100 shadow-none focus:border-[#3e1f63] focus:bg-transparent focus:ring-0 focus-visible:ring-0 lg:h-10"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="public-map-buyer-phone">Número (Whatsapp)</Label>
                    <Input
                      id="public-map-buyer-phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      value={buyerPhone}
                      onChange={(event) => setBuyerPhone(formatPhoneBR(event.target.value))}
                      placeholder="(00) 00000-0000"
                      className="h-11 border-transparent bg-slate-100 shadow-none focus:border-[#3e1f63] focus:bg-transparent focus:ring-0 focus-visible:ring-0 lg:h-10"
                    />
                  </div>
                </div>

                <div className="hidden gap-2 border-t border-slate-200 pt-4 lg:flex">
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-1/3 border-0 bg-slate-100 text-slate-700 shadow-none hover:bg-slate-200 hover:text-slate-900 lg:h-10"
                    onClick={() => setStep('SELECTION')}
                  >
                    Voltar
                  </Button>
                  <Button
                    type="button"
                    className="w-2/3 bg-brand-accent text-white hover:bg-brand-accent/90 lg:h-10"
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
            <section className="border-0 bg-transparent p-4 shadow-none lg:flex lg:min-h-[416px] lg:flex-col lg:rounded-xl lg:border-0 lg:bg-white lg:p-6 lg:shadow-none">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950 lg:text-xl">Como deseja pagar?</h2>
                  <p className="mt-1 text-sm leading-5 text-slate-600">Escolha uma opção para finalizar sua compra.</p>
                </div>
                <div
                  className="hidden shrink-0 items-center gap-2 py-0.5 lg:flex"
                  role="group"
                  aria-label={`Etapa ${stepIndex(step)} de 3: ${stepLabel(step)}`}
                >
                  {[1, 2, 3].map((stepNumber) => (
                    <span
                      key={stepNumber}
                      aria-current={stepNumber === stepIndex(step) ? 'step' : undefined}
                      aria-label={`${stepNumber}. ${stepNumber === 1 ? 'Seleção' : stepNumber === 2 ? 'Identificação' : 'Pagamento'}${stepNumber === stepIndex(step) ? ', etapa atual' : ''}`}
                      className={`block rounded-full transition-[width,height,background-color] duration-200 ${stepNumber === stepIndex(step) ? 'h-2.5 w-2.5 bg-slate-500' : 'h-1.5 w-1.5 bg-slate-200'}`}
                    />
                  ))}
                </div>
              </div>
              <div className="mt-4 hidden border-t border-slate-200 lg:block" aria-hidden="true" />
              <div className="mt-5 lg:flex lg:flex-1 lg:flex-col">
                <div className="space-y-2.5 lg:hidden">
                  {paymentOptions.map((option) => {
                    const Icon = option.icon;
                    const isSelected = paymentMethod === option.value;

                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => setPaymentMethod(option.value)}
                        className={`box-border flex h-16 w-full items-center justify-between rounded-lg border px-3 py-3 text-left transition-colors ${isSelected ? 'alusa-selection-card--selected text-[#2b2634]' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          {option.value !== 'CREDIT_CARD' ? <Icon className="h-5 w-5 shrink-0 text-brand-accent" /> : null}
                          <div className="min-w-0">
                            <strong className="block text-sm text-slate-950">{option.label}</strong>
                            <span className="text-xs text-slate-500">{option.description}</span>
                          </div>
                        </div>
                        {isSelected && <Check className="h-4 w-4" />}
                      </button>
                    );
                  })}
                </div>

                <div role="radiogroup" aria-label="Forma de pagamento" className="hidden space-y-3 lg:block">
                  {paymentOptions.map((option) => {
                    const isSelected = paymentMethod === option.value;

                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        onClick={() => setPaymentMethod(option.value)}
                        className="flex h-8 w-full items-center gap-3 rounded-sm border-0 bg-transparent p-0 text-left text-sm text-slate-900 hover:bg-transparent hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
                      >
                        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${isSelected ? 'border-slate-500' : 'border-slate-300'}`}>
                          {isSelected ? <span className="h-2 w-2 rounded-full bg-slate-500" /> : null}
                        </span>
                        <span className="font-medium">{option.desktopLabel}</span>
                      </button>
                    );
                  })}
                </div>

                {error ? <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

                <div className="hidden rounded-lg bg-slate-50 p-4 text-sm text-slate-600 lg:my-auto lg:block">
                  <p className="leading-5">{paymentMethodInfo.description}</p>
                </div>
              </div>

              <div className="mt-4 hidden gap-2 border-t border-slate-200 pt-4 lg:mt-auto lg:flex">
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-1/3 border-0 bg-slate-100 text-slate-700 shadow-none hover:bg-slate-200 hover:text-slate-900 lg:h-10"
                    onClick={() => setStep('IDENTIFICATION')}
                    disabled={isSubmitting}
                  >
                    Voltar
                  </Button>
                  <Button
                    type="button"
                    className="w-2/3 bg-brand-accent text-white hover:bg-brand-accent/90 lg:h-10"
                    disabled={isSubmitting}
                    onClick={handleCheckout}
                  >
                    {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ticket className="h-4 w-4" />}
                    Confirmar e Reservar
                  </Button>
              </div>
            </section>
          )}

          {step === 'CONFIRMATION' && order && (
            <div className="flex min-h-full flex-col justify-center space-y-4 px-3 py-4 lg:block lg:min-h-0 lg:space-y-4 lg:px-0 lg:py-0">
              {order.status !== 'PAYMENT_PENDING' ? (
              <section
                className={`border-0 bg-transparent p-0 text-center shadow-none lg:rounded-lg lg:border lg:bg-white lg:p-4 lg:text-left lg:shadow-sm ${
                  order.paymentStatus === 'REFUND_DENIED'
                    ? 'lg:border-rose-200'
                    : order.status === 'CONFIRMED'
                    ? 'lg:border-emerald-200'
                    : order.status === 'EXPIRED' || order.status === 'CANCELLED' || order.status === 'REFUNDED'
                      ? 'lg:border-rose-200'
                      : 'lg:border-amber-200'
                }`}
              >
                <div
                  className={`flex items-center justify-center gap-2 lg:justify-start ${
                    order.paymentStatus === 'REFUND_DENIED'
                      ? 'text-rose-700'
                      : order.status === 'CONFIRMED'
                      ? 'text-emerald-700'
                      : order.status === 'EXPIRED' || order.status === 'CANCELLED' || order.status === 'REFUNDED'
                        ? 'text-rose-700'
                        : 'text-amber-700'
                  }`}
                >
                  {order.status === 'CONFIRMED' && ticketsIssued ? null : order.status === 'EXPIRED' || order.status === 'CANCELLED' || order.status === 'REFUNDED' ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : order.paymentStatus === 'REFUND_DENIED' ? (
                    <CircleAlert className="h-5 w-5" />
                  ) : (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  )}
                  <h2 className="text-lg font-semibold lg:text-sm">
                    {order.paymentStatus === 'REFUND_DENIED'
                      ? 'Estorno não concluído'
                    : order.status === 'CONFIRMED' && ticketsIssued
                      ? 'Pagamento confirmado!'
                      : order.refundRequestUrl
                        ? 'Ação necessária para concluir o estorno'
                        : order.status === 'CONFIRMED' && order.ticketFulfillmentLastError?.startsWith('ASSENTOS_INDISPONIVEIS:')
                          ? 'Pagamento confirmado; estorno em andamento'
                      : order.status === 'CONFIRMED'
                        ? ticketFulfillmentNeedsReconciliation
                          ? 'Pagamento confirmado; emissão em análise'
                          : 'Pagamento confirmado; preparando ingressos'
                      : order.status === 'EXPIRED' || order.status === 'CANCELLED' || order.status === 'REFUNDED'
                        ? publicOrderStatusLabel(order.status)
                        : 'Reserva criada!'}
                  </h2>
                </div>
                {order.status !== 'PAYMENT_PENDING' ? (
                  <p className="mt-2 text-sm text-slate-650">
                    {order.status === 'CONFIRMED' && ticketsIssued
                    ? 'Seus ingressos foram emitidos e já podem ser baixados.'
                    : order.paymentStatus === 'REFUND_DENIED'
                      ? 'O Asaas não concluiu o estorno do boleto. Fale com a direção da instituição para acompanhar a devolução. Não é necessário realizar uma nova compra.'
                    : order.refundRequestUrl
                      ? 'Os assentos já não estavam disponíveis quando o pagamento foi confirmado. Para receber o valor do boleto, informe seus dados na página segura do Asaas. Nenhum ingresso foi emitido.'
                    : order.status === 'CONFIRMED' && order.ticketFulfillmentLastError?.startsWith('ASSENTOS_INDISPONIVEIS:')
                      ? 'Os assentos já não estavam disponíveis quando o pagamento foi confirmado. O estorno está sendo iniciado; não faça uma nova compra enquanto ele é processado.'
                    : order.status === 'REFUNDED'
                      ? 'O estorno foi confirmado pelo Asaas. Nenhum ingresso foi emitido para este pedido.'
                    : order.status === 'CONFIRMED'
                      ? ticketFulfillmentNeedsReconciliation
                        ? 'O pagamento foi confirmado e o pedido está em reconciliação automática. Não é necessário realizar uma nova compra.'
                        : 'A emissão dos ingressos está sendo processada automaticamente. Esta página será atualizada quando estiver concluída.'
                    : order.status === 'EXPIRED' || order.status === 'CANCELLED'
                      ? 'Esta reserva não está mais disponível. Selecione novos assentos no mapa.'
                      : null}
                  </p>
                ) : null}
                {order.refundRequestUrl ? (
                  <Button asChild className="mt-3 w-full bg-brand-accent text-white hover:bg-brand-accent/90">
                    <a href={order.refundRequestUrl} target="_blank" rel="noreferrer">
                      Informar dados para o estorno
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                ) : null}
                {ticketsIssued && order.ticketsUrl ? (
                  <div className="mt-3 hidden flex-col gap-2 lg:flex">
                    <Button asChild className="w-full bg-emerald-700 text-white hover:bg-emerald-800">
                      <a href={order.ticketsUrl} target="_blank" rel="noreferrer">
                        <Ticket className="h-4 w-4" />
                        Ver ingressos
                      </a>
                    </Button>
                  </div>
                ) : null}
              </section>
              ) : null}

              {pollTimedOut && order.status === 'PAYMENT_PENDING' ? (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-center text-sm text-slate-600">
                  A confirmação está demorando. Se você já pagou, use &quot;Já paguei&quot; abaixo.
                </p>
              ) : null}

              {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

              {order.status === 'PAYMENT_PENDING' && paymentMethod === 'CREDIT_CARD' ? (
                <section className="mx-auto w-full max-w-[448px] space-y-5 px-1 py-3 lg:px-0">
                  <div>
                    <h2 className="text-lg font-semibold leading-7 text-slate-950">
                      Precisa de ajuda?<br />Veja como pagar com cartão
                    </h2>
                    <p className="mt-2 text-sm leading-5 text-slate-600">
                      {order.invoiceUrl
                        ? 'Conclua o pagamento na página segura da cobrança.'
                        : 'A cobrança do cartão está sendo preparada. Esta página será atualizada assim que estiver pronta.'}
                    </p>
                  </div>
                  {order.invoiceUrl ? (
                    <ol className="space-y-4">
                      {[
                        'Abra a cobrança pelo botão abaixo.',
                        'Informe os dados do cartão e confirme o pagamento.',
                        'Volte para esta página. A confirmação é automática e seus ingressos serão emitidos.',
                      ].map((instruction, index) => (
                        <li key={instruction} className="flex items-center gap-3 text-sm leading-5 text-slate-600">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
                            {index + 1}
                          </span>
                          <span>{instruction}</span>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                  {order.expiresAt ? (
                    <PublicOrderReservationCountdown
                      expiresAt={order.expiresAt}
                      className="text-left text-sm font-semibold"
                      tone="danger"
                    />
                  ) : null}
                </section>
              ) : null}

              {order.status === 'PAYMENT_PENDING' && paymentMethod === 'BOLETO' ? (
                <div className="lg:grid lg:grid-cols-[minmax(0,520px)_minmax(320px,400px)] lg:items-stretch lg:gap-6">
                  <section className="mx-auto hidden w-full max-w-[520px] space-y-3 p-4 text-center lg:flex lg:flex-col lg:justify-center">
                    <h2 className="text-lg font-semibold text-slate-950">
                      {order.bankSlipCode ? 'Aponte a câmera para o código de barras' : 'Estamos preparando seu boleto'}
                    </h2>
                    {order.bankSlipCode ? (
                      <>
                        {bankSlipBarcodeSvg ? (
                          <img
                            src={`data:image/svg+xml,${encodeURIComponent(bankSlipBarcodeSvg)}`}
                            alt="Código de barras do boleto"
                            className="mx-auto h-auto w-full max-w-[488px] object-contain"
                          />
                        ) : null}
                        <div className="relative mx-auto w-[91.2%] text-left">
                          <Input
                            id="boleto-copia-cola-desktop"
                            aria-label="Código do boleto"
                            readOnly
                            value={order.bankSlipCode}
                            className="select-all truncate border-transparent bg-slate-100 pr-11 font-mono text-[11px] shadow-none focus-visible:border-slate-500 focus-visible:bg-white focus-visible:ring-0 focus-visible:ring-offset-0"
                          />
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label={copied ? 'Código do boleto copiado' : 'Copiar código do boleto'}
                            className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 border-0 bg-transparent shadow-none hover:bg-slate-200/70"
                            onClick={() => copyPaymentCode(order.bankSlipCode!)}
                          >
                            {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                          </Button>
                        </div>
                      </>
                    ) : null}
                    {!order.bankSlipCode ? (
                      <p className="text-sm leading-5 text-slate-600">
                        A cobrança será exibida aqui assim que estiver pronta.
                      </p>
                    ) : null}
                  </section>

                  <section className="mx-auto flex min-h-full w-full max-w-none min-w-0 flex-col justify-center py-3 text-left lg:p-6">
                    <h3 className="text-lg font-semibold text-slate-950">
                      Precisa de ajuda?<br />Veja como pagar com boleto
                    </h3>
                    {order.bankSlipCode ? (
                      <ol className="mt-5 space-y-4">
                        {[
                          'Use a linha digitável ou pague pelo app do seu banco com o código de barras.',
                          'Confirme o pagamento pelo aplicativo do seu banco ou internet banking.',
                          'A compensação pode levar até 1 dia útil.',
                          'Após a confirmação, seus ingressos serão emitidos automaticamente.',
                        ].map((instruction, index) => (
                          <li key={instruction} className={`flex gap-3 text-sm leading-5 text-slate-600 ${index === 0 ? 'items-start' : 'items-center'}`}>
                            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700 ${index === 0 ? 'mt-0.5' : ''}`}>
                              {index + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <span>{instruction}</span>
                              {index === 0 ? (
                                <div className="relative mt-2 -ml-9 w-[calc(100%+2.25rem)] lg:hidden">
                                  <Input
                                    id="boleto-copia-cola-mobile"
                                    aria-label="Código do boleto"
                                    readOnly
                                    value={order.bankSlipCode ?? ''}
                                    className="select-all truncate border-transparent bg-slate-100 pr-11 font-mono text-[11px] shadow-none focus-visible:border-slate-500 focus-visible:bg-white focus-visible:ring-0 focus-visible:ring-offset-0"
                                  />
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    aria-label={copied ? 'Código do boleto copiado' : 'Copiar código do boleto'}
                                    className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 border-0 bg-transparent shadow-none hover:bg-slate-200/70"
                                    onClick={() => copyPaymentCode(order.bankSlipCode!)}
                                  >
                                    {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                                  </Button>
                                </div>
                              ) : null}
                            </div>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="mt-3 text-sm leading-5 text-slate-600">
                        Assim que a cobrança estiver disponível, você poderá abrir o boleto nesta página para concluir o pagamento.
                      </p>
                    )}
                    <div className="mt-5 lg:mt-auto lg:space-y-3 lg:pt-6">
                      <div className="hidden space-y-2 lg:block">
                        {order.invoiceUrl ? (
                          <Button asChild className="w-full bg-brand-accent text-white hover:bg-brand-accent/90 lg:h-10">
                            <a href={order.invoiceUrl} target="_blank" rel="noreferrer">
                              Ver cobrança
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          className="w-full justify-center border-0 bg-slate-200 text-slate-700 shadow-none hover:bg-slate-300 hover:text-slate-900 lg:h-10"
                          disabled={isSyncingPayment}
                          onClick={handleSyncPayment}
                        >
                          {isSyncingPayment ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                          Já paguei
                        </Button>
                      </div>
                    </div>
                  </section>
                </div>
              ) : null}

              {order.status !== 'CONFIRMED' &&
              order.status !== 'EXPIRED' &&
              order.status !== 'CANCELLED' &&
              order.status !== 'REFUNDED' &&
              paymentMethod === 'PIX' &&
              order.pixQrCode ? (
                <div className="lg:grid lg:grid-cols-[minmax(0,416px)_minmax(280px,320px)] lg:items-stretch lg:gap-6">
                  <section className="mx-auto w-full max-w-[360px] space-y-3 rounded-xl border-0 bg-white p-4 text-center shadow-none lg:max-w-[392px]">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-950">Aponte a câmera do seu celular</h3>
                      <p className="mt-1 text-sm text-slate-600">
                        Escaneie o QR code pelo app do seu banco para concluir o pagamento.
                      </p>
                    </div>
                    <div className="mx-auto flex max-w-[224px] justify-center rounded-lg bg-white p-2">
                      <img
                        src={`data:image/png;base64,${order.pixQrCode.encodedImage}`}
                        alt="QR Code Pix"
                        className="h-52 w-52"
                      />
                    </div>

                    <div className="text-left space-y-1.5">
                      <Label htmlFor="pix-copia-cola" className="text-xs text-slate-500">Código Copia e Cola</Label>
                      <div className="relative">
                        <Input
                          id="pix-copia-cola"
                          readOnly
                          value={order.pixQrCode.payload}
                          className="select-all truncate border-transparent bg-slate-100 pr-11 font-mono text-xs shadow-none focus-visible:border-slate-500 focus-visible:bg-white focus-visible:ring-0 focus-visible:ring-offset-0"
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={copied ? 'Código Pix copiado' : 'Copiar código Pix'}
                          className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 border-0 bg-transparent shadow-none hover:bg-slate-200/70"
                          onClick={() => copyPaymentCode(order.pixQrCode!.payload)}
                        >
                          {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                  </section>

                  {order.status === 'PAYMENT_PENDING' ? (
                    <section className="hidden min-w-0 flex-col p-6 text-left lg:flex">
                      <h3 className="text-lg font-semibold text-slate-950">
                        Precisa de ajuda?<br />Veja como pagar com Pix
                      </h3>
                      <ol className="mt-5 space-y-4">
                        {[
                          'Abra o aplicativo do seu banco.',
                          'Acesse Pix e escolha pagar com QR Code.',
                          'Aponte a câmera para o código ao lado ou copie e cole o código Pix.',
                          'Após o pagamento, a confirmação é automática e seus ingressos serão emitidos.',
                        ].map((instruction, index) => (
                          <li key={instruction} className="flex items-center gap-3 text-sm leading-5 text-slate-600">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
                              {index + 1}
                            </span>
                            <span>{instruction}</span>
                          </li>
                        ))}
                      </ol>
                      <div className="mt-auto space-y-3 pt-6">
                        <div className="flex items-center justify-between gap-3">
                          <button
                            type="button"
                            className="inline-flex h-auto w-fit items-center gap-2 border-0 bg-transparent p-0 text-left text-sm text-slate-600 shadow-none hover:bg-transparent hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={isSyncingPayment}
                            onClick={handleSyncPayment}
                          >
                            {isSyncingPayment ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                            Já paguei
                          </button>
                          <PublicOrderReservationCountdown
                            expiresAt={order.expiresAt}
                            className="shrink-0 text-right text-sm font-semibold"
                            tone="danger"
                          />
                        </div>
                      </div>
                    </section>
                  ) : null}
                </div>
              ) : null}

              {order.status === 'PAYMENT_PENDING' && paymentMethod === 'PIX' && !order.pixQrCode ? (
                <div className="w-full rounded-lg bg-slate-50 p-4 text-center text-sm leading-5 text-slate-600 shadow-none lg:mx-auto lg:max-w-sm">
                  Não foi possível carregar o QR Code agora. Você ainda pode abrir a cobrança ou verificar o pagamento.
                </div>
              ) : null}

              {order.status === 'PAYMENT_PENDING' && paymentMethod === 'PIX' ? (
                <PublicOrderReservationCountdown
                  expiresAt={order.expiresAt}
                  className={`text-center text-sm font-semibold ${paymentMethod === 'PIX' && order.pixQrCode ? 'lg:hidden' : ''}`}
                  tone="danger"
                />
              ) : null}

              {order.status === 'PAYMENT_PENDING' && paymentMethod !== 'BOLETO' && (paymentMethod !== 'PIX' || !order.pixQrCode) ? (
                <div className="hidden w-full space-y-2 lg:mx-auto lg:block lg:max-w-[448px]">
                  {order.invoiceUrl ? (
                    <Button asChild className="w-full bg-brand-accent text-white hover:bg-brand-accent/90 lg:h-10">
                      <a href={order.invoiceUrl} target="_blank" rel="noreferrer">
                        Ver cobrança
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full justify-center border-0 bg-slate-200 text-slate-700 shadow-none hover:bg-slate-300 hover:text-slate-900 lg:h-10"
                    disabled={isSyncingPayment}
                    onClick={handleSyncPayment}
                  >
                    {isSyncingPayment ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    Já paguei
                  </Button>
                </div>
              ) : null}

              {order.status === 'CONFIRMED' ? (
                <section className="rounded-xl border border-slate-200 bg-white p-4">
                  <h3 className="text-sm font-semibold text-slate-950">Ingressos emitidos</h3>
                  <div className="mt-3 space-y-2">
                    {order.items.map((item) => (
                      <div
                        key={`${item.sectionName}-${item.seatLabel}`}
                        className="flex items-center justify-between border-b border-slate-100 py-2 text-sm last:border-0"
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
                <Button type="button" className="hidden w-full bg-brand-accent text-white lg:flex" onClick={resetCheckoutFlow}>
                  Nova compra no mapa
                </Button>
              ) : null}
            </div>
          )}
        </aside>
      </div>

    </main>

      {isPublicFlow && step === 'CONFIRMATION' && order?.status === 'PAYMENT_PENDING' && paymentMethod === 'BOLETO' && order.expiresAt ? (
        <div className="w-full shrink-0 px-4 py-3 text-center">
          <PublicOrderReservationCountdown
            expiresAt={order.expiresAt}
            className="text-center text-sm font-semibold"
            tone="danger"
          />
        </div>
      ) : null}

      {isPublicFlow && step === 'CONFIRMATION' && order ? (
        <footer className="hidden w-full shrink-0 justify-center px-4 pb-4 text-center text-sm text-slate-600 lg:flex">
          Precisa de ajuda com o pagamento? Fale com a direção da instituição.
        </footer>
      ) : null}

      {isPublicFlow && (step === 'IDENTIFICATION' || step === 'PAYMENT_METHOD' || (step === 'CONFIRMATION' && order)) ? (
        <div className="relative z-30 w-full shrink-0 border-t border-slate-200 bg-white/95 px-3 py-3 backdrop-blur-sm pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] lg:hidden">
          <div className="mx-auto flex max-w-7xl flex-col gap-2">
            {step !== 'CONFIRMATION' ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">Total da compra</span>
                  <strong className="text-base text-slate-950">{formatCurrency(total)}</strong>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-1/3 bg-slate-100 text-slate-700 hover:bg-slate-200 hover:text-slate-900"
                    onClick={() => setStep(step === 'IDENTIFICATION' ? 'SELECTION' : 'IDENTIFICATION')}
                    disabled={step === 'PAYMENT_METHOD' && isSubmitting}
                  >
                    Voltar
                  </Button>
                  {step === 'IDENTIFICATION' ? (
                    <Button
                      type="button"
                      className="w-2/3 bg-brand-accent text-white hover:bg-brand-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={!isIdentificationValid}
                      onClick={() => setStep('PAYMENT_METHOD')}
                    >
                      Avançar
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      className="w-2/3 bg-brand-accent text-white hover:bg-brand-accent/90"
                      disabled={isSubmitting}
                      onClick={handleCheckout}
                    >
                      {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ticket className="h-4 w-4" />}
                      Confirmar e Reservar
                    </Button>
                  )}
                </div>
              </>
            ) : order && ticketsIssued && order.ticketsUrl ? (
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="w-1/2" onClick={resetCheckoutFlow}>
                  <MapPin className="h-4 w-4" />
                  Ver mapa
                </Button>
                <Button asChild className="w-1/2 bg-emerald-700 text-white hover:bg-emerald-800">
                  <a href={order.ticketsUrl} target="_blank" rel="noreferrer">
                    <Ticket className="h-4 w-4" />
                    Ver ingressos
                  </a>
                </Button>
              </div>
            ) : order?.status === 'PAYMENT_PENDING' ? (
              <>
                {order.invoiceUrl && (paymentMethod !== 'PIX' || !order.pixQrCode) ? (
                  <Button asChild className="w-full bg-brand-accent text-white hover:bg-brand-accent/90">
                    <a href={order.invoiceUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-4 w-4" />
                      Ir para o pagamento
                    </a>
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full justify-center border-0 bg-slate-100 text-slate-700 shadow-none hover:bg-slate-200 hover:text-slate-900"
                  disabled={isSyncingPayment}
                  onClick={handleSyncPayment}
                >
                  {isSyncingPayment ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Já paguei, verificar agora
                </Button>
              </>
            ) : order && (order.status === 'EXPIRED' || order.status === 'CANCELLED' || order.status === 'REFUNDED') ? (
              <Button type="button" className="w-full bg-brand-accent text-white" onClick={resetCheckoutFlow}>
                Nova compra no mapa
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {isPublicSelectionView ? (
        <div className="relative z-30 w-full shrink-0 border-t border-slate-200 bg-white/95 px-3 py-3 backdrop-blur-sm pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] lg:hidden">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-slate-500">
                {selectedSeats.length} {selectedSeats.length === 1 ? 'assento' : 'assentos'}
              </p>
              <p className="text-lg font-semibold text-slate-950">{formatCurrency(total)}</p>
            </div>
            <Button
              type="button"
              className="shrink-0 bg-brand-accent px-5 text-white hover:bg-brand-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={selectedSeats.length === 0}
              onClick={() => setStep('IDENTIFICATION')}
            >
              Continuar
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
