'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { renderContractConsentTemplate } from '@alusa/domain';
import { DocumentText } from '@/components/icons/icons';
import { InfoCallout } from '@/components/ui/info-callout';
import type { EditableConsentTerm } from './ConsentTermsEditor';

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
// Word "Normal": 1 inch (2.54 cm) em todos os lados.
const WORD_NORMAL_MARGINS_MM = { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 };
const PREVIEW_MAX_WIDTH_PX = 390;
const PREVIEW_FONT_SIZE_PX = 10;
const PREVIEW_LINE_HEIGHT = 1.55;

type PreviewBlock = {
  key: string;
  kind: 'title' | 'paragraph' | 'options';
  text: string;
};

type ConsentTermsPreviewProps = {
  terms: EditableConsentTerm[];
};

const previewContext = {
  signerType: 'RESPONSAVEL' as const,
  signerName: 'Nome do assinante',
  signerCpf: '000.000.000-00',
  studentName: 'Nome do aluno',
  studentCpf: '000.000.000-00',
  relationship: 'responsável legal',
};

function isSectionHeading(text: string) {
  const normalized = text.trim();
  return normalized.length > 0 && normalized.length <= 90 && normalized === normalized.toUpperCase() && /[A-ZÁÉÍÓÚÃÕÇ]/.test(normalized);
}

function buildBlocks(terms: EditableConsentTerm[]) {
  const blocks: PreviewBlock[] = [];

  terms.forEach((term, termIndex) => {
    blocks.push({
      key: `title-${termIndex}`,
      kind: 'title',
      text: term.titulo || 'Título da cláusula',
    });

    const paragraphs = (term.texto || 'O texto do termo aparecerá aqui.')
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);

    paragraphs.forEach((paragraph, paragraphIndex) => {
      blocks.push({
        key: `paragraph-${termIndex}-${paragraphIndex}`,
        kind: isSectionHeading(paragraph) ? 'title' : 'paragraph',
        text: renderContractConsentTemplate(paragraph, previewContext),
      });
    });

    blocks.push({
      key: `options-${termIndex}`,
      kind: 'options',
      text: '□ Autorizo     □ Não autorizo',
    });
  });

  return blocks;
}

function estimateBlockHeight(block: PreviewBlock, charsPerLine: number, lineHeightPx: number) {
  const lineCount = Math.max(1, Math.ceil(block.text.length / charsPerLine));
  const spacing = block.kind === 'title' ? 12 : block.kind === 'options' ? 10 : 8;
  return lineCount * lineHeightPx + spacing;
}

function paginateBlocks(blocks: PreviewBlock[], pageWidthPx: number) {
  // A prévia é uma miniatura A4. Portanto, cada milímetro precisa ser escalado
  // proporcionalmente à largura visível, em vez de usar o valor físico de CSS.
  const pxPerMm = pageWidthPx / A4_WIDTH_MM;
  const pageHeightPx = pageWidthPx * (A4_HEIGHT_MM / A4_WIDTH_MM);
  const contentWidthPx = pageWidthPx - (WORD_NORMAL_MARGINS_MM.left + WORD_NORMAL_MARGINS_MM.right) * pxPerMm;
  const contentHeightPx = pageHeightPx - (WORD_NORMAL_MARGINS_MM.top + WORD_NORMAL_MARGINS_MM.bottom) * pxPerMm;
  const lineHeightPx = PREVIEW_FONT_SIZE_PX * PREVIEW_LINE_HEIGHT;
  const charsPerLine = Math.max(24, Math.floor(contentWidthPx / (PREVIEW_FONT_SIZE_PX * 0.5)));
  const headerHeightPx = 0;
  const pages: PreviewBlock[][] = [];
  let currentPage: PreviewBlock[] = [];
  let usedHeight = headerHeightPx;

  const pendingBlocks = [...blocks];
  while (pendingBlocks.length > 0) {
    const block = pendingBlocks.shift();
    if (!block) continue;

    const blockHeight = estimateBlockHeight(block, charsPerLine, lineHeightPx);

    if (currentPage.length > 0 && usedHeight + blockHeight > contentHeightPx && block.kind === 'paragraph') {
      const spacing = 8;
      const availableLines = Math.floor((contentHeightPx - usedHeight - spacing) / lineHeightPx);
      const maxChars = availableLines * charsPerLine;

      if (maxChars >= charsPerLine) {
        const rawChunk = block.text.slice(0, maxChars);
        const breakAt = rawChunk.lastIndexOf(' ');
        const chunk = breakAt > charsPerLine ? rawChunk.slice(0, breakAt) : rawChunk;
        const remainder = block.text.slice(chunk.length).trimStart();

        currentPage.push({ ...block, key: `${block.key}-continued`, text: chunk });
        usedHeight += estimateBlockHeight({ ...block, text: chunk }, charsPerLine, lineHeightPx);

        if (remainder) pendingBlocks.unshift({ ...block, key: `${block.key}-next`, text: remainder });
        continue;
      }
    }

    if (currentPage.length > 0 && usedHeight + blockHeight > contentHeightPx) {
      pages.push(currentPage);
      currentPage = [];
      usedHeight = 0;
    }

    currentPage.push(block);
    usedHeight += blockHeight;
  }

  if (currentPage.length > 0 || pages.length === 0) pages.push(currentPage);
  return pages;
}

