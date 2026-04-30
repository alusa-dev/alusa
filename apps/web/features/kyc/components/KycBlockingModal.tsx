'use client';

import { useRouter } from 'next/navigation';
import { Warning } from '@/components/icons/icons';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type { AccountVerificationResponse } from '../constants';

type Props = {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  verification: AccountVerificationResponse | null;
  reason?: string;
};

export function KycBlockingModal({ open, onOpenChange, verification, reason }: Props) {
  const router = useRouter();

  const isRejected = verification?.status === 'ACCOUNT_REQUIRES_CORRECTION';
  const isCommercialInfoExpired = verification?.commercialInfoStatus === 'EXPIRED';
  const redirectAction = verification?.actions.find(
    (a) => a.mode === 'REDIRECT' && a.redirectUrl && !a.isRedirectExpired,
  );

  const totalSlots = verification?.actions.reduce((acc, a) => {
    if (a.mode !== 'UPLOAD') return acc;
    return acc + (a.slots?.length ?? 1);
  }, 0) ?? 0;

  const sentSlots = verification?.actions.reduce((acc, a) => {
    if (a.mode !== 'UPLOAD' || !a.slots) return acc;
    return acc + a.slots.filter((s) => s.status !== 'NOT_SENT' && s.status !== 'REJECTED').length;
  }, 0) ?? 0;

  const progressText = totalSlots > 0 ? `${sentSlots}/${totalSlots} enviados` : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Warning className={`h-5 w-5 ${isRejected ? 'text-red-500' : 'text-yellow-500'}`} />
            <DialogTitle>Verificação pendente</DialogTitle>
          </div>
          <DialogDescription className="mt-2">
            {reason ??
              (isCommercialInfoExpired
                ? 'Seus dados comerciais estão expirados. Regularize para continuar usando operações financeiras.'
                : isRejected
                ? 'Seu cadastro foi reprovado. Corrija os documentos para continuar.'
                : 'Envie seus documentos para liberar cobranças, matrículas e alunos.')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {verification?.rejectReasons && verification.rejectReasons.length > 0 && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3">
              <p className="text-sm font-medium text-red-800 mb-1">Motivos da rejeição:</p>
              <ul className="list-disc list-inside text-sm text-red-700 space-y-0.5">
                {verification.rejectReasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          {progressText && (
            <p className="text-sm text-muted-foreground">Progresso: {progressText}</p>
          )}

          <div className="flex flex-col gap-2">
            <Button
              className="w-full"
              onClick={() => {
                onOpenChange(false);
                router.push(isCommercialInfoExpired ? '/conta/perfil' : '/conta/verificacao');
              }}
            >
              {isCommercialInfoExpired ? 'Regularizar dados comerciais' : 'Enviar documentos'}
            </Button>

            {redirectAction && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => window.open(redirectAction.redirectUrl!, '_blank')}
              >
                Continuar verificação externa
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
