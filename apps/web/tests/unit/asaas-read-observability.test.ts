import { beforeEach, describe, expect, it, vi } from 'vitest';

const { recordAsaasReadIntentMock } = vi.hoisted(() => ({
  recordAsaasReadIntentMock: vi.fn(),
}));

vi.mock('@alusa/finance', () => ({
  recordAsaasReadIntent: recordAsaasReadIntentMock,
}));

import {
  getAsaasReadObservability,
  recordAsaasReadDecision,
  resetAsaasReadObservability,
} from '@/src/server/finance/asaas-read-observability';

describe('asaas-read-observability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAsaasReadObservability();
  });

  it('registra READ_MODEL apenas quando houve leitura remota do Asaas', () => {
    recordAsaasReadDecision('cobranca_detail', 'local');
    recordAsaasReadDecision('cobranca_detail', 'remote');
    recordAsaasReadDecision('portal_financeiro_detail', 'fresh_remote');

    expect(getAsaasReadObservability()).toEqual({
      cobrancaDetail: { local: 1, remote: 1, freshRemote: 0 },
      portalFinanceiroDetail: { local: 0, remote: 0, freshRemote: 1 },
      matriculaDetail: { local: 0, remote: 0, freshRemote: 0 },
      paymentMethodSync: { local: 0, remote: 0, freshRemote: 0 },
    });

    expect(recordAsaasReadIntentMock).toHaveBeenCalledTimes(2);
    expect(recordAsaasReadIntentMock).toHaveBeenNthCalledWith(1, 'READ_MODEL');
    expect(recordAsaasReadIntentMock).toHaveBeenNthCalledWith(2, 'READ_MODEL');
  });
});
