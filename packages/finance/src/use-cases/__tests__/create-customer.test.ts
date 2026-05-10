import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAsaasCustomer } from '../create-customer';

vi.mock('@alusa/database', () => ({
  loadAsaasCredentials: vi.fn(),
}));

vi.mock('@alusa/asaas', () => ({
  createCustomer: vi.fn(),
  listCustomers: vi.fn(),
  restoreCustomer: vi.fn(),
  updateCustomer: vi.fn(),
}));

describe('createAsaasCustomer', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    const { loadAsaasCredentials } = await import('@alusa/database');
    const { listCustomers } = await import('@alusa/asaas');

    vi.mocked(loadAsaasCredentials).mockResolvedValue({
      apiKey: 'sandbox_key',
      contaId: 'conta-1',
    } as never);
    vi.mocked(listCustomers).mockResolvedValue({ data: [] } as never);
  });

  it('envia telefone tambem como celular ao criar customer', async () => {
    const { createCustomer } = await import('@alusa/asaas');

    vi.mocked(createCustomer).mockResolvedValue({
      id: 'cus_1',
      externalReference: 'customer:r1',
    } as never);

    const result = await createAsaasCustomer({
      contaId: 'conta-1',
      name: 'Elaine Costa',
      cpfCnpj: '02719786276',
      email: 'elaine@example.com',
      phone: '(92) 97981-7409',
      externalReference: 'customer:r1',
    });

    expect(result.success).toBe(true);
    expect(createCustomer).toHaveBeenCalledWith({
      apiKey: 'sandbox_key',
      idempotencyKey: 'customer:r1',
      data: {
        name: 'Elaine Costa',
        cpfCnpj: '02719786276',
        email: 'elaine@example.com',
        phone: '92979817409',
        mobilePhone: '92979817409',
        externalReference: 'customer:r1',
        notificationDisabled: false,
      },
    });
  });

  it('reativa notificacoes e atualiza celular em customer existente', async () => {
    const { listCustomers, updateCustomer } = await import('@alusa/asaas');

    vi.mocked(listCustomers).mockResolvedValueOnce({
      data: [
        {
          id: 'cus_1',
          externalReference: 'customer:r1',
          cpfCnpj: '02719786276',
          deleted: false,
        },
      ],
    } as never);

    const result = await createAsaasCustomer({
      contaId: 'conta-1',
      name: 'Elaine Costa',
      cpfCnpj: '02719786276',
      email: 'elaine@example.com',
      phone: '(92) 97981-7409',
      externalReference: 'customer:r1',
    });

    expect(result.success).toBe(true);
    expect(updateCustomer).toHaveBeenCalledWith({
      apiKey: 'sandbox_key',
      customerId: 'cus_1',
      data: {
        name: 'Elaine Costa',
        email: 'elaine@example.com',
        phone: '92979817409',
        mobilePhone: '92979817409',
        externalReference: 'customer:r1',
        notificationDisabled: false,
      },
    });
  });

  it('nao reutiliza customer encontrado por externalReference quando CPF/CNPJ e diferente', async () => {
    const { createCustomer, listCustomers, updateCustomer } = await import('@alusa/asaas');

    vi.mocked(listCustomers)
      .mockResolvedValueOnce({ data: [] } as never)
      .mockResolvedValueOnce({
        data: [
          {
            id: 'cus_antigo',
            externalReference: 'financeProfile:fp1',
            cpfCnpj: '12345678909',
            deleted: false,
          },
        ],
      } as never);

    vi.mocked(createCustomer).mockResolvedValue({
      id: 'cus_novo',
      externalReference: 'customer:conta-1:RESPONSAVEL:r1',
    } as never);

    const result = await createAsaasCustomer({
      contaId: 'conta-1',
      name: 'Luiza de Alencar Bezerra',
      cpfCnpj: '705.484.450-52',
      email: 'luiza@example.com',
      phone: '(97) 98128-3106',
      externalReference: 'customer:conta-1:RESPONSAVEL:r1',
    });

    expect(result.success).toBe(true);
    expect(updateCustomer).not.toHaveBeenCalled();
    expect(createCustomer).toHaveBeenCalledWith({
      apiKey: 'sandbox_key',
      idempotencyKey: 'customer:conta-1:RESPONSAVEL:r1',
      data: {
        name: 'Luiza de Alencar Bezerra',
        cpfCnpj: '705.484.450-52',
        email: 'luiza@example.com',
        phone: '97981283106',
        mobilePhone: '97981283106',
        externalReference: 'customer:conta-1:RESPONSAVEL:r1',
        notificationDisabled: false,
      },
    });
  });
});
