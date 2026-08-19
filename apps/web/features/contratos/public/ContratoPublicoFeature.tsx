'use client';

import { useCallback, useEffect, useRef, useState, type ElementType, type PointerEvent as ReactPointerEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import { Check, CheckCircle as CheckCircleIcon, ChevronRight, Download, ErrorCircle as XCircleIcon, Edit, Lock, Minus, MoreVertical, Plus, RotateCcw, X } from '@/components/icons/icons';
import { BrandWordmark } from '@/components/brand/BrandWordmark';
import { cn } from '@/lib/utils';

type Field = {
  id: string;
  tipo: 'ASSINATURA' | 'RUBRICA';
  papel: 'ESCOLA' | 'RESPONSAVEL_OU_ALUNO';
  pagina: number;
  x: number;
  y: number;
  largura: number;
  altura: number;
  obrigatorio: boolean;
  ordem: number;
};

type ConsentTerm = {
  id: string;
  codigo: string;
  finalidade: string;
  titulo: string;
  texto: string;
  papel: 'RESPONSAVEL_OU_ALUNO';
  obrigatorio: boolean;
  ordem: number;
};

type ContratoPublico = {
  id: string;
  arquivoPdfUrl: string;
  status: 'PENDENTE' | 'ASSINADO' | 'EXPIRADO' | 'CANCELADO';
  tokenExpiraEm: string | null;
  acceptanceText: string;
  acceptanceVersion: number;
  consentimentos: ConsentTerm[];
  escolaNome: string;
  camposAssinatura: Field[];
  matricula: { aluno: { nome: string }; responsavelFinanceiro?: { nome: string } | null };
  signatario?: { nome: string; tipo: 'ALUNO_MAIOR' | 'RESPONSAVEL' } | null;
};

type Signature = { tipo: 'TEXTO' | 'DESENHADA'; valor: string; fonte?: string };

function SignaturePad({ initialValue, onChange: handleChange, onFillScreen }: { initialValue?: string; onChange: (_value: string) => void; onFillScreen?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const padRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const drawing = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const initialValueRef = useRef(initialValue);

  const exportSignature = (canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return '';

    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const hasInk = pixels.some((channel, index) => index % 4 === 3 && channel >= 12);
    if (!hasInk) return '';

    // The complete transparent canvas is the canonical signature asset.
    // Its center is the same baseline shown in the modal and its full width
    // maps exactly to the field line in the PDF. Cropping the ink here would
    // enlarge and reposition the signature when generating the final file.
    return canvas.toDataURL('image/png');
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const pad = padRef.current;
    if (!canvas || !pad) return;

    const resizeCanvas = () => {
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      const previous = canvas.width > 1 && canvas.height > 1 ? canvas.toDataURL('image/png') : initialValueRef.current;
      const ratio = Math.min(4, Math.max(window.devicePixelRatio || 1, 3));
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.strokeStyle = '#182033';
      context.lineWidth = 2.2;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.imageSmoothingEnabled = true;

      if (previous) {
        const image = new Image();
        image.onload = () => {
          const padding = 14;
          const scale = Math.min((width - padding * 2) / image.width, (height - padding * 2) / image.height, 1);
          const imageWidth = image.width * scale;
          const imageHeight = image.height * scale;
          context.drawImage(image, (width - imageWidth) / 2, (height - imageHeight) / 2, imageWidth, imageHeight);
        };
        image.src = previous;
      }
    };

    resizeCanvas();
    const observer = new ResizeObserver(resizeCanvas);
    observer.observe(pad);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const updateFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement));
    updateFullscreen();
    document.addEventListener('fullscreenchange', updateFullscreen);
    return () => document.removeEventListener('fullscreenchange', updateFullscreen);
  }, []);

  const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const padding = 10; return { x: Math.min(Math.max(event.clientX - rect.left, padding), rect.width - padding), y: Math.min(Math.max(event.clientY - rect.top, padding), rect.height - padding) };
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d', { willReadFrequently: true });
    if (!canvas || !context) return;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.restore();
    context.beginPath();
    drawing.current = false;
    lastPoint.current = null;
    handleChange('');
  };

  return <div ref={padRef} className="space-y-2"><div className="relative"><button type="button" className="absolute left-3 top-2 z-10 text-xs font-medium text-slate-500 hover:text-slate-900" onClick={clearCanvas}>Limpar</button><button type="button" className="absolute right-3 top-2 z-10 block text-xs font-medium text-slate-500 hover:text-slate-900 sm:hidden" onClick={onFillScreen}>Preencher tela</button><canvas ref={canvasRef} className={cn('h-36 w-full touch-none rounded-lg border border-slate-300 bg-slate-100', isFullscreen && 'h-[calc(100dvh-250px)] min-h-[180px] rounded-none')} onPointerDown={(event) => { drawing.current = true; event.currentTarget.setPointerCapture(event.pointerId); const p = point(event); lastPoint.current = p; const context = event.currentTarget.getContext('2d', { willReadFrequently: true }); context?.beginPath(); context?.moveTo(p.x, p.y); }} onPointerMove={(event) => { if (!drawing.current) return; const p = point(event); const previous = lastPoint.current; const context = event.currentTarget.getContext('2d', { willReadFrequently: true }); if (!previous || !context) return; const midpoint = { x: (previous.x + p.x) / 2, y: (previous.y + p.y) / 2 }; context.quadraticCurveTo(previous.x, previous.y, midpoint.x, midpoint.y); context.stroke(); lastPoint.current = p; handleChange(exportSignature(event.currentTarget)); }} onPointerUp={(event) => { drawing.current = false; lastPoint.current = null; handleChange(exportSignature(event.currentTarget)); }} onPointerCancel={() => { drawing.current = false; lastPoint.current = null; }} /><span className="pointer-events-none absolute inset-x-3 top-1/2 border-b border-slate-300" aria-hidden="true" /></div><p className="text-xs text-slate-500">Desenhe sua assinatura sobre a linha.</p></div>;
}

