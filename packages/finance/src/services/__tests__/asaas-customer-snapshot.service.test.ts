import { beforeEach, describe, expect, it, vi } from 'vitest';

class MockAsaasHttpError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'AsaasHttpError';
  }
}

const prismaMock = {
  customer: {
    findMany: vi.fn(),
  },
  aluno: {
    findMany: vi.fn(),
  },
  responsavel: {
    findMany: vi.fn(),
  },
  asaasCustomerSnapshot: {
    upsert: vi.fn(),
  },
};

vi.mock('@alusa/asaas', () => ({
  AsaasHttpError: MockAsaasHttpError,
  getCustomer: vi.fn(),
}));

vi.mock('@alusa/database', () => ({
  loadAsaasCredentials: vi.fn(),
  prisma: prismaMock,
}));

const { reconcileAsaasCustomerSnapshots } = await import('../asaas-customer-snapshot.service');
const { getCustomer } = await import('@alusa/asaas');
const { loadAsaasCredentials } = await import('@alusa/database');

describe('asaas-customer-snapshot.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadAsaasCredentials).mockResolvedValue({ apiKey: '$aact_hmlg_test' } as never);
    prismaMock.customer.findMany.mockResolvedValue([
      {
        id: 'customer-local-1',
        contaId: 'conta-1',
        asaasCustomerId: 'cus_1',
        payerType: 'ALUNO',
        payerId: 'aluno-1',
      },
    ]);
    prismaMock.aluno.findMany.mockResolvedValue([]);
    prismaMock.responsavel.findMany.mockResolvedValue([]);
    prismaMock.asaasCustomerSnapshot.upsert.mockResolvedValue({});
  });

  it('salva snapshot remoto de customer por conta e customer Asaas', async () => {
    vi.mocked(getCustomer).mockResolvedValue({
      object: 'customer',
      id: 'cus_1',
      dateCreated: '2026-06-01',
      name: 'Maria Responsável',
      email: 'maria@example.com',
      cpfCnpj: '12345678901',
      personType: 'FISICA',
      deleted: false,
      notificationDisabled: false,
    });

    const result = await reconcileAsaasCustomerSnapshots({ contaId: 'conta-1', limit: 10 });

    expect(getCustomer).toHaveBeenCalledWith({
      apiKey: '$aact_hmlg_test',
      customerId: 'cus_1',
    });
    expect(prismaMock.asaasCustomerSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          uq_asaas_customer_snapshot_conta_asaas: {
            contaId: 'conta-1',
            asaasCustomerId: 'cus_1',
          },
        },
        update: expect.objectContaining({
          localCustomerId: 'customer-local-1',
          name: 'Maria Responsável',
          deleted: false,
        }),
      }),
    );
    expect(result).toMatchObject({ scanned: 1, updated: 1, deleted: 0, failed: 0 });
  });

  it('marca snapshot como deleted quando o Asaas retorna 404', async () => {
    vi.mocked(getCustomer).mockRejectedValue(new MockAsaasHttpError('not found', 404));

    const result = await reconcileAsaasCustomerSnapshots({ contaId: 'conta-1', limit: 10 });

    expect(prismaMock.asaasCustomerSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          contaId: 'conta-1',
          asaasCustomerId: 'cus_1',
          deleted: true,
        }),
        update: expect.objectContaining({
          deleted: true,
        }),
      }),
    );
    expect(result).toMatchObject({ scanned: 1, updated: 0, deleted: 1, failed: 0 });
  });
});
