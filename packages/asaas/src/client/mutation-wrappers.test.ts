import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSubaccount } from '../accounts/createSubaccount';
import { createCustomer } from '../customers/createCustomer';
import { createInstallment } from '../installments/createInstallment';
import { createPayment } from '../payments/createPayment';
import { payPixQrCode } from '../pix/payPixQrCode';
import { createSubscription } from '../subscriptions/createSubscription';
import { createBankTransfer } from '../transfers/createBankTransfer';
import { createPixTransfer } from '../transfers/createPixTransfer';

describe('Asaas mutation wrappers', () => {
  beforeEach(() => {
    vi.stubEnv('ASAAS_BASE_URL', 'https://api-sandbox.asaas.com/v3');
    globalThis.fetch = vi.fn(async () => new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
  });

  it('keeps local idempotency keys out of undocumented provider headers', async () => {
    const idempotencyKey = 'local-operation-123';
    const mutations = [
      () => createSubaccount({ apiKey: 'sandbox-key', idempotencyKey, data: {} as never }),
      () => createCustomer({ apiKey: 'sandbox-key', idempotencyKey, data: {} as never }),
      () => createPayment({ apiKey: 'sandbox-key', idempotencyKey, data: {} as never }),
      () => createSubscription({ apiKey: 'sandbox-key', idempotencyKey, data: {} as never }),
      () => createInstallment({ apiKey: 'sandbox-key', idempotencyKey, data: {} as never }),
      () => createBankTransfer({ apiKey: 'sandbox-key', idempotencyKey, data: {} as never }),
      () => createPixTransfer({ apiKey: 'sandbox-key', idempotencyKey, data: {} as never }),
      () => payPixQrCode({ apiKey: 'sandbox-key', idempotencyKey, data: {} as never }),
    ];

    for (const mutate of mutations) await mutate();

    const requests = vi.mocked(globalThis.fetch).mock.calls;
    expect(requests).toHaveLength(mutations.length);
    for (const [, init] of requests) {
      const headers = new Headers(init?.headers);
      expect(headers.has('Idempotency-Key')).toBe(false);
    }
  });
});
