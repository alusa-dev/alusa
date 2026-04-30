'use client';

import { useState } from 'react';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type ActionKey =
  | 'repair-webhook'
  | 'remove-backoff'
  | 'process-queue'
  | 'replay-event'
  | 'reconcile-payment'
  | 'reconcile-tenant';

type ActionResult = {
  success: boolean;
  action: string;
  tenantId: string;
  summary: string;
  auditId: string | null;
  data?: unknown;
};

const actionTitles: Record<ActionKey, string> = {
  'repair-webhook': 'Consertar webhook',
  'remove-backoff': 'Liberar envios bloqueados',
  'process-queue': 'Processar pendências',
  'replay-event': 'Reprocessar evento',
  'reconcile-payment': 'Sincronizar cobrança',
  'reconcile-tenant': 'Sincronizar conta',
};

export function GlobalAdminActionCenter({
  initialTenantId = '',
  initialEventId = '',
  initialPaymentId = '',
  compact = false,
}: {
  initialTenantId?: string;
  initialEventId?: string;
  initialPaymentId?: string;
  compact?: boolean;
}) {
  const [tenantId, setTenantId] = useState(initialTenantId);
  const [reason, setReason] = useState('');
  const [eventId, setEventId] = useState(initialEventId);
  const [asaasPaymentId, setAsaasPaymentId] = useState(initialPaymentId);
  const [queueLimit, setQueueLimit] = useState('100');
  const [tenantLimit, setTenantLimit] = useState('200');
  const [windowHours, setWindowHours] = useState('72');
  const [pendingAction, setPendingAction] = useState<ActionKey | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);

  async function executeAction(action: ActionKey) {
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        tenantId,
        reason,
      };

      if (action === 'process-queue') body.limit = Number(queueLimit);
      if (action === 'replay-event') body.eventId = eventId;
      if (action === 'reconcile-payment') body.asaasPaymentId = asaasPaymentId;
      if (action === 'reconcile-tenant') {
        body.windowHours = Number(windowHours);
        body.limit = Number(tenantLimit);
      }

      const response = await fetch(`/api/global-admin/actions/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const json = (await response.json().catch(() => null)) as
        | { success?: boolean; data?: ActionResult; error?: string }
        | null;

      if (!response.ok || !json?.success || !json.data) {
        throw new Error(json?.error ?? 'Falha ao executar ação');
      }

      setResult(json.data);
      setReason('');
    } catch (error) {
      setResult({
        success: false,
        action,
        tenantId,
        summary: error instanceof Error ? error.message : String(error),
        auditId: null,
      });
    } finally {
      setSubmitting(false);
      setPendingAction(null);
    }
  }

  const gridClass = compact ? 'grid gap-4 xl:grid-cols-2' : 'grid gap-4 xl:grid-cols-3';

  return (
    <>
      <Card className="rounded-xl border-slate-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle>Ações rápidas</CardTitle>
          <CardDescription>
            Use quando precisar corrigir uma conta específica. Toda ação fica registrada com o motivo informado.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="tenantId">ID da conta</Label>
              <Input
                id="tenantId"
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                placeholder="Cole o id da conta que precisa de ajuda"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reason">Motivo</Label>
              <Textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Explique o que aconteceu e por que esta ação está sendo feita."
                className="min-h-[88px]"
              />
            </div>
          </div>

          <div className={gridClass}>
            <ActionCard
              title="Consertar webhook"
              description="Alinha a configuração do webhook da conta e recria quando necessário."
              disabled={!tenantId || reason.trim().length < 3}
              onRun={() => setPendingAction('repair-webhook')}
            />
            <ActionCard
              title="Liberar envios bloqueados"
              description="Remove penalização e tenta normalizar o envio dos eventos."
              disabled={!tenantId || reason.trim().length < 3}
              onRun={() => setPendingAction('remove-backoff')}
            />
            <ActionCard
              title="Processar pendências"
              description="Reprocessa eventos pendentes ou com erro para a conta."
              disabled={!tenantId || reason.trim().length < 3}
              onRun={() => setPendingAction('process-queue')}
            >
              <div className="space-y-2">
                <Label htmlFor="queueLimit">Quantidade máxima</Label>
                <Input
                  id="queueLimit"
                  value={queueLimit}
                  onChange={(e) => setQueueLimit(e.target.value)}
                  placeholder="Ex.: 100"
                />
              </div>
            </ActionCard>
            <ActionCard
              title="Reprocessar evento"
              description="Tenta novamente um evento específico pelo eventId."
              disabled={!tenantId || !eventId || reason.trim().length < 3}
              onRun={() => setPendingAction('replay-event')}
            >
              <div className="space-y-2">
                <Label htmlFor="eventId">ID do evento</Label>
                <Input
                  id="eventId"
                  value={eventId}
                  onChange={(e) => setEventId(e.target.value)}
                  placeholder="Cole o eventId do webhook"
                />
              </div>
            </ActionCard>
            <ActionCard
              title="Sincronizar cobrança"
              description="Consulta o Asaas e corrige o estado local do pagamento."
              disabled={!tenantId || !asaasPaymentId || reason.trim().length < 3}
              onRun={() => setPendingAction('reconcile-payment')}
            >
              <div className="space-y-2">
                <Label htmlFor="asaasPaymentId">ID do pagamento no Asaas</Label>
                <Input
                  id="asaasPaymentId"
                  value={asaasPaymentId}
                  onChange={(e) => setAsaasPaymentId(e.target.value)}
                  placeholder="Cole o paymentId do Asaas"
                />
              </div>
            </ActionCard>
            <ActionCard
              title="Sincronizar conta"
              description="Atualiza subconta e dados financeiros recentes da conta."
              disabled={!tenantId || reason.trim().length < 3}
              onRun={() => setPendingAction('reconcile-tenant')}
            >
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="windowHours">Janela em horas</Label>
                  <Input
                    id="windowHours"
                    value={windowHours}
                    onChange={(e) => setWindowHours(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tenantLimit">Quantidade máxima</Label>
                  <Input
                    id="tenantLimit"
                    value={tenantLimit}
                    onChange={(e) => setTenantLimit(e.target.value)}
                  />
                </div>
              </div>
            </ActionCard>
          </div>

          {result ? (
            <div
              className={`rounded-xl border px-4 py-3 text-sm ${
                result.success
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-rose-200 bg-rose-50 text-rose-800'
              }`}
            >
              <p className="font-medium">{result.summary}</p>
              <p className="mt-1 text-xs opacity-80">
                ação: {result.action} • conta: {result.tenantId}
                {result.auditId ? ` • histórico: ${result.auditId}` : ''}
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={Boolean(pendingAction)}
        onOpenChange={(open) => {
          if (!open) setPendingAction(null);
        }}
        title={pendingAction ? actionTitles[pendingAction] : 'Confirmar'}
        description={
          pendingAction
            ? `Executar ${actionTitles[pendingAction]} para a conta ${tenantId}. Esta ação ficará registrada no histórico com o motivo informado.`
            : ''
        }
        onConfirm={() => {
          if (pendingAction) void executeAction(pendingAction);
        }}
        loading={submitting}
      />
    </>
  );
}

function ActionCard({
  title,
  description,
  disabled,
  onRun,
  children,
}: {
  title: string;
  description: string;
  disabled: boolean;
  onRun: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="space-y-1">
        <h4 className="text-sm font-semibold text-slate-950">{title}</h4>
        <p className="text-[13px] leading-5 text-slate-600">{description}</p>
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
      <Button className="mt-4 h-10 w-full rounded-lg bg-brand-accent text-white shadow-none hover:bg-brand-accent/90" onClick={onRun} disabled={disabled}>
        Abrir confirmação
      </Button>
    </div>
  );
}
