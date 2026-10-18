'use client';

import { useRef, useState } from 'react';
import { useSession } from 'next-auth/react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { pushToast } from '@/components/ui/toast';
import { AsaasSeal } from '@/components/shared/AsaasSeal';

import {
  useAccountVerification,
  useKycUpload,
  KycUploadModal,
  statusBadge,
  verificationStatusBadge,
  type VerificationAction,
  type SubaccountProvisioningHint,
} from '@/features/kyc';

function provisioningCopy(hint: SubaccountProvisioningHint): { title: string; description: string } {
  switch (hint.state) {
    case 'QUEUED':
      return {
        title: 'Criando sua conta de pagamentos',
        description:
          'Seus dados foram recebidos. Estamos provisionando a subconta no Asaas — em geral leva poucos minutos. Esta página atualiza automaticamente.',
      };
    case 'PROCESSING':
      return {
        title: 'Provisionamento em andamento',
        description: 'Aguarde enquanto concluímos a criação da subconta.',
      };
    case 'FAILED':
      return {
        title: 'Não foi possível criar a subconta automaticamente',
        description:
          hint.lastError?.replace(/^RECOVERY_REQUIRED:/, '') ??
          'Tente novamente mais tarde ou fale com o suporte. O erro foi registrado para análise.',
      };
    case 'ACTION_REQUIRED':
      return {
        title: 'Atualize o e-mail da subconta',
        description:
          hint.lastError ?? 'Volte ao assistente financeiro e informe outro e-mail para a subconta Asaas.',
      };
    case 'RECOVERY_REQUIRED':
      return {
        title: 'Reconexão necessária',
        description:
          'A subconta pode existir no Asaas, mas precisamos reconectar a chave de API no painel administrativo.',
      };
    default:
      return {
        title: 'Aguardando integração financeira',
        description: 'Atualizando status…',
      };
  }
}

