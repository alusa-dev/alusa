/**
 * Cliente Gateway para API do Asaas
 * 
 * Wrapper centralizado que usa o AsaasHttp existente.
 * Garante:
 * - Header `access_token` correto (não Bearer)
 * - Retry com backoff para GETs
 * - Logging e observabilidade
 */

import { AsaasHttp } from '@alusa/asaas';
import { AsaasGatewayError } from '../errors/asaas-gateway-error';

export interface AsaasGatewayClientConfig {
  apiKey: string;
  enableLogging?: boolean;
}

/**
 * Cliente Gateway que encapsula o AsaasHttp
 * Adiciona funcionalidades específicas do gateway (auditoria, feature flags)
 */
export class AsaasGatewayClient {
  private readonly http: AsaasHttp;
  private readonly enableLogging: boolean;

  constructor(config: AsaasGatewayClientConfig) {
    if (!config.apiKey) {
      throw new AsaasGatewayError('API Key é obrigatória', 'MISSING_API_KEY');
    }

    this.http = new AsaasHttp({ apiKey: config.apiKey });
    this.enableLogging = config.enableLogging ?? false;
  }

  /**
   * GET request
   */
  async get<T>(path: string, options?: { params?: Record<string, unknown> }): Promise<T> {
    if (this.enableLogging) {
      console.log('[AsaasGatewayClient] GET', path);
    }
    return this.http.get<T>(path, options);
  }

  /**
   * POST request
   */
  async post<T>(
    path: string,
    body?: unknown,
    options?: { params?: Record<string, unknown> }
  ): Promise<T> {
    if (this.enableLogging) {
      console.log('[AsaasGatewayClient] POST', path);
    }
    return this.http.post<T>(path, body, options);
  }

  /**
   * PUT request
   */
  async put<T>(
    path: string,
    body?: unknown,
    options?: { params?: Record<string, unknown> }
  ): Promise<T> {
    if (this.enableLogging) {
      console.log('[AsaasGatewayClient] PUT', path);
    }
    return this.http.put<T>(path, body, options);
  }

  /**
   * DELETE request
   */
  async delete<T>(path: string, options?: { params?: Record<string, unknown> }): Promise<T> {
    if (this.enableLogging) {
      console.log('[AsaasGatewayClient] DELETE', path);
    }
    return this.http.delete<T>(path, options);
  }

  // =========================================================================
  // Métodos específicos de alto nível (para uso nos use-cases)
  // =========================================================================

  /**
   * Obtém detalhes de um pagamento
   */
  async getPayment(paymentId: string) {
    return this.get<{
      id: string;
      status: string;
      value: number;
      netValue: number;
      billingType: string;
      dueDate: string;
      paymentDate?: string;
      creditDate?: string;
      estimatedCreditDate?: string;
      externalReference?: string;
      invoiceUrl?: string;
      bankSlipUrl?: string;
      subscription?: string;
      installment?: string;
      deleted?: boolean;
    }>(`/v3/payments/${paymentId}`);
  }

  /**
   * Lista cobranças de uma assinatura
   */
  async listSubscriptionPayments(subscriptionId: string, params?: { offset?: number; limit?: number }) {
    return this.get<{
      data: Array<{
        id: string;
        status: string;
        value: number;
        dueDate: string;
        paymentDate?: string;
        externalReference?: string;
      }>;
      hasMore: boolean;
      totalCount: number;
    }>(`/v3/subscriptions/${subscriptionId}/payments`, { params });
  }

  /**
   * Lista cobranças de um parcelamento
   */
  async listInstallmentPayments(installmentId: string) {
    return this.get<{
      data: Array<{
        id: string;
        status: string;
        value: number;
        dueDate: string;
        installmentNumber?: number;
        externalReference?: string;
      }>;
      hasMore: boolean;
      totalCount: number;
    }>(`/v3/installments/${installmentId}/payments`);
  }

  /**
   * Confirma recebimento em dinheiro
   */
  async confirmReceiveInCash(paymentId: string, params: {
    paymentDate: string;
    value: number;
    notifyCustomer?: boolean;
  }) {
    return this.post<{ id: string; status: string }>(
      `/v3/payments/${paymentId}/receiveInCash`,
      params
    );
  }

  /**
   * Desfaz confirmação de recebimento em dinheiro
   */
  async undoReceiveInCash(paymentId: string) {
    return this.post<{ id: string; status: string }>(
      `/v3/payments/${paymentId}/undoReceivedInCash`
    );
  }

  /**
   * Estorna um pagamento
   */
  async refundPayment(paymentId: string, params?: { value?: number; description?: string }) {
    return this.post<{ id: string; status: string }>(
      `/v3/payments/${paymentId}/refund`,
      params
    );
  }

  /**
   * Exclui um pagamento
   */
  async deletePayment(paymentId: string) {
    return this.delete<{ deleted: boolean; id: string }>(
      `/v3/payments/${paymentId}`
    );
  }

  /**
   * Atualiza um pagamento
   */
  async updatePayment(paymentId: string, data: {
    billingType?: string;
    dueDate?: string;
    value?: number;
    description?: string;
    externalReference?: string;
  }) {
    return this.put<{ id: string; status: string }>(
      `/v3/payments/${paymentId}`,
      data
    );
  }

  /**
   * Obtém saldo da conta
   */
  async getBalance() {
    return this.get<{
      balance: number;
    }>('/v3/finance/balance');
  }

  /**
   * Lista transações financeiras (extrato)
   */
  async listFinancialTransactions(params?: {
    startDate?: string;
    finishDate?: string;
    offset?: number;
    limit?: number;
  }) {
    return this.get<{
      data: Array<{
        id: string;
        type: string;
        value: number;
        date: string;
        description: string;
        paymentId?: string;
      }>;
      hasMore: boolean;
      totalCount: number;
    }>('/v3/financialTransactions', { params });
  }

  /**
   * Obtém notificações de um cliente
   */
  async getCustomerNotifications(customerId: string) {
    return this.get<{
      data: Array<{
        id: string;
        event: string;
        scheduleOffset: number;
        enabled: boolean;
        emailEnabledForProvider: boolean;
        smsEnabledForProvider: boolean;
        emailEnabledForCustomer: boolean;
        smsEnabledForCustomer: boolean;
        phoneCallEnabledForCustomer: boolean;
      }>;
    }>(`/v3/customers/${customerId}/notifications`);
  }

  /**
   * Atualiza notificações em lote
   */
  async updateNotificationsBatch(notifications: Array<{
    id: string;
    enabled?: boolean;
    emailEnabledForCustomer?: boolean;
    smsEnabledForCustomer?: boolean;
    phoneCallEnabledForCustomer?: boolean;
  }>) {
    return this.put<{ success: boolean }>(
      '/v3/notifications/batch',
      { notifications }
    );
  }
}

/**
 * Factory function para criar um cliente
 */
export function createAsaasGatewayClient(config: AsaasGatewayClientConfig): AsaasGatewayClient {
  return new AsaasGatewayClient(config);
}