function PublicPdf({ url, fields, escolaNome, signature, signedFieldId, interactive = true, onFieldClick: handleFieldClick, onPageCount }: { url: string; fields: Field[]; escolaNome: string; signature: Signature | null; signedFieldId: string | null; interactive?: boolean; onFieldClick: (_field: Field) => void; onPageCount?: (_pages: number) => void }) {
  const [components, setComponents] = useState<{ Document: ElementType; Page: ElementType } | null>(null);
  const [pages, setPages] = useState(0);
  const [pageWidth, setPageWidth] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [isMobile, setIsMobile] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const gestureRef = useRef<{ mode: 'pan' | 'pinch' | null; startDistance: number; startZoom: number; startPoint: { x: number; y: number }; startScroll: { left: number; top: number } }>({ mode: null, startDistance: 0, startZoom: 1, startPoint: { x: 0, y: 0 }, startScroll: { left: 0, top: 0 } });

  useEffect(() => {
    let active = true;
    void import('react-pdf').then(({ Document, Page, pdfjs }) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
      if (active) setComponents({ Document, Page });
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateWidth = () => {
      const width = viewport.clientWidth;
      const isCompact = window.matchMedia('(max-width: 1023px)').matches;
      setViewportWidth(width);
      setPageWidth(Math.max(280, Math.min(820, width - (isCompact ? 24 : 128))));
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [components]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 1023px)');
    const updateMobile = () => setIsMobile(mediaQuery.matches);
    updateMobile();
    mediaQuery.addEventListener('change', updateMobile);
    return () => mediaQuery.removeEventListener('change', updateMobile);
  }, []);

  useEffect(() => {
    if (!isMobile) {
      setZoom(1);
    }
  }, [isMobile]);

  const updateGesture = () => {
    const pointers = [...pointersRef.current.values()];
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (pointers.length >= 2) {
      const [first, second] = pointers;
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      if (gestureRef.current.mode !== 'pinch') {
        gestureRef.current = { mode: 'pinch', startDistance: distance, startZoom: zoom, startPoint: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }, startScroll: { left: viewport.scrollLeft, top: viewport.scrollTop } };
      }
      setZoom(Math.min(3, Math.max(0.75, gestureRef.current.startZoom * (distance / Math.max(gestureRef.current.startDistance, 1)))));
      return;
    }
    const point = pointers[0];
    if (point && gestureRef.current.mode === 'pan') {
      viewport.scrollLeft = gestureRef.current.startScroll.left - (point.x - gestureRef.current.startPoint.x);
      viewport.scrollTop = gestureRef.current.startScroll.top - (point.y - gestureRef.current.startPoint.y);
    }
  };
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isMobile) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size === 1) gestureRef.current = { mode: 'pan', startDistance: 0, startZoom: zoom, startPoint: { x: event.clientX, y: event.clientY }, startScroll: { left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop } };
    updateGesture();
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isMobile || !pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    updateGesture();
  };
  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isMobile) return;
    pointersRef.current.delete(event.pointerId);
    const [remaining] = pointersRef.current.values();
    if (!remaining) {
      gestureRef.current.mode = null;
      return;
    }
    gestureRef.current = { mode: 'pan', startDistance: 0, startZoom: zoom, startPoint: remaining, startScroll: { left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop } };
  };

  const renderedPageWidth = Math.round(pageWidth * zoom);
  const stageWidth = Math.max(viewportWidth, renderedPageWidth + (isMobile ? 24 : 128));

  return (
    <div className="relative h-full min-h-0 min-w-0 w-full overflow-hidden bg-slate-100">
      <div ref={viewportRef} className={cn('h-full min-h-0 w-full overflow-auto overscroll-contain', isMobile ? 'touch-none' : 'touch-auto')} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerEnd} onPointerCancel={handlePointerEnd}>
        {!components || pageWidth === 0 ? (
          <div className="flex min-h-full items-center justify-center text-sm text-slate-500">Preparando documento...</div>
        ) : (
          <div className="flex min-h-full items-start justify-center bg-slate-100 px-3 py-6 sm:px-6 sm:py-8 lg:px-16 lg:py-10" style={{ width: stageWidth }}>
            <components.Document file={url} onLoadSuccess={({ numPages: totalPages }: { numPages: number }) => { setPages(totalPages); onPageCount?.(totalPages); }} loading={<div className="p-8 text-center text-sm text-slate-500">Carregando documento...</div>} error={<div className="p-8 text-center text-red-600">Não foi possível carregar o documento.</div>}>
              <div className="flex flex-col items-center gap-6 lg:gap-8">
                {Array.from({ length: pages }, (_, index) => index + 1).map((page) => (
                  <div key={page} className="relative shrink-0 overflow-hidden bg-white shadow-[0_12px_28px_-18px_rgba(15,23,42,0.38)] [&>div]:block" style={{ width: renderedPageWidth }} aria-label={`Página ${page}`}>
                    <components.Page pageNumber={page} width={pageWidth} scale={zoom} renderAnnotationLayer={false} renderTextLayer={false} />
                    {fields.filter((field) => field.pagina === page).map((field) => {
                      const isSchool = field.papel === 'ESCOLA';
                      const isSigned = isSchool || (field.id === signedFieldId && signature);
                      return <div key={field.id} className="absolute overflow-visible" style={{ left: `${field.x * 100}%`, top: `${field.y * 100}%`, width: `${field.largura * 100}%`, height: `${field.altura * 100}%` }}>
                        {isSchool ? <span className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-2 text-center font-serif text-base italic text-slate-900">{escolaNome || 'Escola'}</span> : interactive ? <button type="button" onClick={() => handleFieldClick(field)} className={cn('absolute inset-0 z-10 flex min-h-11 items-center justify-center rounded-md border px-2 text-center text-[11px] font-semibold transition-colors', isSigned ? 'border-transparent text-transparent' : 'cursor-pointer border-amber-300 bg-amber-50/90 text-amber-900 shadow-sm hover:bg-amber-100')}>{isSigned ? 'Editar assinatura' : (field.tipo === 'RUBRICA' ? 'Rubrica' : 'Clique para assinar')}</button> : <span className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded px-2 text-center text-[11px] font-semibold text-slate-500">Campo de assinatura</span>}
                        {!isSigned && <span className="pointer-events-none absolute inset-x-0 bottom-0 border-b border-slate-400" aria-hidden="true" />}
                        {!isSchool && isSigned && signature?.valor && (signature.tipo === 'DESENHADA' ? <img src={signature.valor} alt="Assinatura desenhada" className="pointer-events-none absolute left-0 top-full z-[1] h-auto w-full -translate-y-1/2" /> : <span style={{ fontFamily: signature.fonte || 'Georgia, serif' }} className="pointer-events-none absolute left-0 top-full z-[1] w-full -translate-y-full truncate text-center text-base italic leading-tight text-slate-900">{signature.valor}</span>)}
                        {!isSchool && isSigned && <button type="button" aria-label="Editar assinatura" onClick={() => handleFieldClick(field)} className="absolute -right-1 top-0 z-20 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white p-0 text-slate-500 shadow-sm hover:bg-white hover:text-brand-accent sm:-right-6 sm:h-5 sm:w-5 sm:rounded-none sm:border-0 sm:shadow-none"><Edit className="h-3 w-3" /></button>}
                      </div>;
                    })}
                  </div>
                ))}
              </div>
            </components.Document>
          </div>
        )}
      </div>
      <div className="absolute left-4 top-4 z-20 hidden flex-col overflow-hidden rounded-md bg-slate-700/75 text-white shadow-sm lg:flex">
        <button type="button" className="flex h-11 w-8 items-center justify-center border-b border-white/15 hover:bg-slate-700" onClick={() => setZoom((current) => Math.min(2, current + 0.1))} aria-label="Aumentar zoom"><Plus className="h-4 w-4" /></button>
        <button type="button" className="flex h-11 w-8 items-center justify-center border-b border-white/15 hover:bg-slate-700" onClick={() => setZoom(1)} aria-label="Redefinir visualização"><RotateCcw className="h-4 w-4" /></button>
        <button type="button" className="flex h-11 w-8 items-center justify-center hover:bg-slate-700" onClick={() => setZoom((current) => Math.max(0.8, current - 0.1))} aria-label="Reduzir zoom"><Minus className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

