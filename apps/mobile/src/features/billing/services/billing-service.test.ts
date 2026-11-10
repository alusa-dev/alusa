jest.mock('@/features/auth/services/auth-service', () => ({
  authenticatedApi: { request: jest.fn() },
}));

import { billingService } from './billing-service';

const mockApiRequest = jest.requireMock('@/features/auth/services/auth-service').authenticatedApi.request as jest.Mock;

describe('billingService refund idempotency header', () => {
  beforeEach(() => mockApiRequest.mockReset());

  it('forwards the operation key only for refund actions', () => {
    billingService.executeAction('charge-1', 'REFUND', undefined, 'mobile-refund-attempt-1');
    expect(mockApiRequest).toHaveBeenLastCalledWith(expect.objectContaining({
      path: '/api/mobile/billing/charges/charge-1/actions',
      headers: { 'Idempotency-Key': 'mobile-refund-attempt-1' },
    }));

    billingService.executeAction('charge-1', 'UPDATE_RULES', {});
    expect(mockApiRequest.mock.calls[1]?.[0]).not.toHaveProperty('headers');
  });
});
