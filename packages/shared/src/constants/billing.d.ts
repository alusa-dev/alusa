/**
 * Constantes de faturamento
 */
export declare const BILLING_TYPES: {
    readonly BOLETO: "BOLETO";
    readonly CREDIT_CARD: "CREDIT_CARD";
    readonly PIX: "PIX";
    readonly UNDEFINED: "UNDEFINED";
};
export type BillingType = (typeof BILLING_TYPES)[keyof typeof BILLING_TYPES];
export declare const PAYMENT_STATUSES: {
    readonly PENDING: "PENDING";
    readonly CONFIRMED: "CONFIRMED";
    readonly OVERDUE: "OVERDUE";
    readonly REFUNDED: "REFUNDED";
    readonly CANCELLED: "CANCELLED";
    /** Chargeback em qualquer fase (disputado, aguardando reversão, etc.) */
    readonly CHARGEBACK: "CHARGEBACK";
    /** Recebido em dinheiro/mãos - fora do Asaas */
    readonly RECEIVED_IN_CASH: "RECEIVED_IN_CASH";
};
export type PaymentStatus = (typeof PAYMENT_STATUSES)[keyof typeof PAYMENT_STATUSES];
//# sourceMappingURL=billing.d.ts.map