'use client';

import type { PublicMapViewModel } from './public-map-adapter';

import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, ExternalLink, Loader2, MapPin, ShoppingCart, Ticket, Check, Copy, CreditCard, QrCode, User } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { findCEP } from '@/lib/cep';
import { formatCepBR, formatCpfCnpjBR, isValidCepBR, isValidCpfCnpjBR, onlyDigits } from '@/lib/formatters';

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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<{
    orderId: string;
    accessToken: string;
    ticketsUrl: string | null;
    invoiceUrl: string | null;
    status: string;
    expiresAt: string;
    statusUrl?: string | null;
    items: Array<{ ticketCode: string; seatLabel: string; sectionName: string }>;
    pixQrCode: { encodedImage: string; payload: string; expirationDate: string } | null;
  } | null>(null);

  const level = ((map.levels as PublicLevel[])[0] ?? { widthPx: 1440, heightPx: 900 }) as PublicLevel;
  const objects = (map.objects as PublicObject[]).filter((object) => !object.hidden);
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

    async function pollStatus() {
      try {
        const status = await parseApiResponse<{
          orderId: string;
          ticketsUrl: string | null;
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
              <section className={`rounded-lg border bg-white p-4 shadow-sm ${order.status === 'CONFIRMED' ? 'border-emerald-200' : 'border-amber-200'}`}>
                <div className={`flex items-center gap-2 ${order.status === 'CONFIRMED' ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {order.status === 'CONFIRMED' ? <CheckCircle2 className="h-5 w-5" /> : <Loader2 className="h-5 w-5 animate-spin" />}
                  <h2 className="text-sm font-semibold">{order.status === 'CONFIRMED' ? 'Pagamento confirmado!' : 'Reserva criada!'}</h2>
                </div>
                <p className="mt-2 text-sm text-slate-650">
                  {order.status === 'CONFIRMED'
                    ? 'Seus ingressos foram emitidos e já podem ser baixados.'
                    : 'Seus assentos ficam reservados até:'}
                </p>
                {order.status === 'CONFIRMED' && order.ticketsUrl ? (
                  <Button asChild className="mt-3 w-full bg-emerald-700 text-white hover:bg-emerald-800">
                    <a href={order.ticketsUrl} target="_blank" rel="noreferrer">
                      <Ticket className="h-4 w-4" />
                      Baixar ingressos
                    </a>
                  </Button>
                ) : (
                  <div className="mt-2 rounded-lg bg-slate-50 p-3 text-center border border-slate-100">
                    <strong className="block text-sm text-slate-900">{formatDate(order.expiresAt)}</strong>
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Realize o pagamento para garantir seus ingressos</span>
                  </div>
                )}
              </section>

              {order.status !== 'CONFIRMED' && paymentMethod === 'PIX' && order.pixQrCode ? (
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
              ) : order.status !== 'CONFIRMED' ? (
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
                </section>
              ) : null}

              {order.status === 'CONFIRMED' ? (
                <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <h3 className="text-sm font-semibold text-slate-950">Ingressos emitidos</h3>
                  <div className="mt-3 space-y-2">
                    {order.items.map((item) => (
                      <div key={`${item.sectionName}-${item.seatLabel}`} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm">
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
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
