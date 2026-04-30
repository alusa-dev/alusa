'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';
import {
  MagnifyingGlassPlusIcon,
  MagnifyingGlassMinusIcon,
  ArrowDownTrayIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Configurar worker do PDF.js - versão 3.11.174
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

interface PDFViewerClientProps {
  url: string;
  title?: string;
  className?: string;
  showControls?: boolean;
  showDownload?: boolean;
  maxHeight?: string;
  onLoadSuccess?: (numPages: number) => void;
  onLoadError?: (error: Error) => void;
}

export function PDFViewerClient({
  url,
  title,
  className,
  showControls = true,
  showDownload = true,
  maxHeight = '70vh',
  onLoadSuccess,
  onLoadError,
}: PDFViewerClientProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [scale, setScale] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleLoadSuccess = useCallback(
    ({ numPages: pages }: { numPages: number }) => {
      setNumPages(pages);
      setLoading(false);
      onLoadSuccess?.(pages);
    },
    [onLoadSuccess]
  );

  const handleLoadError = useCallback(
    (err: Error) => {
      setError('Não foi possível carregar o PDF.');
      setLoading(false);
      onLoadError?.(err);
      console.error('[PDFViewer] Erro ao carregar PDF:', err);
    },
    [onLoadError]
  );

  const goToPrevPage = useCallback(() => {
    setPageNumber((prev) => Math.max(1, prev - 1));
  }, []);

  const goToNextPage = useCallback(() => {
    setPageNumber((prev) => Math.min(numPages, prev + 1));
  }, [numPages]);

  const zoomIn = useCallback(() => {
    setScale((prev) => Math.min(2, prev + 0.25));
  }, []);

  const zoomOut = useCallback(() => {
    setScale((prev) => Math.max(0.5, prev - 0.25));
  }, []);

  const handleDownload = useCallback(() => {
    const link = document.createElement('a');
    link.href = url;
    link.download = title || 'contrato.pdf';
    link.click();
  }, [url, title]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        goToPrevPage();
      } else if (e.key === 'ArrowRight') {
        goToNextPage();
      } else if (e.key === '+' || e.key === '=') {
        zoomIn();
      } else if (e.key === '-') {
        zoomOut();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goToPrevPage, goToNextPage, zoomIn, zoomOut]);

  if (error) {
    return (
      <div className={cn('flex items-center justify-center p-8 bg-gray-50 rounded-lg', className)}>
        <div className="text-center">
          <p className="text-red-600 mb-2">{error}</p>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Tentar novamente
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col bg-gray-100 rounded-lg overflow-hidden', className)}>
      {/* Controls */}
      {showControls && (
        <div className="flex items-center justify-between px-4 py-2 bg-white border-b">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={goToPrevPage}
              disabled={pageNumber <= 1}
              title="Página anterior"
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </Button>
            <span className="text-sm text-gray-600 min-w-[80px] text-center">
              {pageNumber} / {numPages}
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={goToNextPage}
              disabled={pageNumber >= numPages}
              title="Próxima página"
            >
              <ChevronRightIcon className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={zoomOut}
              disabled={scale <= 0.5}
              title="Diminuir zoom"
            >
              <MagnifyingGlassMinusIcon className="h-4 w-4" />
            </Button>
            <span className="text-sm text-gray-600 min-w-[50px] text-center">
              {Math.round(scale * 100)}%
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={zoomIn}
              disabled={scale >= 2}
              title="Aumentar zoom"
            >
              <MagnifyingGlassPlusIcon className="h-4 w-4" />
            </Button>
          </div>

          {showDownload && (
            <Button variant="ghost" size="sm" onClick={handleDownload}>
              <ArrowDownTrayIcon className="h-4 w-4 mr-2" />
              Baixar
            </Button>
          )}
        </div>
      )}

      {/* PDF Content */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto"
        style={{ maxHeight }}
      >
        <div className="flex justify-center p-4">
          {loading && (
            <div className="flex items-center justify-center p-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-accent"></div>
            </div>
          )}

          <Document
            file={url}
            onLoadSuccess={handleLoadSuccess}
            onLoadError={handleLoadError}
            loading={null}
            className="flex flex-col items-center gap-4"
          >
            <Page
              pageNumber={pageNumber}
              scale={scale}
              renderTextLayer={false}
              renderAnnotationLayer={false}
              className="shadow-lg"
              loading={
                <div className="flex items-center justify-center w-[595px] h-[842px] bg-white">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400"></div>
                </div>
              }
            />
          </Document>
        </div>
      </div>
    </div>
  );
}
