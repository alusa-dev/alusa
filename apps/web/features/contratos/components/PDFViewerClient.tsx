'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, ExternalLink } from '@/components/icons/icons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface PDFViewerClientProps {
  url: string;
  title?: string;
  className?: string;
  showControls?: boolean;
  showDownload?: boolean;
  maxHeight?: string;
  onLoadSuccess?: (_numPages: number) => void;
  onLoadError?: (_error: Error) => void;
}

function getFileName(title?: string) {
  return title?.trim() || 'contrato.pdf';
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
  const [loading, setLoading] = useState<boolean>(true);
  const [frameUrl, setFrameUrl] = useState<string>(url);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    setLoading(true);
    setFrameUrl(url);

    if (url.startsWith('blob:')) {
      return () => {
        active = false;
      };
    }

    fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error('Não foi possível carregar o arquivo PDF.');
        }

        return response.blob();
      })
      .then((blob) => {
        if (!active) {
          return;
        }

        objectUrl = URL.createObjectURL(blob);
        setFrameUrl(objectUrl);
      })
      .catch((error: unknown) => {
        const loadError = error instanceof Error
          ? error
          : new Error('Não foi possível carregar o arquivo PDF.');
        setLoading(false);
        onLoadError?.(loadError);
      });

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [url, onLoadError]);

  const handleDownload = useCallback(() => {
    const link = document.createElement('a');
    link.href = url;
    link.download = getFileName(title);
    link.click();
  }, [url, title]);

  const handleOpenInNewTab = useCallback(() => {
    window.open(url, '_blank', 'noopener,noreferrer');
  }, [url]);

  const handleFrameLoad = useCallback(() => {
    setLoading(false);
    onLoadSuccess?.(1);
  }, [onLoadSuccess]);

  const handleFrameError = useCallback(() => {
    const error = new Error('Não foi possível carregar a visualização nativa do PDF.');
    setLoading(false);
    onLoadError?.(error);
  }, [onLoadError]);

  return (
    <div className={cn('flex flex-col bg-gray-50 rounded-lg overflow-hidden border', className)}>
      {showControls && (
        <div className="flex items-center justify-between px-4 py-2 bg-white border-b gap-2">
          <span className="text-sm text-gray-500">
            {loading ? 'Carregando documento...' : 'Visualização do PDF'}
          </span>

          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-8 px-2 text-gray-600" onClick={handleOpenInNewTab}>
              <ExternalLink className="h-4 w-4 mr-1.5" />
              Abrir
            </Button>
            {showDownload && (
              <Button variant="ghost" size="sm" className="h-8 px-2 text-gray-600" onClick={handleDownload}>
                <Download className="h-4 w-4 mr-1.5" />
                Baixar
              </Button>
            )}
          </div>
        </div>
      )}

      <div
        className="relative flex-1 overflow-hidden bg-gray-100"
        style={{ height: maxHeight, maxHeight }}
      >
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-50/80">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-accent mx-auto mb-2" />
              <p className="text-xs text-gray-500">Carregando documento...</p>
            </div>
          </div>
        )}

        <iframe
          src={frameUrl}
          title={title || 'Visualização do contrato'}
          className="h-full min-h-[400px] w-full border-0 bg-white"
          onLoad={handleFrameLoad}
          onError={handleFrameError}
          style={{ height: maxHeight, maxHeight }}
        />
      </div>
    </div>
  );
}
