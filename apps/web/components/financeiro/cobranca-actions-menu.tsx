'use client';

import { useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import {
  MoreHorizontal,
  FileText,
  Banknote,
  Undo2,
  X,
  RefreshCcw,
  RotateCcw,
  Loader2,
} from 'lucide-react';
import { toast } from '@/components/ui/toast';
import type { StatusCobranca } from '@prisma/client';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { getAllowedActionsByChargeStatus, type ChargeAction } from '@alusa/finance/client';

interface CobrancaActionsMenuProps {
  cobrancaId: string;
  status: StatusCobranca;
  invoiceUrl?: string | null;
  wasReceivedInCash?: boolean;
  isAdmin?: boolean;
  onActionComplete?: () => void;
}

// Calcula ações permitidas por status (sincronizado com @alusa/finance)
function getAllowedActions(
  status: StatusCobranca,
  options: { wasReceivedInCash?: boolean; isAdmin?: boolean },
): ChargeAction[] {
  return getAllowedActionsByChargeStatus(status, {
    wasReceivedInCash: options.wasReceivedInCash,
  });
}

const ACTION_CONFIG: Record<
  ChargeAction,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    variant?: 'default' | 'destructive';
    requireConfirmation?: boolean;
  }
> = {
  VIEW_INVOICE: { label: 'Visualizar fatura', icon: FileText },
  CONFIRM_CASH_PAYMENT: {
    label: 'Confirmar recebimento',
    icon: Banknote,
    requireConfirmation: true,
  },
  UNDO_CASH_PAYMENT: {
    label: 'Desfazer recebimento',
    icon: Undo2,
    variant: 'destructive',
    requireConfirmation: true,
  },
  CANCEL: {
    label: 'Cancelar cobrança',
    icon: X,
    variant: 'destructive',
    requireConfirmation: true,
  },
  REFUND: {
    label: 'Estornar pagamento',
    icon: RotateCcw,
    variant: 'destructive',
    requireConfirmation: true,
  },
  RESEND_NOTIFICATION: { label: 'Reenviar cobrança', icon: RefreshCcw },
  EDIT: { label: 'Editar cobrança', icon: FileText },
};

