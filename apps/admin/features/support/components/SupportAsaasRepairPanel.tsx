'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { InfoCallout } from '@/components/ui/info-callout';
import { Input } from '@/components/ui/input';
import { SupportActionModal } from '@/features/support/components/SupportActionModal';
import { formatDateTime } from '@/features/support/shared/format';
import type { AsaasSupportDiagnosis, AsaasSupportRepairExecuteAction } from '@alusa/finance';

export type SupportAsaasRepairPanelProps = {
  contaId: string;
  accountStatus?: string | null;
  financeStatus?: string | null;
  webhookStatus?: string | null;
};

type Feedback = { tone: 'brand' | 'warning'; text: string };

const supportedActions = new Set<AsaasSupportRepairExecuteAction>([
  'BOOTSTRAP_LOCAL',
  'ENQUEUE_PROVISION',
  'REPAIR_WEBHOOK',
  'RECONCILE',
  'LINK_SUBACCOUNT',
  'RECOVER_API_KEY',
]);

function getIntegrationState(diagnosis: AsaasSupportDiagnosis) {
  if (diagnosis.credentialHealth === 'DECRYPTION_FAILED' || diagnosis.needsApiKeyRecovery) {
    return {
      label: 'Acesso indisponível',
      tone: 'danger' as const,
      description:
        'A Alusa não consegue autenticar nesta subconta. Recupere o acesso para restabelecer a integração.',
    };
  }

  if (diagnosis.webhookDrift === true) {
    return {
      label: 'Atenção necessária',
      tone: 'warning' as const,
      description:
        'A integração está conectada, mas a configuração dos webhooks apresenta divergências.',
    };
  }

  if (diagnosis.provisionJob || diagnosis.webhookJob) {
    return {
      label: 'Em configuração',
      tone: 'info' as const,
      description: 'A configuração da integração está sendo concluída. Nenhuma ação adicional é necessária agora.',
    };
  }

  if (diagnosis.phase === 'WIZARD_INCOMPLETE') {
    return {
      label: 'Configuração pendente',
      tone: 'warning' as const,
      description: 'Ainda faltam dados da conta para concluir a configuração financeira.',
    };
  }

  if (diagnosis.phase === 'LOCAL_BOOTSTRAP_NEEDED') {
    return {
      label: 'Configuração pendente',
      tone: 'warning' as const,
      description: 'A estrutura local da integração ainda precisa ser preparada para esta conta.',
    };
  }

  if (diagnosis.phase === 'READY_TO_ENQUEUE_PROVISION') {
    return {
      label: 'Configuração pendente',
      tone: 'warning' as const,
      description: 'A conta está pronta para concluir a configuração da subconta Asaas.',
    };
  }

  if (diagnosis.integrationOperational) {
    return {
      label: 'Funcionando normalmente',
      tone: 'success' as const,
      description: 'A integração está conectada e pronta para operar.',
    };
  }

  return {
    label: 'Configuração pendente',
    tone: 'warning' as const,
    description: diagnosis.hint,
  };
}

function actionCopy(action: AsaasSupportRepairExecuteAction) {
  const copy: Record<AsaasSupportRepairExecuteAction, { label: string; title: string; description: string }> = {
    BOOTSTRAP_LOCAL: {
      label: 'Inicializar integração',
      title: 'Inicializar integração Asaas',
      description: 'A Alusa criará os registros locais necessários para continuar o onboarding financeiro.',
    },
    ENQUEUE_PROVISION: {
      label: 'Continuar configuração',
      title: 'Continuar configuração da conta',
      description: 'A Alusa colocará o provisionamento da subconta na fila para processamento seguro.',
    },
    REPAIR_WEBHOOK: {
      label: 'Reparar integração',
      title: 'Reparar integração Asaas',
      description: 'A Alusa verificará e alinhará a configuração dos webhooks sem exigir edição manual.',
    },
    RECONCILE: {
      label: 'Verificar divergências',
      title: 'Verificar divergências',
      description: 'A Alusa comparará os estados necessários com o Asaas e atualizará o estado local quando houver diferença.',
    },
    LINK_SUBACCOUNT: {
      label: 'Vincular subconta',
      title: 'Vincular subconta Asaas',
      description: 'Informe o ID da subconta criada no Asaas. A Alusa conferirá o CPF/CNPJ antes de criar o vínculo.',
    },
    RECOVER_API_KEY: {
      label: 'Recuperar acesso',
      title: 'Recuperar acesso Asaas',
      description: 'A Alusa criará e validará uma nova credencial no servidor, armazenará o segredo criptografado e reparará a integração.',
    },
  };
  return copy[action];
}

