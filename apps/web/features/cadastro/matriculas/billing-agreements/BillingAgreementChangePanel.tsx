'use client';

import * as React from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoCallout, InfoCalloutItem } from '@/components/ui/info-callout';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

import {
  billingEffectivePolicySchema,
  billingAgreementPreviewRequestSchema,
  paidDecreaseHandlingSchema,
  type BillingAgreementChangeSeed,
  type BillingAgreementCommitResponse,
  type BillingEffectivePolicy,
} from './contracts';
import { useBillingAgreementChange } from './use-billing-agreement-change';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const date = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' });

const POLICY_OPTIONS: Array<{
  value: BillingEffectivePolicy;
  label: string;
  description: string;
}> = [
  {
    value: 'CURRENT_CYCLE',
    label: 'Ciclo atual',
    description: 'Atualiza a assinatura e as cobranças pendentes elegíveis do ciclo atual.',
  },
  {
    value: 'NEXT_CYCLE',
    label: 'Próximo ciclo',
    description: 'Preserva as cobranças existentes e aplica o novo valor nas próximas cobranças.',
  },
  {
    value: 'PRORATA',
    label: 'Proporcional',
    description: 'Calcula o período parcial e cria o crédito ou complemento necessário.',
  },
];

const OPERATION_LABELS: Record<BillingAgreementChangeSeed['operation'], string> = {
  ADD_ALLOCATION: 'Adicionar matrícula à cobrança',
  REMOVE_ALLOCATION: 'Remover matrícula da cobrança',
  UPDATE_ALLOCATION: 'Alterar valor da matrícula',
  TRANSFER_ALLOCATION: 'Transferir matrícula entre cobranças',
  PAUSE_ALLOCATION: 'Pausar cobrança da matrícula',
  RESUME_ALLOCATION: 'Retomar cobrança da matrícula',
  PAUSE_AGREEMENT: 'Pausar cobrança recorrente',
  RESUME_AGREEMENT: 'Retomar cobrança recorrente',
  CANCEL_AGREEMENT: 'Encerrar cobrança recorrente',
  CHANGE_PAYER: 'Trocar responsável financeiro',
};

function todayDateOnly() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function formatCents(value: number) {
  return currency.format(value / 100);
}

function formatDateOnly(value: string) {
  return date.format(new Date(`${value}T12:00:00.000Z`));
}

function operationStatusPresentation(status: string) {
  if (status === 'APPLIED') return { label: 'Aplicada', variant: 'success' as const };
  if (status === 'FAILED') return { label: 'Falhou', variant: 'destructive' as const };
  if (status === 'CANCELLED') return { label: 'Cancelada', variant: 'neutral' as const };
  if (status === 'REQUIRES_RECONCILIATION' || status === 'PARTIAL') {
    return { label: 'Requer conferência', variant: 'warning' as const };
  }
  return { label: 'Processando', variant: 'info' as const };
}

export type BillingAgreementChangePanelProps = {
  agreementId: string;
  change: BillingAgreementChangeSeed;
  title?: string;
  onCommitted?: (_result: BillingAgreementCommitResponse) => void;
};

