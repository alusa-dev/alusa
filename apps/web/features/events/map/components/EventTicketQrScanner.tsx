'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle, ErrorCircle, Loader2, QrCode } from '@/components/icons/icons';
import { Button } from '@/components/ui/button';
import { getEvent } from '../../events-service';

type TicketInfo = {
  ticketCode: string;
  status: string;
  usedAt: string | null;
  buyerName?: string;
  order?: { buyerName: string } | null;
  sale?: { buyerName: string } | null;
  seat: { sectionName: string; seatLabel: string } | null;
};
type VerifyResponse = { ticket: TicketInfo; ok?: true; alreadyUsed?: boolean };
type Props = { eventId: string; accessToken?: never } | { eventId?: never; accessToken: string };

async function parseResponse<T>(response: Response): Promise<T> {
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (json as { error?: { message?: string } } | null)?.error?.message;
    throw new Error(message ?? 'Não foi possível validar o ingresso.');
  }
  return (json as { data: T }).data;
}

function normalizeCode(value: string | undefined) {
  return value?.trim().toUpperCase() ?? '';
}

function localizedDomainMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  const message = error.message.trim();
  const portugueseTerms = /ingresso|evento|utilizad|inválid|invalido|invalida|não|nao|permiss|acesso|conta|confirma|check-in|código|codigo|pagamento|pedido|encontrad|válid|valido|disponível|disponivel/i;
  return portugueseTerms.test(message) ? message : fallback;
}

function cameraErrorMessage(error: unknown) {
  const name = error && typeof error === 'object' && 'name' in error && typeof error.name === 'string'
    ? error.name
    : '';
  const message = error instanceof Error ? error.message.toLowerCase() : '';

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || /permission|denied/.test(message)) {
    return 'Permissão da câmera negada. Libere o acesso nas configurações do navegador ou selecione uma imagem.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError' || /device not found|no camera/.test(message)) {
    return 'Nenhuma câmera disponível foi encontrada neste dispositivo. Você pode selecionar uma imagem do ingresso.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'A câmera está indisponível ou sendo usada por outro aplicativo. Feche os outros aplicativos que a utilizam ou selecione uma imagem.';
  }
  if (name === 'SecurityError' || !window.isSecureContext || /secure|https/.test(message)) {
    return 'A câmera exige uma conexão segura (HTTPS). Você pode selecionar uma imagem do ingresso.';
  }
  if (name === 'TypeError' || !navigator.mediaDevices?.getUserMedia) {
    return 'Este navegador não oferece suporte à câmera. Você pode selecionar uma imagem do ingresso.';
  }
  return 'Não foi possível iniciar a câmera. Verifique as permissões do navegador ou selecione uma imagem do ingresso.';
}