function StatusIndicator({
  tone,
  label,
}: {
  tone: 'success' | 'warning' | 'danger' | 'info';
  label: string;
}) {
  return <span className={`support-integration-status support-integration-status-${tone}`}>{label}</span>;
}

function SummaryItem({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'warning' | 'danger' | 'info';
}) {
  return (
    <div className="support-integration-summary-item">
      <span>{label}</span>
      {tone ? <StatusIndicator tone={tone} label={value} /> : <strong>{value}</strong>}
    </div>
  );
}

export function SupportAsaasRepairPanel({
  contaId,
  accountStatus,
  financeStatus,
  webhookStatus,
}: SupportAsaasRepairPanelProps) {
  const router = useRouter();
  const [diagnosis, setDiagnosis] = useState<AsaasSupportDiagnosis | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingDiag, setLoadingDiag] = useState(true);
  const [pendingAction, setPendingAction] = useState<AsaasSupportRepairExecuteAction | null>(null);
  const [reason, setReason] = useState('');
  const [linkId, setLinkId] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const loadDiagnosis = useCallback(async () => {
    setLoadingDiag(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/admin/actions/asaas-support-diagnose', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contaId }),
      });
      const json = (await res.json().catch(() => null)) as {
        success?: boolean;
        data?: AsaasSupportDiagnosis;
        error?: string;
      } | null;
      if (!res.ok || !json?.success || !json.data) {
        setLoadError(json?.error ?? 'Não foi possível carregar o diagnóstico.');
        setDiagnosis(null);
        return;
      }
      setDiagnosis(json.data);
    } catch {
      setLoadError('Falha de rede ao carregar diagnóstico.');
      setDiagnosis(null);
    } finally {
      setLoadingDiag(false);
    }
  }, [contaId]);

  useEffect(() => {
    void loadDiagnosis();
  }, [loadDiagnosis]);

  const closeActionModal = useCallback(() => {
    if (actionLoading) return;
    setPendingAction(null);
    setReason('');
    setLinkId('');
  }, [actionLoading]);

  async function runAction() {
    if (!pendingAction || reason.trim().length < 8 || actionLoading) return;
    if (pendingAction === 'LINK_SUBACCOUNT' && !linkId.trim()) return;

    setActionLoading(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/admin/actions/asaas-support-repair', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contaId,
          reason: reason.trim(),
          action: pendingAction,
          ...(pendingAction === 'LINK_SUBACCOUNT' ? { linkAsaasAccountId: linkId.trim() } : {}),
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        success?: boolean;
        data?: { steps?: { summary: string }[] };
        error?: string;
        finalDiagnosis?: AsaasSupportDiagnosis;
      } | null;

      if (!res.ok || !json?.success) {
        if (json?.finalDiagnosis) setDiagnosis(json.finalDiagnosis);
        setFeedback({ tone: 'warning', text: json?.error ?? 'A ação não foi concluída.' });
        return;
      }

      const summaries = json.data?.steps?.map((step) => step.summary).filter(Boolean) ?? [];
      setPendingAction(null);
      setReason('');
      setLinkId('');
      setFeedback({
        tone: 'brand',
        text: summaries.length ? summaries.join(' ') : 'Ação concluída.',
      });
      router.refresh();
      await loadDiagnosis();
    } catch {
      setFeedback({ tone: 'warning', text: 'Falha de rede ao executar a ação.' });
    } finally {
      setActionLoading(false);
    }
  }

  if (loadingDiag && !diagnosis) {
    return (
      <InfoCallout variant="info" size="sm" showIcon>
        Carregando o estado da integração…
      </InfoCallout>
    );
  }

  if (loadError) {
    const isEncryptionConfigurationError = loadError.includes('ENCRYPTION_KEY');
    return (
      <div className="support-integration-error">
        <InfoCallout
          variant="warning"
          size="sm"
          showIcon
          title={isEncryptionConfigurationError ? 'Configuração de segurança pendente' : 'Diagnóstico indisponível'}
        >
          {isEncryptionConfigurationError
            ? 'O Admin precisa da mesma chave de criptografia do app principal para ler as credenciais persistidas.'
            : loadError}
        </InfoCallout>
        <Button type="button" variant="outline" size="sm" onClick={() => void loadDiagnosis()}>
          Verificar novamente
        </Button>
      </div>
    );
  }

  if (!diagnosis) return null;

  const integrationState = getIntegrationState(diagnosis);
  const recommendedAction = supportedActions.has(diagnosis.recommendedAction as AsaasSupportRepairExecuteAction)
    ? (diagnosis.recommendedAction as AsaasSupportRepairExecuteAction)
    : null;
  const mvpAction = recommendedAction && recommendedAction !== 'RECONCILE'
    ? recommendedAction
    : null;
  const recommendedCopy = mvpAction ? actionCopy(mvpAction) : null;
  const credentialTone = diagnosis.credentialHealth === 'CONNECTED' ? 'success' : 'danger';
  const webhookTone = webhookStatus === 'ACTIVE' || diagnosis.webhookDrift === false
    ? 'success'
    : diagnosis.webhookDrift === true
    ? 'warning'
    : diagnosis.webhookJob
      ? 'info'
      : 'warning';
  const modalCopy = pendingAction ? actionCopy(pendingAction) : null;

  return (
    <section className="support-integration-card">
      <div className="support-integration-summary">
        <SummaryItem label="Situação da conta" value={accountStatus ?? 'Não verificada'} />
        <SummaryItem label="Status financeiro" value={financeStatus ?? 'Não informado'} />
        <SummaryItem label="Credencial" value={diagnosis.credentialHealth === 'CONNECTED' ? 'Ativa' : 'Indisponível'} tone={credentialTone} />
        <SummaryItem
          label="Webhooks"
          value={webhookStatus === 'ACTIVE' || diagnosis.webhookDrift === false ? 'Ativos' : diagnosis.webhookJob ? 'Em configuração' : diagnosis.webhookDrift === true ? 'Ação necessária' : 'Não verificados'}
          tone={webhookTone}
        />
        <SummaryItem label="Última verificação" value={diagnosis.lastCheckedAt ? formatDateTime(diagnosis.lastCheckedAt) : 'Ainda não verificado'} />
      </div>

      <div className="support-integration-message">
        <InfoCallout variant={integrationState.tone === 'success' ? 'brand' : integrationState.tone === 'info' ? 'info' : 'warning'} size="sm" showIcon>
          {integrationState.description}
        </InfoCallout>
      </div>

      <div className="support-integration-next-action">
        <div>
          <span>Manutenção</span>
          <strong>{recommendedCopy ? 'Há uma correção recomendada' : 'Nenhuma ação necessária'}</strong>
        </div>
        <div className="support-integration-actions">
          {recommendedCopy ? (
            <Button type="button" onClick={() => setPendingAction(mvpAction)}>
              Corrigir integração
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={() => void loadDiagnosis()} disabled={loadingDiag || actionLoading}>
            Verificar novamente
          </Button>
        </div>
      </div>

      {feedback ? (
        <div className="support-integration-feedback">
          <InfoCallout variant={feedback.tone} size="sm" showIcon>
            {feedback.text}
          </InfoCallout>
        </div>
      ) : null}

      {pendingAction && modalCopy ? (
        <SupportActionModal
          title={modalCopy.title}
          description={modalCopy.description}
          confirmLabel={modalCopy.label}
          reason={reason}
          onReasonChange={setReason}
          onConfirm={() => void runAction()}
          onClose={closeActionModal}
          disabled={actionLoading}
        >
          {pendingAction === 'RECOVER_API_KEY' ? (
            <InfoCallout variant="info" size="sm" showIcon>
              O Asaas pode exigir que o gerenciamento de chaves de subcontas esteja liberado temporariamente e que o IP de saída da Alusa esteja autorizado na whitelist.{' '}
              <a href="https://docs.asaas.com/docs/gerenciamento-de-chaves-de-api-de-subcontas" target="_blank" rel="noreferrer">
                Ver requisitos do Asaas
              </a>
            </InfoCallout>
          ) : null}
          {pendingAction === 'LINK_SUBACCOUNT' ? (
            <label className="support-action-modal-field">
              <span>ID da subconta Asaas</span>
              <Input value={linkId} onChange={(event) => setLinkId(event.target.value)} placeholder="Informe o ID da subconta" disabled={actionLoading} />
            </label>
          ) : null}
        </SupportActionModal>
      ) : null}
    </section>
  );
}
