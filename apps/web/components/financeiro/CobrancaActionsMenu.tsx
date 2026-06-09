'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { pushToast } from '@/components/ui/toast';
import {
  DollarSign,
  DocumentText as FileText,
  Eye,
  Mail,
  MoreVertical,
  RotateCcw,
  Trash2,
} from '@/components/icons/icons';
import { evaluatePaymentActionPolicy, type PaymentOrigin } from '@alusa/finance/client';

/**
 * Tipo de dados da cobrança necessários para o menu de ações
 */
export interface CobrancaActionData {
  id: string;
  status: string;
  asaasPaymentId?: string | null;
  matriculaId?: string;
  formaPagamento?: string;
  tipo?: string | null;
  origin?: PaymentOrigin | string | null;
  asaasStatus?: string | null;
  billingType?: string | null;
  wasReceivedInCash?: boolean;
  isInstallmentPayment?: boolean;
  isSubscriptionPayment?: boolean;
  valor?: number | null;
  refundedValue?: number | null;
  atrasado?: boolean;
  /** URL pública do boleto em PDF (retornada pela API Asaas) */
  bankSlipUrl?: string | null;
  /** URL pública da fatura/invoice (retornada pela API Asaas) */
  invoiceUrl?: string | null;
}

/**
 * Props do componente de menu de ações
 */
export interface CobrancaActionsMenuProps {
  cobranca: CobrancaActionData;
  onPrint?: (_cobranca: CobrancaActionData) => void;
  onResend?: (_cobranca: CobrancaActionData) => void;
  onActionComplete?: () => void | Promise<void>;
  variant?: 'icon' | 'button';
  className?: string;
}

type ChargeMenuAction =
  | 'OPEN_DETAILS'
  | 'VIEW_INVOICE'
  | 'RESEND_NOTIFICATION'
  | 'CONFIRM_CASH_PAYMENT'
  | 'UNDO_CASH_PAYMENT'
  | 'REFUND'
  | 'CANCEL'
  | 'OPEN_MATRICULA';

type NormalizedStatus = 'PENDING' | 'OVERDUE' | 'PAID' | 'CANCELED' | 'REFUNDED' | 'PROCESSING';

const ACTION_LABELS: Record<ChargeMenuAction, string> = {
  OPEN_DETAILS: 'Abrir detalhes',
  VIEW_INVOICE: 'Visualizar fatura',
  RESEND_NOTIFICATION: 'Reenviar cobrança',
  CONFIRM_CASH_PAYMENT: 'Confirmar recebimento',
  UNDO_CASH_PAYMENT: 'Desfazer recebimento',
  REFUND: 'Estornar pagamento',
  CANCEL: 'Cancelar cobrança',
  OPEN_MATRICULA: 'Ver matrícula',
};

const ACTION_ICONS: Record<ChargeMenuAction, React.ComponentType<{ className?: string }>> = {
  OPEN_DETAILS: Eye,
  VIEW_INVOICE: FileText,
  RESEND_NOTIFICATION: Mail,
  CONFIRM_CASH_PAYMENT: DollarSign,
  UNDO_CASH_PAYMENT: RotateCcw,
  REFUND: RotateCcw,
  CANCEL: Trash2,
  OPEN_MATRICULA: Eye,
};

function normalizeStatus(status: string, atrasado?: boolean): NormalizedStatus {
  const normalized = String(status || '').toUpperCase();

  if (['PAGO', 'PAID', 'RECEIVED', 'CONFIRMED'].includes(normalized)) return 'PAID';
  if (['ATRASADO', 'OVERDUE'].includes(normalized) || atrasado) return 'OVERDUE';
  if (['CANCELADO', 'CANCELED', 'CANCELAMENTO_PENDENTE'].includes(normalized)) return 'CANCELED';
  if (['ESTORNADO', 'ESTORNADO_PARCIAL', 'REFUNDED'].includes(normalized)) return 'REFUNDED';
  if (['PROCESSANDO', 'PROCESSING'].includes(normalized)) return 'PROCESSING';
  return 'PENDING';
}

function resolvePaymentOrigin(cobranca: CobrancaActionData): PaymentOrigin {
  if (cobranca.origin) {
    const origin = String(cobranca.origin).toUpperCase();
    if (
      origin === 'ACADEMIC' ||
      origin === 'STANDALONE' ||
      origin === 'INSTALLMENT' ||
      origin === 'SUBSCRIPTION' ||
      origin === 'EVENT' ||
      origin === 'STORE' ||
      origin === 'ENROLLMENT_FEE'
    ) {
      return origin;
    }
  }

  switch (cobranca.tipo) {
    case 'PARCELADA':
      return 'INSTALLMENT';
    case 'RECORRENTE':
      return 'SUBSCRIPTION';
    case 'TAXA_MATRICULA':
      return 'ENROLLMENT_FEE';
    case 'AVULSA':
      return 'STANDALONE';
    default:
      return 'ACADEMIC';
  }
}

