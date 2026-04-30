'use client';

import dynamic from 'next/dynamic';
import { cn } from '@/lib/utils';

// Carrega o PDFViewerClient apenas no cliente, evitando erros de SSR
const PDFViewerClient = dynamic(
  () => import('./PDFViewerClient').then((mod) => mod.PDFViewerClient),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center p-8 bg-gray-100 rounded-lg min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-accent mx-auto mb-2"></div>
          <p className="text-sm text-gray-500">Carregando visualizador...</p>
        </div>
      </div>
    ),
  }
);

export interface PDFViewerProps {
  url: string;
  title?: string;
  className?: string;
  showControls?: boolean;
  showDownload?: boolean;
  maxHeight?: string;
  onLoadSuccess?: (numPages: number) => void;
  onLoadError?: (error: Error) => void;
}

/**
 * Componente PDFViewer - Wrapper para visualização de PDFs no Next.js
 *
 * Utiliza dynamic import com ssr: false para evitar erros de hydration
 * e garantir que o pdfjs-dist seja executado apenas no cliente.
 */
export function PDFViewer(props: PDFViewerProps) {
  return (
    <div className={cn('min-h-[200px]', props.className)}>
      <PDFViewerClient {...props} className="" />
    </div>
  );
}
