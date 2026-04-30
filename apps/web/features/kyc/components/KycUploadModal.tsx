'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle, ErrorCircle } from '@/components/icons/icons';
import { UploadCloud, FileText } from 'lucide-react';
import { useDropzone, type FileRejection } from 'react-dropzone';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { pushToast } from '@/components/ui/toast';
import type { VerificationAction } from '../constants';
import { UPLOAD_MAX_SIZE_MB } from '../constants';
import { getKycDocumentGuidance } from '../document-guidance';
import { isValidKycGroupId, ZERO_UUID } from '../utils/group-id';
import {
  ExternalVerificationRequiredError,
  KycUploadApiError,
  ProviderPortalRequiredError,
} from '../hooks/use-kyc-upload';

type Props = {
  action: VerificationAction | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpload: (groupId: string, file: File, type?: string, slotId?: string) => Promise<void>;
  uploading: boolean;
  uploadError: string | null;
  onRefreshAfterUpload?: () => Promise<void>;
  onExternalRequired?: (actionId: string) => Promise<void>;
};

type SlotState = {
  file: File | null;
  sending: boolean;
  status: string;
};

type NormalizedSlot = {
  label: string;
  slotId?: string;
  status: string;
};

const DROPZONE_ACCEPT = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
};

const LOCKED_SLOT_STATUSES = new Set(['APPROVED', 'AWAITING_APPROVAL', 'SENT', 'PENDING']);

function buildInitialSlotStates(slots: NormalizedSlot[]): SlotState[] {
  return slots.map((slot) => ({
    file: null,
    sending: false,
    status: slot.status,
  }));
}

function normalizeDocumentType(action: Pick<VerificationAction, 'documentType' | 'uploadType'> | null): string {
  return String(action?.uploadType ?? action?.documentType ?? '').trim().toUpperCase();
}

function isIdentificationAction(action: Pick<VerificationAction, 'documentType' | 'uploadType'> | null): boolean {
  return normalizeDocumentType(action) === 'IDENTIFICATION';
}

function buildNormalizedSlots(action: VerificationAction | null): NormalizedSlot[] {
  if (!action) return [{ label: 'Arquivo', status: 'NOT_SENT' }];

  const rawSlots = action.slots ?? [];

  if (isIdentificationAction(action) && rawSlots.length <= 2) {
    return ['Frente', 'Verso'].map((label, index) => ({
      label,
      slotId: rawSlots[index]?.id,
      status: String(rawSlots[index]?.status ?? 'NOT_SENT').toUpperCase(),
    }));
  }

  if (rawSlots.length > 0) {
    return rawSlots.map((slot, index) => ({
      label: slot.label || `Arquivo ${index + 1}`,
      slotId: slot.id,
      status: String(slot.status ?? 'NOT_SENT').toUpperCase(),
    }));
  }

  return [{ label: 'Arquivo', status: 'NOT_SENT' }];
}

