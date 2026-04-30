"use client";

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/toast';

type ApiSuccess = {
  ok: true;
  status: number;
  endpoint: string;
  data: unknown;
};

type ApiError = {
  ok: false;
  status?: number;
  endpoint?: string | null;
  error: string;
  details?: unknown;
};

type ApiResponse = ApiSuccess | ApiError;

type LogEntry = {
  id: string;
  timestamp: string;
  endpoint: string;
  status: number;
  ok: boolean;
  message: string;
  payload: unknown;
};

function statusBadgeVariant(status: number): 'default' | 'destructive' | 'outline' | 'warning' {
  if (status >= 200 && status < 300) return 'default';
  if (status >= 500) return 'destructive';
  if (status >= 400) return 'warning';
  return 'outline';
}

function statusHint(status: number): string {
  if (status === 200) return 'Customer encontrado na subconta.';
  if (status === 404) return 'Customer não existe nesta subconta.';
  if (status === 401 || status === 403) return 'API key inválida ou sem permissão.';
  if (status === 400) return 'CustomerId inválido ou requisição malformada.';
  return 'Falha de comunicação com o Asaas.';
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function CustomerDiagnosticClient() {
  const [customerId, setCustomerId] = useState('');
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = useMemo(
    () => logs.find((entry) => entry.id === selectedId) ?? null,
    [logs, selectedId],
  );

  async function handleTest() {
    if (loading) return;
    const trimmed = customerId.trim();
    if (!trimmed) return;

    setLoading(true);
    try {
      const res = await fetch('/api/admin/teste-asaas/customer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: trimmed }),
      });

      const data = (await res.json().catch(() => null)) as ApiResponse | null;
      const endpoint = data?.endpoint || `/v3/customers/${trimmed}`;
      const message = data?.ok ? 'Consulta concluída.' : data?.error || 'Falha ao consultar.';
      const payload = data?.ok ? data.data : data?.details ?? data ?? null;

      const entry: LogEntry = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        timestamp: new Date().toLocaleString('pt-BR'),
        endpoint,
        status: res.status,
        ok: res.ok,
        message,
        payload,
      };

      setLogs((prev) => [entry, ...prev]);
      setSelectedId(entry.id);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="text-sm font-medium text-gray-700" htmlFor="customerId">
            CustomerId
          </label>
          <Input
            id="customerId"
            placeholder="cus_000007454218"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
          />
        </div>
        <Button onClick={handleTest} disabled={loading || !customerId.trim()}>
          {loading ? 'Consultando...' : 'Testar customer'}
        </Button>
        <BadgeTestButton />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr,1.9fr]">
        <section className="rounded-lg border border-gray-200 bg-white">
          <header className="border-b border-gray-100 px-4 py-3">
            <h3 className="text-sm font-medium text-gray-900">Logs</h3>
          </header>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Endpoint</th>
                  <th className="px-4 py-2 text-left font-medium">Timestamp</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-center text-gray-500" colSpan={3}>
                      Nenhum log gerado ainda.
                    </td>
                  </tr>
                ) : (
                  logs.map((entry) => (
                    <tr
                      key={entry.id}
                      className={`cursor-pointer border-t border-gray-100 hover:bg-gray-50 ${selectedId === entry.id ? 'bg-gray-50' : ''
                        }`}
                      onClick={() => setSelectedId(entry.id)}
                    >
                      <td className="px-4 py-3 font-mono text-xs text-gray-800">
                        {entry.endpoint}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{entry.timestamp}</td>
                      <td className="px-4 py-3">
                        <Badge variant={statusBadgeVariant(entry.status)}>{entry.status}</Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white">
          <header className="border-b border-gray-100 px-4 py-3">
            <h3 className="text-sm font-medium text-gray-900">Detalhes</h3>
          </header>
          <div className="space-y-4 px-4 py-4">
            {!selected ? (
              <div className="text-sm text-gray-500">Selecione um log ao lado para ver detalhes.</div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-gray-900">{selected.message}</p>
                    <p className="text-xs text-gray-500">{statusHint(selected.status)}</p>
                  </div>
                  <Badge variant={statusBadgeVariant(selected.status)}>{selected.status}</Badge>
                </div>
                <div className="rounded-md border border-gray-100 bg-gray-50 p-3">
                  <pre className="max-h-[420px] overflow-auto text-xs text-gray-700">
                    {formatJson(selected.payload)}
                  </pre>
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

// Botão de teste que exibe/esconde um Badge de sucesso
import { CustomToast } from '@/components/ui/toast';

function BadgeTestButton() {
  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        onClick={() =>
          (toast as any).custom((t: any) => (
            <CustomToast
              variant="success"
              title="Success toast!"
              description="Notification description will be here"
              actionLabel="Got It!"
              onClose={() => (toast as any).dismiss(t)}
            />
          ))
        }
      >
        Testar Success
      </Button>

      <Button
        variant="outline"
        onClick={() =>
          (toast as any).custom((t: any) => (
            <CustomToast
              variant="error"
              title="Error toast!"
              description="Notification description will be here"
              actionLabel="Fixing!"
              onClose={() => (toast as any).dismiss(t)}
            />
          ))
        }
      >
        Testar Error
      </Button>
    </div>
  );
}
