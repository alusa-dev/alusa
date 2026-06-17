'use client';

import { useCallback } from 'react';
import { FileKey, RefreshCw, Trash2, UploadCloud } from 'lucide-react';
import { useDropzone, type FileRejection } from 'react-dropzone';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { FISCAL_WIZARD_FIELD_CLASS, FiscalFieldError, FiscalFieldLabel } from './FiscalWizardFields';

const CERTIFICATE_ACCEPT = {
  'application/x-pkcs12': ['.pfx', '.p12'],
  'application/pkcs12': ['.pfx', '.p12'],
} as const;

const MAX_CERTIFICATE_BYTES = 5 * 1024 * 1024;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type FiscalCertificateUploadFieldProps = {
  file?: File;
  certificateConfigured?: boolean;
  error?: string;
  disabled?: boolean;
  onChange: (file: File | undefined) => void;
  onClearError?: () => void;
  onReject?: (message: string) => void;
};

export function FiscalCertificateUploadField({
  file,
  certificateConfigured = false,
  error,
  disabled = false,
  onChange,
  onClearError,
  onReject,
}: FiscalCertificateUploadFieldProps) {
  const hasLocalFile = Boolean(file);
  const showConfiguredState = certificateConfigured && !hasLocalFile;

  const handleAccepted = useCallback(
    (acceptedFiles: File[]) => {
      const selected = acceptedFiles[0];
      if (!selected) return;
      onClearError?.();
      onChange(selected);
    },
    [onChange, onClearError],
  );

  const handleRejected = useCallback(
    (rejections: FileRejection[]) => {
      const code = rejections[0]?.errors[0]?.code;
      if (code === 'file-too-large') {
        onReject?.('Arquivo muito grande. O certificado deve ter no máximo 5 MB.');
        return;
      }
      onReject?.('Formato inválido. Use um arquivo .pfx ou .p12.');
    },
    [onReject],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDropAccepted: handleAccepted,
    onDropRejected: handleRejected,
    accept: CERTIFICATE_ACCEPT,
    maxFiles: 1,
    maxSize: MAX_CERTIFICATE_BYTES,
    noClick: true,
    noKeyboard: true,
    disabled,
  });

  function handleRemove(event: React.MouseEvent) {
    event.stopPropagation();
    onClearError?.();
    onChange(undefined);
  }

  function handleOpen(event: React.MouseEvent) {
    event.stopPropagation();
    open();
  }

  return (
    <div className={FISCAL_WIZARD_FIELD_CLASS}>
      <FiscalFieldLabel
        label="Arquivo do certificado A1"
        help="Certificado digital A1 nos formatos .pfx ou .p12, usado para autenticar a emissão junto ao emissor municipal."
      />

      <div
        {...getRootProps()}
        className={cn(
          'rounded-xl border-2 border-dashed bg-white px-6 py-8 transition-colors',
          error ? 'border-red-400' : isDragActive ? 'border-primary bg-primary/5' : 'border-[#e5e7eb]',
          !disabled && !isDragActive && !error && 'hover:border-primary/40 hover:bg-primary/[0.02]',
          disabled && 'cursor-not-allowed opacity-60',
        )}
      >
        <input {...getInputProps()} aria-invalid={Boolean(error)} />

        <div className="flex flex-col items-center gap-3 text-center">
          {hasLocalFile || showConfiguredState ? (
            <FileKey className="h-10 w-10 text-primary" strokeWidth={1.5} aria-hidden />
          ) : (
            <UploadCloud className="h-10 w-10 text-primary" strokeWidth={1.5} aria-hidden />
          )}

          {hasLocalFile ? (
            <>
              <div className="space-y-1">
                <p className="max-w-md break-all text-sm font-medium text-gray-900">{file?.name}</p>
                <p className="text-xs text-gray-500">{formatFileSize(file?.size ?? 0)}</p>
              </div>
              <p className="max-w-sm text-xs text-gray-500">
                O certificado será enviado ao salvar as configurações fiscais.
              </p>
              <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                <Button type="button" size="sm" disabled={disabled} onClick={handleOpen}>
                  Substituir
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                  onClick={handleRemove}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  Deletar
                </Button>
              </div>
            </>
          ) : showConfiguredState ? (
            <>
              <div className="space-y-1">
                <p className="text-sm font-medium text-gray-900">Certificado já configurado</p>
                <p className="max-w-sm text-xs text-gray-500">
                  Há um certificado A1 ativo no emissor. Importe um novo arquivo apenas se precisar
                  substituí-lo.
                </p>
              </div>
              <Button type="button" size="sm" className="mt-2" disabled={disabled} onClick={handleOpen}>
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                Substituir
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-gray-700">
                Selecione o arquivo ou arraste e solte
              </p>
              <p className="text-xs text-gray-500">.pfx ou .p12 · até 5 MB</p>
              <Button type="button" size="sm" className="mt-2 min-w-[7.5rem]" disabled={disabled} onClick={handleOpen}>
                Importar
              </Button>
            </>
          )}
        </div>
      </div>

      <FiscalFieldError message={error} />
    </div>
  );
}