export function EventTicketQrScanner({ eventId, accessToken }: Props) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const handledRef = useRef(false);
  const verificationInFlightRef = useRef(false);
  const confirmationInFlightRef = useRef(false);
  const imageReadInFlightRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [eventName, setEventName] = useState<string | null>(null);
  const [operatorName, setOperatorName] = useState<string | null>(null);
  const [gateName, setGateName] = useState<string | null>(null);
  const [eventLoading, setEventLoading] = useState(true);
  const [eventError, setEventError] = useState('');
  const [cameraState, setCameraState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [cameraMessage, setCameraMessage] = useState('Preparando a câmera…');
  const [ticketCode, setTicketCode] = useState('');
  const [ticket, setTicket] = useState<TicketInfo | null>(null);
  const [verifyError, setVerifyError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [cameraRetryKey, setCameraRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    const loadEvent = accessToken
      ? fetch(`/api/public/event-ticket-check-in/${encodeURIComponent(accessToken)}`, { cache: 'no-store' })
        .then((response) => parseResponse<{ event: { name: string }; operatorName: string; gateName: string }>(response))
        .then((result) => {
          if (!active) return;
          setEventName(result.event.name);
          setOperatorName(result.operatorName);
          setGateName(result.gateName);
        })
      : eventId
        ? getEvent(eventId).then((result) => {
            if (!active) return;
            setEventName(result.name);
          })
        : Promise.reject(new Error('Evento não informado.'));
    void loadEvent.catch((error: unknown) => {
      if (active) setEventError(localizedDomainMessage(error, 'Não foi possível carregar o evento ou validar o acesso do leitor.'));
    }).finally(() => { if (active) setEventLoading(false); });
    return () => { active = false; };
  }, [accessToken, eventId]);

  const stopCamera = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const videoStream = videoRef.current?.srcObject;
    if (videoStream instanceof MediaStream) videoStream.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const verifyCode = useCallback(async (rawCode: string) => {
    const code = normalizeCode(rawCode);
    if (!code || verificationInFlightRef.current) return;
    verificationInFlightRef.current = true;
    handledRef.current = true;
    stopCamera();
    setTicketCode(code);
    setTicket(null);
    setVerifyError('');
    setVerifying(true);
    try {
      const verifyUrl = accessToken
        ? `/api/public/event-ticket-check-in/${encodeURIComponent(accessToken)}`
        : `/api/events/${eventId}/public-orders/verify-ticket`;
      const data = await parseResponse<VerifyResponse>(await fetch(verifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketCode: code, confirm: false }),
      }));
      setTicket(data.ticket);
    } catch (error) {
      setVerifyError(localizedDomainMessage(error, 'Ingresso inválido ou não foi possível validá-lo.'));
    } finally {
      verificationInFlightRef.current = false;
      setVerifying(false);
    }
  }, [accessToken, eventId, stopCamera]);

  useEffect(() => {
    if (eventLoading || !eventName || eventError || ticket || verifying || verifyError) return;
    let cancelled = false;
    setCameraState('loading');
    setCameraMessage('Preparando a câmera…');
    void (async () => {
      try {
        if (!window.isSecureContext) throw new Error('secure context required');
        if (!navigator.mediaDevices?.getUserMedia) throw new TypeError('camera unavailable');
        const { BrowserQRCodeReader } = await import('@zxing/browser');
        if (cancelled || !videoRef.current) return;
        const controls = await new BrowserQRCodeReader().decodeFromVideoDevice(undefined, videoRef.current, (result) => {
          if (!result || cancelled || handledRef.current) return;
          const code = normalizeCode(result.getText());
          if (code) void verifyCode(code);
        });
        if (cancelled) { controls.stop(); return; }
        controlsRef.current = controls;
        streamRef.current = videoRef.current.srcObject instanceof MediaStream ? videoRef.current.srcObject : null;
        setCameraState('ready');
        setCameraMessage('Aponte a câmera para o QR Code do ingresso.');
      } catch (error) {
        if (cancelled) return;
        setCameraState('error');
        setCameraMessage(cameraErrorMessage(error));
      }
    })();
    return () => { cancelled = true; stopCamera(); };
  }, [eventName, eventError, eventLoading, ticket, verifying, verifyError, cameraRetryKey, verifyCode, stopCamera]);

  const readImage = async (file: File | undefined) => {
    if (!file || imageReadInFlightRef.current || verificationInFlightRef.current || confirmationInFlightRef.current) return;
    imageReadInFlightRef.current = true;
    handledRef.current = true;
    stopCamera();
    setImageBusy(true);
    setVerifyError('');
    try {
      const { BrowserQRCodeReader } = await import('@zxing/browser');
      const image = new Image();
      const url = URL.createObjectURL(file);
      let code: string;
      try {
        image.src = url;
        await image.decode();
        code = normalizeCode((await new BrowserQRCodeReader().decodeFromImageElement(image)).getText());
      } finally { URL.revokeObjectURL(url); }
      if (!code) throw new Error('Não foi possível encontrar um QR Code legível nessa imagem.');
      await verifyCode(code);
    } catch (error) {
      setVerifyError(localizedDomainMessage(error, 'Não foi possível ler o QR Code dessa imagem. Selecione outra imagem ou use a câmera.'));
      setCameraState('error');
    } finally {
      imageReadInFlightRef.current = false;
      setImageBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const confirmCheckIn = async () => {
    if (!ticket || ticket.status !== 'VALID' || confirmationInFlightRef.current) return;
    confirmationInFlightRef.current = true;
    setConfirming(true);
    setVerifyError('');
    try {
      const verifyUrl = accessToken
        ? `/api/public/event-ticket-check-in/${encodeURIComponent(accessToken)}`
        : `/api/events/${eventId}/public-orders/verify-ticket`;
      const data = await parseResponse<VerifyResponse>(await fetch(verifyUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketCode, confirm: true }),
      }));
      setTicket(data.ticket);
      setVerifyError(data.alreadyUsed ? 'A entrada já havia sido registrada.' : 'Entrada registrada com sucesso.');
    } catch (error) {
      setVerifyError(localizedDomainMessage(error, 'Não foi possível confirmar o check-in. Tente novamente.'));
    } finally {
      confirmationInFlightRef.current = false;
      setConfirming(false);
    }
  };

  const scanNext = () => {
    handledRef.current = false;
    setTicket(null);
    setTicketCode('');
    setVerifyError('');
    setCameraState('loading');
  };

  const retryCamera = () => {
    setVerifyError('');
    setCameraState('loading');
    setCameraRetryKey((key) => key + 1);
  };

  return (
    <main className="fixed inset-0 z-[100] flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-slate-950 text-white" aria-label="Leitor de QR Code">
      {eventLoading ? (
        <div className="flex h-full items-center justify-center gap-3" role="status"><Loader2 className="h-6 w-6 animate-spin" />Carregando evento…</div>
      ) : eventError || !eventName ? (
        <div className="m-auto max-w-md p-6 text-center"><p className="text-lg font-semibold">Não foi possível abrir o leitor</p><p className="mt-2 text-sm text-slate-300">{eventError || 'Evento não encontrado ou sem acesso na conta atual.'}</p>{eventId ? <Button className="mt-6" onClick={() => router.push(`/events/${eventId}`)}>Voltar ao evento</Button> : null}</div>
      ) : (
        <>
          <video ref={videoRef} autoPlay muted playsInline className="absolute inset-0 h-full w-full object-cover" aria-label="Prévia da câmera para leitura do QR Code" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/70 via-black/15 to-black/80" />
          <header className="relative z-10 flex items-center gap-3 px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-7">
            {eventId ? <Button type="button" variant="ghost" className="h-11 w-11 shrink-0 rounded-full bg-white/10 p-0 text-white hover:bg-white/20 hover:text-white" aria-label="Voltar ao evento" onClick={() => router.push(`/events/${eventId}`)}><ArrowLeft className="h-5 w-5" /></Button> : <div className="h-11 w-11 shrink-0" />}
            <div className="min-w-0"><h1 className="text-lg font-semibold">Ler ingresso</h1><p className="truncate text-sm text-white/80">{eventName}</p>{operatorName && gateName ? <p className="truncate text-xs text-white/75">{operatorName} · {gateName}</p> : null}</div>
          </header>
          <section className="relative z-10 flex flex-1 flex-col items-center justify-center gap-5 px-5 pb-5" aria-live="polite" aria-busy={verifying || confirming || imageBusy}>
            {confirming ? (
              <div className="rounded-2xl border border-white/60 bg-white/95 px-7 py-6 text-center text-slate-900 shadow-xl" role="status" aria-live="assertive">
                <Loader2 className="mx-auto h-8 w-8 animate-spin text-[#512a82]" />
                <p className="mt-3 text-base font-semibold">Confirmando entrada…</p>
                <p className="mt-1 text-sm text-slate-600">Aguarde enquanto registramos a entrada.</p>
              </div>
            ) : ticket ? (
              <div className="w-full max-w-md rounded-2xl border border-white/70 bg-white p-5 text-slate-900 shadow-2xl sm:p-6">
                <div className="flex items-center gap-3"><div className={`rounded-full p-2 ${ticket.status === 'VALID' ? 'bg-emerald-50 text-emerald-700' : ticket.status === 'USED' ? 'bg-violet-50 text-violet-700' : 'bg-rose-50 text-rose-700'}`}>{ticket.status === 'VALID' ? <CheckCircle className="h-6 w-6" /> : <ErrorCircle className="h-6 w-6" />}</div><div className="min-w-0"><h2 className="text-lg font-semibold">{ticket.status === 'VALID' ? 'Ingresso válido' : ticket.status === 'USED' ? 'Entrada já registrada' : 'Ingresso indisponível'}</h2><p className="text-sm text-slate-500">Confira os dados antes de registrar a entrada.</p></div></div>
                <dl className="mt-5 space-y-3 border-t border-slate-200 pt-4 text-sm">
                  <ResultRow label="Evento" value={eventName} />
                  <ResultRow label="Participante" value={ticket.buyerName ?? ticket.order?.buyerName ?? ticket.sale?.buyerName ?? 'Não identificado'} />
                  <ResultRow label="Assento" value={ticket.seat ? `${ticket.seat.sectionName} · ${ticket.seat.seatLabel}` : 'Ingresso sem assento numerado'} />
                  <ResultRow label="Código" value={ticket.ticketCode} />
                  {ticket.usedAt ? <ResultRow label="Entrada registrada em" value={formatTicketDate(ticket.usedAt)} /> : null}
                </dl>
                {verifyError ? <p role="status" className={`mt-4 text-center text-sm ${ticket.status === 'VALID' && verifyError.startsWith('Entrada registrada') ? 'text-emerald-700' : 'text-violet-700'}`}>{verifyError}</p> : null}
                <div className="mt-5 grid gap-2">
                  {ticket.status === 'VALID' ? <Button type="button" className="h-11 rounded-xl bg-[#512a82] text-white hover:bg-[#43216d]" disabled={confirming} onClick={() => void confirmCheckIn()}>{confirming ? <><Loader2 className="h-4 w-4 animate-spin" />Registrando…</> : 'Registrar entrada'}</Button> : null}
                  <Button type="button" variant="ghost" className="h-11 rounded-xl text-[#512a82] hover:bg-violet-50 hover:text-[#512a82]" onClick={scanNext}>Ler outro ingresso</Button>
                </div>
              </div>
            ) : verifying || imageBusy ? (
              <div className="rounded-2xl border border-white/60 bg-white/95 px-7 py-6 text-center text-slate-900 shadow-xl" role="status" aria-live="assertive">
                <Loader2 className="mx-auto h-8 w-8 animate-spin text-[#512a82]" />
                <p className="mt-3 text-base font-semibold">{verifying ? 'Verificando ingresso…' : 'Lendo QR Code…'}</p>
                <p className="mt-1 text-sm text-slate-600">{verifying ? 'Aguarde enquanto conferimos os dados do ingresso.' : 'Estamos identificando o código da imagem.'}</p>
              </div>
            ) : verifyError ? (
              <div className="w-full max-w-md rounded-2xl border border-white/70 bg-white p-6 text-center text-slate-900 shadow-xl">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-700"><ErrorCircle className="h-6 w-6" /></div>
                <h2 className="mt-4 text-lg font-semibold">Ingresso não encontrado</h2>
                <p className="mt-1 text-sm text-slate-500">Não conseguimos confirmar este código agora. Tente novamente.</p>
                <Button type="button" variant="ghost" className="mt-4 h-11 w-full rounded-xl text-[#512a82] hover:bg-violet-50 hover:text-[#512a82]" onClick={scanNext}>Ler novamente</Button>
              </div>
            ) : (
              <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
                <div className="relative flex aspect-square w-[min(72vw,22rem)] items-center justify-center rounded-3xl border-2 border-white/85 shadow-[0_0_0_999px_rgba(2,6,23,0.22)]" aria-hidden="true" />
                <div className="rounded-2xl border border-white/25 bg-slate-950/55 px-5 py-4 backdrop-blur-sm">
                  <h2 className="flex items-center justify-center gap-2 text-base font-semibold">
                    {cameraState === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : cameraState === 'ready' ? <span className="h-2 w-2 rounded-full bg-emerald-400" /> : <ErrorCircle className="h-4 w-4 text-rose-300" />}
                    {cameraState === 'loading' ? 'Preparando câmera…' : cameraState === 'ready' ? 'Lendo QR Code' : 'Câmera indisponível'}
                  </h2>
                  <p className="mt-1 text-sm text-white/85">{cameraState === 'loading' ? 'Aguarde enquanto ativamos a câmera.' : cameraState === 'ready' ? 'Aponte a câmera para o QR Code do ingresso. O evento será identificado automaticamente.' : cameraMessage}</p>
                  <p className="mt-2 text-xs text-white/70">Mantenha o código inteiro dentro da moldura para uma leitura mais rápida.</p>
                </div>
              </div>
            )}
          </section>
          <footer className="relative z-10 space-y-3 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-center sm:px-8">
            {!ticket && cameraState === 'error' && !verifyError ? <div role="status" aria-live="polite" className="mx-auto max-w-md rounded-2xl border border-white/70 bg-white px-5 py-4 text-left text-slate-900 shadow-xl"><p className="font-medium">Câmera indisponível</p><p className="mt-1 text-sm text-slate-600">{cameraMessage}</p><Button type="button" variant="ghost" className="mt-2 h-10 px-3 text-[#512a82] hover:bg-violet-50 hover:text-[#512a82]" onClick={retryCamera}>Tentar câmera novamente</Button></div> : null}
            <div className="flex justify-center gap-2">
              <input ref={fileRef} type="file" accept="image/*" className="sr-only" aria-label="Selecionar imagem do QR Code" onChange={(e) => void readImage(e.target.files?.[0])} />
              <Button type="button" variant="outline" disabled={imageBusy || verifying || confirming} className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={() => fileRef.current?.click()}><QrCode className="h-4 w-4" />Ler imagem</Button>
            </div>
          </footer>
        </>
      )}
    </main>
  );
}

function ResultRow({ label, value }: { label: string; value: string }) {
  return <div className="grid gap-0.5"><dt className="text-xs text-slate-500">{label}</dt><dd className="break-words font-medium text-slate-900">{value}</dd></div>;
}

function formatTicketDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}