export function ConsentTermsPreview({ terms }: ConsentTermsPreviewProps) {
  const previewFrameRef = useRef<HTMLDivElement>(null);
  const [pageWidthPx, setPageWidthPx] = useState(PREVIEW_MAX_WIDTH_PX);

  useEffect(() => {
    const frame = previewFrameRef.current;
    if (!frame) return;

    const updateWidth = () => setPageWidthPx(Math.max(280, Math.min(frame.clientWidth || PREVIEW_MAX_WIDTH_PX, PREVIEW_MAX_WIDTH_PX)));
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const pages = useMemo(() => paginateBlocks(buildBlocks(terms), pageWidthPx), [pageWidthPx, terms]);

  return (
    <div className="space-y-4 lg:sticky lg:top-24">
      <div className="rounded-2xl border border-slate-200 bg-slate-100/80 p-3 shadow-sm">
        <div className="mb-3 flex items-center justify-between px-1">
          <p className="text-sm font-semibold text-slate-800">Prévia do consentimento</p>
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">A4</span>
        </div>

        <div ref={previewFrameRef} className="mx-auto w-full max-w-[390px] space-y-3">
          {pages.map((page, pageIndex) => (
            <article
              key={`page-${pageIndex}`}
              className="relative w-full overflow-hidden bg-white text-[10px] leading-[1.55] text-slate-800 shadow-[0_10px_30px_rgba(15,23,42,0.12)]"
              style={{
                aspectRatio: `${A4_WIDTH_MM} / ${A4_HEIGHT_MM}`,
                boxSizing: 'border-box',
                padding: `${(WORD_NORMAL_MARGINS_MM.top / A4_WIDTH_MM) * 100}% ${(WORD_NORMAL_MARGINS_MM.right / A4_WIDTH_MM) * 100}% ${(WORD_NORMAL_MARGINS_MM.bottom / A4_WIDTH_MM) * 100}% ${(WORD_NORMAL_MARGINS_MM.left / A4_WIDTH_MM) * 100}%`,
                letterSpacing: 'normal',
                wordSpacing: 'normal',
                overflowWrap: 'break-word',
                wordBreak: 'normal',
              }}
            >
              {page.length === 0 ? (
                <div className="flex min-h-40 flex-col items-center justify-center text-center text-slate-400">
                  <DocumentText className="mb-2 h-6 w-6" />
                  <p>Selecione um modelo para visualizar a prévia.</p>
                </div>
              ) : (
                <div className="min-w-0 space-y-3">
                  {page.map((block) => (
                    <div key={block.key} className="min-w-0 break-inside-avoid">
                      {block.kind === 'title' ? (
                        <p className="text-left font-bold uppercase text-slate-950">{block.text}</p>
                      ) : (
                        <p className="whitespace-pre-line break-words text-left">{block.text}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}

            </article>
          ))}
        </div>
      </div>

      <InfoCallout title="Prévia em formato A4" size="sm" showIcon={false}>
        A prévia respeita a dimensão A4 (210 × 297 mm) e o padrão Normal do Word: margens de 2,54 cm em todos os lados. A quebra é calculada pela área útil da página, sem esticar o espaçamento das palavras.
      </InfoCallout>
    </div>
  );
}
