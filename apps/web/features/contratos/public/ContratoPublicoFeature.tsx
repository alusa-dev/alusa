'use client';

import { useCallback, useEffect, useRef, useState, type ElementType, type PointerEvent as ReactPointerEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { InfoCallout } from '@/components/ui/info-callout';
import { toast } from '@/components/ui/toast';
import { CheckCircle as CheckCircleIcon, ErrorCircle as XCircleIcon, Edit, X } from '@/components/icons/icons';
import { AsaasSeal } from '@/components/shared/AsaasSeal';
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

type ContratoPublico = {
  id: string;
  arquivoPdfUrl: string;
  status: 'PENDENTE' | 'ASSINADO' | 'EXPIRADO' | 'CANCELADO';
  tokenExpiraEm: string;
  acceptanceText: string;
  acceptanceVersion: number;
  escolaNome: string;
  camposAssinatura: Field[];
  matricula: { aluno: { nome: string }; responsavelFinanceiro?: { nome: string } | null };
};

type Signature = { tipo: 'TEXTO' | 'DESENHADA'; valor: string; fonte?: string };

function SignaturePad({ initialValue, onChange: handleChange }: { initialValue?: string; onChange: (_value: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const initialValueRef = useRef(initialValue);

  const exportSignature = (canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('2d');
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
    if (!canvas) return;
    // Keep a high-resolution backing canvas so the signature remains smooth
    // when it is later embedded at the line width in the PDF.
    const ratio = Math.min(4, Math.max(window.devicePixelRatio || 1, 3));
    canvas.width = Math.round(canvas.clientWidth * ratio);
    canvas.height = Math.round(canvas.clientHeight * ratio);
    const context = canvas.getContext('2d');
    context?.scale(ratio, ratio);
    if (context) {
      context.strokeStyle = '#182033';
      context.lineWidth = 2.2;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.imageSmoothingEnabled = true;
    }

    if (initialValueRef.current && context) {
      const image = new Image();
      image.onload = () => {
        const padding = 14;
        const scale = Math.min(
          (canvas.clientWidth - padding * 2) / image.width,
          (canvas.clientHeight - padding * 2) / image.height,
          1,
        );
        const width = image.width * scale;
        const height = image.height * scale;
        context.drawImage(image, (canvas.clientWidth - width) / 2, (canvas.clientHeight - height) / 2, width, height);
      };
      image.src = initialValueRef.current;
    }
  }, []);

  const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const padding = 10; return { x: Math.min(Math.max(event.clientX - rect.left, padding), rect.width - padding), y: Math.min(Math.max(event.clientY - rect.top, padding), rect.height - padding) };
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
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

  return <div className="space-y-2"><div className="relative"><button type="button" className="absolute left-3 top-2 z-10 text-xs font-medium text-slate-500 hover:text-slate-900" onClick={clearCanvas}>Limpar</button><canvas ref={canvasRef} className="h-36 w-full touch-none rounded-lg border border-slate-300 bg-slate-100" onPointerDown={(event) => { drawing.current = true; event.currentTarget.setPointerCapture(event.pointerId); const p = point(event); lastPoint.current = p; const context = event.currentTarget.getContext('2d'); context?.beginPath(); context?.moveTo(p.x, p.y); }} onPointerMove={(event) => { if (!drawing.current) return; const p = point(event); const previous = lastPoint.current; const context = event.currentTarget.getContext('2d'); if (!previous || !context) return; const midpoint = { x: (previous.x + p.x) / 2, y: (previous.y + p.y) / 2 }; context.quadraticCurveTo(previous.x, previous.y, midpoint.x, midpoint.y); context.stroke(); lastPoint.current = p; handleChange(exportSignature(event.currentTarget)); }} onPointerUp={(event) => { drawing.current = false; lastPoint.current = null; handleChange(exportSignature(event.currentTarget)); }} onPointerCancel={() => { drawing.current = false; lastPoint.current = null; }} /><span className="pointer-events-none absolute inset-x-3 top-1/2 border-b border-slate-300" aria-hidden="true" /></div><p className="text-xs text-slate-500">Desenhe sua assinatura sobre a linha.</p></div>;
}

function PublicPdf({ url, fields, escolaNome, signature, signedFieldId, onFieldClick: handleFieldClick }: { url: string; fields: Field[]; escolaNome: string; signature: Signature | null; signedFieldId: string | null; onFieldClick: (_field: Field) => void }) {
  const [components, setComponents] = useState<{ Document: ElementType; Page: ElementType } | null>(null);
  const [pages, setPages] = useState(0);

  useEffect(() => {
    let active = true;
    void import('react-pdf').then(({ Document, Page, pdfjs }) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
      if (active) setComponents({ Document, Page });
    });
    return () => { active = false; };
  }, []);

  if (!components) return <div className="flex min-h-[560px] items-center justify-center text-sm text-slate-500">Preparando documento...</div>;
  return (
    <components.Document
      file={url}
      onLoadSuccess={({ numPages: totalPages }: { numPages: number }) => setPages(totalPages)}
      loading={<div className="p-8 text-center text-sm text-slate-500">Carregando documento...</div>}
      error={<div className="p-8 text-center text-sm text-red-600">Não foi possível carregar o documento.</div>}
    >
      <div className="space-y-5">
        {Array.from({ length: pages }, (_, index) => index + 1).map((page) => (
          <div key={page} className="relative mx-auto w-fit bg-white shadow-md">
            <components.Page pageNumber={page} width={760} renderAnnotationLayer={false} renderTextLayer={false} />
            {fields.filter((field) => field.pagina === page).map((field) => {
              const isSchool = field.papel === 'ESCOLA';
              const isSigned = isSchool || (field.id === signedFieldId && signature);

              return (
                <div
                  key={field.id}
                  className="absolute overflow-visible"
                  style={{
                    left: `${field.x * 100}%`,
                    top: `${field.y * 100}%`,
                    width: `${field.largura * 100}%`,
                    height: `${field.altura * 100}%`,
                  }}
                >
                  {isSchool ? (
                    <span className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-2 text-center font-serif text-base italic text-slate-900">
                      {escolaNome || 'Escola'}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleFieldClick(field)}
                      className={cn(
                        'absolute inset-0 z-10 flex items-center justify-center rounded px-2 text-center text-[11px] font-semibold',
                        isSigned ? 'text-transparent' : 'cursor-pointer text-amber-800',
                      )}
                    >
                      {isSigned ? 'Editar assinatura' : (field.tipo === 'RUBRICA' ? 'Rubrica' : 'Clique para assinar')}
                    </button>
                  )}
                  {!isSigned && <span className="pointer-events-none absolute inset-x-0 bottom-0 border-b border-slate-400" aria-hidden="true" />}
                  {!isSchool && isSigned && signature?.valor && (signature.tipo === 'DESENHADA' ? (
                    <img src={signature.valor} alt="Assinatura desenhada" className="pointer-events-none absolute left-0 top-full z-[1] h-auto w-full -translate-y-1/2" />
                  ) : (
                    <span style={{ fontFamily: signature.fonte || 'Georgia, serif' }} className="pointer-events-none absolute left-0 top-full z-[1] w-full -translate-y-full truncate text-center text-base italic leading-tight text-slate-900">
                      {signature.valor}
                    </span>
                  ))}
                  {!isSchool && isSigned && (
                    <button
                      type="button"
                      aria-label="Editar assinatura"
                      onClick={() => handleFieldClick(field)}
                      className="absolute -right-6 top-1/2 z-20 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-none bg-transparent p-0 text-slate-500 hover:bg-transparent hover:text-brand-accent"
                    >
                      <Edit className="h-3 w-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </components.Document>
  );
}

function PublicStepIndicator({ step }: { step: 1 | 2 | 3 }) {
  const items = [
    ['1', 'Revisar'],
    ['2', 'Assinar'],
    ['3', 'Concluir'],
  ] as const;

  return (
    <nav aria-label="Etapas da assinatura" className="hidden items-center gap-2 md:flex">
      {items.map(([number, title], index) => {
        const active = Number(number) === step;
        const completed = Number(number) < step;
        return (
          <div key={number} className="flex items-center gap-2">
            <div className={cn(
              'flex min-w-[104px] items-center justify-center gap-2 rounded-full border px-3.5 py-2 transition-colors',
              active && '!border-[#dfccf7] !bg-[#dfccf7] !text-[#4b2a72]',
              completed && 'border-[#dfccf7] bg-[#dfccf7] text-[#5a397b]',
              !active && !completed && 'border-[#dfccf7] bg-[#dfccf7] text-[#6b4b88]',
            )}>
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-current/10 text-[11px] font-bold">{completed ? '✓' : number}</span>
              <span className="text-xs font-semibold">{title}</span>
            </div>
            {index < items.length - 1 && <span aria-hidden="true" className="h-px w-6 shrink-0 bg-[#dfccf7]" />}
          </div>
        );
      })}
    </nav>
  );
}

export function ContratoPublicoFeature({ token }: { token: string }) {
  const [contrato, setContrato] = useState<ContratoPublico | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMSG, setErrorMSG] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
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
  const [assinando, setAssinando] = useState(false);
  const [signedSuccess, setSignedSuccess] = useState(false);

  useEffect(() => {
    fetch(`/api/public/contrato/${token}`).then(async (res) => { if (!res.ok) throw new Error((await res.json()).error?.message || 'Erro ao carregar contrato'); return res.json(); }).then((data: ContratoPublico) => { setContrato(data); setNome(data.matricula.responsavelFinanceiro?.nome || data.matricula.aluno.nome); }).catch((error: unknown) => setErrorMSG(error instanceof Error ? error.message : 'Erro ao carregar contrato')).finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    if (!signatureField) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [signatureField]);

  const formatCpf = useCallback((value: string) => { const digits = value.replace(/\D/g, '').slice(0, 11); if (digits.length <= 3) return digits; if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`; if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`; return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`; }, []);
  const requiredFields = contrato?.camposAssinatura.filter((field) => field.papel === 'RESPONSAVEL_OU_ALUNO' && field.obrigatorio) ?? [];

  const openSignature = (field: Field) => {
    const editingCurrentSignature = signedFieldId === field.id ? signature : null;
    setSignatureField(field);
    setSignatureMode(editingCurrentSignature ? editingCurrentSignature.tipo : 'TEXTO');
    setTypedSignature(editingCurrentSignature?.tipo === 'TEXTO' ? editingCurrentSignature.valor : '');
    setTypedFont(editingCurrentSignature?.tipo === 'TEXTO' ? (editingCurrentSignature.fonte || 'Georgia, serif') : 'Georgia, serif');
  };
  const saveSignature = () => { const value = signatureMode === 'TEXTO' ? typedSignature.trim() : signature?.valor; if (!value || !signatureField) return toast.error('Preencha sua assinatura antes de continuar.'); setSignature({ tipo: signatureMode, valor: value, ...(signatureMode === 'TEXTO' ? { fonte: typedFont } : {}) }); setSignedFieldId(signatureField.id); setSignatureField(null); };

  const submit = async () => {
    if (!signature || !nome.trim() || cpf.replace(/\D/g, '').length !== 11 || !aceite) return toast.error('Revise seus dados, assinatura e aceite antes de finalizar.');
    try { setAssinando(true); const assinatura = { ...signature, fonte: signature.fonte || typedFont }; const res = await fetch(`/api/public/contrato/${token}/assinar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome: nome.trim(), cpf: cpf.replace(/\D/g, ''), email: email.trim() || undefined, aceite: true, assinatura, userAgent: navigator.userAgent }) }); const data = await res.json(); if (!res.ok) throw new Error(data.error?.message || 'Erro ao assinar contrato'); setSignedSuccess(true); toast.success('Contrato assinado com sucesso!'); } catch (error) { toast.error(error instanceof Error ? error.message : 'Erro ao assinar contrato'); } finally { setAssinando(false); }
  };

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">Carregando contrato...</div>;
  if (errorMSG) return <StateCard title="Não foi possível acessar" message={errorMSG} tone="error" />;
  if (signedSuccess || contrato?.status === 'ASSINADO') return <StateCard title="Assinatura concluída" message="Sua assinatura foi registrada com sucesso. Você pode fechar esta página com segurança." tone="success" />;
  if (!contrato) return null;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="sticky top-0 z-30 border-b border-brand-accent/80 bg-brand-accent text-white backdrop-blur">
        <div className="mx-auto flex min-h-[76px] max-w-7xl items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="min-w-0">
              <BrandWordmark variant="white" className="h-7 w-[92px]" />
            </div>
          </div>
          <PublicStepIndicator step={step} />
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px] xl:gap-8">
<section aria-label="Documento para assinatura" className="w-fit max-w-full justify-self-center overflow-hidden rounded-2xl border-0 bg-[#dce3ec] p-5 shadow-[0_12px_40px_-24px_rgba(15,23,42,0.4)]">
            <div className="rounded-xl border-0 bg-transparent p-0">
              <PublicPdf url={contrato.arquivoPdfUrl} fields={contrato.camposAssinatura} escolaNome={contrato.escolaNome} signature={signature} signedFieldId={signedFieldId} onFieldClick={(field) => { setStep(2); openSignature(field); }} />
            </div>
          </section>

          <aside className="space-y-4 lg:sticky lg:top-24">
            <Card className="overflow-hidden border-slate-200/90 shadow-[0_12px_32px_-24px_rgba(15,23,42,0.5)]">
              <CardHeader className="space-y-2 border-b border-slate-100 bg-white px-5 py-5">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-[15px] font-bold">{step === 1 ? 'Revise o documento' : step === 2 ? 'Sua assinatura' : 'Confirmar assinatura'}</CardTitle>
                </div>
                <CardDescription className="leading-5">{step === 1 ? 'Leia o contrato completo. Os campos destacados indicam onde você assinará.' : step === 2 ? 'Clique no campo destacado do documento para preencher sua assinatura.' : 'Confira seus dados e aceite os termos para concluir.'}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 bg-slate-50 px-5 py-5">
                {step === 1 && <InfoCallout variant="info" size="sm" title="Pronto para assinar?">Clique em um marcador no documento ou avance para preencher sua assinatura.</InfoCallout>}
                {step === 2 && <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm">{signature ? <div className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 font-semibold text-emerald-700"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-xs">✓</span>Assinatura preenchida</span><Button variant="link" className="h-auto px-0 text-xs" onClick={() => setSignatureField(requiredFields[0] ?? null)}>Alterar</Button></div> : <span className="leading-5 text-slate-600">{requiredFields.length ? 'Clique no campo destacado do PDF para assinar.' : 'Nenhum campo de assinatura configurado.'}</span>}</div>}
                {step === 3 && <>
                  <div className="space-y-2"><Label htmlFor="public-nome">Nome completo</Label><Input id="public-nome" value={nome} onChange={(event) => setNome(event.target.value)} className="h-10 rounded-lg border-slate-200 bg-white shadow-sm focus-visible:border-brand-accent focus-visible:ring-brand-accent/25" /></div>
                  <div className="space-y-2"><Label htmlFor="public-cpf">CPF</Label><Input id="public-cpf" value={cpf} onChange={(event) => setCpf(formatCpf(event.target.value))} maxLength={14} placeholder="000.000.000-00" className="h-10 rounded-lg border-slate-200 bg-white shadow-sm focus-visible:border-brand-accent focus-visible:ring-brand-accent/25" /></div>
                  <div className="space-y-2"><Label htmlFor="public-email">E-mail para cópia <span className="text-xs font-normal text-slate-400">(opcional)</span></Label><Input id="public-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="h-10 rounded-lg border-slate-200 bg-white shadow-sm focus-visible:border-brand-accent focus-visible:ring-brand-accent/25" /></div>
                  <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3 shadow-sm"><Checkbox id="public-aceite" checked={aceite} onCheckedChange={(checked) => setAceite(checked === true)} /><Label htmlFor="public-aceite" className="cursor-pointer text-sm font-normal leading-5">{contrato.acceptanceText}</Label></div>
                </>}
              </CardContent>
              <CardFooter className="flex gap-2 border-t border-slate-200 bg-white px-5 py-4"><Button variant="outline" className="flex-1 bg-white" onClick={() => setStep((Math.max(1, step - 1)) as 1 | 2 | 3)} disabled={step === 1}>Voltar</Button>{step < 3 ? <Button className="flex-1" onClick={() => { if (step === 1) setStep(2); else if (!signature) toast.error('Preencha sua assinatura antes de continuar.'); else setStep(3); }}>{step === 1 ? 'Preencher assinatura' : 'Continuar'}</Button> : <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => void submit()} disabled={assinando || !aceite}>{assinando ? 'Finalizando...' : 'Finalizar assinatura'}</Button>}</CardFooter>
            </Card>
            <div className="flex justify-center rounded-xl border border-slate-200/70 bg-white/60 px-4 py-3"><AsaasSeal variant="negativo-preto" /></div>
          </aside>
        </div>
      </main>

{signatureField && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-[2px]" role="presentation"><Card role="dialog" aria-modal="true" aria-labelledby="signature-dialog-title" className="w-full max-w-[520px] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl border-slate-200 bg-white text-slate-900 shadow-[0_24px_70px_-24px_rgba(15,23,42,0.55)]"><CardHeader className="flex-row items-start justify-between gap-4 bg-white px-6 pt-5 pb-0"><div className="space-y-1"><CardTitle id="signature-dialog-title" className="text-base font-semibold">Preencher assinatura</CardTitle></div><Button variant="ghost" size="icon" className="-mr-1 -mt-1 h-6 w-6 shrink-0 rounded-none p-0 text-slate-500 hover:bg-transparent hover:text-slate-900" onClick={() => setSignatureField(null)} aria-label="Fechar"><X className="h-4 w-4" /></Button></CardHeader><CardContent className="space-y-4 bg-white px-6 pt-0 pb-6"><div role="tablist" aria-label="Modo de assinatura" className="flex border-b border-slate-200"><Button type="button" role="tab" aria-selected={signatureMode === 'TEXTO'} className={cn('relative h-10 flex-1 rounded-none border-0 bg-transparent px-3 text-sm font-medium shadow-none hover:bg-white', signatureMode === 'TEXTO' ? 'text-brand-accent after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:bg-brand-accent' : 'text-slate-500')} variant="ghost" onClick={() => setSignatureMode('TEXTO')}>Digitar</Button><Button type="button" role="tab" aria-selected={signatureMode === 'DESENHADA'} className={cn('relative h-10 flex-1 rounded-none border-0 bg-transparent px-3 text-sm font-medium shadow-none hover:bg-slate-50', signatureMode === 'DESENHADA' ? 'text-brand-accent after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:bg-brand-accent' : 'text-slate-500')} variant="ghost" onClick={() => setSignatureMode('DESENHADA')}>Desenhar</Button></div>{signatureMode === 'TEXTO' ? <div className="relative h-36 overflow-visible rounded-lg border border-slate-300 bg-slate-100"><div className="absolute left-3 top-2 z-10"><Select value={typedFont} onValueChange={setTypedFont}><SelectTrigger aria-label="Alterar fonte" className="h-7 min-w-[118px] rounded-md border-slate-200 bg-white/70 px-2 py-1 text-xs font-medium text-slate-600 shadow-none hover:bg-white focus:border-slate-300 focus:ring-0 data-[state=open]:bg-white"><SelectValue placeholder="Alterar fonte" /></SelectTrigger><SelectContent className="z-[70]"><SelectItem value="Georgia, serif" style={{ fontFamily: "Georgia, serif" }}>Clássica</SelectItem><SelectItem value="Arial, sans-serif" style={{ fontFamily: "Arial, sans-serif" }}>Simples</SelectItem><SelectItem value="Courier New, monospace" style={{ fontFamily: "Courier New, monospace" }}>Monoespaçada</SelectItem><SelectItem value="Times New Roman, serif" style={{ fontFamily: "Times New Roman, serif" }}>Tradicional</SelectItem></SelectContent></Select></div><Input id="typed-signature" autoComplete="new-password" autoCorrect="off" autoCapitalize="off" spellCheck={false} value={typedSignature} onChange={(event) => setTypedSignature(event.target.value)} placeholder="Digite aqui a assinatura" style={{ fontFamily: typedFont }} className="absolute inset-x-3 top-[58%] z-[1] h-8 -translate-y-full rounded-none border-0 !bg-transparent px-2 text-center text-xl italic shadow-none transition-none hover:!bg-transparent focus:!bg-transparent active:!bg-transparent placeholder:text-slate-400 focus-visible:ring-0" /><span className="pointer-events-none absolute inset-x-3 top-[58%] border-b border-slate-300" aria-hidden="true" /></div> : <SignaturePad initialValue={signedFieldId === signatureField.id && signature?.tipo === 'DESENHADA' ? signature.valor : undefined} onChange={(value) => setSignature({ tipo: 'DESENHADA', valor: value })} />}</CardContent><CardFooter className="justify-end gap-2 bg-slate-50 px-6 py-5"><Button variant="outline" className="min-w-24 bg-white" onClick={() => setSignatureField(null)}>Cancelar</Button><Button className="min-w-40" onClick={saveSignature}>Aplicar assinatura</Button></CardFooter></Card></div>}
    </div>
  );
}

function StateCard({ title, message, tone }: { title: string; message: string; tone: 'error' | 'success' }) {
  return <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4"><Card className="w-full max-w-md text-center"><CardHeader><div className={cn('mx-auto flex h-14 w-14 items-center justify-center rounded-full', tone === 'success' ? 'bg-emerald-100' : 'bg-red-100')}><>{tone === 'success' ? <CheckCircleIcon className="h-8 w-8 text-emerald-600" /> : <XCircleIcon className="h-8 w-8 text-red-600" />}</></div><CardTitle>{title}</CardTitle><CardDescription>{message}</CardDescription></CardHeader></Card> </div>;
}
