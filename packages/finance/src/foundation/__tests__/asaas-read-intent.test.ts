import { beforeEach, describe, expect, it } from 'vitest';

import {
  ASAAS_READ_INTENTS,
  getAsaasReadIntentStats,
  recordAsaasReadIntent,
  resetAsaasReadIntentStats,
} from '../asaas-read-intent';

describe('asaas-read-intent', () => {
  beforeEach(() => {
    resetAsaasReadIntentStats();
  });

  it('mantem todos os buckets canônicos inicializados em zero', () => {
    expect(ASAAS_READ_INTENTS).toEqual([
      'READ_MODEL',
      'COMMAND_PREFLIGHT_STATUS',
      'COMMAND_PREFLIGHT_FULL',
      'RECONCILIATION',
      'MANUAL_REPAIR',
      'AUTHORITATIVE_DOCUMENT',
    ]);
    expect(getAsaasReadIntentStats()).toEqual({
      READ_MODEL: 0,
      COMMAND_PREFLIGHT_STATUS: 0,
      COMMAND_PREFLIGHT_FULL: 0,
      RECONCILIATION: 0,
      MANUAL_REPAIR: 0,
      AUTHORITATIVE_DOCUMENT: 0,
    });
  });

  it('acumula contadores por intenção', () => {
    recordAsaasReadIntent('READ_MODEL');
    recordAsaasReadIntent('COMMAND_PREFLIGHT_STATUS');
    recordAsaasReadIntent('COMMAND_PREFLIGHT_FULL');
    recordAsaasReadIntent('RECONCILIATION', 2);
    recordAsaasReadIntent('MANUAL_REPAIR', 3);
    recordAsaasReadIntent('AUTHORITATIVE_DOCUMENT');

    expect(getAsaasReadIntentStats()).toEqual({
      READ_MODEL: 1,
      COMMAND_PREFLIGHT_STATUS: 1,
      COMMAND_PREFLIGHT_FULL: 1,
      RECONCILIATION: 2,
      MANUAL_REPAIR: 3,
      AUTHORITATIVE_DOCUMENT: 1,
    });
  });
});
