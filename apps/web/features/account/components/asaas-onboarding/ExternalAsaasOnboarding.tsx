'use client';

import Link from 'next/link';
import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Check, Eye, EyeOff, Loader2, Play } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { InfoCallout, InfoCalloutItem } from '@/components/ui/info-callout';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { isExternalAsaasApiKeyHealthy } from '@/lib/external-asaas-api-key-health';

type SnapshotResponse = {
  data: {
    schoolName: string;
    cpfCnpj: string | null;
    phone: string | null;
    status: string;
    asaasAccountId: string | null;
    asaasEmail: string | null;
    hasApiKey: boolean;
    apiKeyStatus?: string;
    webhookStatus?: string | null;
  };
};

type SubmitResponse = {
  success: boolean;
  summary: string;
  status?: 'READY' | 'WEBHOOK_PENDING' | 'FAILED';
  account?: {
    asaasAccountId: string;
    asaasEmail: string | null;
  };
};

type TestConnectionResponse = {
  success: boolean;
  summary: string;
};

type FormState = {
  schoolName: string;
  cpfCnpj: string;
  phone: string;
  apiKey: string;
};

const initialForm: FormState = {
  schoolName: '',
  cpfCnpj: '',
  phone: '',
  apiKey: '',
};

const CONNECT_BENEFITS = [
  'Emitir e acompanhar cobranças da escola.',
  'Sincronizar pagamentos e recebimentos automaticamente.',
  'Manter o financeiro atualizado via webhook do Asaas.',
];

function unhealthyApiKeyMessage(apiKeyStatus: string) {
  switch (apiKeyStatus) {
    case 'EXPIRED':
      return 'A API key expirou no Asaas. Cole uma nova chave abaixo para restabelecer a integração.';
    case 'DISABLED':
      return 'A API key foi desabilitada no Asaas. Reative a chave no painel ou substitua a credencial abaixo.';
    case 'DELETED':
      return 'A API key foi excluída no painel do Asaas. Cole uma nova chave abaixo.';
    case 'REVOKED':
    case 'INVALID':
      return 'A API key salva está inválida ou sem permissão. Substitua a credencial abaixo.';
    default:
      return 'A credencial precisa ser revisada. Cole ou substitua a API key abaixo.';
  }
}

function webhookStatusMessage(status: string, webhookStatus: string | null) {
  if (status === 'READY' || webhookStatus === 'ACTIVE') {
    return 'Configurado e sincronizando eventos financeiros do Asaas.';
  }

  if (status === 'WEBHOOK_PENDING' || webhookStatus === 'PENDING') {
    return 'A chave está salva, mas o webhook ainda precisa ser concluído.';
  }

  return 'Em validação.';
}

function statusCopy(status: string) {
  switch (status) {
    case 'READY':
      return 'Conta conectada e webhook validado.';
    case 'WEBHOOK_PENDING':
      return 'Conta conectada, mas ainda falta concluir a configuração do webhook.';
    case 'FAILED':
      return 'Não foi possível validar a conexão anterior. Revise os dados e tente novamente.';
    case 'PENDING_CONFIGURATION':
      return 'Informe os dados da escola e a API key para conectar a conta existente.';
    default:
      return 'Conecte a conta existente do Asaas para continuar o fluxo financeiro.';
  }
}

type ExternalAsaasOnboardingProps = {
  variant?: 'page' | 'modal' | 'settings';
};

type SubmitFeedbackState = 'idle' | 'loading' | 'success' | 'error';

function getSubmitButtonLabel(state: SubmitFeedbackState, isReplace: boolean) {
  switch (state) {
    case 'loading':
      return isReplace ? 'Substituindo...' : 'Conectando...';
    case 'success':
      return isReplace ? 'Substituído' : 'Conectado';
    case 'error':
      return 'Tentar novamente';
    default:
      return isReplace ? 'Substituir' : 'Conectar';
  }
}

