import { describe, expect, it } from 'vitest';

import {
  closeExpiredEnrollmentsJobQueryDTOSchema,
  encerrarContratosJobQueryDTOSchema,
  processOverdueBillingNotificationsJobQueryDTOSchema,
  reconcileOpenTransfersJobQueryDTOSchema,
  renewalJobsQueryDTOSchema,
} from '@/features/jobs/dtos';

describe('DTOs de jobs', () => {
  it('normaliza limites e preserva o instante opcional do encerramento de matrículas', () => {
    expect(closeExpiredEnrollmentsJobQueryDTOSchema.parse({})).toEqual({
      contaId: undefined,
      limit: 100,
      now: undefined,
    });
    expect(
      closeExpiredEnrollmentsJobQueryDTOSchema.parse({
        contaId: ' conta-a ',
        limit: '999',
        now: '2026-09-15T12:00:00.000Z',
      }),
    ).toEqual({
      contaId: 'conta-a',
      limit: 500,
      now: '2026-09-15T12:00:00.000Z',
    });
  });

  it('preserva defaults e limites históricos dos jobs de contratos', () => {
    expect(encerrarContratosJobQueryDTOSchema.parse({})).toEqual({
      contaId: undefined,
      maxAccounts: 25,
    });
    expect(
      encerrarContratosJobQueryDTOSchema.parse({ contaId: ' conta-a ', maxAccounts: '999' }),
    ).toEqual({ contaId: 'conta-a', maxAccounts: 100 });
  });

  it('mantém fallback seguro para limites inválidos', () => {
    expect(
      processOverdueBillingNotificationsJobQueryDTOSchema.parse({ limit: 'not-a-number' }),
    ).toEqual({ contaId: undefined, limit: 200 });
    expect(
      reconcileOpenTransfersJobQueryDTOSchema.parse({ limit: '0', minAgeSeconds: '1.9' }),
    ).toEqual({ contaId: undefined, limit: 1, maxAccounts: 30, minAgeSeconds: 1 });
  });

  it('normaliza a seleção de contas e limites do job de rematrículas', () => {
    expect(
      renewalJobsQueryDTOSchema.parse({ contaId: 'conta-a', maxAccounts: '2', limit: '10' }),
    ).toEqual({ contaId: 'conta-a', maxAccounts: 2, limit: 10 });
  });
});
