'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { pushToast } from '@/components/ui/toast';
import { AsaasSeal } from '@/components/shared/AsaasSeal';

import {
  useAccountVerification,
  useKycUpload,
  KycActionCard,
  KycExternalOnboardingCard,
  KycUploadModal,
  statusBadge,
  verificationStatusBadge,
  type VerificationAction,
} from '@/features/kyc';

export default function VerificacaoPage() {
  const sessionResult = useSession();
  const session = sessionResult?.data;
  const status = sessionResult?.status ?? 'unauthenticated';

  const isAuthenticated = status === 'authenticated' && Boolean(session?.user?.id);
  const role = (session?.user as { role?: string } | undefined)?.role;
  const isAdmin = typeof role === 'string' && role.toUpperCase() === 'ADMIN';

  const { verification, loading, error, refresh } = useAccountVerification({
    enabled: isAuthenticated && isAdmin,
    poll: true,
  });
  const { upload, uploading, error: uploadError } = useKycUpload();

  const [uploadModal, setUploadModal] = useState<VerificationAction | null>(null);
  const [sandboxApproving, setSandboxApproving] = useState(false);
  const [verifyingActionId, setVerifyingActionId] = useState<string | null>(null);

  const pendingActions = verification?.actions ?? [];
  const hasWaitingProvider = pendingActions.some((a) => a.mode === 'WAITING_PROVIDER');

  const handleSandboxApprove = async () => {
    setSandboxApproving(true);
    try {
      const res = await fetch('/api/kyc/sandbox/approve', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        pushToast({ title: body.message ?? 'Erro ao aprovar sandbox', variant: 'error' });
        return;
      }
      pushToast({ title: 'Conta aprovada no sandbox', variant: 'success' });
      await refresh(true);
    } catch {
      pushToast({ title: 'Erro ao aprovar sandbox', variant: 'error' });
    } finally {
      setSandboxApproving(false);
    }
  };

  const handleUpload = async (groupId: string, file: File, type?: string, slotId?: string) => {
    await upload(groupId, file, type, slotId);
    await refresh(true);
  };

  const handleVerifyExternalAction = async (actionId: string) => {
    setVerifyingActionId(actionId);
    try {
      await refresh(true);
    } finally {
      setVerifyingActionId((current) => (current === actionId ? null : current));
    }
  };

  const handleOpenAction = async (action: VerificationAction) => {
    if (action.mode === 'PROVIDER_PORTAL_REQUIRED') {
      pushToast({
        title: action.description ?? 'Esta etapa precisa ser concluída no ambiente de verificação configurado para a conta.',
        variant: 'error',
      });
      return;
    }

    setUploadModal(action);
  };

  if (!isAuthenticated || !isAdmin) {
    if (loading) return null;
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-destructive">Você não tem permissão para acessar esta página.</p>
      </div>
    );
  }

  if (loading && !verification) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-destructive mb-4">{error}</p>
        <Button variant="outline" onClick={() => void refresh(true)}>Tentar novamente</Button>
      </div>
    );
  }

  const globalBadge = verification ? verificationStatusBadge(verification.status) : null;

  return (
    <div className="space-y-6 pr-3 md:pr-5">
      {/* Cabeçalho com status global */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Verificação da conta</h2>
          {globalBadge && <Badge variant={globalBadge.variant}>{globalBadge.label}</Badge>}
        </div>
        {loading && (
          <span className="text-xs text-muted-foreground animate-pulse">Atualizando...</span>
        )}
      </div>

      {/* Motivos de rejeição */}
      {verification && verification.rejectReasons.length > 0 && (
        <div className="p-4 rounded-lg border bg-red-50 border-red-200">
          <p className="font-medium text-sm">Motivos da rejeição:</p>
          <ul className="list-disc list-inside text-sm text-muted-foreground mt-1">
            {verification.rejectReasons.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Áreas de status */}
      {verification && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {verification.areas.map((area) => {
            const badge = statusBadge(area.status);
            return (
              <div key={area.key} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">{area.label}</p>
                  <p className="text-xs text-muted-foreground">{area.description}</p>
                </div>
                <Badge variant={badge.variant}>{badge.label}</Badge>
              </div>
            );
          })}
        </div>
      )}

      {/* Ações pendentes */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground">Ações necessárias</h3>

        {/* Provedor ainda gerando os links — polling resolve automaticamente */}
        {hasWaitingProvider && (
          <p className="text-xs text-muted-foreground">
            As etapas pendentes são verificadas automaticamente. Se um link externo ou upload interno for liberado, ele aparecerá aqui.
          </p>
        )}

        {pendingActions.length > 0 ? (
          pendingActions.map((action) => (
            action.mode === 'REDIRECT' ? (
              <KycExternalOnboardingCard
                key={action.id}
                action={action}
                verifying={verifyingActionId === action.id}
                onVerify={async () => handleVerifyExternalAction(action.id)}
              />
            ) : (
              <KycActionCard
                key={action.id}
                action={action}
                onAction={handleOpenAction}
                isSandbox={verification?.isSandbox}
                onSandboxApprove={!sandboxApproving ? handleSandboxApprove : undefined}
              />
            )
          ))
        ) : (
          <div className="rounded-lg border p-4 text-sm text-muted-foreground">
            Nenhuma ação pendente no momento.
          </div>
        )}
      </div>

      <KycUploadModal
        action={uploadModal}
        open={!!uploadModal}
        onOpenChange={(open) => !open && setUploadModal(null)}
        onUpload={handleUpload}
        uploading={uploading}
        uploadError={uploadError}
        onRefreshAfterUpload={() => refresh(true)}
      />

      <div className="flex justify-center pt-4 pb-2">
        <AsaasSeal variant="negativo-preto" />
      </div>
    </div>
  );
}