export function BillingAgreementChangePanel({
  agreementId,
  change,
  title,
  onCommitted,
}: BillingAgreementChangePanelProps) {
  const [effectivePolicy, setEffectivePolicy] = React.useState<BillingEffectivePolicy>('CURRENT_CYCLE');
  const [effectiveDate, setEffectiveDate] = React.useState(todayDateOnly);
  const [nextDueDate, setNextDueDate] = React.useState(todayDateOnly);
  const [reason, setReason] = React.useState('Ajuste solicitado pela escola');
  const [paidDecreaseHandling, setPaidDecreaseHandling] = React.useState<'CREDIT' | 'REFUND' | 'MANUAL_REVIEW'>('CREDIT');
  const [validationError, setValidationError] = React.useState<string | null>(null);
  const lifecycle = useBillingAgreementChange(agreementId);
  const resetPreview = lifecycle.resetPreview;
  const changeKey = React.useMemo(() => JSON.stringify(change), [change]);
  const selectedPolicy = POLICY_OPTIONS.find((item) => item.value === effectivePolicy)!;

  React.useEffect(() => {
    resetPreview();
    setValidationError(null);
  }, [changeKey, effectiveDate, effectivePolicy, nextDueDate, paidDecreaseHandling, reason, resetPreview]);

  const handlePreview = async () => {
    const parsed = billingAgreementPreviewRequestSchema.safeParse({
      ...change,
      agreementId,
      effectivePolicy,
      effectiveDate,
      reason,
      paidDecreaseHandling,
      ...(change.operation === 'RESUME_ALLOCATION' || change.operation === 'RESUME_AGREEMENT'
        ? { nextDueDate }
        : {}),
    });
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? 'Revise os dados da alteração.');
      return;
    }
    setValidationError(null);
    await lifecycle.requestPreview(parsed.data);
  };

  const handleCommit = async () => {
    const result = await lifecycle.commit();
    if (result) onCommitted?.(result);
  };

  const statusPresentation = lifecycle.commitResult
    ? operationStatusPresentation(lifecycle.commitResult.status)
    : null;
  const isBusy = lifecycle.previewState === 'loading' || lifecycle.commitState === 'loading';
  const canDecreaseValue = [
    'REMOVE_ALLOCATION',
    'UPDATE_ALLOCATION',
    'TRANSFER_ALLOCATION',
    'PAUSE_ALLOCATION',
    'PAUSE_AGREEMENT',
    'CANCEL_AGREEMENT',
  ].includes(change.operation);
  const isResume = change.operation === 'RESUME_ALLOCATION' || change.operation === 'RESUME_AGREEMENT';

  return (
    <Card className="alusa-session-panel overflow-hidden">
      <CardHeader className="border-b border-border/70">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>{title ?? OPERATION_LABELS[change.operation]}</CardTitle>
            <CardDescription className="mt-1.5">
              Confira o impacto antes de alterar a assinatura e as cobranças da família.
            </CardDescription>
          </div>
          {statusPresentation ? (
            <Badge variant={statusPresentation.variant}>{statusPresentation.label}</Badge>
          ) : null}
        </div>

      </CardHeader>

      <CardContent className="space-y-5 pt-6">
        {lifecycle.agreement ? (
          <div className="grid gap-3 rounded-xl bg-muted/40 p-4 sm:grid-cols-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pagador</p>
              <p className="mt-1 text-sm font-semibold">{lifecycle.agreement.payer.name}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Valor esperado</p>
              <p className="mt-1 text-sm font-semibold">{formatCents(lifecycle.agreement.desiredValueCents)}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Integração</p>
              <p className="mt-1 text-sm font-semibold">
                {lifecycle.agreement.reconciliationStatus === 'CONSISTENT'
                  ? 'Conferida'
                  : lifecycle.agreement.reconciliationStatus === 'PENDING'
                    ? 'Sincronizando'
                    : 'Precisa de conferência'}
              </p>
            </div>
          </div>
        ) : lifecycle.agreementState === 'loading' ? (
          <p className="text-sm text-muted-foreground" aria-live="polite">Carregando acordo financeiro…</p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="billing-effective-policy">Quando aplicar</Label>
            <Select
              value={effectivePolicy}
              onValueChange={(value) => {
                const parsed = billingEffectivePolicySchema.safeParse(value);
                if (parsed.success) setEffectivePolicy(parsed.data);
              }}
              disabled={isBusy}
            >
              <SelectTrigger id="billing-effective-policy">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {POLICY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs leading-relaxed text-muted-foreground">{selectedPolicy.description}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="billing-effective-date">Data de vigência</Label>
            <Input
              id="billing-effective-date"
              type="date"
              value={effectiveDate}
              onChange={(event) => setEffectiveDate(event.target.value)}
              disabled={isBusy}
            />
          </div>
        </div>

        {isResume ? (
          <div className="space-y-2">
            <Label htmlFor="billing-next-due-date">Próximo vencimento</Label>
            <Input
              id="billing-next-due-date"
              type="date"
              value={nextDueDate}
              min={effectiveDate}
              onChange={(event) => setNextDueDate(event.target.value)}
              disabled={isBusy}
            />
            <p className="text-xs leading-relaxed text-muted-foreground">
              A retomada usa esta data para reativar a recorrência sem recriar cobranças do período pausado.
            </p>
          </div>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="billing-change-reason">Motivo do ajuste</Label>
          <Textarea
            id="billing-change-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            rows={3}
            disabled={isBusy}
          />
        </div>

        {canDecreaseValue ? (
          <div className="space-y-2">
            <Label htmlFor="billing-paid-decrease-handling">Se já houver cobrança paga</Label>
            <Select
              value={paidDecreaseHandling}
              onValueChange={(value) => {
                const parsed = paidDecreaseHandlingSchema.safeParse(value);
                if (parsed.success) setPaidDecreaseHandling(parsed.data);
              }}
              disabled={isBusy}
            >
              <SelectTrigger id="billing-paid-decrease-handling">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CREDIT">Gerar crédito no próximo ciclo</SelectItem>
                <SelectItem value="REFUND">Solicitar análise de reembolso</SelectItem>
                <SelectItem value="MANUAL_REVIEW">Encaminhar para análise manual</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {paidDecreaseHandling === 'CREDIT'
                ? 'A cobrança paga permanece imutável e a diferença é abatida no próximo ciclo.'
                : paidDecreaseHandling === 'REFUND'
                  ? 'O reembolso depende do meio de pagamento, saldo e confirmação da integração financeira.'
                  : 'Nenhum ajuste automático será feito até a conferência do financeiro.'}
            </p>
          </div>
        ) : null}

        {validationError || lifecycle.error ? (
          <Alert variant="destructive">
            <AlertTitle>Não foi possível continuar</AlertTitle>
            <AlertDescription>{validationError ?? lifecycle.error}</AlertDescription>
          </Alert>
        ) : null}

        {lifecycle.preview ? (
          <div className="space-y-4" aria-live="polite">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MoneyTile label="Valor atual" value={lifecycle.preview.totals.currentCents} />
              <MoneyTile label="Adicionado" value={lifecycle.preview.totals.addedCents} tone="positive" />
              <MoneyTile label="Removido" value={lifecycle.preview.totals.removedCents} tone="negative" />
              <MoneyTile label="Novo total" value={lifecycle.preview.totals.resultingCents} emphasis />
            </div>

            {lifecycle.preview.affectedPendingPayments.length > 0 ? (
              <div className="overflow-hidden rounded-xl border border-border/70">
                <div className="border-b border-border/70 bg-muted/40 px-4 py-3">
                  <h4 className="text-sm font-semibold">Cobranças pendentes afetadas</h4>
                </div>
                <div className="divide-y divide-border/70">
                  {lifecycle.preview.affectedPendingPayments.map((payment) => (
                    <div key={payment.id} className="grid gap-2 px-4 py-3 text-sm sm:grid-cols-[1fr_auto_auto] sm:items-center">
                      <span>Vencimento {formatDateOnly(payment.dueDate)}</span>
                      <span className="text-muted-foreground">{formatCents(payment.currentAmountCents)}</span>
                      <span className="font-semibold">→ {formatCents(payment.resultingAmountCents)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {lifecycle.preview.paidPaymentAdjustments.length > 0 ? (
              <InfoCallout variant="warning" title="Cobranças pagas serão preservadas" showIcon>
                {lifecycle.preview.paidPaymentAdjustments.map((adjustment) => (
                  <InfoCalloutItem key={`${adjustment.paymentId}:${adjustment.kind}`} label={formatCents(adjustment.amountCents)}>
                    {adjustment.description}
                  </InfoCalloutItem>
                ))}
              </InfoCallout>
            ) : null}

            {lifecycle.preview.warnings.length > 0 ? (
              <Alert variant="warning">
                <AlertTitle>Atenção antes de confirmar</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc space-y-1 pl-5">
                    {lifecycle.preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}

            {lifecycle.preview.blockers.length > 0 ? (
              <Alert variant="destructive">
                <AlertTitle>Alteração bloqueada</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc space-y-1 pl-5">
                    {lifecycle.preview.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
        ) : null}

        {lifecycle.commitResult ? (
          <InfoCallout
            variant={lifecycle.commitResult.status === 'APPLIED' ? 'info' : 'warning'}
            title={statusPresentation?.label}
            showIcon
          >
            <p>{lifecycle.commitResult.message}</p>
            {lifecycle.commitResult.status !== 'APPLIED' ? (
              <p className="mt-1">A Alusa continuará conferindo o estado local e a integração financeira.</p>
            ) : null}
          </InfoCallout>
        ) : null}

        <div className="flex flex-col-reverse gap-2 border-t border-border/70 pt-4 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={handlePreview}
            disabled={isBusy || !effectiveDate || reason.trim().length < 3}
          >
            {lifecycle.previewState === 'loading' ? 'Calculando…' : lifecycle.preview ? 'Recalcular' : 'Ver impacto'}
          </Button>
          <Button
            type="button"
            onClick={handleCommit}
            disabled={
              isBusy ||
              !lifecycle.preview?.canCommit ||
              Boolean(lifecycle.preview?.blockers.length) ||
              lifecycle.commitResult?.status === 'APPLIED'
            }
          >
            {lifecycle.commitState === 'loading' ? 'Aplicando…' : 'Confirmar alteração'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MoneyTile({
  label,
  value,
  tone = 'default',
  emphasis = false,
}: {
  label: string;
  value: number;
  tone?: 'default' | 'positive' | 'negative';
  emphasis?: boolean;
}) {
  return (
    <div className={emphasis ? 'rounded-xl bg-primary/10 p-3' : 'rounded-xl bg-muted/40 p-3'}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={
          tone === 'positive'
            ? 'mt-1 text-base font-semibold text-emerald-700'
            : tone === 'negative'
              ? 'mt-1 text-base font-semibold text-amber-700'
              : 'mt-1 text-base font-semibold text-foreground'
        }
      >
        {formatCents(value)}
      </p>
    </div>
  );
}