type OfficialChargeLinks = {
  invoiceUrl: string | null;
  bankSlipUrl: string | null;
  transactionReceiptUrl?: string | null;
};

function getKnownOfficialLinks(cobranca: CobrancaActionData): OfficialChargeLinks {
  return {
    invoiceUrl: cobranca.invoiceUrl ?? null,
    bankSlipUrl: cobranca.bankSlipUrl ?? null,
  };
}

async function fetchOfficialChargeLinks(cobrancaId: string, options: { fresh?: boolean } = {}): Promise<OfficialChargeLinks> {
  const suffix = options.fresh ? '?fresh=1' : '';
  const response = await fetch(`/api/cobrancas/${cobrancaId}${suffix}`, { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || !payload?.success) {
    const message =
      payload?.message || payload?.error?.message || payload?.error || 'Falha ao buscar links oficiais da cobrança.';
    throw new Error(message);
  }

  const data = payload?.data ?? {};
  return {
    invoiceUrl:
      (typeof data.invoiceUrl === 'string' && data.invoiceUrl) ||
      (typeof data.asaasData?.invoiceUrl === 'string' && data.asaasData.invoiceUrl) ||
      null,
    bankSlipUrl:
      (typeof data.bankSlipUrl === 'string' && data.bankSlipUrl) ||
      (typeof data.asaasData?.bankSlipUrl === 'string' && data.asaasData.bankSlipUrl) ||
      null,
    transactionReceiptUrl:
      (typeof data.transactionReceiptUrl === 'string' && data.transactionReceiptUrl) ||
      (typeof data.asaasData?.transactionReceiptUrl === 'string' && data.asaasData.transactionReceiptUrl) ||
      null,
  };
}

async function syncOfficialChargeLinks(cobrancaId: string): Promise<OfficialChargeLinks> {
  const response = await fetch(`/api/cobrancas/${cobrancaId}/sync-asaas`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || !payload?.success) {
    const message =
      payload?.message || payload?.error?.message || payload?.error || 'Falha ao sincronizar a cobrança com o Asaas.';
    throw new Error(message);
  }

  return {
    invoiceUrl: typeof payload.invoiceUrl === 'string' && payload.invoiceUrl ? payload.invoiceUrl : null,
    bankSlipUrl: typeof payload.bankSlipUrl === 'string' && payload.bankSlipUrl ? payload.bankSlipUrl : null,
    transactionReceiptUrl:
      typeof payload.transactionReceiptUrl === 'string' && payload.transactionReceiptUrl
        ? payload.transactionReceiptUrl
        : null,
  };
}

function openOfficialChargeLink(links: OfficialChargeLinks) {
  const url = links.transactionReceiptUrl || links.invoiceUrl || links.bankSlipUrl;
  if (!url) return false;
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}

function getRecommendedActions(cobranca: CobrancaActionData): ChargeMenuAction[] {
  const normalizedStatus = normalizeStatus(cobranca.status, cobranca.atrasado);
  const hasAsaasPaymentId = Boolean(cobranca.asaasPaymentId);
  const wasReceivedInCash =
    cobranca.wasReceivedInCash ||
    String(cobranca.asaasStatus ?? '').toUpperCase() === 'RECEIVED_IN_CASH' ||
    String(cobranca.billingType ?? cobranca.formaPagamento ?? '').toUpperCase() === 'RECEIVED_IN_CASH';
  const policy = evaluatePaymentActionPolicy({
    entityType: 'COBRANCA',
    origin: resolvePaymentOrigin(cobranca),
    localStatus: cobranca.status,
    asaasStatus: cobranca.asaasStatus,
    billingType: cobranca.billingType ?? cobranca.formaPagamento,
    hasAsaasPaymentId,
    hasInvoiceUrl: Boolean(cobranca.invoiceUrl || cobranca.bankSlipUrl),
    wasReceivedInCash,
    isInstallmentPayment: cobranca.isInstallmentPayment || cobranca.tipo === 'PARCELADA',
    isSubscriptionPayment: cobranca.isSubscriptionPayment || cobranca.tipo === 'RECORRENTE',
    paymentValue: cobranca.valor,
    refundedValue: cobranca.refundedValue,
  });
  const actions: ChargeMenuAction[] = ['OPEN_DETAILS'];

  if (policy.canViewInvoice) {
    actions.push('VIEW_INVOICE');
  }

  if (normalizedStatus === 'PENDING' || normalizedStatus === 'OVERDUE') {
    if (policy.canResendNotification) actions.push('RESEND_NOTIFICATION');
    actions.push('CONFIRM_CASH_PAYMENT');
    if (policy.canCancel) actions.push('CANCEL');
  }

  if (policy.canUndoCashPayment) {
    actions.push('UNDO_CASH_PAYMENT');
  } else if (policy.canRefund || normalizedStatus === 'PAID') {
    actions.push('REFUND');
  }

  if (cobranca.matriculaId) {
    actions.push('OPEN_MATRICULA');
  }

  return Array.from(new Set(actions));
}

function getConfirmationCopy(action: ChargeMenuAction) {
  switch (action) {
    case 'CONFIRM_CASH_PAYMENT':
      return {
        title: 'Confirmar recebimento?',
        description: 'Esta ação usa a confirmação manual de recebimento da cobrança e o estado financeiro será reconciliado na Alusa.',
        confirmText: 'Confirmar recebimento',
      };
    case 'REFUND':
      return {
        title: 'Estornar pagamento?',
        description: 'Esta ação solicita o estorno oficial da cobrança e a Alusa refletirá o estado confirmado pela plataforma financeira.',
        confirmText: 'Solicitar estorno',
      };
    case 'UNDO_CASH_PAYMENT':
      return {
        title: 'Desfazer recebimento em dinheiro?',
        description: 'Esta ação desfaz no Asaas a confirmação manual de recebimento em dinheiro. O estado local será reconciliado em seguida.',
        confirmText: 'Desfazer recebimento',
      };
    case 'CANCEL':
      return {
        title: 'Cancelar cobrança?',
        description: 'Esta ação remove a cobrança na plataforma financeira. O estado local será convergido após a confirmação oficial.',
        confirmText: 'Cancelar cobrança',
      };
    default:
      return {
        title: 'Confirmar ação?',
        description: 'Confirme para continuar.',
        confirmText: 'Confirmar',
      };
  }
}

export function CobrancaActionsMenu({
  cobranca,
  onResend,
  onActionComplete,
  variant = 'icon',
  className = '',
}: CobrancaActionsMenuProps) {
  const router = useRouter();
  const [loadingAction, setLoadingAction] = useState<ChargeMenuAction | null>(null);
  const [confirmAction, setConfirmAction] = useState<ChargeMenuAction | null>(null);

  const recommendedActions = useMemo(() => getRecommendedActions(cobranca), [cobranca]);
  const navigationActions = useMemo(
    () => recommendedActions.filter((action) => ['OPEN_DETAILS', 'OPEN_MATRICULA'].includes(action)),
    [recommendedActions],
  );
  const operationalActions = useMemo(
    () => recommendedActions.filter((action) => !navigationActions.includes(action)),
    [navigationActions, recommendedActions],
  );

  async function runAction(action: ChargeMenuAction) {
    if (action === 'OPEN_DETAILS') {
      router.push(`/cobrancas/${cobranca.id}`);
      return;
    }

    if (action === 'OPEN_MATRICULA' && cobranca.matriculaId) {
      router.push(`/matriculas/${cobranca.matriculaId}`);
      return;
    }

    if (action === 'VIEW_INVOICE') {
      try {
        const knownLinks = getKnownOfficialLinks(cobranca);
        if (openOfficialChargeLink(knownLinks)) {
          return;
        }

        const remoteLinks = await fetchOfficialChargeLinks(cobranca.id, { fresh: true });
        if (openOfficialChargeLink(remoteLinks)) {
          await onActionComplete?.();
          router.refresh();
          return;
        }

        const syncedLinks = await syncOfficialChargeLinks(cobranca.id);
        if (openOfficialChargeLink(syncedLinks)) {
          await onActionComplete?.();
          router.refresh();
          return;
        }

        if (!openOfficialChargeLink(syncedLinks)) {
          pushToast({ title: 'Erro', description: 'Fatura não disponível para esta cobrança.', variant: 'error' });
        }
      } catch (error) {
        pushToast({
          title: 'Erro',
          description: error instanceof Error ? error.message : 'Falha ao buscar a fatura oficial.',
          variant: 'error',
        });
      }
      return;
    }

    if (action === 'RESEND_NOTIFICATION' && onResend) {
      onResend(cobranca);
      return;
    }

    setLoadingAction(action);

    try {
      let response: Response;

      switch (action) {
        case 'RESEND_NOTIFICATION':
          response = await fetch(`/api/cobrancas/${cobranca.id}/asaas-notify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tipo: 'EMAIL' }),
          });
          break;
        case 'CONFIRM_CASH_PAYMENT':
          response = await fetch(`/api/financeiro/cobrancas/${cobranca.id}/marcar-pago`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          });
          break;
        case 'REFUND':
          response = await fetch(`/api/cobrancas/${cobranca.id}/refund`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          });
          break;
        case 'UNDO_CASH_PAYMENT':
          response = await fetch(`/api/cobrancas/${cobranca.id}/undo-receive-in-cash`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          });
          break;
        case 'CANCEL':
          response = await fetch(`/api/cobrancas/${cobranca.id}`, { method: 'DELETE' });
          break;
        default:
          return;
      }

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = payload?.message || payload?.error?.message || payload?.error || 'Falha ao executar ação';
        throw new Error(message);
      }

      if (action === 'RESEND_NOTIFICATION') {
        const links = {
          invoiceUrl: payload?.invoiceUrl ?? null,
          bankSlipUrl: payload?.bankSlipUrl ?? null,
        };
        if (!openOfficialChargeLink(links)) {
          const remoteLinks = await fetchOfficialChargeLinks(cobranca.id);
          openOfficialChargeLink(remoteLinks);
        }
      }

      pushToast({
        title: 'Sucesso',
        description:
          payload?.message ||
          (action === 'RESEND_NOTIFICATION'
            ? 'Cobrança reenviada com sucesso.'
            : 'Ação executada com sucesso.'),
        variant: 'success',
      });

      await onActionComplete?.();
      router.refresh();
    } catch (error) {
      pushToast({
        title: 'Erro',
        description: error instanceof Error ? error.message : 'Falha ao executar ação.',
        variant: 'error',
      });
    } finally {
      setLoadingAction(null);
      setConfirmAction(null);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {variant === 'icon' ? (
            <Button
              variant="ghost"
              size="sm"
              className={`h-8 w-8 p-0 text-gray-600 hover:text-gray-800 hover:bg-gray-100 ${className}`}
              aria-label="Ações da cobrança"
              onClick={(event) => event.stopPropagation()}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className={className}
              aria-label="Ações da cobrança"
              onClick={(event) => event.stopPropagation()}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60" onClick={(event) => event.stopPropagation()}>
          <div className="px-2 py-1.5 text-xs font-medium text-gray-500">Recomendadas</div>
          {operationalActions.map((action) => {
            const Icon = ACTION_ICONS[action];
            const destructive = action === 'REFUND' || action === 'CANCEL';

            return (
              <DropdownMenuItem
                key={action}
                onClick={() => {
                  if (['CONFIRM_CASH_PAYMENT', 'UNDO_CASH_PAYMENT', 'REFUND', 'CANCEL'].includes(action)) {
                    setConfirmAction(action);
                    return;
                  }
                  void runAction(action);
                }}
                className={destructive ? 'text-red-600 focus:text-red-600' : ''}
                disabled={loadingAction !== null}
              >
                <Icon className="mr-2 h-4 w-4" />
                <span>{ACTION_LABELS[action]}</span>
              </DropdownMenuItem>
            );
          })}

          {navigationActions.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <div className="px-2 py-1.5 text-xs font-medium text-gray-500">Navegação</div>
              {navigationActions.map((action) => {
                const Icon = ACTION_ICONS[action];
                return (
                  <DropdownMenuItem
                    key={action}
                    onClick={() => void runAction(action)}
                    disabled={loadingAction !== null}
                  >
                    <Icon className="mr-2 h-4 w-4" />
                    <span>{ACTION_LABELS[action]}</span>
                  </DropdownMenuItem>
                );
              })}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {confirmAction && (
        <ConfirmDialog
          open={true}
          onOpenChange={(open) => {
            if (!open) setConfirmAction(null);
          }}
          title={getConfirmationCopy(confirmAction).title}
          description={getConfirmationCopy(confirmAction).description}
          confirmText={getConfirmationCopy(confirmAction).confirmText}
          cancelText="Voltar"
          variant="destructive"
          loading={loadingAction === confirmAction}
          onConfirm={() => {
            void runAction(confirmAction);
          }}
        />
      )}
    </>
  );
}
