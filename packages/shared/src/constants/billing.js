/**
 * Constantes de faturamento
 */
export const BILLING_TYPES = {
    BOLETO: 'BOLETO',
    CREDIT_CARD: 'CREDIT_CARD',
    PIX: 'PIX',
    UNDEFINED: 'UNDEFINED',
};
export const PAYMENT_STATUSES = {
    PENDING: 'PENDING',
    CONFIRMED: 'CONFIRMED',
    OVERDUE: 'OVERDUE',
    REFUNDED: 'REFUNDED',
    CANCELLED: 'CANCELLED',
    /** Chargeback em qualquer fase (disputado, aguardando reversão, etc.) */
    CHARGEBACK: 'CHARGEBACK',
    /** Recebido em dinheiro/mãos - fora do Asaas */
    RECEIVED_IN_CASH: 'RECEIVED_IN_CASH',
};
