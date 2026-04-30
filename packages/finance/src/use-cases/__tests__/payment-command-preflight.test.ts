import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../asaas-ops', () => ({
  getPayment: vi.fn(async () => ({ id: 'pay_1', status: 'PENDING' })),
  getPaymentStatus: vi.fn(async () => ({ status: 'PENDING' })),
}));

import { getPayment, getPaymentStatus } from '../asaas-ops';
import { getAsaasReadIntentStats, resetAsaasReadIntentStats } from '../../foundation/asaas-read-intent';
import {
  getPaymentCommandPreflightStats,
  readPaymentFullPreflight,
  readPaymentStatusPreflight,
  resetPaymentCommandPreflightStats,
} from '../payment-command-preflight';

describe('payment-command-preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPaymentCommandPreflightStats();
    resetAsaasReadIntentStats();
  });

  it('contabiliza preflight status-only', async () => {
    await readPaymentStatusPreflight('pay_1', { contaId: 'conta-1' });

    expect(getPaymentStatus).toHaveBeenCalledWith('pay_1', { contaId: 'conta-1' });
    expect(getPaymentCommandPreflightStats()).toEqual({
      statusOnly: 1,
      fullPayment: 0,
    });
    expect(getAsaasReadIntentStats()).toMatchObject({
      COMMAND_PREFLIGHT_STATUS: 1,
      COMMAND_PREFLIGHT_FULL: 0,
    });
  });

  it('contabiliza preflight full-payment', async () => {
    await readPaymentFullPreflight('pay_2', { contaId: 'conta-1' });

    expect(getPayment).toHaveBeenCalledWith('pay_2', { contaId: 'conta-1' });
    expect(getPaymentCommandPreflightStats()).toEqual({
      statusOnly: 0,
      fullPayment: 1,
    });
    expect(getAsaasReadIntentStats()).toMatchObject({
      COMMAND_PREFLIGHT_STATUS: 0,
      COMMAND_PREFLIGHT_FULL: 1,
    });
  });
});