function ConsentDocumentPreview({ terms }: { terms: ConsentTerm[] }) {
  return (
    <div className="mx-auto w-full max-w-[760px] space-y-5">
      {terms.map((term, index) => (
        <article
          key={term.id}
          className="min-h-[680px] w-full bg-white p-5 text-[13px] leading-6 text-slate-800 shadow-[0_10px_28px_-18px_rgba(15,23,42,0.7)] sm:min-h-[1075px] sm:p-10 sm:text-[15px] sm:leading-7 lg:p-[2.54cm]"
        >
          <div className="space-y-6 sm:space-y-8">
            <h1 className="text-left text-lg font-bold uppercase tracking-[0.04em] text-slate-950 sm:text-xl">
              {term.titulo}
            </h1>
            <div className="space-y-5 sm:space-y-6">
              {term.texto.split(/\n\s*\n/).map((paragraph, paragraphIndex) => {
                const content = paragraph.trim();
                if (!content) return null;
                const isHeading = content.length <= 90 && content === content.toUpperCase() && /[A-ZÁÉÍÓÚÃÕÇ]/.test(content);
                return isHeading ? (
                  <h2 key={`${term.id}-heading-${paragraphIndex}`} className="text-left text-sm font-bold uppercase tracking-[0.02em] text-slate-950">
                    {content}
                  </h2>
                ) : (
                  <p key={`${term.id}-paragraph-${paragraphIndex}`} className="whitespace-pre-line text-left">
                    {content}
                  </p>
                );
              })}
            </div>
          </div>
          {terms.length > 1 && index < terms.length - 1 && <div className="mt-12 border-t border-slate-200 pt-4 text-xs text-slate-400">Próximo termo de consentimento</div>}
        </article>
      ))}
    </div>
  );
}

