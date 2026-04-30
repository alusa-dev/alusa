'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';

type CheckStatus = 'ok' | 'error' | 'skipped';

type ApiOk = {
  success: true;
  summary: string;
  checks: {
    env: CheckStatus;
    auth: CheckStatus;
    account: CheckStatus;
    webhook: CheckStatus;
  };
  technical?: Record<string, unknown>;
};

type ApiFail = {
  success: false;
  summary: string;
  errorCode?: string;
  checks?: Partial<ApiOk['checks']>;
  details?: { step?: string; message?: string };
  technical?: Record<string, unknown>;
};

type ApiResult = ApiOk | ApiFail;

type DeleteAccountStepKey =
  | 'validate'
  | 'load'
  | 'subaccount_apikey'
  | 'precheck'
  | 'delete_asaas'
  | 'delete_local'
  | 'audit';

type DeleteAccountStepStatus = 'ok' | 'error' | 'skipped' | 'in_progress';

type DeleteAsaasAccountStep = {
  step: DeleteAccountStepKey;
  status: DeleteAccountStepStatus;
  message: string;
  debugSafe?: Record<string, unknown>;
};

type DeleteAccountApiOk = {
  success: true;
  summary: string;
  asaasDeleted: boolean;
  localDeleted: boolean;
  steps: DeleteAsaasAccountStep[];
  debugSafe?: {
    financeProfileId?: string;
    asaasAccountIdMasked?: string | null;
  };
};

type DeleteAccountApiFail = {
  success: false;
  summary: string;
  errorCode?: string;
  asaasDeleted: boolean;
  localDeleted: boolean;
  steps?: DeleteAsaasAccountStep[];
  debugSafe?: {
    financeProfileId?: string;
    asaasAccountIdMasked?: string | null;
  };
};

type DeleteAccountApiResult = DeleteAccountApiOk | DeleteAccountApiFail;

function badgeVariant(status: CheckStatus): 'default' | 'destructive' | 'outline' | 'warning' {
  if (status === 'ok') return 'default';
  if (status === 'error') return 'destructive';
  return 'outline';
}

function label(status: CheckStatus): string {
  if (status === 'ok') return 'OK';
  if (status === 'error') return 'Erro';
  return 'Ignorado';
}

function deleteStepBadgeVariant(
  status: DeleteAccountStepStatus,
): 'default' | 'destructive' | 'outline' | 'warning' {
  if (status === 'ok') return 'default';
  if (status === 'error') return 'destructive';
  if (status === 'in_progress') return 'warning';
  return 'outline';
}

function deleteStepLabel(status: DeleteAccountStepStatus): string {
  if (status === 'ok') return 'OK';
  if (status === 'error') return 'Erro';
  if (status === 'in_progress') return 'Em andamento';
  return 'Ignorado';
}