function slotStatusUi(status: string) {
  if (status === 'APPROVED') {
    return { label: 'Aprovado', className: 'bg-green-100 text-green-700' };
  }
  if (status === 'REJECTED') {
    return { label: 'Rejeitado', className: 'bg-red-100 text-red-700' };
  }
  if (status === 'AWAITING_APPROVAL' || status === 'SENT' || status === 'PENDING') {
    return { label: 'Enviado', className: 'bg-blue-100 text-blue-700' };
  }
  return { label: 'Pendente', className: 'bg-yellow-100 text-yellow-700' };
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function userFriendlyUploadError(error: unknown): string {
  if (error instanceof KycUploadApiError) {
    switch (error.code) {
      case 'INVALID_GROUP_ID':
        return 'Grupo de documento não encontrado. Atualize a página e tente novamente.';
      case 'INVALID_SLOT_ID':
        return 'Identificador do arquivo inválido. Atualize a página e tente novamente.';
      case 'SLOT_NOT_ALLOWED':
        return 'Este arquivo não pertence ao grupo informado. Atualize a página e tente novamente.';
      case 'WAITING_REQUIREMENTS':
        return 'A subconta ainda não está disponível. Aguarde alguns instantes e tente novamente.';
      default:
        return error.message || 'Erro ao enviar documento.';
    }
  }
  if (error instanceof Error) return error.message || 'Erro ao enviar documento.';
  return 'Erro ao enviar documento.';
}

type UploadSlotCardProps = {
  slot: NormalizedSlot;
  index: number;
  state: SlotState;
  busy: boolean;
  onFileChange: (index: number, file: File | null) => void;
  onError: (message: string | null) => void;
  actionId: string;
};

function UploadSlotCard({
  slot,
  index,
  state,
  busy,
  onFileChange,
  onError,
  actionId,
}: UploadSlotCardProps) {
  const statusUi = slotStatusUi(state.status);
  const isLocked = LOCKED_SLOT_STATUSES.has(state.status);
  const inputHelpId = `document-file-help-${actionId}-${index}`;

  const onDropAccepted = useCallback(
    (acceptedFiles: File[]) => {
      const selected = acceptedFiles[0] ?? null;
      onError(null);
      onFileChange(index, selected);
    },
    [index, onError, onFileChange],
  );

  const onDropRejected = useCallback(
    (rejections: FileRejection[]) => {
      const first = rejections[0];
      const code = first?.errors[0]?.code;
      if (code === 'file-too-large') {
        onError(`Arquivo muito grande. Máximo: ${UPLOAD_MAX_SIZE_MB}MB`);
        return;
      }
      onError('Formato inválido. Use PDF, JPG ou PNG.');
    },
    [onError],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDropAccepted,
    onDropRejected,
    accept: DROPZONE_ACCEPT,
    maxFiles: 1,
    maxSize: UPLOAD_MAX_SIZE_MB * 1024 * 1024,
    noClick: true,
    noKeyboard: true,
    disabled: busy || state.sending || isLocked,
  });

  const labelLower = slot.label.toLowerCase();

  return (
    <div className="rounded-2xl border border-border/80 bg-background p-4 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <Label className="text-sm font-semibold text-foreground">{slot.label}</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            {slot.label === 'Arquivo'
              ? 'Envie o arquivo solicitado para esta etapa.'
              : `Envie ${slot.label === 'Frente' ? 'a frente' : 'o verso'} do documento.`}
          </p>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${statusUi.className}`}>
          {state.status === 'APPROVED' ? (
            <CheckCircle className="h-3.5 w-3.5" />
          ) : state.status === 'REJECTED' ? (
            <ErrorCircle className="h-3.5 w-3.5" />
          ) : null}
          {statusUi.label}
        </span>
      </div>

      <div
        {...getRootProps()}
        className={[
          'rounded-2xl border-2 border-dashed p-6 transition-all',
          isDragActive ? 'border-primary bg-primary/5' : 'border-border bg-muted/20',
          busy || state.sending || isLocked ? 'cursor-not-allowed opacity-70' : 'hover:border-primary/60 hover:bg-primary/5',
        ].join(' ')}
      >
        <input {...getInputProps({ 'aria-describedby': inputHelpId })} />

        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-background shadow-sm">
            {state.file ? <FileText className="h-6 w-6 text-primary" /> : <UploadCloud className="h-6 w-6 text-primary" />}
          </div>

          {isLocked ? (
            <>
              <p className="text-sm font-medium text-foreground">
                {state.status === 'APPROVED' ? 'Arquivo aprovado' : 'Arquivo enviado para análise'}
              </p>
              <p className="max-w-xs text-xs text-muted-foreground">
                {slot.label} já foi enviado. Aguarde a análise ou reenvie apenas se o status mudar para rejeitado.
              </p>
            </>
          ) : state.file ? (
            <>
              <p className="max-w-xs break-all text-sm font-medium text-foreground">{state.file.name}</p>
              <p className="text-xs text-muted-foreground">{formatFileSize(state.file.size)}</p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-foreground">
                Arraste e solte {slot.label === 'Arquivo' ? 'o arquivo' : labelLower} aqui
              </p>
              <p className="text-xs text-muted-foreground">ou selecione no seu dispositivo</p>
            </>
          )}

          {!isLocked ? (
            <Button type="button" size="sm" variant="outline" onClick={open} disabled={busy || state.sending}>
              {state.file ? 'Trocar arquivo' : 'Selecionar arquivo'}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p id={inputHelpId} className="text-xs text-muted-foreground">
          PDF, JPG ou PNG até {UPLOAD_MAX_SIZE_MB}MB
        </p>
        {state.file ? (
          <span className="text-xs font-medium text-foreground/80">
            Pronto para enviar {labelLower}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function KycUploadModal({
  action,
  open,
  onOpenChange,
  onUpload,
  uploading,
  uploadError,
  onRefreshAfterUpload,
  onExternalRequired,
}: Props) {
  const normalizedSlots = useMemo(() => buildNormalizedSlots(action), [action]);
  const uploadGroupId = action?.uploadGroupId ?? null;

  const [slotStates, setSlotStates] = useState<SlotState[]>(() => buildInitialSlotStates(normalizedSlots));
  const [localError, setLocalError] = useState<string | null>(null);
  const [batchUploading, setBatchUploading] = useState(false);
  const isGroupIdValid = isValidKycGroupId(uploadGroupId);
  const isZeroUuid = uploadGroupId === ZERO_UUID;

  useEffect(() => {
    setSlotStates(buildInitialSlotStates(normalizedSlots));
    if (isZeroUuid) {
      setLocalError('Os documentos ainda estão sendo processados pelo provedor. Aguarde alguns instantes e tente novamente.');
    } else if (!isGroupIdValid) {
      setLocalError('Grupo de documento inválido. Recarregue a página e tente novamente.');
    } else {
      setLocalError(null);
    }
  }, [open, normalizedSlots, isGroupIdValid, isZeroUuid]);

  if (!action) return null;
  if (action.mode === 'REDIRECT') return null;
  if (action.mode === 'PROVIDER_PORTAL_REQUIRED') return null;
  if (!uploadGroupId) return null;

  const guidance = getKycDocumentGuidance(action);
  const allSent = slotStates.every((state) => LOCKED_SLOT_STATUSES.has(state.status));
  const pendingIndexes = slotStates
    .map((state, index) => ({ state, index }))
    .filter(({ state }) => state.status === 'NOT_SENT' || state.status === 'REJECTED')
    .map(({ index }) => index);
  const canSendBatch =
    isGroupIdValid &&
    pendingIndexes.length > 0 &&
    pendingIndexes.every((index) => Boolean(slotStates[index]?.file)) &&
    !batchUploading &&
    !uploading;

  const handleFileChange = (index: number, file: File | null) => {
    setLocalError(null);
    setSlotStates((prev) => prev.map((state, i) => (i === index ? { ...state, file } : state)));
  };

  const sendSingleSlot = async (index: number) => {
    if (!isGroupIdValid) {
      setLocalError('Grupo de documento inválido. Recarregue a página e tente novamente.');
      return;
    }

    const state = slotStates[index];
    if (!state?.file) return;

    const slotId = normalizedSlots[index]?.slotId;
    if (state.file.size > UPLOAD_MAX_SIZE_MB * 1024 * 1024) {
      setLocalError(`Arquivo muito grande. Máximo: ${UPLOAD_MAX_SIZE_MB}MB`);
      return;
    }

    setLocalError(null);
    setSlotStates((prev) => prev.map((slotState, i) => (i === index ? { ...slotState, sending: true } : slotState)));

    try {
      await onUpload(uploadGroupId, state.file, action.uploadType ?? undefined, slotId);
      setSlotStates((prev) =>
        prev.map((slotState, i) => (
          i === index
            ? {
                ...slotState,
                file: null,
                sending: false,
                status: 'SENT',
              }
            : slotState
        )),
      );
      pushToast({ title: `${normalizedSlots[index]?.label ?? 'Arquivo'} enviado!`, variant: 'success' });
      if (onRefreshAfterUpload) {
        await onRefreshAfterUpload().catch(() => {});
      }
    } catch (error) {
      if (error instanceof ExternalVerificationRequiredError) {
        onOpenChange(false);
        await onRefreshAfterUpload?.().catch(() => {});
        await onExternalRequired?.(action.id).catch(() => {});
        throw error;
      }

      if (error instanceof ProviderPortalRequiredError) {
        onOpenChange(false);
        await onRefreshAfterUpload?.().catch(() => {});
        pushToast({ title: error.message, variant: 'error' });
        return;
      }

      setSlotStates((prev) => prev.map((slotState, i) => (i === index ? { ...slotState, sending: false } : slotState)));
      setLocalError(userFriendlyUploadError(error));
      throw error;
    }
  };

  const handleSendPendingDocuments = async () => {
    if (!canSendBatch) return;

    setBatchUploading(true);
    setLocalError(null);

    try {
      for (const index of pendingIndexes) {
        await sendSingleSlot(index);
      }
    } catch {
      // erros já tratados individualmente em sendSingleSlot
    } finally {
      setBatchUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{action.label}</DialogTitle>
          {action.description ? <DialogDescription>{action.description}</DialogDescription> : null}
        </DialogHeader>

        <div className="mt-4 space-y-6">
          <div className="rounded-2xl border bg-muted/20 p-4">
            <p className="text-sm font-semibold text-foreground">{guidance.title}</p>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
              {guidance.checklist.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            {guidance.tips?.length ? (
              <p className="mt-3 text-xs text-muted-foreground">{guidance.tips[0]}</p>
            ) : null}
          </div>

          <div className={`grid gap-4 ${normalizedSlots.length > 1 ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
            {normalizedSlots.map((slot, index) => (
              <UploadSlotCard
                key={`${slot.label}-${slot.slotId ?? 'pending'}-${index}`}
                slot={slot}
                index={index}
                state={slotStates[index] ?? { file: null, sending: false, status: slot.status }}
                busy={batchUploading || uploading}
                onFileChange={handleFileChange}
                onError={setLocalError}
                actionId={action.id}
              />
            ))}
          </div>

          {(localError ?? uploadError) ? <p className="text-sm text-destructive">{localError ?? uploadError}</p> : null}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={batchUploading || uploading}>
              {allSent ? 'Fechar' : 'Cancelar'}
            </Button>
            {!allSent ? (
              <Button onClick={() => void handleSendPendingDocuments()} disabled={!canSendBatch}>
                {batchUploading || uploading ? 'Enviando documento...' : 'Enviar documento'}
              </Button>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