function getSubmitButtonClassName(state: SubmitFeedbackState, rounded = false) {
  return cn(
    'inline-flex h-10 min-w-[104px] items-center justify-center gap-2 px-4 text-sm font-medium shadow-none transition-all duration-200 disabled:pointer-events-none',
    rounded && 'rounded-xl',
    state === 'idle' && 'bg-brand-accent text-white hover:bg-brand-accent/90 disabled:opacity-50',
    state === 'loading' && 'cursor-wait bg-blue-600 text-white hover:bg-blue-600 disabled:opacity-100',
    state === 'success' && 'bg-emerald-600 text-white hover:bg-emerald-600 disabled:cursor-default disabled:opacity-100',
    state === 'error' && 'bg-red-600 text-white hover:bg-red-700 disabled:opacity-100',
  );
}

function isSubmitButtonDisabled(state: SubmitFeedbackState, hasDraftApiKey: boolean) {
  if (state === 'success') return true;
  if (state === 'error') return false;
  if (state === 'loading') return false;
  return !hasDraftApiKey;
}

export function ExternalAsaasOnboarding({ variant = 'page' }: ExternalAsaasOnboardingProps) {
  const { update } = useSession();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitFeedback, setSubmitFeedback] = useState<SubmitFeedbackState>('idle');
  const [testingConnection, setTestingConnection] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('PENDING_CONFIGURATION');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [apiKeyStatus, setApiKeyStatus] = useState<string>('MISSING');
  const [webhookStatus, setWebhookStatus] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(initialForm);
  const isModal = variant === 'modal';
  const isSettings = variant === 'settings';
  const hasDraftApiKey = form.apiKey.trim().length > 0;

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch('/api/finance/external-onboarding', {
          method: 'GET',
          cache: 'no-store',
        });

        if (!response.ok) {
          throw new Error('snapshot_failed');
        }

        const body = (await response.json()) as SnapshotResponse;
        if (cancelled) return;

        setForm({
          schoolName: body.data.schoolName ?? '',
          cpfCnpj: body.data.cpfCnpj ?? '',
          phone: body.data.phone ?? '',
          apiKey: '',
        });
        setStatus(body.data.status ?? 'PENDING_CONFIGURATION');
        setAccountId(body.data.asaasAccountId ?? null);
        setAccountEmail(body.data.asaasEmail ?? null);
        setHasApiKey(Boolean(body.data.hasApiKey));
        setApiKeyStatus(body.data.apiKeyStatus ?? 'MISSING');
        setWebhookStatus(body.data.webhookStatus ?? null);
        setMessage(statusCopy(body.data.status ?? 'PENDING_CONFIGURATION'));
      } catch {
        if (!cancelled) {
          setMessage('Não foi possível carregar os dados do onboarding financeiro.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function resetSubmitFeedback() {
    setSubmitFeedback((current) => (current === 'idle' ? current : 'idle'));
  }

  function handleApiKeyChange(value: string) {
    setForm((current) => ({ ...current, apiKey: value }));
    resetSubmitFeedback();
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || submitFeedback === 'loading' || submitFeedback === 'success') return;

    setSubmitting(true);
    setSubmitFeedback('loading');
    setMessage(null);

    try {
      const response = await fetch('/api/finance/external-onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      const body = (await response.json().catch(() => null)) as SubmitResponse | null;
      setStatus(body?.status ?? 'FAILED');
      setMessage(body?.summary ?? 'Não foi possível conectar a conta do Asaas.');
      setAccountId(body?.account?.asaasAccountId ?? accountId);
      setAccountEmail(body?.account?.asaasEmail ?? accountEmail);

      if (body?.success) {
        setSubmitFeedback('success');
        setForm((current) => ({ ...current, apiKey: '' }));
        setHasApiKey(true);
        setApiKeyStatus('CONNECTED');
        if (body.status === 'READY') {
          setWebhookStatus('ACTIVE');
        } else if (body.status === 'WEBHOOK_PENDING') {
          setWebhookStatus('PENDING');
        }
        if (isSettings) {
          toast.success(body.summary ?? 'API key atualizada com sucesso.');
        }
        await update().catch(() => undefined);
      } else {
        setSubmitFeedback('error');
        if (isSettings) {
          toast.error(body?.summary ?? 'Não foi possível substituir a API key do Asaas.');
        }
      }
    } catch {
      setSubmitFeedback('error');
      setMessage('Não foi possível conectar a conta do Asaas.');
      if (isSettings) {
        toast.error('Não foi possível conectar a conta do Asaas.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTestConnection() {
    if (!hasDraftApiKey || testingConnection) return;

    setTestingConnection(true);

    try {
      const response = await fetch('/api/admin/asaas/test-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: form.apiKey.trim() }),
      });

      const body = (await response.json().catch(() => null)) as TestConnectionResponse | null;

      if (response.ok && body?.success) {
        toast.success(body.summary ?? 'Conexão validada com sucesso.');
        return;
      }

      toast.error(body?.summary ?? 'Não foi possível validar a API key do Asaas.');
    } finally {
      setTestingConnection(false);
    }
  }

  const maskedPlaceholder = hasApiKey ? '$aact_hmlg_••••••••••••••••' : 'Cole a API key do Asaas';
  const isReplaceAction = hasApiKey;
  const submitButtonLabel = getSubmitButtonLabel(submitFeedback, isReplaceAction);
  const submitButtonDisabled = isSubmitButtonDisabled(submitFeedback, hasDraftApiKey);
  const isApiKeyHealthy = isExternalAsaasApiKeyHealthy({
    financeIntegrationMode: 'EXTERNAL_ASAAS_ACCOUNT',
    externalAsaasOnboardingStatus: status,
    asaasApiKeyStatus: apiKeyStatus,
  });
  const webhookMessage = webhookStatusMessage(status, webhookStatus);
  const webhookNeedsAttention = status === 'WEBHOOK_PENDING' || webhookStatus === 'PENDING';

  if (loading) {
    if (isModal) {
      return (
        <div className="flex min-h-[320px] items-center justify-center px-5 py-10">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-label="Carregando" />
        </div>
      );
    }

    return <div className="text-sm text-slate-600">Carregando onboarding financeiro...</div>;
  }

  if (isModal) {
    return (
      <form className="flex flex-col" onSubmit={handleSubmit}>
        <div className="relative border-b border-gray-100 px-6 py-5 text-left">
          <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-accent/40 to-transparent" />
          <h2 className="text-base font-semibold text-slate-900">Conectar Asaas à Alusa</h2>
          <p className="mt-1.5 max-w-[22rem] text-sm leading-relaxed text-slate-600">
            Conecte sua conta existente para concluir a etapa financeira.
          </p>
        </div>

        <div className="space-y-5 px-6 py-5">
          <label className="block space-y-2 text-left">
            <span className="text-sm font-medium text-slate-900">API key do Asaas</span>
            <div className="relative">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setShowApiKey((current) => !current)}
                disabled={submitFeedback === 'loading' || submitFeedback === 'success'}
                aria-label={showApiKey ? 'Ocultar API key' : 'Mostrar API key'}
                className="absolute right-1 top-1/2 z-10 h-8 w-8 -translate-y-1/2 text-slate-500 hover:text-slate-700"
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              <Input
                type={showApiKey ? 'text' : 'password'}
                value={form.apiKey}
                onChange={(event) => handleApiKeyChange(event.target.value)}
                disabled={submitFeedback === 'loading' || submitFeedback === 'success'}
                className="h-10 pr-10"
                placeholder={maskedPlaceholder}
                required
              />
            </div>
          </label>

          <div>
            <p className="text-left text-sm font-medium text-slate-900">Conectar o Asaas permite:</p>
            <ul className="mt-2 space-y-2">
              {CONNECT_BENEFITS.map((benefit) => (
                <li key={benefit} className="flex items-start gap-2.5 text-left text-sm leading-snug text-slate-600">
                  <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#f4ecfd] text-brand-accent">
                    <Check className="h-3 w-3" strokeWidth={2.5} />
                  </span>
                  <span>{benefit}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="border-t border-slate-200 bg-slate-50 px-6 py-4">
          <div className="flex items-center justify-between w-full">
            <Button
              variant="outline"
              asChild
              className="h-10 gap-2 border-slate-200 bg-white px-3.5 text-slate-600 shadow-none hover:bg-slate-100"
            >
              <a href="https://youtu.be/tULtfD8vEfg" target="_blank" rel="noopener noreferrer">
                <Play className="h-3.5 w-3.5 fill-current" />
                Tutorial
              </a>
            </Button>

            <Button
              type="submit"
              disabled={submitButtonDisabled}
              aria-busy={submitFeedback === 'loading'}
              aria-live="polite"
              className={getSubmitButtonClassName(submitFeedback)}
            >
              {submitFeedback === 'loading' ? (
                <Loader2 className="h-4 w-4 animate-spin text-sky-200" aria-hidden="true" />
              ) : null}
              {submitFeedback === 'success' ? (
                <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
              ) : null}
              {submitButtonLabel}
            </Button>
          </div>
        </div>
      </form>
    );
  }

  if (isSettings) {
    return (
      <div className="space-y-6">
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-4 rounded-xl bg-[#F4EDFF] p-4 text-[#4B2F78]">
            <p className="text-sm font-semibold text-[#4B2F78]">Como obter a API key no Asaas</p>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#4B2F78] text-xs font-semibold text-white shadow-sm">
                  1
                </span>
                <p className="pt-0.5 text-sm leading-6 text-[#5F4B8B]">
                  Acesse o site do Asaas em{' '}
                  <a
                    href="https://www.asaas.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-[#5B21B6] underline underline-offset-2"
                  >
                    asaas.com
                  </a>{' '}
                  e entre na conta que será usada por esta instituição.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#4B2F78] text-xs font-semibold text-white shadow-sm">
                  2
                </span>
                <p className="pt-0.5 text-sm leading-6 text-[#5F4B8B]">
                  No painel do Asaas, abra Minha conta e acesse a área de API da conta.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#4B2F78] text-xs font-semibold text-white shadow-sm">
                  3
                </span>
                <p className="pt-0.5 text-sm leading-6 text-[#5F4B8B]">
                  Copie a API key exibida no Asaas e cole no campo abaixo para testar ou substituir a credencial.
                </p>
              </div>
            </div>
          </div>

          {hasApiKey ? (
            <InfoCallout
              variant={isApiKeyHealthy && !webhookNeedsAttention ? 'info' : 'warning'}
              size="sm"
              title={
                isApiKeyHealthy
                  ? webhookNeedsAttention
                    ? 'Conta Asaas conectada com pendência'
                    : 'Conta Asaas conectada'
                  : 'Credencial do Asaas precisa de atenção'
              }
            >
              {isApiKeyHealthy ? (
                <>
                  <InfoCalloutItem label="API key" labelTone="default">
                    Salva na Alusa e ativa para operações financeiras.
                  </InfoCalloutItem>
                  {accountId ? (
                    <InfoCalloutItem label="Conta Asaas" labelTone="default">
                      {accountId}
                    </InfoCalloutItem>
                  ) : null}
                  {accountEmail ? (
                    <InfoCalloutItem label="E-mail da conta" labelTone="default">
                      {accountEmail}
                    </InfoCalloutItem>
                  ) : null}
                  <InfoCalloutItem
                    label="Webhook"
                    labelTone={webhookNeedsAttention ? 'warning' : 'default'}
                  >
                    {webhookMessage}
                  </InfoCalloutItem>
                </>
              ) : (
                <>
                  <InfoCalloutItem label="Situação" labelTone="warning">
                    {unhealthyApiKeyMessage(apiKeyStatus)}
                  </InfoCalloutItem>
                  {accountId ? (
                    <InfoCalloutItem label="Conta Asaas" labelTone="default">
                      {accountId}
                    </InfoCalloutItem>
                  ) : null}
                </>
              )}
            </InfoCallout>
          ) : null}

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setShowApiKey((current) => !current)}
                disabled={
                  submitFeedback === 'loading' ||
                  submitFeedback === 'success' ||
                  testingConnection
                }
                aria-label={showApiKey ? 'Ocultar API key' : 'Mostrar API key'}
                className="absolute right-2 top-1/2 z-10 h-8 w-8 -translate-y-1/2 text-slate-500 hover:text-slate-700"
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              <Input
                type={showApiKey ? 'text' : 'password'}
                value={form.apiKey}
                onChange={(event) => handleApiKeyChange(event.target.value)}
                disabled={submitFeedback === 'loading' || submitFeedback === 'success'}
                className="h-10 rounded-xl border-slate-200 bg-white pl-3 pr-12 text-sm text-slate-950 placeholder:text-slate-400"
                placeholder={maskedPlaceholder}
                required={!hasApiKey}
              />
            </div>

            <div className="flex shrink-0 items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={!hasDraftApiKey || submitting || testingConnection}
                onClick={() => void handleTestConnection()}
                className="h-10 rounded-xl border-slate-200 bg-white text-slate-700 shadow-none hover:bg-slate-50"
              >
                {testingConnection ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Testando...
                  </>
                ) : (
                  'Testar conexão'
                )}
              </Button>

              {hasDraftApiKey || submitFeedback === 'error' ? (
                <Button
                  type="submit"
                  disabled={submitButtonDisabled || testingConnection}
                  aria-busy={submitFeedback === 'loading'}
                  aria-live="polite"
                  className={getSubmitButtonClassName(submitFeedback, true)}
                >
                  {submitFeedback === 'loading' ? (
                    <Loader2 className="h-4 w-4 animate-spin text-sky-200" aria-hidden="true" />
                  ) : null}
                  {submitFeedback === 'success' ? (
                    <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
                  ) : null}
                  {submitButtonLabel}
                </Button>
              ) : null}
            </div>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div className="inline-flex rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
          Onboarding financeiro
        </div>
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Conectar conta existente do Asaas</h1>
          <p className="max-w-2xl text-sm leading-6 text-slate-600">
            Esse fluxo mantém a matrícula, o plano, a cobrança e o pagamento vinculados ao responsável financeiro, mas usa a sua conta já existente no Asaas como origem operacional. O estado financeiro continua confirmado por webhook.
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        {message ?? statusCopy(status)}
      </div>

      {(accountId || accountEmail) && (
        <div className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Conta Asaas</p>
            <p className="mt-2 text-sm font-medium text-slate-900">{accountId ?? 'Não identificado'}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">E-mail da conta</p>
            <p className="mt-2 text-sm font-medium text-slate-900">{accountEmail ?? 'Não informado pelo Asaas'}</p>
          </div>
        </div>
      )}

      <form className="grid gap-5" onSubmit={handleSubmit}>
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium text-slate-700">
            Nome da escola
            <input
              value={form.schoolName}
              onChange={(event) => setForm((current) => ({ ...current, schoolName: event.target.value }))}
              className="h-12 rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-950 outline-none transition focus:border-slate-900"
              placeholder="Nome exibido na conta"
              required
            />
          </label>
          <label className="grid gap-2 text-sm font-medium text-slate-700">
            CPF/CNPJ da escola
            <input
              value={form.cpfCnpj}
              onChange={(event) => setForm((current) => ({ ...current, cpfCnpj: event.target.value }))}
              className="h-12 rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-950 outline-none transition focus:border-slate-900"
              placeholder="Somente para vínculo local"
            />
          </label>
        </div>

        <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <label className="grid gap-2 text-sm font-medium text-slate-700">
            Telefone financeiro
            <input
              value={form.phone}
              onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
              className="h-12 rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-950 outline-none transition focus:border-slate-900"
              placeholder="Contato para referência interna"
            />
          </label>
          <label className="grid gap-2 text-sm font-medium text-slate-700">
            API key do Asaas
            <input
              type="password"
              value={form.apiKey}
              onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))}
              className="h-12 rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-950 outline-none transition focus:border-slate-900"
              placeholder="Cole a API key da conta existente"
              required
            />
          </label>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs leading-5 text-slate-500">
            Não criamos cliente financeiro nem cobrança aqui. Esse passo apenas conecta a conta e garante o webhook oficial do Asaas.
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            {status === 'READY' ? (
              <Link
                href="/dashboard"
                className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-300 px-5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Ir para o dashboard
              </Link>
            ) : null}
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex h-12 items-center justify-center rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'Validando conexão...' : status === 'READY' ? 'Revalidar conexão' : 'Conectar conta'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