function ConsentChoices({ terms, answers, compact = false, onChange }: { terms: ConsentTerm[]; answers: Record<string, 'AUTORIZADO' | 'RECUSADO'>; compact?: boolean; onChange: (_termId: string, _decision: 'AUTORIZADO' | 'RECUSADO') => void }) {
  return <div className={cn(compact ? 'flex min-w-0 items-center gap-2 overflow-x-auto' : 'space-y-3')}>
    {terms.map((term) => <div key={term.id} className={cn(compact ? 'flex min-w-[300px] shrink-0 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2' : 'rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm')}>
      <div className={cn('min-w-0 font-semibold leading-5 text-slate-900', compact ? 'max-w-[180px] truncate text-xs' : 'text-sm')}>{term.titulo}</div>
      <div className="flex min-w-0 flex-1 gap-2">
        <label className={cn('flex min-h-10 flex-1 cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg border px-2.5 text-xs font-medium transition-colors', answers[term.id] === 'AUTORIZADO' ? 'border-brand-accent bg-brand-accent/5 text-brand-accent' : 'border-slate-200 text-slate-700')}>
          <input type="radio" name={`consent-${term.id}`} value="AUTORIZADO" checked={answers[term.id] === 'AUTORIZADO'} onChange={() => onChange(term.id, 'AUTORIZADO')} className="h-4 w-4 accent-brand-accent" />
          <span>Autorizo</span>
        </label>
        <label className={cn('flex min-h-10 flex-1 cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg border px-2.5 text-xs font-medium transition-colors', answers[term.id] === 'RECUSADO' ? 'border-amber-500 bg-amber-50 text-amber-800' : 'border-slate-200 text-slate-700')}>
          <input type="radio" name={`consent-${term.id}`} value="RECUSADO" checked={answers[term.id] === 'RECUSADO'} onChange={() => onChange(term.id, 'RECUSADO')} className="h-4 w-4 accent-amber-500" />
          <span>Não autorizo</span>
        </label>
      </div>
    </div>)}
  </div>;
}

