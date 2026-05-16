'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { AsaasSupportDiagnosis, AsaasSupportRepairExecuteAction } from '@alusa/finance';

export type SupportAsaasRepairPanelProps = {
  contaId: string;
};

export function SupportAsaasRepairPanel({ contaId }: SupportAsaasRepairPanelProps) {
  const router = useRouter();
  const [diagnosis, setDiagnosis] = useState<AsaasSupportDiagnosis | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingDiag, setLoadingDiag] = useState(true);
  const [reason, setReason] = useState('');
  const [linkId, setLinkId] = useState('');
  const [manualApiKey, setManualApiKey] = useState('');
  const [confirmGeneratedWithScript, setConfirmGeneratedWithScript] = useState(false);
  const [confirmExistingSubaccount, setConfirmExistingSubaccount] = useState(false);
  const [confirmRotatedExistingKey, setConfirmRotatedExistingKey] = useState(false);
  const [confirmEncryptedStorage, setConfirmEncryptedStorage] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [lastSteps, setLastSteps] = useState<{ step: string; summary: string }[] | null>(null);

  const reasonValid = reason.trim().length >= 8;

  const loadDiagnosis = useCallback(async () => {
    setLoadingDiag(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/developer/actions/asaas-support-diagnose', {
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

  const manualApiKeyReady =
    Boolean(diagnosis?.effectiveAsaasAccountId) &&
    reasonValid &&
    manualApiKey.trim().length >= 10 &&
    confirmGeneratedWithScript &&
    confirmExistingSubaccount &&
    confirmRotatedExistingKey &&
    confirmEncryptedStorage;

  async function runRepair(action: AsaasSupportRepairExecuteAction) {
    if (!reasonValid || actionLoading) return;
    if (action === 'LINK_SUBACCOUNT' && !linkId.trim()) return;

    setActionLoading(true);
    setFeedback(null);
    setLastSteps(null);
    try {
      const res = await fetch('/api/developer/actions/asaas-support-repair', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contaId,
          reason: reason.trim(),
          action,
          ...(action === 'LINK_SUBACCOUNT' ? { linkAsaasAccountId: linkId.trim() } : {}),
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        success?: boolean;
        data?: { steps?: { step: string; summary: string }[] };
        error?: string;
        finalDiagnosis?: AsaasSupportDiagnosis;
      } | null;
      if (!res.ok || !json?.success) {
        setFeedback({
          tone: 'err',
          text: json?.error ?? 'Ação não concluída.',
        });
        const failJson = json as {
          finalDiagnosis?: AsaasSupportDiagnosis;
        };
        if (failJson.finalDiagnosis) setDiagnosis(failJson.finalDiagnosis);
        else void loadDiagnosis();
        return;
      }
      const steps = json.data?.steps ?? [];
      setLastSteps(steps.length ? steps : null);
      setFeedback({
        tone: 'ok',
        text: steps.length ? steps.map((s) => `• ${s.summary}`).join('\n') : 'Concluído.',
      });
      router.refresh();
      await loadDiagnosis();
    } catch {
      setFeedback({ tone: 'err', text: 'Falha de rede.' });
    } finally {
      setActionLoading(false);
    }
  }

  async function saveManualApiKey() {
    if (!manualApiKeyReady || actionLoading) return;

    setActionLoading(true);
    setFeedback(null);
    setLastSteps(null);
    try {
      const res = await fetch('/api/developer/actions/asaas-save-manual-api-key', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contaId,
          apiKey: manualApiKey.trim(),
          reason: reason.trim(),
          confirmations: {
            generatedWithLocalScript: true,
            belongsToExistingSubaccount: true,
            rotatedExistingKeyWhenPresent: true,
            understandsEncryptedStorage: true,
          },
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        success?: boolean;
        data?: {
          summary?: string;
          webhook?: { reason: string };
          reconcile?: { reconciled: boolean };
          warnings?: { summary: string }[];
        };
        error?: string;
      } | null;

      if (!res.ok || !json?.success) {
        setFeedback({ tone: 'err', text: json?.error ?? 'Chave não salva.' });
        void loadDiagnosis();
        return;
      }

      const warnings = json.data?.warnings ?? [];
      const lines = [
        'Chave validada e salva com segurança.',
        json.data?.webhook?.reason === 'REPAIRED'
          ? 'Webhook reparado/alinhado.'
          : 'Webhook verificado.',
        json.data?.reconcile?.reconciled ? 'Reconciliação concluída.' : 'Reconciliação verificada.',
        warnings.length ? `Avisos: ${warnings.map((w) => w.summary).join(' | ')}` : null,
      ].filter(Boolean);

      setManualApiKey('');
      setConfirmGeneratedWithScript(false);
      setConfirmExistingSubaccount(false);
      setConfirmRotatedExistingKey(false);
      setConfirmEncryptedStorage(false);
      setFeedback({ tone: 'ok', text: lines.join('\n') });
      router.refresh();
      await loadDiagnosis();
    } catch {
      setFeedback({ tone: 'err', text: 'Falha de rede.' });
    } finally {
      setActionLoading(false);
    }
  }

  async function copySubaccountId() {
    const id = diagnosis?.effectiveAsaasAccountId;
    if (!id) return;
    await navigator.clipboard?.writeText(id).catch(() => undefined);
    setFeedback({ tone: 'ok', text: 'ID da subconta copiado.' });
  }

  if (loadingDiag && !diagnosis) {
    return (
      <div className="mt-4 rounded-md border border-slate-200 bg-slate-50/80 px-3 py-2 text-sm text-slate-700">
        A carregar diagnóstico da integração…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mt-4 space-y-2">
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-950">
          {loadError}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void loadDiagnosis()}
          className="border-slate-200"
        >
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (!diagnosis) return null;

  if (diagnosis.phase === 'NOT_WHITELABEL_BAAS') {
    return <p className="mt-4 text-sm text-slate-600">{diagnosis.hint}</p>;
  }

  return (
    <div className="mt-4 space-y-4 text-sm">
      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-slate-800">
        <p className="font-medium text-slate-900">Diagnóstico</p>
        <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">
          Fase: {diagnosis.phase}
        </p>
        <p className="mt-2 text-slate-700">{diagnosis.hint}</p>
        <dl className="mt-3 grid gap-1 text-xs text-slate-600">
          <div>
            <span className="font-medium text-slate-700">Próximo passo sugerido:</span>{' '}
            {diagnosis.recommendedAction}
          </div>
          <div>
            <span className="font-medium text-slate-700">Subconta (ID):</span>{' '}
            {diagnosis.effectiveAsaasAccountId ?? '—'}
          </div>
          <div>
            <span className="font-medium text-slate-700">API Key:</span>{' '}
            {diagnosis.needsApiKeyRecovery
              ? diagnosis.integrationOperational
                ? 'inválida'
                : 'ausente'
              : 'CONNECTED'}
          </div>
          <div>
            <span className="font-medium text-slate-700">Webhook:</span>{' '}
            {diagnosis.webhookDrift === null
              ? 'não avaliado ou sem credencial de subconta'
              : diagnosis.webhookDrift
                ? 'desvio detectado'
                : 'alinhado'}
          </div>
          {diagnosis.provisionJob ? (
            <div>
              <span className="font-medium text-slate-700">Job provisionamento:</span>{' '}
              {diagnosis.provisionJob.status}
            </div>
          ) : null}
          {diagnosis.missingWizardFields.length > 0 ? (
            <div>
              <span className="font-medium text-slate-700">Campos do assistente:</span>{' '}
              {diagnosis.missingWizardFields.join(', ')}
            </div>
          ) : null}
        </dl>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-2 h-8 px-2 text-slate-600"
          disabled={actionLoading}
          onClick={() => void loadDiagnosis()}
        >
          Atualizar diagnóstico
        </Button>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
          Motivo (mínimo 8 caracteres)
        </label>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ex.: Reparo suporte — sync Asaas."
          disabled={actionLoading}
          rows={3}
          className="resize-y border-slate-200"
        />
      </div>

      <div className="rounded-md border border-slate-200 bg-white px-3 py-3">
        <p className="font-medium text-slate-900">Rotacionar e salvar API Key da subconta</p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            value={diagnosis.effectiveAsaasAccountId ?? ''}
            readOnly
            aria-label="ID da subconta Asaas"
            className="border-slate-200 sm:max-w-sm"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!diagnosis.effectiveAsaasAccountId || actionLoading}
            className="border-slate-200"
            onClick={() => void copySubaccountId()}
          >
            Copiar ID da subconta
          </Button>
        </div>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-xs text-slate-700">
          <li>
            Rode `node scripts/support/create-asaas-subaccount-api-key.mjs` na sua máquina local.
          </li>
          <li>Cole a chave PAI/master do Asaas apenas no terminal.</li>
          <li>Informe o ID da subconta exibido acima.</li>
          <li>O script listará chaves existentes e pedirá confirmação antes de revogar.</li>
          <li>Cole abaixo apenas a nova API Key gerada e validada para a subconta.</li>
        </ol>
        <div className="mt-3">
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
            Nova API Key da subconta
          </label>
          <Input
            value={manualApiKey}
            onChange={(e) => setManualApiKey(e.target.value)}
            placeholder="Cole a API Key recém-gerada"
            disabled={actionLoading}
            type="password"
            autoComplete="off"
            className="border-slate-200"
          />
        </div>
        <div className="mt-3 space-y-2">
          <label className="flex cursor-pointer items-start gap-2 text-slate-700">
            <Checkbox
              checked={confirmGeneratedWithScript}
              onCheckedChange={(v) => setConfirmGeneratedWithScript(v === true)}
              disabled={actionLoading}
              className="mt-0.5"
            />
            <span>A chave foi gerada pelo script local oficial de rotação.</span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-slate-700">
            <Checkbox
              checked={confirmExistingSubaccount}
              onCheckedChange={(v) => setConfirmExistingSubaccount(v === true)}
              disabled={actionLoading}
              className="mt-0.5"
            />
            <span>A chave pertence à subconta exibida acima.</span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-slate-700">
            <Checkbox
              checked={confirmRotatedExistingKey}
              onCheckedChange={(v) => setConfirmRotatedExistingKey(v === true)}
              disabled={actionLoading}
              className="mt-0.5"
            />
            <span>Se já existia chave, ela foi revogada/rotacionada pelo script.</span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-slate-700">
            <Checkbox
              checked={confirmEncryptedStorage}
              onCheckedChange={(v) => setConfirmEncryptedStorage(v === true)}
              disabled={actionLoading}
              className="mt-0.5"
            />
            <span>Entendo que a Alusa validará e salvará a chave criptografada.</span>
          </label>
        </div>
        <Button
          type="button"
          className="mt-3"
          disabled={!manualApiKeyReady || actionLoading}
          onClick={() => void saveManualApiKey()}
        >
          {actionLoading ? 'A processar…' : 'Validar e salvar API Key rotacionada'}
        </Button>
      </div>

      <div className="flex flex-col gap-2 border-t border-slate-100 pt-3">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Ações avançadas
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!reasonValid || actionLoading}
            onClick={() => void runRepair('BOOTSTRAP_LOCAL')}
          >
            Bootstrap local
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!reasonValid || actionLoading}
            onClick={() => void runRepair('ENQUEUE_PROVISION')}
          >
            Enfileirar provisionamento
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!reasonValid || actionLoading}
            onClick={() => void runRepair('REPAIR_WEBHOOK')}
          >
            Reparar webhook
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!reasonValid || actionLoading}
            onClick={() => void runRepair('RECONCILE')}
          >
            Reconciliar
          </Button>
        </div>
      </div>

      <div className="rounded-md border border-slate-200 bg-slate-50/50 px-3 py-3">
        <p className="font-medium text-slate-900">Vincular subconta existente</p>
        <p className="mt-1 text-xs text-slate-600">
          Confere CPF/CNPJ da subconta no Asaas com o documento da conta. Use quando o
          provisionamento falhou mas a subconta já existe.
        </p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <Input
            value={linkId}
            onChange={(e) => setLinkId(e.target.value)}
            placeholder="ID da subconta Asaas"
            disabled={actionLoading}
            className="border-slate-200 sm:max-w-xs"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!reasonValid || actionLoading || !linkId.trim()}
            className="border-slate-200"
            onClick={() => void runRepair('LINK_SUBACCOUNT')}
          >
            Vincular
          </Button>
        </div>
      </div>

      {lastSteps ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-xs text-emerald-950">
          <p className="font-medium">Últimas etapas</p>
          <ul className="mt-1 list-inside list-disc">
            {lastSteps.map((s) => (
              <li key={s.step}>{s.summary}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {feedback ? (
        <div
          className={
            feedback.tone === 'ok'
              ? 'rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-950'
              : 'rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-950'
          }
        >
          <p className="whitespace-pre-wrap">{feedback.text}</p>
        </div>
      ) : null}
    </div>
  );
}