export function CobrancaActionsMenu({
  cobrancaId,
  status,
  invoiceUrl,
  wasReceivedInCash = false,
  isAdmin = false,
  onActionComplete,
}: CobrancaActionsMenuProps) {
  const [loadingAction, setLoadingAction] = useState<ChargeAction | null>(null);
  const [confirmAction, setConfirmAction] = useState<ChargeAction | null>(null);

  const allowedActions = getAllowedActions(status, { wasReceivedInCash, isAdmin });

  if (allowedActions.length === 0) {
    return null;
  }

  function getConfirmationContent(action: ChargeAction) {
    switch (action) {
      case 'CONFIRM_CASH_PAYMENT':
        return {
          title: 'Confirmar recebimento em dinheiro?',
          description:
            'Esta ação envia a confirmação para o processamento financeiro da Alusa e o status será atualizado automaticamente.',
          confirmText: 'Confirmar recebimento',
        };
      case 'UNDO_CASH_PAYMENT':
        return {
          title: 'Desfazer recebimento?',
          description:
            'Esta ação solicita o desfazimento do recebimento em dinheiro na plataforma financeira e o status será atualizado automaticamente.',
          confirmText: 'Desfazer recebimento',
        };
      case 'CANCEL':
        return {
          title: 'Cancelar cobrança?',
          description:
            'Esta ação solicita o cancelamento da cobrança no processamento financeiro da Alusa e pode levar alguns instantes para refletir.',
          confirmText: 'Cancelar cobrança',
        };
      case 'REFUND':
        return {
          title: 'Estornar pagamento?',
          description:
            'Esta ação solicita o estorno no processamento financeiro da Alusa e a atualização será confirmada automaticamente.',
          confirmText: 'Solicitar estorno',
        };
      default:
        return {
          title: 'Confirmar ação?',
          description:
            'Esta ação será enviada para processamento financeiro e confirmada automaticamente.',
          confirmText: 'Confirmar',
        };
    }
  }

  async function executeAction(action: ChargeAction) {
    // Ações que não precisam de API
    if (action === 'VIEW_INVOICE') {
      if (invoiceUrl) {
        window.open(invoiceUrl, '_blank');
      } else {
        toast.error('URL da fatura não disponível');
      }
      return;
    }

    setLoadingAction(action);

    try {
      let endpoint: string;
      let method = 'POST';

      switch (action) {
        case 'CONFIRM_CASH_PAYMENT':
          endpoint = `/api/financeiro/cobrancas/${cobrancaId}/receber-dinheiro`;
          break;
        case 'UNDO_CASH_PAYMENT':
          endpoint = `/api/cobrancas/${cobrancaId}/undo-receive-in-cash`;
          break;
        case 'CANCEL':
          endpoint = `/api/cobrancas/${cobrancaId}`;
          method = 'DELETE';
          break;
        case 'REFUND':
          endpoint = `/api/cobrancas/${cobrancaId}/refund`;
          break;
        default:
          toast.error('Ação não implementada');
          return;
      }

      const response = await fetch(endpoint, { method });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.message || 'Erro ao executar ação');
      }

      // Mensagem diferenciada para ações assíncronas
      if (data.pending) {
        toast.success(data.message || 'Solicitação enviada. Aguardando atualização automática do processamento financeiro.');
      } else {
        toast.success(data.message || 'Ação executada com sucesso');
      }

      onActionComplete?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      toast.error(message);
    } finally {
      setLoadingAction(null);
    }
  }

  // Separar ações por categoria
  const viewActions = allowedActions.filter((a) => a === 'VIEW_INVOICE');
  const safeActions = allowedActions.filter((a) =>
    ['CONFIRM_CASH_PAYMENT', 'RESEND_NOTIFICATION', 'EDIT'].includes(a),
  );
  const dangerActions = allowedActions.filter((a) =>
    ['CANCEL', 'REFUND', 'UNDO_CASH_PAYMENT'].includes(a),
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <MoreHorizontal className="h-4 w-4" />
            <span className="sr-only">Mais ações</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {/* Ações de visualização */}
          {viewActions.map((action) => {
            const config = ACTION_CONFIG[action];
            const Icon = config.icon;
            return (
              <DropdownMenuItem
                key={action}
                onClick={() => void executeAction(action)}
                disabled={loadingAction !== null}
              >
                {loadingAction === action ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Icon className="mr-2 h-4 w-4" />
                )}
                {config.label}
              </DropdownMenuItem>
            );
          })}

          {/* Separador se houver ações de visualização e outras */}
          {viewActions.length > 0 && (safeActions.length > 0 || dangerActions.length > 0) && (
            <DropdownMenuSeparator />
          )}

          {/* Ações seguras */}
          {safeActions.map((action) => {
            const config = ACTION_CONFIG[action];
            const Icon = config.icon;
            return (
              <DropdownMenuItem
                key={action}
                onClick={() => {
                  if (config.requireConfirmation) {
                    setConfirmAction(action);
                    return;
                  }
                  void executeAction(action);
                }}
                disabled={loadingAction !== null}
              >
                {loadingAction === action ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Icon className="mr-2 h-4 w-4" />
                )}
                {config.label}
              </DropdownMenuItem>
            );
          })}

          {/* Separador antes de ações perigosas */}
          {dangerActions.length > 0 && (viewActions.length > 0 || safeActions.length > 0) && (
            <DropdownMenuSeparator />
          )}

          {/* Ações perigosas */}
          {dangerActions.map((action) => {
            const config = ACTION_CONFIG[action];
            const Icon = config.icon;
            return (
              <DropdownMenuItem
                key={action}
                onClick={() => {
                  if (config.requireConfirmation) {
                    setConfirmAction(action);
                    return;
                  }
                  void executeAction(action);
                }}
                disabled={loadingAction !== null}
                className="text-destructive focus:text-destructive"
              >
                {loadingAction === action ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Icon className="mr-2 h-4 w-4" />
                )}
                {config.label}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {confirmAction && (
        <ConfirmDialog
          open={true}
          onOpenChange={(open) => {
            if (!open) setConfirmAction(null);
          }}
          title={getConfirmationContent(confirmAction).title}
          description={getConfirmationContent(confirmAction).description}
          confirmText={getConfirmationContent(confirmAction).confirmText}
          cancelText="Cancelar"
          variant="destructive"
          loading={loadingAction === confirmAction}
          onConfirm={() => {
            void executeAction(confirmAction).finally(() => setConfirmAction(null));
          }}
        />
      )}
    </>
  );
}