export default function VerificacaoPage() {
  const sessionResult = useSession();
  const session = sessionResult?.data;
  const status = sessionResult?.status ?? 'unauthenticated';

  const isAuthenticated = status === 'authenticated' && Boolean(session?.user?.id);
  const role = (session?.user as { role?: string } | undefined)?.role;
  const isAdmin = typeof role === 'string' && role.toUpperCase() === 'ADMIN';

  const { verification, loading, error, refresh, provisioningHint } = useAccountVerification({
    enabled: isAuthenticated && isAdmin,
    poll: true,
  });
  const { upload, uploading, error: uploadError } = useKycUpload();

  const [uploadModal, setUploadModal] = useState<VerificationAction | null>(null);
  const [approvedModalOpen, setApprovedModalOpen] = useState(false);
  const [sandboxApproving, setSandboxApproving] = useState(false);
  const sandboxApprovingRef = useRef(false);
  const [verifyingActionId, setVerifyingActionId] = useState<string | null>(null);

  const pendingActions = verification?.actions ?? [];
  const hasWaitingProvider = pendingActions.some((a) => a.mode === 'WAITING_PROVIDER');
  const documentAction = pendingActions.find(
    (action) => (action.mode !== 'WAITING_PROVIDER' || action.submissionMethod === 'EXTERNAL_ONBOARDING_URL')
      && action.mode !== 'PROVISIONING_TIMEOUT'
      && action.documentType?.trim().toUpperCase() !== 'IDENTIFICATION_SELFIE',
  ) ?? null;
  const selfieAction = pendingActions.find(
    (action) => action.documentType?.trim().toUpperCase() === 'IDENTIFICATION_SELFIE'
      && (action.mode !== 'WAITING_PROVIDER' || action.submissionMethod === 'EXTERNAL_ONBOARDING_URL')
      && action.mode !== 'PROVISIONING_TIMEOUT',
  ) ?? null;
  const documentsApproved = verification?.areas.some(
    (area) => area.key === 'documentation' && area.status === 'APPROVED',
  ) ?? false;
  const provisioningBanner = provisioningHint ? provisioningCopy(provisioningHint) : null;

  const handleSandboxApprove = async () => {
    if (sandboxApprovingRef.current) return;
    sandboxApprovingRef.current = true;
    setSandboxApproving(true);
    try {
      const res = await fetch('/api/kyc/sandbox/approve', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        pushToast({ title: body.message ?? 'Erro ao aprovar sandbox', variant: 'error' });
        return;
      }
      const body = await res.json().catch(() => null) as {
        data?: { generalStatus?: string; alreadyRequested?: boolean };
      } | null;
      const approved = body?.data?.generalStatus?.toUpperCase() === 'APPROVED';
      pushToast({
        title: approved
          ? 'Conta aprovada no sandbox'
          : 'Aprovação solicitada. Aguardando confirmação do Asaas.',
        variant: 'success',
      });
      await refresh(!approved);
    } catch {
      pushToast({ title: 'Erro ao aprovar sandbox', variant: 'error' });
    } finally {
      sandboxApprovingRef.current = false;
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

  const handleDocumentAction = () => {
    if (documentsApproved) {
      setUploadModal(null);
      setApprovedModalOpen(true);
      return;
    }
    if (!documentAction) {
      return;
    }
    if (documentAction.mode === 'WAITING_PROVIDER') {
      void handleVerifyExternalAction(documentAction.id);
      return;
    }
    if (documentAction.mode === 'REDIRECT') {
      if (documentAction.isRedirectExpired || !documentAction.redirectUrl) {
        void handleVerifyExternalAction(documentAction.id);
        return;
      }
      window.open(documentAction.redirectUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    void handleOpenAction(documentAction);
  };

  const handleSelfieAction = () => {
    if (!selfieAction) return;
    if (selfieAction.mode === 'WAITING_PROVIDER') {
      void handleVerifyExternalAction(selfieAction.id);
      return;
    }
    if (selfieAction.mode === 'REDIRECT') {
      if (selfieAction.isRedirectExpired || !selfieAction.redirectUrl) {
        void handleVerifyExternalAction(selfieAction.id);
        return;
      }
      window.open(selfieAction.redirectUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    void handleOpenAction(selfieAction);
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
  const commercialArea = verification?.areas.find((area) => area.key === 'commercialInfo');
  const documentArea = verification?.areas.find((area) => area.key === 'documentation');
  const commercialBadge = commercialArea ? statusBadge(commercialArea.status) : null;
  const documentBadge = documentArea ? statusBadge(documentArea.status) : null;
  const sandboxApprovalAvailable = verification?.isSandbox && pendingActions.some((action) => action.mode === 'PROVISIONING_TIMEOUT');

  return (
    <div className="space-y-6 pr-3 md:pr-5">
      {provisioningBanner ? (
        <div
          className="rounded-lg border border-amber-200 bg-amber-50/80 p-4 text-sm dark:border-amber-900/50 dark:bg-amber-950/30"
          role="status"
        >
          <p className="font-medium text-amber-950 dark:text-amber-100">{provisioningBanner.title}</p>
          <p className="mt-1 text-amber-900/90 dark:text-amber-200/90">{provisioningBanner.description}</p>
          {provisioningHint?.state === 'ACTION_REQUIRED' ? (
            <a
              href="/finance/wizard"
              className="mt-3 inline-flex font-semibold text-[#55298a] underline underline-offset-4"
            >
              Revisar e-mail financeiro
            </a>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">Situação cadastral</h2>
        </div>
        {loading && (
          <span className="text-xs text-muted-foreground animate-pulse" role="status">Atualizando...</span>
        )}
      </div>

      {!verification ? (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>O estado da verificação está sendo preparado. A atualização automática virá do webhook ou da reconciliação.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void refresh(true)}>
            Consultar agora
          </Button>
        </div>
      ) : null}

      {verification ? (
        <>
          <section className="overflow-hidden rounded-xl border border-border bg-card" aria-label="Etapas cadastrais">
            <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div className="min-w-0 space-y-1">
                <h3 className="text-sm font-semibold text-foreground">1. Preenchimento dos Dados Comerciais</h3>
          <p className="text-sm text-muted-foreground">
                  <a href="/account/profile" className="text-primary underline underline-offset-4">Clique aqui</a>
                  {' para editar seus dados comerciais.'}
                </p>
              </div>
              {commercialBadge ? (
                <Badge
                  variant={commercialBadge.label === 'Aprovado' ? 'success' : commercialBadge.variant}
                  className="shrink-0"
                >
                  {commercialBadge.label}
                </Badge>
              ) : null}
            </div>

            <div className="border-t border-border/70" />

            <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div className="min-w-0 space-y-1">
                <h3 className="text-sm font-semibold text-foreground">2. Envio de documentos</h3>
                <p className="text-sm text-muted-foreground">
                  <button
                    type="button"
                    onClick={handleDocumentAction}
                    disabled={(!documentAction && !documentsApproved) || (documentAction?.mode === 'REDIRECT' && verifyingActionId === documentAction.id)}
                    aria-busy={Boolean(documentAction && verifyingActionId === documentAction.id)}
                    className="text-left text-primary underline underline-offset-4 disabled:cursor-not-allowed disabled:text-muted-foreground"
                  >
                    Clique aqui
                  </button>
                  {' para enviar seus documentos.'}
                </p>
              </div>
              {documentBadge ? (
                <Badge
                  variant={documentBadge.label === 'Aprovado' ? 'success' : documentBadge.variant}
                  className="shrink-0"
                >
                  {documentBadge.label}
                </Badge>
              ) : null}
            </div>

            {selfieAction ? (
              <>
                <div className="border-t border-border/70" />
                <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                  <div className="min-w-0 space-y-1">
                    <h3 className="text-sm font-semibold text-foreground">3. Selfie de identificação</h3>
                    <p className="text-sm text-muted-foreground">
                      <button
                        type="button"
                        onClick={handleSelfieAction}
                        disabled={selfieAction.mode === 'REDIRECT' && verifyingActionId === selfieAction.id}
                        aria-busy={selfieAction.mode === 'REDIRECT' && verifyingActionId === selfieAction.id}
                        className="text-left text-primary underline underline-offset-4 disabled:cursor-not-allowed disabled:text-muted-foreground"
                      >
                        Clique aqui
                      </button>
                      {' para enviar sua selfie de identificação.'}
                    </p>
                  </div>
                  <Badge
                    variant={selfieAction.status === 'REJECTED' ? 'destructive' : 'warning'}
                    className="shrink-0"
                  >
                    {selfieAction.status === 'REJECTED' ? 'Rejeitado' : 'Pendente'}
                  </Badge>
                </div>
              </>
            ) : null}

            {hasWaitingProvider ? (
              <div className="flex flex-col gap-2 border-t border-border/70 px-4 py-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-5" role="status">
                <span>As etapas pendentes são atualizadas por webhook e reconciliação. Você também pode verificar agora.</span>
                <Button type="button" variant="outline" size="sm" onClick={() => void refresh(true)}>
                  Verificar agora
                </Button>
              </div>
            ) : null}
            {sandboxApprovalAvailable ? (
              <div className="border-t border-border/70 px-4 py-3 sm:px-5">
                <Button size="sm" onClick={handleSandboxApprove} disabled={sandboxApproving}>
                  {sandboxApproving ? 'Aprovando...' : 'Aprovar conta (sandbox)'}
                </Button>
              </div>
            ) : null}
          </section>

          <section className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5" aria-labelledby="approval-section-title">
            <div className="flex items-center justify-between gap-3">
              <h3 id="approval-section-title" className="text-sm font-semibold text-foreground">Aprovação geral:</h3>
              {globalBadge && <Badge variant={globalBadge.variant}>{globalBadge.label}</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">
              O cadastro somente pode ir para aprovação após finalizadas as etapas anteriores.
            </p>
            {verification.rejectReasons.length > 0 ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900/50 dark:bg-red-950/30">
                <p className="text-sm font-medium text-red-950 dark:text-red-100">Motivos da rejeição:</p>
                <ul className="mt-1 list-disc list-inside text-sm text-red-900/90 dark:text-red-200/90">
                  {verification.rejectReasons.map((reason, i) => (
                    <li key={i}>{reason}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        </>
      ) : null}

      <KycUploadModal
        action={uploadModal}
        open={!!uploadModal || approvedModalOpen}
        onOpenChange={(open) => {
          if (!open) {
            setUploadModal(null);
            setApprovedModalOpen(false);
          }
        }}
        onUpload={handleUpload}
        uploading={uploading}
        uploadError={uploadError}
        onRefreshAfterUpload={() => refresh(true)}
        documentsApproved={documentsApproved}
      />

      <div className="flex justify-center pt-4 pb-2">
        <AsaasSeal variant="negativo-preto" />
      </div>
    </div>
  );
}
