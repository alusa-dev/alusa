'use client';

import Link from 'next/link';
import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';

type SnapshotResponse = {
  data: {
    schoolName: string;
    cpfCnpj: string | null;
    phone: string | null;
    status: string;
    asaasAccountId: string | null;
    asaasEmail: string | null;
    hasApiKey: boolean;
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

export function ExternalAsaasOnboarding({ variant = 'page' }: ExternalAsaasOnboardingProps) {
  const { update } = useSession();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('PENDING_CONFIGURATION');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(initialForm);
  const isModal = variant === 'modal';
  const isSettings = variant === 'settings';
  const isCompact = isModal || isSettings;
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

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
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
        setForm((current) => ({ ...current, apiKey: '' }));
        setHasApiKey(true);
        if (isSettings) {
          toast.success(body.summary ?? 'API key atualizada com sucesso.');
        }
        await update().catch(() => undefined);
      } else if (isSettings) {
        toast.error(body?.summary ?? 'Não foi possível substituir a API key do Asaas.');
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

  const compactHelperText =
    message ??
    (hasApiKey
      ? 'Substitua a API key quando precisar rotacionar a credencial ou reconectar a integração.'
      : 'Cole a API key da sua conta existente para concluir a integração com o Asaas.');

  const compactActionLabel = hasApiKey ? 'Substituir API key' : 'Conectar API key';
  const maskedPlaceholder = hasApiKey ? '$aact_hmlg_••••••••••••••••' : 'Cole a API key do Asaas';

  if (loading) {
    return <div className="text-sm text-slate-600">Carregando onboarding financeiro...</div>;
  }

  if (isCompact) {
    return (
      <div className={isSettings ? 'space-y-6' : 'space-y-4'}>
        <form className="space-y-4" onSubmit={handleSubmit}>
          {isSettings ? (
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
                      rel="noreferrer"
                      className="font-medium text-[#5B21B6] underline underline-offset-2"
                    >
                      asaas.com
                    </a>
                    {' '}e entre na conta que será usada por esta instituição.
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
          ) : null}

          <div className={isSettings ? 'flex flex-col gap-3 lg:flex-row lg:items-center' : 'space-y-2'}>
            <div className="relative min-w-0 flex-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setShowApiKey((current) => !current)}
                disabled={submitting || testingConnection}
                aria-label={showApiKey ? 'Ocultar API key' : 'Mostrar API key'}
                className="absolute right-2 top-1/2 z-10 h-8 w-8 -translate-y-1/2 text-slate-500 hover:text-slate-700"
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              <Input
                type={showApiKey ? 'text' : 'password'}
                value={form.apiKey}
                onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))}
                className="h-10 rounded-xl border-slate-200 bg-white pl-3 pr-12 text-sm text-slate-950 placeholder:text-slate-400"
                placeholder={maskedPlaceholder}
                required={!isSettings || !hasApiKey}
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

              {hasDraftApiKey ? (
                <Button
                  type="submit"
                  disabled={submitting || testingConnection}
                  className="h-10 min-w-32 rounded-xl bg-brand-accent text-white shadow-none hover:bg-brand-accent/90"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Conectando...
                    </>
                  ) : (
                    hasApiKey ? 'Substituir' : 'Conectar'
                  )}
                </Button>
              ) : null}
            </div>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className={isModal ? 'space-y-6' : 'space-y-8'}>
      <div className="space-y-3">
        {!isModal ? (
          <div className="inline-flex rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
            Onboarding financeiro
          </div>
        ) : null}
        <div className="space-y-2">
          <h1 className={isModal ? 'text-2xl font-semibold tracking-tight text-slate-950' : 'text-3xl font-semibold tracking-tight text-slate-950'}>Conectar conta existente do Asaas</h1>
          <p className={isModal ? 'text-sm leading-6 text-slate-600' : 'max-w-2xl text-sm leading-6 text-slate-600'}>
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
            {!isModal && status === 'READY' ? (
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