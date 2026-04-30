import type {
  PaymentsProviderPort,
  ProviderCreateSubscriptionInput,
  ProviderCreateSubscriptionResult,
  ResolveOrCreateCustomerInput,
  ResolveOrCreateCustomerResult,
  CancelSubscriptionInput,
  CancelSubscriptionResult,
} from '@alusa/finance';
import { createAsaasPaymentsProvider } from '@alusa/finance';

type ProviderCreatePaymentInput = Parameters<PaymentsProviderPort['createPayment']>[0];
type ProviderCreatePaymentResult = Awaited<ReturnType<PaymentsProviderPort['createPayment']>>;
type ProviderListSubscriptionPaymentsResult = Awaited<
  ReturnType<PaymentsProviderPort['listSubscriptionPayments']>
>;

class MockPaymentsProvider implements PaymentsProviderPort {
  async resolveOrCreateCustomerForPayer(
    _input: ResolveOrCreateCustomerInput
  ): Promise<ResolveOrCreateCustomerResult> {
    return { customerId: 'mock-customer', created: false };
  }

  async cancelSubscription(input: CancelSubscriptionInput): Promise<CancelSubscriptionResult> {
    const shouldFail =
      process.env.MOCK_CANCEL_SUBSCRIPTION_FAIL === 'true' ||
      input.subscriptionId.startsWith('fail-');

    if (shouldFail) {
      const error = new Error('MOCK_CANCEL_SUBSCRIPTION_FAILED');
      (error as { response?: { status?: number } }).response = { status: 500 };
      throw error;
    }

    return { success: true, notFound: false };
  }

  async createSubscription(
    input: ProviderCreateSubscriptionInput
  ): Promise<ProviderCreateSubscriptionResult> {
    return {
      subscriptionId: `mock-sub-${Date.now()}`,
      nextDueDate: input.nextDueDate,
      status: 'ACTIVE',
    };
  }

  async createPayment(
    input: ProviderCreatePaymentInput
  ): Promise<ProviderCreatePaymentResult> {
    return {
      paymentId: `mock-pay-${Date.now()}`,
      status: 'PENDING',
      invoiceUrl: `https://mock.local/payments/${input.externalReference}`,
    };
  }

  async listSubscriptionPayments(): Promise<ProviderListSubscriptionPaymentsResult> {
    return {
      data: [],
      totalCount: 0,
    };
  }
}

export async function getPaymentsProviderForConta(_contaId: string): Promise<PaymentsProviderPort> {
  if (process.env.PAYMENTS_PROVIDER_MODE === 'mock' || process.env.PLAYWRIGHT_TEST === 'true') {
    return new MockPaymentsProvider();
  }

  return createAsaasPaymentsProvider();
}
