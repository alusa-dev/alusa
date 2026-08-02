import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));

vi.mock('../client/AsaasHttp', () => ({
  AsaasHttp: class {
    get = http.get;
    put = http.put;
  },
}));

import { updateInvoice } from './updateInvoice';

describe('updateInvoice taxes replacement contract', () => {
  beforeEach(() => vi.resetAllMocks());

  it('faz GET-merge-PUT e não reenvia campos tributários somente de resposta', async () => {
    http.get.mockResolvedValue({
      id: 'inv_1',
      status: 'SCHEDULED',
      taxes: {
        retainIss: false, cofins: 3, csll: 0, inss: 0, ir: 0, pis: 0.65, iss: 2,
        nbsCode: '109012100', taxSituationCode: '200001', taxClassificationCode: '011001',
        operationIndicatorCode: '020101', pisCofinsTaxStatus: 'STANDARD_TAXABLE_OPERATION',
        operationPis: 0.65, operationCofins: 3, useTaxSystemReformNT007: true,
        pisCofinsRetentionType: 'CALCULATED_BY_ASAAS', stateIbs: 0.1, cbsValue: 12.34,
      },
    });
    http.put.mockResolvedValue({ id: 'inv_1', status: 'SCHEDULED' });

    await updateInvoice({
      apiKey: 'key',
      id: 'inv_1',
      data: { taxes: { iss: 2.5 } as never },
    });

    expect(http.get).toHaveBeenCalledWith('/invoices/inv_1');
    expect(http.put).toHaveBeenCalledWith('/invoices/inv_1', {
      taxes: expect.objectContaining({
        iss: 2.5,
        pis: 0.65,
        cofins: 3,
        nbsCode: '109012100',
        useTaxSystemReformNT007: true,
      }),
    });
    const sentTaxes = http.put.mock.calls[0]![1].taxes;
    expect(sentTaxes).not.toHaveProperty('pisCofinsRetentionType');
    expect(sentTaxes).not.toHaveProperty('stateIbs');
    expect(sentTaxes).not.toHaveProperty('cbsValue');
  });
});
