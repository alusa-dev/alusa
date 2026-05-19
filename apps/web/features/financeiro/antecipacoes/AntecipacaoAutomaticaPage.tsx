'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { pushToast } from '@/components/ui/toast';
import { CheckCircle, Warning } from '@/components/icons/icons';
import { useFinanceListLoad } from '@/features/financeiro/hooks/use-finance-list-load';
import type { AnticipationConfiguration, AnticipationLimits } from './types';
import { formatCurrency } from './utils';

function InfoCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-semibold text-slate-900">{value}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
    </div>
  );
}

export function AntecipacaoAutomaticaPage() {
  const [configuration, setConfiguration] = useState<AnticipationConfiguration | null>(null);
  const [limits, setLimits] = useState<AnticipationLimits | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState(false);

  const enabled = Boolean(configuration?.creditCardAutomaticEnabled);
  const automaticEligible = configuration?.automaticCreditCardEligible ?? true;
  const automaticBlockedByPersonType =
    configuration?.automaticCreditCardReason === 'PERSON_TYPE_MUST_BE_PJ';

  const { isInitialLoading } = useFinanceListLoad(
    async ({ signal }) => {
      const [configResponse, limitsResponse] = await Promise.all([
        fetch('/api/financeiro/antecipacoes/configuracao', { cache: 'no-store', signal }),
        fetch('/api/financeiro/antecipacoes/limites', { cache: 'no-store', signal }),
      ]);

      if (!configResponse.ok) throw new Error('Falha ao carregar configuração');
      const configPayload = await configResponse.json();
      setConfiguration(configPayload.data);

      if (limitsResponse.ok) {
        const limitsPayload = await limitsResponse.json();
        setLimits(limitsPayload.data ?? null);
      }
    },
    {
      liveRefreshEnabled: !saving,
      liveRefresh: { dashboard: true, portal: false },
      intervalMs: 60_000,
      minIntervalMs: 10_000,
    },
  );

  async function updateConfiguration(nextEnabled: boolean) {
    if (nextEnabled && !automaticEligible) {
      pushToast({
        title: 'Não foi possível salvar',
        description: 'A antecipação automática está disponível apenas para contas PJ no Asaas.',
        variant: 'error',
      });
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/financeiro/antecipacoes/configuracao', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creditCardAutomaticEnabled: nextEnabled }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof payload?.message === 'string'
            ? payload.message
            : payload?.error === 'ERRO_ASAAS'
              ? 'Configuração rejeitada pelo Asaas.'
              : 'Falha ao salvar',
        );
      }
      setConfiguration(payload.data);
      setConfirmDisable(false);
      pushToast({
        title: nextEnabled ? 'Antecipação automática ativada' : 'Antecipação automática desativada',
        variant: 'success',
      });
    } catch (error) {
      pushToast({
        title: 'Não foi possível salvar',
        description: error instanceof Error ? error.message : 'Tente novamente.',
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="w-full min-w-0 space-y-5">
      <section className="rounded-xl border border-slate-200 bg-white px-5 py-5 md:px-6">
        <div className="max-w-2xl">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Antecipações</p>
          <h1 className="mt-1 text-[22px] font-semibold text-gray-900 md:text-[24px]">Antecipação automática</h1>
          <p className="mt-1 text-[13px] leading-5 text-slate-600">
            Controle a antecipação automática de recebíveis de cartão de crédito da subconta Asaas.
          </p>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-900">Antecipação automática de cartão</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Quando ativa, o Asaas solicita automaticamente a antecipação dos recebíveis de cartão elegíveis.
            </p>

            <div className="mt-5 grid gap-3 text-sm text-slate-700">
              <div className="flex gap-3">
                <CheckCircle className="mt-0.5 h-5 w-5 text-emerald-600" />
                <span>Aplicável somente a recebíveis de cartão de crédito.</span>
              </div>
              <div className="flex gap-3">
                <CheckCircle className="mt-0.5 h-5 w-5 text-emerald-600" />
                <span>Solicitações seguem sujeitas a análise de crédito do Asaas.</span>
              </div>
              <div className="flex gap-3">
                <CheckCircle className="mt-0.5 h-5 w-5 text-emerald-600" />
                <span>Você pode ativar ou desativar a configuração a qualquer momento.</span>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              {isInitialLoading ? (
                <Button disabled className="rounded-xl">Carregando...</Button>
              ) : enabled ? (
                <Button
                  className="rounded-xl bg-rose-700 text-white hover:bg-rose-800"
                  disabled={saving}
                  onClick={() => setConfirmDisable(true)}
                >
                  Desativar antecipação automática
                </Button>
              ) : (
                <Button
                  className="rounded-xl bg-brand-accent text-white hover:bg-brand-accent/90"
                  disabled={saving || !automaticEligible}
                  onClick={() => void updateConfiguration(true)}
                >
                  Ativar antecipação automática
                </Button>
              )}
            </div>

            {!enabled && automaticBlockedByPersonType ? (
              <p className="mt-3 text-sm leading-6 text-amber-700">
                Esta subconta está cadastrada como pessoa física no Asaas. A antecipação automática só pode ser ativada para contas PJ.
              </p>
            ) : null}
          </div>
        </section>

        <aside className="space-y-4">
          <InfoCard
            label="Situação"
            value={enabled ? 'Ativada' : 'Desativada'}
            detail={
              enabled
                ? 'Novos recebíveis de cartão elegíveis entram no fluxo automático.'
                : automaticBlockedByPersonType
                  ? 'A conta está como pessoa física no Asaas. O fluxo automático exige conta PJ.'
                  : 'As antecipações continuam disponíveis no fluxo manual.'
            }
          />
          <InfoCard
            label="Limite de cartão"
            value={formatCurrency(limits?.creditCard?.available ?? 0)}
            detail={`Liberado na conta: ${formatCurrency(limits?.creditCard?.total ?? 0)}`}
          />
          <InfoCard
            label="Limite de boleto"
            value={formatCurrency(limits?.bankSlip?.available ?? 0)}
            detail={`Liberado na conta: ${formatCurrency(limits?.bankSlip?.total ?? 0)}`}
          />
        </aside>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold text-slate-900">Principais dúvidas</h2>
        <div className="mt-3 divide-y divide-slate-100">
          <details className="group py-4">
            <summary className="cursor-pointer text-sm font-medium text-slate-900">A antecipação automática vale para boleto ou Pix?</summary>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Pela API oficial usada aqui, a configuração automática exposta pelo Asaas é apenas para cartão de crédito.
            </p>
          </details>
          <details className="group py-4">
            <summary className="cursor-pointer text-sm font-medium text-slate-900">Desativar cancela solicitações em andamento?</summary>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Não. A desativação impede novas solicitações automáticas, mas as antecipações já solicitadas continuam com o status retornado pelo Asaas.
            </p>
          </details>
          <details className="group py-4">
            <summary className="cursor-pointer text-sm font-medium text-slate-900">As taxas são definidas pela Alusa?</summary>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Não. A taxa e o valor líquido são calculados pelo Asaas no momento da simulação ou da antecipação.
            </p>
          </details>
        </div>
      </section>

      {confirmDisable ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-700">
                <Warning className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Desativar antecipação automática?</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Novos recebíveis de cartão não serão mais antecipados automaticamente. Solicitações em andamento continuam no fluxo do Asaas.
                </p>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="outline" className="rounded-xl" disabled={saving} onClick={() => setConfirmDisable(false)}>
                Voltar
              </Button>
              <Button className="rounded-xl bg-rose-700 text-white hover:bg-rose-800" disabled={saving} onClick={() => void updateConfiguration(false)}>
                {saving ? 'Desativando...' : 'Desativar'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
