'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ElementType } from 'react';
import { Button } from '@/components/ui/button';
import { CheckCircle, DocumentText, Plus, Trash } from '@/components/icons/icons';
import { cn } from '@/lib/utils';

export type SignatureField = {
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

type Props = {
  url: string;
  fields: SignatureField[];
  onFieldsChange: (_fields: SignatureField[]) => void;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const MIN_FIELD_WIDTH = 0.08;
const SIGNATURE_LINE_HEIGHT = 0.045;
const resizeHandles = [
  'middle-left', 'middle-right',
] as const;
type ResizeHandle = (typeof resizeHandles)[number];

function labelFor(field: SignatureField) {
  return field.papel === 'ESCOLA' ? 'Escola' : 'Responsável / aluno';
}

export function PDFSignatureEditor({ url, fields, onFieldsChange }: Props) {
  const [pdfComponents, setPdfComponents] = useState<{ Document: ElementType; Page: ElementType } | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [activePage, setActivePage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [placementRole, setPlacementRole] = useState<SignatureField['papel'] | null>(null);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const historyRef = useRef<{ past: SignatureField[][]; future: SignatureField[][] }>({ past: [], future: [] });
  const dragRef = useRef<{ id: string; rect: DOMRect; offsetX: number; offsetY: number; width: number } | null>(null);
  const resizeRef = useRef<{
    id: string;
    rect: DOMRect;
    startX: number;
    startY: number;
    x: number;
    y: number;
    width: number;
    height: number;
    handle: ResizeHandle;
  } | null>(null);

  useEffect(() => {
    let active = true;
    void import('react-pdf').then(({ Document, Page, pdfjs }) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url,
      ).toString();
      if (active) setPdfComponents({ Document, Page });
    });
    return () => { active = false; };
  }, []);

  const selectFieldRole = useCallback((papel: SignatureField['papel']) => {
    setPlacementRole((current) => current === papel ? null : papel);
  }, []);

  const commitFields = useCallback((nextFields: SignatureField[]) => {
    historyRef.current.past.push(fields);
    historyRef.current.future = [];
    onFieldsChange(nextFields);
  }, [fields, onFieldsChange]);

  const addFieldAt = useCallback((papel: SignatureField['papel'], page: number, x: number, y: number) => {
    commitFields([
      ...fields,
      {
        id: crypto.randomUUID(),
        tipo: 'ASSINATURA',
        papel,
        pagina: page,
        x: clamp(x - 0.14, 0, 0.72),
        // `y` stores the top of the interaction area. The signature line is
        // its bottom edge, matching the real line in the source PDF.
        y: clamp(y - SIGNATURE_LINE_HEIGHT, 0, 1 - SIGNATURE_LINE_HEIGHT),
        largura: 0.28,
        altura: SIGNATURE_LINE_HEIGHT,
        obrigatorio: true,
        ordem: fields.length,
      },
    ]);
  }, [commitFields, fields]);

  const removeField = useCallback((id: string) => {
    commitFields(fields.filter((field) => field.id !== id));
    setSelectedFieldId(null);
  }, [commitFields, fields]);

  const updatePosition = useCallback((event: PointerEvent) => {
    const resize = resizeRef.current;
    if (resize) {
      const deltaX = (event.clientX - resize.startX) / resize.rect.width;
      const movesLeft = resize.handle.includes('left');
      const movesRight = resize.handle.includes('right');
      let x = resize.x;
      const y = resize.y;
      let width = resize.width;

      if (movesLeft) {
        x = clamp(resize.x + deltaX, 0, resize.x + resize.width - MIN_FIELD_WIDTH);
        width = resize.width - (x - resize.x);
      } else if (movesRight) {
        width = clamp(resize.width + deltaX, MIN_FIELD_WIDTH, 1 - resize.x);
      }
      commitFields(fields.map((field) => field.id === resize.id ? {
        ...field,
        x,
        y,
        largura: width,
        altura: field.altura,
      } : field));
      return;
    }
    const drag = dragRef.current;
    if (!drag) return;
    const x = clamp((event.clientX - drag.rect.left) / drag.rect.width - drag.offsetX, 0, 1 - drag.width);
    const y = clamp((event.clientY - drag.rect.top) / drag.rect.height - drag.offsetY, 0, 1 - SIGNATURE_LINE_HEIGHT);
    commitFields(fields.map((field) => field.id === drag.id ? { ...field, x, y } : field));
  }, [commitFields, fields]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!selectedFieldId) return;
      const modifier = event.metaKey || event.ctrlKey;

      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        const history = historyRef.current;
        if (event.shiftKey) {
          const next = history.future.pop();
          if (!next) return;
          history.past.push(fields);
          onFieldsChange(next);
        } else {
          const previous = history.past.pop();
          if (!previous) return;
          history.future.push(fields);
          onFieldsChange(previous);
        }
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        commitFields(fields.filter((field) => field.id !== selectedFieldId));
        setSelectedFieldId(null);
        return;
      }

      const step = event.shiftKey ? 0.012 : 0.003;
      const movement = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      }[event.key];
      if (!movement) return;
      event.preventDefault();
      commitFields(fields.map((field) => field.id === selectedFieldId ? {
        ...field,
        x: clamp(field.x + movement[0], 0, 1 - field.largura),
        y: clamp(field.y + movement[1], 0, 1 - field.altura),
      } : field));
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [commitFields, fields, onFieldsChange, selectedFieldId]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest('[data-signature-field]')) {
        setSelectedFieldId(null);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  useEffect(() => {
    const stop = () => { dragRef.current = null; resizeRef.current = null; };
    window.addEventListener('pointermove', updatePosition);
    window.addEventListener('pointerup', stop);
    return () => {
      window.removeEventListener('pointermove', updatePosition);
      window.removeEventListener('pointerup', stop);
    };
  }, [updatePosition]);

  return (
    <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="h-fit self-start space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:sticky lg:top-24">
        <div>
          <p className="text-sm font-semibold text-slate-900">Campos de assinatura</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Adicione os campos e arraste-os para o local correto do documento.
          </p>
        </div>
        <div className="space-y-2">
          <Button type="button" variant={placementRole === 'ESCOLA' ? 'default' : 'outline'} className="w-full justify-start" onClick={() => selectFieldRole('ESCOLA')}>
            <Plus className="mr-2 h-4 w-4" /> Assinatura da escola
          </Button>
          <Button type="button" variant={placementRole === 'RESPONSAVEL_OU_ALUNO' ? 'default' : 'outline'} className="w-full justify-start" onClick={() => selectFieldRole('RESPONSAVEL_OU_ALUNO')}>
            <Plus className="mr-2 h-4 w-4" /> Responsável / aluno
          </Button>
        </div>
        {placementRole && <p className="text-xs text-brand-accent">Clique no PDF para posicionar o campo.</p>}
        <div className="space-y-2 border-t border-slate-100 pt-3">
          {fields.length === 0 ? (
            <p className="text-xs text-slate-500">Nenhum campo configurado.</p>
          ) : fields.map((field) => (
            <div key={field.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-2">
              <span className="flex min-w-0 items-center gap-1.5 text-xs text-slate-700">
                <CheckCircle className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                <span className="truncate">{labelFor(field)} · pág. {field.pagina}</span>
              </span>
              <button type="button" onClick={() => removeField(field.id)} className="text-slate-400 hover:text-red-600" aria-label={`Remover campo ${labelFor(field)}`}>
                <Trash className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <div className="min-h-[620px] rounded-xl border border-slate-200 bg-slate-100 p-4 shadow-inner">
        {loading && <div className="flex min-h-[560px] items-center justify-center text-sm text-slate-500">Carregando documento...</div>}
        {pdfComponents ? <pdfComponents.Document
          file={url}
          onLoadSuccess={({ numPages: total }: { numPages: number }) => { setNumPages(total); setLoading(false); }}
          onLoadError={() => setLoading(false)}
          loading={null}
          error={<div className="flex min-h-[560px] items-center justify-center text-sm text-red-600">Não foi possível carregar o PDF.</div>}
        >
          <div className="space-y-5">
            {Array.from({ length: numPages }, (_, index) => index + 1).map((page) => (
              <div
                key={page}
                onClick={(event) => {
                  if (!placementRole) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  addFieldAt(
                    placementRole,
                    page,
                    (event.clientX - rect.left) / rect.width,
                    (event.clientY - rect.top) / rect.height,
                  );
                  setActivePage(page);
                  setPlacementRole(null);
                }}
                className={cn('relative mx-auto w-fit bg-white shadow-md', placementRole ? 'cursor-crosshair' : '', activePage === page ? 'ring-2 ring-brand-accent/30' : '')}
              >
                <pdfComponents.Page pageNumber={page} width={720} renderAnnotationLayer={false} renderTextLayer={false} />
                {fields.filter((field) => field.pagina === page).map((field) => (
                  <div
                    key={field.id}
                    data-signature-field="true"
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedFieldId(field.id);
                      setActivePage(page);
                    }}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      const pageRect = event.currentTarget.parentElement?.getBoundingClientRect() ?? new DOMRect();
                      const fieldRect = event.currentTarget.getBoundingClientRect();
                      dragRef.current = {
                        id: field.id,
                        rect: pageRect,
                        offsetX: (event.clientX - fieldRect.left) / pageRect.width,
                        offsetY: (event.clientY - fieldRect.top) / pageRect.height,
                        width: field.largura,
                      };
                      setActivePage(page);
                    }}
                    className={cn('absolute cursor-move select-none', selectedFieldId === field.id ? 'z-10' : '')}
                    style={{ left: `${field.x * 100}%`, top: `${field.y * 100}%`, width: `${field.largura * 100}%`, height: `${field.altura * 100}%` }}
                  >
                    <span className={cn('absolute inset-x-0 bottom-[14px] px-0 text-center text-[10px] font-medium', field.papel === 'ESCOLA' ? 'text-indigo-700' : 'text-amber-700')}>{field.tipo === 'RUBRICA' ? 'Rubrica' : labelFor(field)}</span>
                    <span className={cn('absolute inset-x-0 bottom-1 border-b-2', field.papel === 'ESCOLA' ? 'border-indigo-500/80' : 'border-amber-500/80', selectedFieldId === field.id ? 'border-brand-accent' : '')} />
                    {selectedFieldId === field.id && resizeHandles.map((handle) => {
                      const positionClass = {
                        'middle-left': '-left-0.5 -bottom-0.5 cursor-ew-resize',
                        'middle-right': '-right-0.5 -bottom-0.5 cursor-ew-resize',
                      }[handle];

                      return <span
                        key={handle}
                        role="button"
                        tabIndex={0}
                        aria-label={`Redimensionar campo pelo ${handle}`}
                        onClick={(event) => event.stopPropagation()}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          const rect = event.currentTarget.parentElement?.parentElement?.getBoundingClientRect() ?? new DOMRect();
                          resizeRef.current = {
                            id: field.id,
                            rect,
                            startX: event.clientX,
                            startY: event.clientY,
                            x: field.x,
                            y: field.y,
                            width: field.largura,
                            height: field.altura,
                            handle,
                          };
                        }}
                        className={cn('absolute z-10 h-6 w-0.5 rounded-full border-0 bg-brand-accent shadow-none', positionClass)}
                      />;
                    })}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </pdfComponents.Document> : <div className="flex min-h-[560px] items-center justify-center text-sm text-slate-500">Preparando visualizador...</div>}
        {!numPages && !loading && <div className="flex min-h-[560px] items-center justify-center text-sm text-slate-500"><DocumentText className="mr-2 h-5 w-5" /> Documento sem páginas.</div>}
      </div>
    </div>
  );
}
