/**
 * Constantes de Actions de Auditoria
 *
 * Centraliza todas as actions usadas em logs de auditoria para:
 * - Consistência de nomenclatura
 * - Facilitar buscas e análises
 * - Evitar typos
 *
 * Convenção: namespace.contexto.acao
 * Ex: finance.webhook.payment_status_changed
 */

// ─────────────────────────────────────────────────────────────────────────────
// Alunos
// ─────────────────────────────────────────────────────────────────────────────
export const AUDIT_ACTIONS = {
  ALUNO: {
    CREATED: 'ALUNO_CREATED',
    UPDATED: 'ALUNO_UPDATED',
    ARQUIVADO: 'ALUNO_ARQUIVADO',
    HARD_DELETED: 'ALUNO_HARD_DELETED',
    REACTIVATED: 'ALUNO_REACTIVATED',
    ASAAS_CUSTOMER_INACTIVATION: 'ASAAS_CUSTOMER_INACTIVATION_RESULT',
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Matrículas
  // ─────────────────────────────────────────────────────────────────────────────
  MATRICULA: {
    CREATED: 'MATRICULA_CREATED',
    EDITED: 'MATRICULA_EDITED',
    STATUS_SYNC: 'MATRICULA_STATUS_SYNC',
    HARD_DELETED: 'MATRICULA_HARD_DELETED',
    CANCELADA_VIA_SUBSCRIPTION: 'finance.webhook.matricula_cancelada_via_subscription',
    PAUSADA_VIA_SUBSCRIPTION: 'finance.webhook.matricula_pausada_via_subscription',
    REATIVADA_VIA_SUBSCRIPTION: 'finance.webhook.matricula_reativada_via_subscription',
    TIMEOUT_APPLIED: 'matricula.timeout.applied',
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Rematrícula
  // ─────────────────────────────────────────────────────────────────────────────
  REMATRICULA: {
    INICIADA: 'rematricula.step.iniciada',
    MATRICULA_PROVISORIA_CRIADA: 'rematricula.step.matricula_provisoria_criada',
    SUBSCRIPTION_CRIADA: 'rematricula.step.subscription_criada',
    ORIGEM_CANCELADA: 'rematricula.step.origem_cancelada',
    MATRICULA_ATIVADA: 'rematricula.step.matricula_ativada',
    CONCLUIDA: 'rematricula.step.concluida',
    FALHOU: 'rematricula.step.falhou',
    RETRY_INICIADO: 'rematricula.retry.iniciado',
    RETRY_CONCLUIDO: 'rematricula.retry.concluido',
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Cobranças e Pagamentos (Finance)
  // ─────────────────────────────────────────────────────────────────────────────
  FINANCE: {
    PAYMENT_STATUS_CHANGED: 'finance.webhook.payment_status_changed',
    PAYMENT_STATUS_REGRESSION_BLOCKED: 'finance.webhook.payment_status_regression_blocked',
    STANDALONE_CHARGE_UPDATED: 'finance.webhook.standalone_charge_updated',
    COBRANCA_CREATED_FROM_SUBSCRIPTION: 'finance.webhook.cobranca_created_from_subscription',
    SUBSCRIPTION_STATUS_CHANGED: 'finance.webhook.subscription_status_changed',
    INSTALLMENT_PLAN_STATUS_CHANGED: 'finance.webhook.installmentPlan_status_changed',
    TRANSFER_STATUS_CHANGED: 'finance.webhook.transfer_status_changed',
    INTERNAL_TRANSFER_RECEIVED: 'finance.webhook.internal_transfer_received',
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Onboarding (Asaas Account)
  // ─────────────────────────────────────────────────────────────────────────────
  ONBOARDING: {
    ACCOUNT_STATUS_CHANGED: 'finance.onboarding.account_status_changed',
    COMMERCIAL_INFO_STATUS_CHANGED: 'finance.onboarding.commercial_info_status_changed',
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Webhooks (genérico)
  // ─────────────────────────────────────────────────────────────────────────────
  WEBHOOK: {
    RECEIVED: 'webhook.received',
    PROCESSED: 'webhook.processed',
    FAILED: 'webhook.failed',
    DUPLICATE_IGNORED: 'webhook.duplicate_ignored',
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Reconciliação
  // ─────────────────────────────────────────────────────────────────────────────
  RECONCILIATION: {
    MATRICULA_SEM_ASSINATURA: 'gateway.reconcile.matricula_sem_assinatura',
    STATUS_DIVERGENTE: 'gateway.reconcile.status_divergente',
    CORRIGIDO: 'gateway.reconcile.corrigido',
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Troca de Pagador
  // ─────────────────────────────────────────────────────────────────────────────
  PAYER_CHANGE: {
    INICIADO: 'payer.change.iniciado',
    ASSINATURA_ANTIGA_CANCELADA: 'payer.change.assinatura_antiga_cancelada',
    ASSINATURA_NOVA_CRIADA: 'payer.change.assinatura_nova_criada',
    COMMITTED: 'payer.change.committed',
    CONCLUIDO: 'payer.change.concluido',
    FALHOU: 'payer.change.falhou',
    RETRY: 'payer.change.retry',
  },
} as const;

// Type helpers para uso com TypeScript
export type AuditAction =
  | (typeof AUDIT_ACTIONS.ALUNO)[keyof typeof AUDIT_ACTIONS.ALUNO]
  | (typeof AUDIT_ACTIONS.MATRICULA)[keyof typeof AUDIT_ACTIONS.MATRICULA]
  | (typeof AUDIT_ACTIONS.REMATRICULA)[keyof typeof AUDIT_ACTIONS.REMATRICULA]
  | (typeof AUDIT_ACTIONS.FINANCE)[keyof typeof AUDIT_ACTIONS.FINANCE]
  | (typeof AUDIT_ACTIONS.ONBOARDING)[keyof typeof AUDIT_ACTIONS.ONBOARDING]
  | (typeof AUDIT_ACTIONS.WEBHOOK)[keyof typeof AUDIT_ACTIONS.WEBHOOK]
  | (typeof AUDIT_ACTIONS.RECONCILIATION)[keyof typeof AUDIT_ACTIONS.RECONCILIATION]
  | (typeof AUDIT_ACTIONS.PAYER_CHANGE)[keyof typeof AUDIT_ACTIONS.PAYER_CHANGE];
