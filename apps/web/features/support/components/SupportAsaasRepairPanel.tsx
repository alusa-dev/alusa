'use client';

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
  const [confirmedTutorial, setConfirmedTutorial] = useState(false);
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
      const json = (await res.json().catch(() => null)) as
        | { success?: boolean; data?: AsaasSupportDiagnosis; error?: string }
        | null;
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

  const needsTutorialConfirm =
    diagnosis?.recommendedAction === 'RECOVER_INTEGRATION' ||
    diagnosis?.phase === 'API_KEY_OR_SUBACCOUNT_RECOVERY';

  async function runRepair(action: AsaasSupportRepairExecuteAction) {
    if (!reasonValid || actionLoading) return;
    if (action === 'AUTO_NEXT' && needsTutorialConfirm && !confirmedTutorial) return;
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
      setConfirmedTutorial(false);
      router.refresh();
      await loadDiagnosis();
    } catch {
      setFeedback({ tone: 'err', text: 'Falha de rede.' });
    } finally {
      setActionLoading(false);
    }
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
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-950">{loadError}</div>
        <Button type="button" variant="outline" size="sm" onClick={() => void loadDiagnosis()} className="border-slate-200">
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (!diagnosis) return null;

  if (diagnosis.phase === 'NOT_WHITELABEL_BAAS') {
    return (
      <p className="mt-4 text-sm text-slate-600">{diagnosis.hint}</p>
    );
  }

  return (
    <div className="mt-4 space-y-4 text-sm">
      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-slate-800">
        <p className="font-medium text-slate-900">Diagnóstico</p>
        <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">Fase: {diagnosis.phase}</p>
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

      <div className="rounded-md border border-slate-200 bg-white px-3 py-3">
        <p className="font-medium text-slate-900">Conta master Asaas (recuperação de chave)</p>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-slate-700">
          <li>Entre no Asaas com a conta master da Alusa (não é o login da escola).</li>
          <li>Integrações → Chaves de API → Gestão de chaves de API de subcontas → Habilitar acesso.</li>
          <li>Confirme IPs permitidos para os servidores que executam esta ação.</li>
        </ol>
      </div>

      {needsTutorialConfirm ? (
        <label className="flex cursor-pointer items-start gap-2 text-slate-700">
          <Checkbox
            checked={confirmedTutorial}
            onCheckedChange={(v) => setConfirmedTutorial(v === true)}
            disabled={actionLoading}
            className="mt-0.5"
          />
          <span>Confirmo os passos da conta master para geração de chave de subconta.</span>
        </label>
      ) : null}

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

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button
          type="button"
          disabled={!reasonValid || actionLoading || (needsTutorialConfirm && !confirmedTutorial)}
          onClick={() => void runRepair('AUTO_NEXT')}
        >
          {actionLoading ? 'A processar…' : 'Diagnosticar e reparar (automático)'}
        </Button>
      </div>

      <div className="flex flex-col gap-2 border-t border-slate-100 pt-3">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Ações explícitas</p>
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
            disabled={!reasonValid || actionLoading || (needsTutorialConfirm && !confirmedTutorial)}
            onClick={() => void runRepair('RECOVER_INTEGRATION')}
          >
            Recuperar chave / webhooks
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
          Confere CPF/CNPJ da subconta no Asaas com o documento da conta. Use quando o provisionamento falhou
          mas a subconta já existe.
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