export default function TesteAsaasClient() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);

  const [reconnectOpen, setReconnectOpen] = useState(false);
  const [reconnectLoading, setReconnectLoading] = useState(false);
  const [reconnectApiKey, setReconnectApiKey] = useState('');
  const [reconnectResult, setReconnectResult] = useState<{ success: boolean; message: string } | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteChecked, setDeleteChecked] = useState(false);
  const [deleteResult, setDeleteResult] = useState<DeleteAccountApiResult | null>(null);

  async function handleTest() {
    if (loading) return;
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch('/api/admin/teste-asaas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = (await res.json().catch(() => null)) as ApiResult | null;
      if (!data) {
        setResult({ success: false, summary: 'Resposta inválida do servidor.' });
        return;
      }

      setResult(data);
    } catch {
      setResult({ success: false, summary: 'Falha de rede ao testar a conexão.' });
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (deleteLoading) return;

    setDeleteLoading(true);
    setDeleteResult({
      success: false,
      summary: 'Iniciando exclusão…',
      errorCode: 'IN_PROGRESS',
      asaasDeleted: false,
      localDeleted: false,
      steps: [{ step: 'validate', status: 'in_progress', message: 'Processando…' }],
    });

    try {
      const res = await fetch('/api/admin/asaas/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmText: deleteConfirmText,
          removeReason: deleteReason,
        }),
      });

      const data = (await res.json().catch(() => null)) as DeleteAccountApiResult | null;
      if (!data) {
        setDeleteResult({
          success: false,
          summary: 'Resposta inválida do servidor.',
          errorCode: 'INVALID_RESPONSE',
          asaasDeleted: false,
          localDeleted: false,
          steps: [],
        });
        return;
      }

      setDeleteResult(data);
    } catch {
      setDeleteResult({
        success: false,
        summary: 'Falha de rede ao excluir a conta.',
        errorCode: 'NETWORK_ERROR',
        asaasDeleted: false,
        localDeleted: false,
        steps: [],
      });
    } finally {
      setDeleteLoading(false);
    }
  }

  async function handleReconnect() {
    if (reconnectLoading) return;
    setReconnectLoading(true);
    setReconnectResult(null);

    try {
      const res = await fetch('/api/admin/asaas/reconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: reconnectApiKey }),
      });

      const data = (await res.json().catch(() => null)) as { success?: boolean; summary?: string } | null;
      if (!data) {
        setReconnectResult({ success: false, message: 'Resposta inválida do servidor.' });
        return;
      }

      setReconnectResult({ success: Boolean(data.success), message: data.summary ?? 'Processo concluído.' });
      if (data.success) {
        setReconnectApiKey('');
      }
    } catch {
      setReconnectResult({ success: false, message: 'Falha de rede ao reconectar conta.' });
    } finally {
      setReconnectLoading(false);
    }
  }

  const apiKeyStatus = (result?.success ? result.technical : result?.technical)?.apiKeyStatus as
    | 'CONNECTED'
    | 'MISSING'
    | 'REVOKED'
    | undefined;

  const checks = result?.success
    ? result.checks
    : {
        env: result?.checks?.env ?? 'skipped',
        auth: result?.checks?.auth ?? 'skipped',
        account: result?.checks?.account ?? 'skipped',
        webhook: result?.checks?.webhook ?? 'skipped',
      };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button onClick={handleTest} disabled={loading}>
          {loading ? 'Testando…' : 'Testar conexão com Asaas'}
        </Button>

        {result ? (
          <div className="flex items-center gap-2">
            <Badge variant={result.success ? 'default' : 'destructive'}>
              {result.success ? 'Sucesso' : 'Erro'}
            </Badge>
            <span className="text-sm text-gray-700">{result.summary}</span>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-sm font-medium text-gray-900">Configuração</div>
          <div className="mt-2">
            <Badge variant={badgeVariant(checks.env)}>{label(checks.env)}</Badge>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-sm font-medium text-gray-900">Autenticação</div>
          <div className="mt-2">
            <Badge variant={badgeVariant(checks.auth)}>{label(checks.auth)}</Badge>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-sm font-medium text-gray-900">Subconta</div>
          <div className="mt-2">
            <Badge variant={badgeVariant(checks.account)}>{label(checks.account)}</Badge>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-sm font-medium text-gray-900">Webhook</div>
          <div className="mt-2">
            <Badge variant={badgeVariant(checks.webhook)}>{label(checks.webhook)}</Badge>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-medium text-gray-900">Status da integração</div>
            <p className="text-sm text-gray-600">
              {apiKeyStatus === 'CONNECTED'
                ? 'Conta Asaas conectada.'
                : apiKeyStatus === 'REVOKED' || apiKeyStatus === 'MISSING'
                  ? 'Conta de pagamentos não conectada.'
                  : 'Status não verificado.'}
            </p>
          </div>

          <Button
            variant="outline"
            onClick={() => {
              setReconnectResult(null);
              setReconnectOpen(true);
            }}
          >
            Conectar conta Asaas
          </Button>
        </div>
      </div>

      {result && !result.success && result.details?.message ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {result.details.message}
        </div>
      ) : null}

      {result?.technical ? (
        <details className="rounded-lg border border-gray-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-medium text-gray-900">
            Detalhes técnicos (admin/dev)
          </summary>
          <pre className="mt-3 overflow-auto rounded bg-gray-50 p-3 text-xs text-gray-800">
            {JSON.stringify(result.technical, null, 2)}
          </pre>
        </details>
      ) : null}

      <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-rose-900">Zona de risco</div>
            <div className="text-sm text-rose-800">
              Ação destrutiva e irreversível: exclui a conta na Alusa e a subconta no Asaas.
            </div>
          </div>

          <Button
            variant="destructive"
            onClick={() => {
              setDeleteResult(null);
              setDeleteConfirmText('');
              setDeleteReason('');
              setDeleteChecked(false);
              setDeleteOpen(true);
            }}
          >
            Excluir conta (Alusa + Asaas)
          </Button>
        </div>
      </div>

      <Dialog
        open={reconnectOpen}
        onOpenChange={(open) => {
          if (!open && reconnectLoading) return;
          setReconnectOpen(open);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Conectar conta Asaas</DialogTitle>
            <DialogDescription>
              Informe a API key da subconta para validar e reconectar a integração.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-sm font-medium">API key da subconta</div>
              <Input
                value={reconnectApiKey}
                onChange={(e) => setReconnectApiKey(e.target.value)}
                placeholder="cole a API key aqui"
                disabled={reconnectLoading}
              />
              <p className="text-xs text-gray-600">
                A chave é usada apenas para validar e não é exibida novamente.
              </p>
            </div>

            {reconnectResult ? (
              <div className="flex items-center gap-2">
                <Badge variant={reconnectResult.success ? 'default' : 'destructive'}>
                  {reconnectResult.success ? 'Sucesso' : 'Erro'}
                </Badge>
                <span className="text-sm text-gray-700">{reconnectResult.message}</span>
              </div>
            ) : null}
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={reconnectLoading}
              onClick={() => setReconnectOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={reconnectLoading || !reconnectApiKey.trim()}
              onClick={handleReconnect}
            >
              {reconnectLoading ? 'Conectando…' : 'Conectar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!open && deleteLoading) return;
          setDeleteOpen(open);
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Excluir conta (Alusa + Asaas)</DialogTitle>
            <DialogDescription>
              Esta ação é irreversível. A conta será excluída no Asaas primeiro e, somente em caso
              de sucesso, será marcada como excluída na Alusa.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-sm font-medium">Motivo (obrigatório)</div>
              <Textarea
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder="Descreva o motivo da exclusão"
                disabled={deleteLoading}
              />
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Digite DELETAR para confirmar</div>
              <Input
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="DELETAR"
                disabled={deleteLoading}
                autoCapitalize="characters"
              />
            </div>

            <label className="flex items-start gap-3 rounded-md border border-rose-200 bg-white p-3">
              <Checkbox
                checked={deleteChecked}
                onCheckedChange={(v) => setDeleteChecked(v === true)}
                disabled={deleteLoading}
              />
              <span className="text-sm text-rose-900">
                Eu entendo que esta ação é destrutiva e irreversível.
              </span>
            </label>

            {deleteResult ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge variant={deleteResult.success ? 'default' : 'destructive'}>
                    {deleteResult.success ? 'Sucesso' : 'Erro'}
                  </Badge>
                  <span className="text-sm text-gray-700">{deleteResult.summary}</span>
                </div>

                {deleteResult.steps?.length ? (
                  <div className="rounded-md border border-gray-200 bg-white p-3">
                    <div className="text-sm font-medium text-gray-900">Progresso</div>
                    <ul className="mt-2 space-y-1 text-sm text-gray-700">
                      {deleteResult.steps.map((s, idx) => (
                        <li
                          key={`${s.step}-${idx}`}
                          className="flex items-start justify-between gap-3"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="font-mono text-xs text-gray-600">{s.step}</span>
                            <Badge variant={deleteStepBadgeVariant(s.status)}>
                              {deleteStepLabel(s.status)}
                            </Badge>
                          </div>

                          <div className="min-w-0 text-right">
                            <div className="text-gray-800">{s.message}</div>
                            {s.debugSafe && Object.keys(s.debugSafe).length ? (
                              <details className="mt-1 text-left">
                                <summary className="cursor-pointer text-xs text-gray-600">
                                  Detalhes
                                </summary>
                                <pre className="mt-2 max-h-40 overflow-auto rounded bg-gray-50 p-2 text-[11px] text-gray-800">
                                  {JSON.stringify(s.debugSafe, null, 2)}
                                </pre>
                              </details>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {deleteResult.debugSafe ? (
                  <details className="rounded-md border border-gray-200 bg-white p-3">
                    <summary className="cursor-pointer text-sm font-medium text-gray-900">
                      Debug seguro (admin/dev)
                    </summary>
                    <pre className="mt-3 overflow-auto rounded bg-gray-50 p-3 text-xs text-gray-800">
                      {JSON.stringify(deleteResult.debugSafe, null, 2)}
                    </pre>
                  </details>
                ) : null}
              </div>
            ) : null}
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={deleteLoading}
              onClick={() => setDeleteOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={
                deleteLoading ||
                !deleteChecked ||
                deleteConfirmText.trim() !== 'DELETAR' ||
                !deleteReason.trim()
              }
              onClick={handleDelete}
            >
              {deleteLoading ? 'Excluindo…' : 'Excluir conta (Alusa + Asaas)'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
