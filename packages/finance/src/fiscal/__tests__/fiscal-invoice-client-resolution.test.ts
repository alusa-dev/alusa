import { describe, expect, it } from 'vitest';

import { resolveFiscalInvoiceClient } from '../../fiscal/fiscal-invoice-client-resolution';

describe('resolveFiscalInvoiceClient', () => {
  it('prioriza responsável financeiro como cliente', () => {
    expect(
      resolveFiscalInvoiceClient({
        responsavelId: 'resp-1',
        matriculaAlunoId: 'aluno-1',
        customerPayerType: null,
        customerPayerId: null,
      }),
    ).toEqual({ tipo: 'RESPONSAVEL', id: 'resp-1' });
  });

  it('usa aluno da matrícula quando não há responsável', () => {
    expect(
      resolveFiscalInvoiceClient({
        responsavelId: null,
        matriculaAlunoId: 'aluno-1',
        customerPayerType: null,
        customerPayerId: null,
      }),
    ).toEqual({ tipo: 'ALUNO', id: 'aluno-1' });
  });

  it('usa customer da cobrança como fallback', () => {
    expect(
      resolveFiscalInvoiceClient({
        responsavelId: null,
        matriculaAlunoId: null,
        customerPayerType: 'RESPONSAVEL',
        customerPayerId: 'resp-2',
      }),
    ).toEqual({ tipo: 'RESPONSAVEL', id: 'resp-2' });
  });
});
