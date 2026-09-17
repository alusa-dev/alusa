import { describe, expect, it } from 'vitest';

import {
  createRestockOrderInputDTOSchema,
  listInventoryMovementsQueryDTOSchema,
  listRestockOrdersQueryDTOSchema,
  vendasClienteDocumentoQueryDTOSchema,
} from '@/features/vendas/dtos';

describe('DTOs de vendas', () => {
  it('normaliza e valida CPF/CNPJ para consulta de cliente avulso', () => {
    const parsed = vendasClienteDocumentoQueryDTOSchema.parse({
      document: '529.982.247-25',
      uiRequestId: null,
    });

    expect(parsed.document).toBe('52998224725');
    expect(parsed.uiRequestId).toBeNull();
  });

  it('aplica coerção somente nos parâmetros numéricos previstos do estoque', () => {
    const parsed = listInventoryMovementsQueryDTOSchema.parse({ limit: '50' });

    expect(parsed.limit).toBe(50);
  });

  it('mantém o contrato de reposição separado entre consulta e criação', () => {
    expect(listRestockOrdersQueryDTOSchema.parse({ status: 'TODOS' })).toEqual({ status: 'TODOS' });
    expect(
      createRestockOrderInputDTOSchema.parse({
        requestId: 'req-1',
        items: [{ productId: 'product-1', quantity: 2, unitCost: 10 }],
      }),
    ).toMatchObject({ requestId: 'req-1', items: [{ productId: 'product-1', quantity: 2 }] });
  });
});
