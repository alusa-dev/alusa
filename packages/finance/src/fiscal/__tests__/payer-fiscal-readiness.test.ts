import { describe, expect, it } from 'vitest';

import { mapPayerFiscalReadinessForApi } from '../payer-fiscal-readiness';

describe('mapPayerFiscalReadinessForApi', () => {
  it('adiciona blocking=true nas issues para o contrato da API', () => {
    expect(
      mapPayerFiscalReadinessForApi({
        ready: false,
        responsavelId: 'resp-1',
        responsavelNome: 'Maria',
        issues: [{ code: 'PAYER_ADDRESS_MISSING', message: 'Endereço do responsável financeiro não informado.' }],
      }),
    ).toEqual({
      ready: false,
      responsavelId: 'resp-1',
      responsavelNome: 'Maria',
      issues: [
        {
          code: 'PAYER_ADDRESS_MISSING',
          message: 'Endereço do responsável financeiro não informado.',
          blocking: true,
        },
      ],
    });
  });
});
