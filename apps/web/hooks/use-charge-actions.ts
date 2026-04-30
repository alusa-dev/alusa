/**
 * Hook para gerenciar ações permitidas em cobranças com base no status.
 *
 * Este hook encapsula a lógica de negócio definida em @alusa/finance
 * para determinar quais ações estão disponíveis para cada status de cobrança.
 *
 * Uso:
 * ```tsx
 * const { allowedActions, isAllowed, getActionLabel } = useChargeActions(status);
 * 
 * // Verificar se ação específica é permitida
 * if (isAllowed('CONFIRM_CASH_PAYMENT')) {
 *   // Mostrar botão de confirmar recebimento
 * }
 * ```
 */

import { useMemo } from 'react';
import type { StatusCobranca } from '@prisma/client';
import {
  getAllowedActionsByChargeStatus,
  isActionAllowed,
  CHARGE_ACTION_LABELS,
  type ChargeAction,
} from '@alusa/finance/client';

export interface UseChargeActionsReturn {
  /** Lista de ações permitidas para o status atual */
  allowedActions: ChargeAction[];
  /** Verifica se uma ação específica é permitida */
  isAllowed: (action: ChargeAction) => boolean;
  /** Retorna o label amigável para uma ação */
  getActionLabel: (action: ChargeAction) => string;
  /** Indica se a cobrança pode ser editada */
  canEdit: boolean;
  /** Indica se a cobrança pode ser cancelada */
  canCancel: boolean;
  /** Indica se pode confirmar recebimento manual */
  canConfirmPayment: boolean;
  /** Indica se pode reenviar notificação */
  canResend: boolean;
  /** Indica se pode visualizar fatura */
  canViewInvoice: boolean;
  /** Indica se pode estornar */
  canRefund: boolean;
  /** Indica se pode desfazer recebimento em dinheiro */
  canUndoCashPayment: boolean;
}

interface UseChargeActionsOptions {
  wasReceivedInCash?: boolean;
}

/**
 * Hook para gerenciar ações permitidas em cobranças
 */
export function useChargeActions(
  status: StatusCobranca,
  options?: UseChargeActionsOptions,
): UseChargeActionsReturn {
  return useMemo(() => {
    const allowedActions = getAllowedActionsByChargeStatus(status, options);

    const isAllowed = (action: ChargeAction) => isActionAllowed(status, action, options);
    const getActionLabel = (action: ChargeAction) => CHARGE_ACTION_LABELS[action];

    return {
      allowedActions,
      isAllowed,
      getActionLabel,
      canEdit: isAllowed('EDIT'),
      canCancel: isAllowed('CANCEL'),
      canConfirmPayment: isAllowed('CONFIRM_CASH_PAYMENT'),
      canResend: isAllowed('RESEND_NOTIFICATION'),
      canViewInvoice: isAllowed('VIEW_INVOICE'),
      canRefund: isAllowed('REFUND'),
      canUndoCashPayment: isAllowed('UNDO_CASH_PAYMENT'),
    };
  }, [options, status]);
}

/**
 * Componentes de menu de ações para cobrança
 */
export interface ChargeActionMenuItem {
  action: ChargeAction;
  label: string;
  icon?: string;
  variant?: 'default' | 'destructive' | 'outline';
  disabled?: boolean;
}

/**
 * Retorna itens de menu formatados para o dropdown de ações
 */
export function getChargeActionMenuItems(
  status: StatusCobranca,
  options?: UseChargeActionsOptions,
): ChargeActionMenuItem[] {
  const allowedActions = getAllowedActionsByChargeStatus(status, options);

  const menuConfig: Record<ChargeAction, Omit<ChargeActionMenuItem, 'action' | 'label'>> = {
    RESEND_NOTIFICATION: { icon: 'send', variant: 'default' },
    CONFIRM_CASH_PAYMENT: { icon: 'banknote', variant: 'default' },
    UNDO_CASH_PAYMENT: { icon: 'rotate-ccw', variant: 'destructive' },
    CANCEL: { icon: 'trash-2', variant: 'destructive' },
    VIEW_INVOICE: { icon: 'file-text', variant: 'outline' },
    REFUND: { icon: 'rotate-ccw', variant: 'destructive' },
    EDIT: { icon: 'pencil', variant: 'default' },
  };

  return allowedActions.map((action) => ({
    action,
    label: CHARGE_ACTION_LABELS[action],
    ...menuConfig[action],
  }));
}

// Re-export types for convenience
export type { ChargeAction };