export function ContratoPublicoFeature({ token, kind = 'academic' }: { token: string; kind?: 'academic' | 'event' }) {
  const [contrato, setContrato] = useState<ContratoPublico | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMSG, setErrorMSG] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [signatureField, setSignatureField] = useState<Field | null>(null);
  const [signature, setSignature] = useState<Signature | null>(null);
  const [signedFieldId, setSignedFieldId] = useState<string | null>(null);
  const [signatureMode, setSignatureMode] = useState<'TEXTO' | 'DESENHADA'>('TEXTO');
  const [typedSignature, setTypedSignature] = useState('');
  const [typedFont, setTypedFont] = useState('Georgia, serif');
  const [nome, setNome] = useState('');
  const [cpf, setCpf] = useState('');
  const [email, setEmail] = useState('');
  const [aceite, setAceite] = useState(false);
  const [consentAnswers, setConsentAnswers] = useState<Record<string, 'AUTORIZADO' | 'RECUSADO'>>({});
  const [assinando, setAssinando] = useState(false);
  const [signedSuccess, setSignedSuccess] = useState(false);
  const [signedPdfUrl, setSignedPdfUrl] = useState<string | null>(null);
  const [drawingFullscreen, setDrawingFullscreen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [documentPages, setDocumentPages] = useState(0);
  const signatureDialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch(`${kind === 'event' ? '/api/public/event-contrato' : '/api/public/contrato'}/${token}`).then(async (res) => { if (!res.ok) throw new Error((await res.json()).error?.message || 'Erro ao carregar contrato'); return res.json(); }).then((data: ContratoPublico) => { setContrato(data); setNome(data.signatario?.nome || data.matricula.responsavelFinanceiro?.nome || data.matricula.aluno.nome); }).catch((error: unknown) => setErrorMSG(error instanceof Error ? error.message : 'Erro ao carregar contrato')).finally(() => setLoading(false));
  }, [kind, token]);

  useEffect(() => {
    if (!signatureField) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [signatureField]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) setDrawingFullscreen(false);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const enterDrawingMode = () => setSignatureMode('DESENHADA');

  const exitDrawingFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    const orientation = window.screen.orientation as ScreenOrientation & { unlock?: () => void };
    orientation.unlock?.();
    setDrawingFullscreen(false);
  }, []);

  const fillDrawingScreen = () => {
    if (!window.matchMedia('(max-width: 1023px)').matches) return;
    setDrawingFullscreen(true);
    if (signatureDialogRef.current?.requestFullscreen) void signatureDialogRef.current.requestFullscreen().catch(() => undefined);
    const orientation = window.screen.orientation as ScreenOrientation & { lock?: (_orientation: 'landscape') => Promise<void> };
    const lock = orientation.lock?.('landscape');
    void lock?.catch(() => undefined);
  };

  const formatCpf = useCallback((value: string) => { const digits = value.replace(/\D/g, '').slice(0, 11); if (digits.length <= 3) return digits; if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`; if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`; return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`; }, []);
  const requiredFields = contrato?.camposAssinatura.filter((field) => field.papel === 'RESPONSAVEL_OU_ALUNO' && field.obrigatorio) ?? [];
  const consentimentos = contrato?.consentimentos ?? [];
  const consentimentosValidos = consentimentos.every((term) => !term.obrigatorio || Boolean(consentAnswers[term.id]));

  const openSignature = (field: Field) => {
    const editingCurrentSignature = signedFieldId === field.id ? signature : null;
    setSignatureField(field);
    setSignatureMode(editingCurrentSignature ? editingCurrentSignature.tipo : 'TEXTO');
    setTypedSignature(editingCurrentSignature?.tipo === 'TEXTO' ? editingCurrentSignature.valor : '');
    setTypedFont(editingCurrentSignature?.tipo === 'TEXTO' ? (editingCurrentSignature.fonte || 'Georgia, serif') : 'Georgia, serif');
  };
  const saveSignature = () => { const value = signatureMode === 'TEXTO' ? typedSignature.trim() : signature?.valor; if (!value || !signatureField) return toast.error('Preencha sua assinatura antes de continuar.'); setSignature({ tipo: signatureMode, valor: value, ...(signatureMode === 'TEXTO' ? { fonte: typedFont } : {}) }); setSignedFieldId(signatureField.id); exitDrawingFullscreen(); setSignatureField(null); };

  const submit = async () => {
    if (!signature || !nome.trim() || cpf.replace(/\D/g, '').length !== 11 || !aceite || !consentimentosValidos) return toast.error('Revise seus dados, consentimentos, assinatura e aceite antes de finalizar.');
    try { setAssinando(true); const assinatura = { ...signature, fonte: signature.fonte || typedFont }; const res = await fetch(`${kind === 'event' ? '/api/public/event-contrato' : '/api/public/contrato'}/${token}/assinar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome: nome.trim(), cpf: cpf.replace(/\D/g, ''), email: email.trim() || undefined, aceite: true, consentimentos: Object.entries(consentAnswers).map(([termId, decision]) => ({ termId, decision })), assinatura, userAgent: navigator.userAgent }) }); const data = await res.json(); if (!res.ok) throw new Error(data.error?.message || 'Erro ao assinar contrato'); setSignedPdfUrl(typeof data.signedPdfUrl === 'string' ? data.signedPdfUrl : null); setSignedSuccess(true); toast.success('Contrato assinado com sucesso!'); } catch (error) { toast.error(error instanceof Error ? error.message : 'Erro ao assinar contrato'); } finally { setAssinando(false); }
  };

  const workflowSteps = [
    { id: 1 as const, label: 'Revisar', description: 'Leia o documento' },
    ...(consentimentos.length ? [{ id: 2 as const, label: 'Consentimentos', description: 'Escolha suas opções' }] : []),
    { id: 3 as const, label: 'Assinar', description: 'Preencha os campos' },
    { id: 4 as const, label: 'Confirmar', description: 'Revise seus dados' },
  ];
  const currentStepPosition = workflowSteps.findIndex((item) => item.id === step) + 1;
  const completedSignatures = signature ? Math.min(1, requiredFields.length || 1) : 0;
  const stepTitle = step === 1 ? 'Revise o documento' : step === 2 ? 'Consentimentos' : step === 3 ? 'Posicione sua assinatura' : 'Confirme seus dados';
  const stepDescription = step === 1
    ? 'Leia o contrato completo antes de continuar.'
    : step === 2
      ? 'Escolha uma opção para cada termo de consentimento.'
      : step === 3
        ? 'Clique no campo destacado dentro do documento para assinar.'
        : 'Confira seus dados e aceite os termos para finalizar.';
  const goBack = () => {
    if (step === 3 && consentimentos.length === 0) setStep(1);
    else setStep((Math.max(1, step - 1)) as 1 | 2 | 3 | 4);
  };
  const goNext = () => {
    if (step === 1) setStep(consentimentos.length ? 2 : 3);
    else if (step === 2) {
      if (!consentimentosValidos) toast.error('Responda todos os termos de consentimento antes de continuar.');
      else setStep(3);
    } else if (!signature) toast.error('Preencha sua assinatura antes de continuar.');
    else setStep(4);
  };
  const primaryActionLabel = step === 1 ? 'Continuar' : step === 2 ? 'Ir para assinatura' : step === 3 ? 'Revisar dados' : assinando ? 'Finalizando...' : 'Finalizar assinatura';

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-[#202124] text-sm text-slate-300 lg:bg-slate-50 lg:text-slate-500">Carregando contrato...</div>;
  if (errorMSG) return <StateCard title="Não foi possível acessar" message={errorMSG} tone="error" />;
  if (signedSuccess || contrato?.status === 'ASSINADO') return <StateCard title="Contrato assinado" message="Sua assinatura foi registrada com sucesso. Você pode fechar esta página com segurança." tone="success" signedPdfUrl={signedPdfUrl} />;
  if (!contrato) return null;

  return (
    <div className="flex min-h-screen flex-col bg-[#202124] text-slate-900 lg:h-dvh lg:min-h-0 lg:overflow-hidden lg:bg-slate-100">
      <header className="sticky top-0 z-30 shrink-0 border-b border-brand-accent/80 bg-brand-accent text-white">
        <div className="flex min-h-14 items-center justify-center px-4 sm:min-h-16">
          <BrandWordmark variant="white" className="h-6 w-[80px] sm:h-7 sm:w-[92px]" />
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col bg-slate-100 px-0 pb-[52vh] sm:pb-[48vh] lg:overflow-hidden lg:bg-transparent lg:pb-0">
        <div className="relative z-20 flex min-h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6 lg:-mb-14 lg:ml-[228px] lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <p className="text-sm font-semibold text-brand-accent">{completedSignatures}/{requiredFields.length || 1} Assinaturas</p>
            <ChevronRight className="h-4 w-4 text-brand-accent" aria-hidden="true" />
          </div>
          <div className="relative flex items-center gap-3">
            <Button type="button" variant="outline" className="h-9 rounded-full border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700" onClick={() => setOptionsOpen((current) => !current)} aria-expanded={optionsOpen} aria-haspopup="menu">
              <span className="hidden sm:inline">Opções</span>
              <MoreVertical className="h-4 w-4 sm:ml-1" />
            </Button>
            {optionsOpen && <div role="menu" className="absolute right-0 top-11 z-50 w-72 rounded-2xl border border-slate-200 bg-white p-2 text-sm shadow-[0_18px_45px_-24px_rgba(15,23,42,0.45)]">
              <a href={contrato.arquivoPdfUrl} target="_blank" rel="noreferrer" className="flex min-h-10 items-center gap-3 whitespace-nowrap rounded-xl px-3 text-slate-700 hover:bg-slate-50" role="menuitem"><Download className="h-4 w-4 shrink-0 text-slate-500" />Baixar documento original</a>
            </div>}
          </div>
        </div>

        <div className="flex w-full min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[228px_minmax(0,1fr)] lg:overflow-hidden">
          <nav aria-label="Etapas da assinatura" className="hidden border-r border-brand-accent/10 bg-[#f7f4fb] px-5 py-8 lg:block lg:min-h-0 lg:overflow-y-auto">
            <ol className="relative space-y-7 before:absolute before:bottom-5 before:left-[13px] before:top-5 before:w-px before:bg-slate-200">
              {workflowSteps.map((item) => {
                const isCurrent = item.id === step;
                const isComplete = item.id < step;
                return <li key={item.id} className="relative flex items-start gap-3">
                  <span className={cn('relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 bg-white text-xs font-semibold transition-colors', isCurrent ? 'border-brand-accent text-brand-accent' : isComplete ? 'border-brand-accent bg-brand-accent text-white' : 'border-slate-300 text-slate-400')}>
                    {isComplete ? <Check className="h-4 w-4" /> : item.id}
                  </span>
                  <button type="button" disabled={!isComplete && !isCurrent} onClick={() => isComplete && setStep(item.id)} className={cn('min-w-0 pt-0.5 text-left', isCurrent ? 'text-slate-900' : isComplete ? 'text-slate-600' : 'cursor-default text-slate-400')}>
                    <span className="block text-sm font-semibold">{item.label}</span>
                    <span className="mt-0.5 block text-xs leading-4 text-slate-500">{item.description}</span>
                  </button>
                </li>;
              })}
            </ol>
          </nav>

          <div className={cn('relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-slate-100 lg:border-r lg:border-slate-200 lg:pt-14', step === 4 && 'hidden')}>
            <section aria-label={step === 2 ? 'Termo de consentimento' : 'Documento para assinatura'} className={cn('min-h-0 min-w-0 w-full max-w-full flex-1 shrink overscroll-contain', step === 2 ? 'overflow-y-auto overflow-x-hidden px-0 py-4 pb-24 sm:px-6 sm:py-6 sm:pb-24 lg:px-8 lg:py-8 lg:pb-24' : 'overflow-hidden', step === 4 && 'hidden')}>
              {step === 2 ? <ConsentDocumentPreview terms={consentimentos} /> : <PublicPdf url={contrato.arquivoPdfUrl} fields={contrato.camposAssinatura} escolaNome={contrato.escolaNome} signature={signature} signedFieldId={signedFieldId} interactive={step === 3} onFieldClick={openSignature} onPageCount={setDocumentPages} />}
            </section>
          </div>

          <aside className={cn('fixed inset-x-0 bottom-0 z-40 mx-auto max-h-[70vh] max-w-[760px] overflow-y-auto rounded-t-2xl bg-slate-100 lg:min-h-0 lg:max-h-none lg:overflow-y-auto lg:rounded-none', step === 1 || step === 2 || step === 3 ? 'lg:hidden' : 'lg:sticky lg:top-0 lg:flex lg:h-full lg:w-full lg:max-w-[480px] lg:items-center lg:justify-self-center lg:bg-transparent lg:pb-20 lg:pt-14')}>
            <Card className="overflow-hidden rounded-t-2xl border-slate-200 bg-white shadow-none lg:min-h-0 lg:rounded-none lg:border-0 lg:bg-transparent">
              <CardHeader className={cn('space-y-2 border-b border-slate-100 bg-white px-4 py-4 sm:px-5 sm:py-5 lg:border-0 lg:bg-transparent lg:px-6 lg:py-7 lg:text-center', step === 4 && 'hidden')}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-base font-bold">{stepTitle}</CardTitle>
                  </div>
                </div>
                {step !== 4 && <CardDescription className="leading-5">{stepDescription}</CardDescription>}
                <div className="flex items-center gap-2 pt-1 text-xs font-medium text-slate-400 lg:hidden"><span>Etapa {currentStepPosition} de {workflowSteps.length}</span><span aria-hidden="true">•</span><span>{completedSignatures}/{requiredFields.length || 1} campos</span></div>
              </CardHeader>
              <CardContent className={cn('space-y-4 bg-slate-50 px-4 py-4 sm:px-5 sm:py-5 lg:bg-transparent lg:px-6 lg:py-6', step === 1 && 'hidden')}>
                {step === 2 && <ConsentChoices terms={consentimentos} answers={consentAnswers} onChange={(termId, decision) => setConsentAnswers((current) => ({ ...current, [termId]: decision }))} />}
                {step === 3 && <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm">{signature ? <div className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 font-semibold text-emerald-700"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-xs">✓</span>Assinatura preenchida</span><Button variant="link" className="h-auto px-0 text-xs" onClick={() => setSignatureField(requiredFields[0] ?? null)}>Alterar</Button></div> : <span className="leading-5 text-slate-600">{requiredFields.length ? 'Clique no campo destacado do PDF para assinar.' : 'Nenhum campo de assinatura configurado.'}</span>}</div>}
                {step === 4 && <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                  <CardTitle className="text-base font-bold text-slate-900">Confirme seus dados</CardTitle>
                  <div className="space-y-2"><Label htmlFor="public-nome">Nome completo</Label><Input id="public-nome" value={nome} onChange={(event) => setNome(event.target.value)} className="h-10 rounded-lg border-slate-200 bg-white shadow-sm focus-visible:border-brand-accent focus-visible:ring-brand-accent/25" /></div>
                  <div className="space-y-2"><Label htmlFor="public-cpf">CPF</Label><Input id="public-cpf" value={cpf} onChange={(event) => setCpf(formatCpf(event.target.value))} maxLength={14} placeholder="000.000.000-00" className="h-10 rounded-lg border-slate-200 bg-white shadow-sm focus-visible:border-brand-accent focus-visible:ring-brand-accent/25" /></div>
                  <div className="space-y-2"><Label htmlFor="public-email">E-mail para cópia <span className="text-xs font-normal text-slate-400">(opcional)</span></Label><Input id="public-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="h-10 rounded-lg border-slate-200 bg-white shadow-sm focus-visible:border-brand-accent focus-visible:ring-brand-accent/25" /></div>
                  <div className="flex items-start gap-2 px-1 py-1"><Checkbox id="public-aceite" checked={aceite} onCheckedChange={(checked) => setAceite(checked === true)} className="mt-0.5 shrink-0" /><Label htmlFor="public-aceite" className="cursor-pointer text-sm font-normal leading-5">{contrato.acceptanceText}</Label></div>
                </div>}
                {step === 4 && <div className="flex items-center justify-center gap-2 text-xs text-slate-500"><Lock className="h-4 w-4" aria-hidden="true" />Ambiente seguro Alusa</div>}
              </CardContent>
              <CardFooter className="sticky bottom-0 z-20 flex gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-5 sm:py-4 lg:hidden"><Button variant="outline" className="min-h-11 flex-1 bg-white" onClick={goBack} disabled={step === 1}>Voltar</Button>{step < 4 ? <Button className="min-h-11 flex-1" onClick={goNext}>{primaryActionLabel}</Button> : <Button className="min-h-11 flex-1" onClick={() => void submit()} disabled={assinando || !aceite || !consentimentosValidos}>{primaryActionLabel}</Button>}</CardFooter>
            </Card>
          </aside>

        </div>
        <div className="fixed bottom-0 left-0 right-0 z-30 hidden h-20 items-center justify-between border-t border-slate-200 bg-white px-8 py-4 shadow-[0_-8px_24px_-20px_rgba(15,23,42,0.45)] lg:left-[228px] lg:flex">
          {step === 2 ? <div className="flex min-w-0 flex-1 items-center gap-4">
            <div className="hidden shrink-0 sm:block"><p className="text-sm font-semibold text-slate-900">Consentimentos</p><p className="text-xs text-slate-500">Escolha uma opção para cada termo.</p></div>
            <ConsentChoices terms={consentimentos} answers={consentAnswers} compact onChange={(termId, decision) => setConsentAnswers((current) => ({ ...current, [termId]: decision }))} />
          </div> : <div className="flex items-center gap-5 text-xs text-slate-500">
            <span>{`Página 1 / ${documentPages || '—'}`}</span>
          </div>}
          <div className="flex items-center gap-3">
            {step === 3 && <Button type="button" variant="outline" className="h-10 rounded-full border-brand-accent/30 px-4 text-xs font-semibold text-brand-accent" onClick={() => { const nextField = requiredFields.find((field) => field.id !== signedFieldId) ?? requiredFields[0]; if (nextField) openSignature(nextField); }} disabled={!requiredFields.length}>
              Próximo campo <ChevronRight className="ml-1 h-4 w-4" />
            </Button>}
            <Button type="button" variant="outline" className="h-10 min-w-24 rounded-full border-slate-200 px-4 text-xs font-semibold" onClick={goBack} disabled={step === 1}>Voltar</Button>
            {step < 4 ? <Button type="button" className="h-10 min-w-36 rounded-full px-5 text-xs font-semibold" onClick={goNext}>{primaryActionLabel}<ChevronRight className="ml-1 h-4 w-4" /></Button> : <Button type="button" className="h-10 min-w-44 rounded-full px-5 text-xs font-semibold" onClick={() => void submit()} disabled={assinando || !aceite || !consentimentosValidos}>{primaryActionLabel}</Button>}
          </div>
        </div>
      </main>

{signatureField && <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-slate-950/60 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" role="presentation"><Card ref={signatureDialogRef} role="dialog" aria-modal="true" aria-labelledby="signature-dialog-title" className={cn('max-h-[min(780px,calc(100vh-1rem))] w-full max-w-[520px] overflow-y-auto rounded-t-3xl border-slate-200 bg-white text-slate-900 shadow-[0_24px_70px_-24px_rgba(15,23,42,0.55)] sm:rounded-2xl', drawingFullscreen && 'h-[100dvh] max-h-none max-w-none rounded-none')}><div className="mx-auto mt-2 h-1 w-10 rounded-full bg-slate-200 sm:hidden" /><CardHeader className="flex-row items-start justify-between gap-4 bg-white px-5 pb-0 pt-4 sm:px-6 sm:pt-5"><div className="space-y-1"><CardTitle id="signature-dialog-title" className="text-base font-semibold">Preencher assinatura</CardTitle><CardDescription>Escolha como deseja assinar este campo.</CardDescription></div><Button variant="ghost" size="icon" className="-mr-1 -mt-1 h-9 w-9 shrink-0 rounded-full p-0 text-slate-500 hover:bg-slate-100 hover:text-slate-900" onClick={() => { exitDrawingFullscreen(); setSignatureField(null); }} aria-label="Fechar"><X className="h-4 w-4" /></Button></CardHeader><CardContent className={cn('space-y-4 bg-white px-5 pb-5 pt-4 sm:px-6 sm:pb-6', drawingFullscreen && 'flex-1')}><div role="tablist" aria-label="Modo de assinatura" className="flex rounded-xl bg-slate-100 p-1"><Button type="button" role="tab" aria-selected={signatureMode === 'TEXTO'} className={cn('relative h-10 flex-1 rounded-lg border-0 px-3 text-sm font-semibold shadow-none', signatureMode === 'TEXTO' ? 'bg-white text-brand-accent shadow-sm hover:bg-white' : 'bg-transparent text-slate-500 hover:bg-white/60')} variant="ghost" onClick={() => { exitDrawingFullscreen(); setSignatureMode('TEXTO'); }}>Digitar</Button><Button type="button" role="tab" aria-selected={signatureMode === 'DESENHADA'} className={cn('relative h-10 flex-1 rounded-lg border-0 px-3 text-sm font-semibold shadow-none', signatureMode === 'DESENHADA' ? 'bg-white text-brand-accent shadow-sm hover:bg-white' : 'bg-transparent text-slate-500 hover:bg-white/60')} variant="ghost" onClick={enterDrawingMode}>Desenhar</Button></div>{signatureMode === 'TEXTO' ? <div className="relative h-36 overflow-visible rounded-xl border border-slate-300 bg-slate-100"><div className="absolute left-3 top-2 z-10"><Select value={typedFont} onValueChange={setTypedFont}><SelectTrigger aria-label="Alterar fonte" className="h-8 min-w-[118px] rounded-lg border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 shadow-sm hover:bg-white focus:border-slate-300 focus:ring-0 data-[state=open]:bg-white"><SelectValue placeholder="Alterar fonte" /></SelectTrigger><SelectContent className="z-[70]"><SelectItem value="Georgia, serif" style={{ fontFamily: "Georgia, serif" }}>Clássica</SelectItem><SelectItem value="Arial, sans-serif" style={{ fontFamily: "Arial, sans-serif" }}>Simples</SelectItem><SelectItem value="Courier New, monospace" style={{ fontFamily: "Courier New, monospace" }}>Monoespaçada</SelectItem><SelectItem value="Times New Roman, serif" style={{ fontFamily: "Times New Roman, serif" }}>Tradicional</SelectItem></SelectContent></Select></div><Input id="typed-signature" autoComplete="new-password" autoCorrect="off" autoCapitalize="off" spellCheck={false} value={typedSignature} onChange={(event) => setTypedSignature(event.target.value)} placeholder="Digite aqui a assinatura" style={{ fontFamily: typedFont }} className="absolute inset-x-3 top-[58%] z-[1] h-8 -translate-y-full rounded-none border-0 !bg-transparent px-2 text-center text-xl italic shadow-none transition-none hover:!bg-transparent focus:!bg-transparent active:!bg-transparent placeholder:text-slate-400 focus-visible:ring-0" /><span className="pointer-events-none absolute inset-x-3 top-[58%] border-b border-slate-300" aria-hidden="true" /></div> : <SignaturePad onFillScreen={fillDrawingScreen} initialValue={signedFieldId === signatureField.id && signature?.tipo === 'DESENHADA' ? signature.valor : undefined} onChange={(value) => setSignature({ tipo: 'DESENHADA', valor: value })} />}</CardContent><CardFooter className="justify-end gap-2 bg-slate-50 px-5 py-4 [padding-bottom:max(1rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-5"><Button variant="outline" className="min-h-11 min-w-24 bg-white" onClick={() => { exitDrawingFullscreen(); setSignatureField(null); }}>Cancelar</Button><Button className="min-h-11 min-w-40" onClick={saveSignature}>Aplicar assinatura</Button></CardFooter></Card></div>}
    </div>
  );
}

function StateCard({ title, message, tone, signedPdfUrl }: { title: string; message: string; tone: 'error' | 'success'; signedPdfUrl?: string | null }) {
  return <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#f6f0fc,transparent_45%),#f8fafc] p-4"><Card className="w-full max-w-md overflow-hidden rounded-3xl border-slate-200 bg-white text-center shadow-[0_24px_70px_-30px_rgba(62,31,99,0.35)]"><CardHeader className="space-y-4 px-6 pb-5 pt-8 sm:px-8"><div className={cn('mx-auto flex h-16 w-16 items-center justify-center rounded-full', tone === 'success' ? 'bg-emerald-100' : 'bg-red-100')}><>{tone === 'success' ? <CheckCircleIcon className="h-9 w-9 text-emerald-600" /> : <XCircleIcon className="h-9 w-9 text-red-600" />}</></div><div className="space-y-2"><CardTitle className="text-xl">{title}</CardTitle><CardDescription className="leading-6">{message}</CardDescription></div></CardHeader>{tone === 'success' && signedPdfUrl && <CardFooter className="border-t border-slate-100 bg-slate-50 px-6 py-5 sm:px-8"><Button asChild className="min-h-11 w-full"><a href={signedPdfUrl} target="_blank" rel="noreferrer">Abrir contrato assinado</a></Button></CardFooter>}</Card> </div>;
}
