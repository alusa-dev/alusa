import { beforeAll, beforeEach, afterEach, afterAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

import { ensureAsaasCustomerForPayer } from '../ensure-asaas-customer-for-payer';
import { AsaasHttpError } from '@alusa/asaas';
import { encryptSecret } from '@alusa/database';

const {
  listCustomersMock,
  getCustomerMock,
  createCustomerMock,
  updateCustomerMock,
  restoreCustomerMock,
  applyNotificationPreferencesMock,
} = vi.hoisted(() => ({
  listCustomersMock: vi.fn(),
  getCustomerMock: vi.fn(),
  createCustomerMock: vi.fn(),
  updateCustomerMock: vi.fn(),
  restoreCustomerMock: vi.fn(),
  applyNotificationPreferencesMock: vi.fn(),
}));

vi.mock('@alusa/asaas', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alusa/asaas')>();
  return {
    ...actual,
    listCustomers: listCustomersMock,
    getCustomer: getCustomerMock,
    createCustomer: createCustomerMock,
    updateCustomer: updateCustomerMock,
    restoreCustomer: restoreCustomerMock,
  };
});

vi.mock('../../services/customer-notification-bridge', () => ({
  syncCustomerNotificationChannelsFromTenantPreferences: applyNotificationPreferencesMock,
}));

const prisma = new PrismaClient();

describe('ensureAsaasCustomerForPayer', () => {
  const contaId = 'conta-asaas-ensure';

  beforeAll(async () => {
    if (!process.env.ENCRYPTION_KEY) {
      process.env.ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
    }

    await prisma.conta.upsert({
      where: { id: contaId },
      update: {},
      create: { id: contaId, nome: 'Conta Teste', cpfCnpj: '99999999999999' },
    });

    const owner = await prisma.usuario.upsert({
      where: { email: 'owner+asaas.ensure@example.com' },
      update: {},
      create: { id: 'owner-asaas-ensure', contaId, nome: 'Owner Test', email: 'owner+asaas.ensure@example.com', senhaHash: 'x', role: 'ADMIN', status: 'ATIVO' },
    });

    await prisma.conta.upsert({
      where: { id: contaId },
      update: { ownerUserId: owner.id },
      create: { id: contaId, nome: 'Conta Teste', cpfCnpj: '99999999999999', ownerUserId: owner.id },
    });

    const profile = await prisma.financeProfile.upsert({
      where: { contaId },
      update: {},
      create: { contaId },
    });

    await prisma.asaasCredential.upsert({
      where: { financeProfileId: profile.id },
      update: { apiKeyEncrypted: encryptSecret('sandbox_test_key') },
      create: { financeProfileId: profile.id, apiKeyEncrypted: encryptSecret('sandbox_test_key') },
    });

    // Evita ping (listCustomers) em loadAndValidateSubaccountKey e mantém apiKeyStatus estável
    await prisma.asaasAccount.upsert({
      where: { financeProfileId: profile.id },
      update: {
        apiKeyEncrypted: encryptSecret('sandbox_test_key'),
        apiKeyStatus: 'CONNECTED',
        status: 'APPROVED',
      },
      create: {
        financeProfileId: profile.id,
        apiKeyEncrypted: encryptSecret('sandbox_test_key'),
        apiKeyStatus: 'CONNECTED',
        status: 'APPROVED',
      },
    });
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    listCustomersMock.mockReset();
    getCustomerMock.mockReset();
    createCustomerMock.mockReset();
    updateCustomerMock.mockReset();
    restoreCustomerMock.mockReset();
    applyNotificationPreferencesMock.mockReset();
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('PAYMENTS_PROVIDER_MODE', 'asaas');
    vi.stubEnv('PLAYWRIGHT_TEST', 'false');
    const profile = await prisma.financeProfile.findUnique({
      where: { contaId },
      select: { id: true },
    });
    if (profile?.id) {
      await prisma.asaasAccount.upsert({
        where: { financeProfileId: profile.id },
        update: {
          apiKeyEncrypted: encryptSecret('sandbox_test_key'),
          apiKeyStatus: 'CONNECTED',
          status: 'APPROVED',
        },
        create: {
          financeProfileId: profile.id,
          apiKeyEncrypted: encryptSecret('sandbox_test_key'),
          apiKeyStatus: 'CONNECTED',
          status: 'APPROVED',
        },
      });
    }

    listCustomersMock.mockResolvedValue({
      object: 'list',
      hasMore: false,
      totalCount: 0,
      limit: 100,
      offset: 0,
      data: [],
    });
    getCustomerMock.mockImplementation(async ({ customerId }) => {
      const created = createCustomerMock.mock.calls.at(-1)?.[0]?.data;
      const listResults = await Promise.all(listCustomersMock.mock.results.map(async (result) => {
        if (result.type !== 'return') return [];
        const response = await result.value;
        return response?.data ?? [];
      }));
      const listedCustomer = listResults.flat().find((customer) => customer.id === customerId);
      return {
        ...(listedCustomer ?? created ?? {}),
        id: customerId,
        object: 'customer',
        dateCreated: '2026-01-01',
        name: listedCustomer?.name ?? created?.name ?? 'Teste',
        cpfCnpj: listedCustomer?.cpfCnpj ?? created?.cpfCnpj ?? '39053344705',
        externalReference: listedCustomer?.externalReference ?? created?.externalReference,
        deleted: listedCustomer?.deleted ?? false,
        notificationDisabled: false,
      } as never;
    });
    createCustomerMock.mockResolvedValue({
      id: 'cust_new',
      object: 'customer',
      dateCreated: '2026-01-01',
      name: 'Teste',
      cpfCnpj: '39053344705',
      deleted: false,
      notificationDisabled: false,
    });
    updateCustomerMock.mockResolvedValue({
      id: 'cust_existing',
      object: 'customer',
      dateCreated: '2026-01-01',
      name: 'Teste',
      cpfCnpj: '39053344705',
      deleted: false,
      notificationDisabled: false,
    });

    restoreCustomerMock.mockResolvedValue({
      id: 'cust_existing',
      object: 'customer',
      dateCreated: '2026-01-01',
      name: 'Teste',
      cpfCnpj: '39053344705',
      deleted: false,
      notificationDisabled: false,
    });

    applyNotificationPreferencesMock.mockResolvedValue({ updated: true, total: 1 });

    await prisma.customerPayer.deleteMany({ where: { contaId } });
    await prisma.customer.deleteMany({ where: { contaId } });
    await prisma.asaasIntegrationJob.deleteMany({ where: { contaId, type: 'CREATE_CUSTOMER' } });
    await prisma.alunoResponsavel.deleteMany({ where: { aluno: { contaId } } });
    await prisma.aluno.deleteMany({ where: { contaId } });
    await prisma.responsavel.deleteMany({ where: { contaId } });
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each([
    { lookup: 'known ID', changed: false, shouldUpdate: false },
    { lookup: 'known ID', changed: true, shouldUpdate: true },
    { lookup: 'CPF result', changed: false, shouldUpdate: false },
    { lookup: 'CPF result', changed: true, shouldUpdate: true },
  ])('$lookup: PUT only when a synchronized field differs (changed=$changed)', async ({ lookup, changed, shouldUpdate }) => {
    const aluno = await prisma.aluno.create({
      data: {
        contaId,
        nome: `Reconciliação ${lookup} ${changed}`,
        dataNasc: new Date('2000-01-01'),
        cpf: changed ? '15350946056' : '11144477735',
        email: 'reconciliation@example.com',
        telefone: '11999999999',
        ...(lookup === 'known ID' ? { asaasCustomerId: 'cust_reconciliation' } : {}),
      },
    });
    const externalReference = `alusa_${contaId}_aluno_${aluno.id}`;
    const currentCustomer = {
      id: 'cust_reconciliation',
      object: 'customer' as const,
      dateCreated: '2026-01-01',
      name: aluno.nome,
      cpfCnpj: aluno.cpf!,
      email: changed ? 'old@example.com' : aluno.email!,
      phone: '11999999999',
      mobilePhone: '11999999999',
      externalReference,
      deleted: false,
      notificationDisabled: false,
    };
    if (lookup === 'known ID') {
      getCustomerMock.mockResolvedValueOnce(currentCustomer);
    } else {
      listCustomersMock.mockResolvedValueOnce({
        object: 'list', hasMore: false, totalCount: 1, limit: 100, offset: 0, data: [currentCustomer],
      });
      listCustomersMock.mockResolvedValueOnce({
        object: 'list', hasMore: false, totalCount: 1, limit: 100, offset: 0, data: [currentCustomer],
      });
    }

    const result = await ensureAsaasCustomerForPayer({
      contaId,
      payer: {
        type: 'ALUNO', id: aluno.id, name: aluno.nome, cpfCnpj: aluno.cpf!,
        email: aluno.email, phone: aluno.telefone,
        ...(lookup === 'known ID' ? { asaasCustomerId: aluno.asaasCustomerId } : {}),
      },
    });

    expect(result).toMatchObject({ ok: true, customerId: 'cust_reconciliation' });
    expect(updateCustomerMock).toHaveBeenCalledTimes(shouldUpdate ? 1 : 0);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('reaproveita customer existente por externalReference e persiste o ID', async () => {
    listCustomersMock.mockImplementationOnce(async (params) => ({
      object: 'list', hasMore: false, totalCount: 1, limit: 100, offset: 0,
      data: [{ id: 'cust_existing', object: 'customer', dateCreated: '2026-01-01', name: 'Cliente',
        cpfCnpj: '11144477735', externalReference: params.externalReference, deleted: false,
        notificationDisabled: false }],
    } as never));
    listCustomersMock.mockImplementationOnce(async (params) => ({
      object: 'list', hasMore: false, totalCount: 1, limit: 100, offset: 0,
      data: [{ id: 'cust_existing', object: 'customer', dateCreated: '2026-01-01', name: 'Cliente',
        cpfCnpj: '11144477735', externalReference: params.externalReference, deleted: false,
        notificationDisabled: false }],
    } as never));
    const aluno = await prisma.aluno.create({
      data: {
        contaId,
        nome: 'Aluno 1',
        dataNasc: new Date('2000-01-01'),
        cpf: '11144477735',
        email: 'aluno@example.com',
        telefone: '11999999999',
        enderecoCep: '01001000',
        enderecoLogradouro: 'Rua A',
        enderecoNumero: '10',
        enderecoBairro: 'Centro',
        enderecoCidade: 'SP',
        enderecoUf: 'SP',
      },
    });

    const result = await ensureAsaasCustomerForPayer({
      contaId,
      payer: {
        type: 'ALUNO',
        id: aluno.id,
        name: aluno.nome,
        cpfCnpj: aluno.cpf!,
        email: aluno.email,
        phone: aluno.telefone,
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.customerId).toBe('cust_existing');
      expect(result.reused).toBe(true);
    }

    const updated = await prisma.aluno.findUnique({ where: { id: aluno.id } });
    expect(updated?.asaasCustomerId).toBe('cust_existing');
    expect(updated?.asaasCustomerExternalReference).toBe(`alusa_${contaId}_aluno_${aluno.id}`);
    expect(createCustomerMock).not.toHaveBeenCalled();
    expect(applyNotificationPreferencesMock).toHaveBeenCalledWith(contaId, 'cust_existing');
    expect(updateCustomerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cust_existing',
        data: expect.objectContaining({
          externalReference: `alusa_${contaId}_aluno_${aluno.id}`,
        }),
      }),
    );
    const updateCall = updateCustomerMock.mock.calls.at(-1)?.[0];
    expect(updateCall.data).not.toHaveProperty('notificationDisabled');
  });

  it('não escolhe customer quando a página posterior revela identidade duplicada', async () => {
    const aluno = await prisma.aluno.create({ data: {
      contaId, nome: 'Aluno Customer Página Dois', dataNasc: new Date('2000-01-01'),
      cpf: '52998224725', email: 'customer-page-two@example.com',
    } });
    const externalReference = `alusa_${contaId}_aluno_${aluno.id}`;
    const page = (offset: number, data: unknown[], hasMore: boolean) => ({
      object: 'list', totalCount: 101, offset, limit: 100, hasMore, data,
    });
    const candidates = Array.from({ length: 100 }, (_, index) => ({
      id: `cus-page-one-${index}`, externalReference, cpfCnpj: aluno.cpf, deleted: false,
    }));
    listCustomersMock
      .mockResolvedValueOnce(page(0, candidates, true) as never)
      .mockResolvedValueOnce(page(100, [
        { id: 'cus-page-two', externalReference, cpfCnpj: aluno.cpf, deleted: false },
      ], false) as never);

    const result = await ensureAsaasCustomerForPayer({ contaId, payer: {
      type: 'ALUNO', id: aluno.id, name: aluno.nome, cpfCnpj: aluno.cpf!,
    } });

    expect(result).toMatchObject({ ok: false, error: 'TEMPORARY_ERROR' });
    expect(listCustomersMock).toHaveBeenCalledTimes(2);
    expect(listCustomersMock.mock.calls.map(([params]) => params)).toEqual([
      expect.objectContaining({ externalReference, offset: 0, limit: 100 }),
      expect.objectContaining({ externalReference, offset: 100, limit: 100 }),
    ]);
    expect(createCustomerMock).not.toHaveBeenCalled();
    const persisted = await prisma.aluno.findUnique({ where: { id: aluno.id } });
    expect(persisted?.asaasCustomerId).toBeNull();
  });

  it('reaproveita customer local por id e sincroniza dados cadastrais no Asaas', async () => {
    const aluno = await prisma.aluno.create({
      data: {
        contaId,
        nome: 'Aluno Local',
        dataNasc: new Date('2000-01-01'),
        cpf: '39053344705',
        email: 'aluno-local@example.com',
        telefone: '11999999999',
        asaasCustomerId: 'cust_local',
      },
    });

    const result = await ensureAsaasCustomerForPayer({
      contaId,
      payer: {
        type: 'ALUNO',
        id: aluno.id,
        name: aluno.nome,
        cpfCnpj: aluno.cpf!,
        email: aluno.email,
        phone: aluno.telefone,
        asaasCustomerId: aluno.asaasCustomerId,
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.customerId).toBe('cust_local');
      expect(result.reused).toBe(true);
    }

    expect(getCustomerMock).toHaveBeenCalledWith({
      apiKey: 'sandbox_test_key',
      customerId: 'cust_local',
    });
    expect(listCustomersMock).not.toHaveBeenCalled();
    expect(createCustomerMock).not.toHaveBeenCalled();
    expect(updateCustomerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cust_local',
        data: expect.objectContaining({
          externalReference: `alusa_${contaId}_aluno_${aluno.id}`,
        }),
      }),
    );
    expect(applyNotificationPreferencesMock).toHaveBeenCalledWith(contaId, 'cust_local');

    const updated = await prisma.aluno.findUnique({ where: { id: aluno.id } });
    expect(updated?.asaasCustomerExternalReference).toBe(`alusa_${contaId}_aluno_${aluno.id}`);
  });

  it('falha em strictCustomerUpdate quando Asaas rejeita atualização do customer local', async () => {
    const aluno = await prisma.aluno.create({
      data: {
        contaId,
        nome: 'Aluno Local Strict',
        dataNasc: new Date('2000-01-01'),
        cpf: '15350946056',
        email: 'aluno-strict@example.com',
        telefone: '11999999999',
        enderecoCep: '69553315',
        enderecoLogradouro: 'Rua Nova II',
        enderecoNumero: '196',
        enderecoBairro: 'São João',
        asaasCustomerId: 'cust_local_strict',
      },
    });

    getCustomerMock.mockResolvedValueOnce({ id: 'cust_local_strict', cpfCnpj: '15350946056', deleted: false });

    updateCustomerMock.mockRejectedValueOnce(
      new AsaasHttpError('Invalid postal code', 400, undefined, {
        errors: [{ description: 'CEP do cliente é inválido.' }],
      }),
    );

    const result = await ensureAsaasCustomerForPayer({
      contaId,
      payer: {
        type: 'ALUNO',
        id: aluno.id,
        name: aluno.nome,
        cpfCnpj: aluno.cpf!,
        email: aluno.email,
        phone: aluno.telefone,
        postalCode: aluno.enderecoCep,
        address: aluno.enderecoLogradouro,
        addressNumber: aluno.enderecoNumero,
        province: aluno.enderecoBairro,
        asaasCustomerId: aluno.asaasCustomerId,
      },
      strictCustomerUpdate: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('CEP');
    }
  });

  it('cria customer quando não existe e persiste o ID', async () => {
    const aluno = await prisma.aluno.create({
      data: {
        contaId,
        nome: 'Aluno 2',
        dataNasc: new Date('2000-01-01'),
        cpf: '52998224725',
        email: 'aluno2@example.com',
        telefone: '11999999999',
        enderecoCep: '01001000',
        enderecoLogradouro: 'Rua B',
        enderecoNumero: '20',
        enderecoBairro: 'Centro',
        enderecoCidade: 'SP',
        enderecoUf: 'SP',
      },
    });

    const result = await ensureAsaasCustomerForPayer({
      contaId,
      payer: {
        type: 'ALUNO',
        id: aluno.id,
        name: aluno.nome,
        cpfCnpj: aluno.cpf!,
        email: aluno.email,
        phone: aluno.telefone,
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.customerId).toBe('cust_new');
      expect(result.reused).toBe(false);
    }

    const updated = await prisma.aluno.findUnique({ where: { id: aluno.id } });
    expect(updated?.asaasCustomerId).toBe('cust_new');
    expect(updated?.asaasCustomerExternalReference).toBe(`alusa_${contaId}_aluno_${aluno.id}`);
    expect(applyNotificationPreferencesMock).toHaveBeenCalledWith(contaId, 'cust_new');
    expect(createCustomerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          externalReference: `alusa_${contaId}_aluno_${aluno.id}`,
          notificationDisabled: false,
        }),
      }),
    );
  });

  it('concorre para o mesmo payer usando um job durável e um único POST', async () => {
    const aluno = await prisma.aluno.create({ data: {
      contaId, nome: 'Aluno Customer Concorrente', dataNasc: new Date('2000-01-01'),
      cpf: '15350946056', email: 'customer-race@example.com', telefone: '11999999999',
    } });
    const externalReference = `alusa_${contaId}_aluno_${aluno.id}`;
    let releaseBarrier!: () => void;
    const barrier = new Promise<void>((resolve) => { releaseBarrier = resolve; });
    let outboxLookups = 0;
    listCustomersMock.mockImplementation(async (params) => {
      if (params.externalReference === externalReference && params.limit === 100) {
        outboxLookups += 1;
        if (outboxLookups === 2) releaseBarrier();
        await barrier;
      }
      return { object: 'list', data: [], hasMore: false, totalCount: 0, limit: params.limit, offset: params.offset } as never;
    });

    const payer = {
      type: 'ALUNO' as const, id: aluno.id, name: aluno.nome,
      cpfCnpj: aluno.cpf!, email: aluno.email, phone: aluno.telefone,
    };
    const results = await Promise.all([
      ensureAsaasCustomerForPayer({ contaId, payer }),
      ensureAsaasCustomerForPayer({ contaId, payer }),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(createCustomerMock).toHaveBeenCalledTimes(1);
    expect(outboxLookups).toBeGreaterThanOrEqual(2);
    const jobs = await prisma.asaasIntegrationJob.findMany({
      where: { contaId, type: 'CREATE_CUSTOMER', payload: { path: ['externalReference'], equals: externalReference } },
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.payload).toMatchObject({
      resource: 'CUSTOMER', state: 'SYNCHRONIZED', externalReference,
    });
    const saved = await prisma.aluno.findUnique({ where: { id: aluno.id } });
    expect(saved?.asaasCustomerId).toBe('cust_new');
  });

  it('reusa e persiste customer criado remotamente quando a resposta do POST se perde', async () => {
    const aluno = await prisma.aluno.create({
      data: {
        contaId,
        nome: 'Aluno Resposta Perdida',
        dataNasc: new Date('2000-01-01'),
        cpf: '15350946056',
        email: 'lost-response@example.com',
        telefone: '11999999999',
      },
    });
    listCustomersMock
      .mockResolvedValueOnce({ object: 'list', data: [], hasMore: false, totalCount: 0, limit: 100, offset: 0 })
      .mockResolvedValueOnce({ object: 'list', data: [], hasMore: false, totalCount: 0, limit: 100, offset: 0 })
      .mockResolvedValueOnce({ object: 'list', data: [], hasMore: false, totalCount: 0, limit: 100, offset: 0 })
      .mockResolvedValueOnce({
        object: 'list', hasMore: false, totalCount: 1, limit: 100, offset: 0,
        data: [{
          id: 'cust_created_before_timeout',
          externalReference: `alusa_${contaId}_aluno_${aluno.id}`,
          cpfCnpj: '15350946056',
          deleted: false,
        }],
      });
    createCustomerMock.mockRejectedValueOnce(new TypeError('fetch failed'));

    const result = await ensureAsaasCustomerForPayer({ contaId, payer: {
      type: 'ALUNO', id: aluno.id, name: aluno.nome, cpfCnpj: aluno.cpf!, email: aluno.email,
    } });

    expect(result).toMatchObject({ ok: true, customerId: 'cust_created_before_timeout', reused: true });
    expect(createCustomerMock).toHaveBeenCalledTimes(1);
    expect(listCustomersMock).toHaveBeenCalledTimes(4);
    const persisted = await prisma.aluno.findUnique({ where: { id: aluno.id } });
    expect(persisted?.asaasCustomerId).toBe('cust_created_before_timeout');
  });

  it('não vincula customer arbitrário quando o lookup retorna múltiplas correspondências exatas', async () => {
    const aluno = await prisma.aluno.create({
      data: {
        contaId,
        nome: 'Aluno Customers Duplicados',
        dataNasc: new Date('2000-01-01'),
        cpf: '15350946056',
      },
    });
    const externalReference = `alusa_${contaId}_aluno_${aluno.id}`;
    listCustomersMock
      .mockResolvedValueOnce({ object: 'list', data: [], hasMore: false, totalCount: 0, limit: 100, offset: 0 })
      .mockResolvedValueOnce({ object: 'list', data: [], hasMore: false, totalCount: 0, limit: 100, offset: 0 })
      .mockResolvedValueOnce({
        object: 'list', hasMore: false, totalCount: 2, limit: 100, offset: 0,
        data: [
          { id: 'cust_duplicate_a', externalReference, cpfCnpj: '15350946056', deleted: false },
          { id: 'cust_duplicate_b', externalReference, cpfCnpj: '153.509.460-56', deleted: false },
        ],
      });
    createCustomerMock.mockRejectedValueOnce(new TypeError('fetch failed'));

    const result = await ensureAsaasCustomerForPayer({ contaId, payer: {
      type: 'ALUNO', id: aluno.id, name: aluno.nome, cpfCnpj: aluno.cpf!,
    } });

    expect(result).toMatchObject({ ok: false, error: 'TEMPORARY_ERROR' });
    if (!result.ok) expect(result.message).toContain('reconciliação necessária');
    expect(createCustomerMock).toHaveBeenCalledTimes(0);
    expect(listCustomersMock).toHaveBeenCalledTimes(3);
    const persisted = await prisma.aluno.findUnique({ where: { id: aluno.id } });
    expect(persisted?.asaasCustomerId).toBeNull();
  });

  it('mantém resultado ambíguo quando a leitura posterior não encontra customer', async () => {
    const aluno = await prisma.aluno.create({
      data: {
        contaId,
        nome: 'Aluno Customer Não Encontrado',
        dataNasc: new Date('2000-01-01'),
        cpf: '52998224725',
      },
    });
    listCustomersMock
      .mockResolvedValueOnce({ object: 'list', data: [], hasMore: false, totalCount: 0, limit: 100, offset: 0 })
      .mockResolvedValueOnce({ object: 'list', data: [], hasMore: false, totalCount: 0, limit: 100, offset: 0 })
      .mockResolvedValueOnce({ object: 'list', data: [], hasMore: false, totalCount: 0, limit: 100, offset: 0 });
    createCustomerMock.mockRejectedValueOnce(new TypeError('fetch failed'));

    const result = await ensureAsaasCustomerForPayer({ contaId, payer: {
      type: 'ALUNO', id: aluno.id, name: aluno.nome, cpfCnpj: aluno.cpf!,
    } });

    expect(result).toMatchObject({ ok: false, error: 'TEMPORARY_ERROR' });
    if (!result.ok) expect(result.message).toContain('Resultado do POST incerto');
    expect(createCustomerMock).toHaveBeenCalledTimes(1);
    expect(listCustomersMock).toHaveBeenCalledTimes(4);
    const persisted = await prisma.aluno.findUnique({ where: { id: aluno.id } });
    expect(persisted?.asaasCustomerId).toBeNull();
  });

  it('retorna resultado ambíguo sem repetir POST quando a consulta pós-timeout falha', async () => {
    const aluno = await prisma.aluno.create({
      data: {
        contaId,
        nome: 'Aluno Lookup Indisponível',
        dataNasc: new Date('2000-01-01'),
        cpf: '11144477735',
      },
    });
    listCustomersMock
      .mockResolvedValueOnce({ object: 'list', data: [], hasMore: false, totalCount: 0, limit: 100, offset: 0 })
      .mockResolvedValueOnce({ object: 'list', data: [], hasMore: false, totalCount: 0, limit: 100, offset: 0 })
      .mockResolvedValueOnce({ object: 'list', data: [], hasMore: false, totalCount: 0, limit: 100, offset: 0 })
      .mockRejectedValueOnce(new TypeError('fetch failed'));
    createCustomerMock.mockRejectedValueOnce(new TypeError('fetch failed'));

    const result = await ensureAsaasCustomerForPayer({ contaId, payer: {
      type: 'ALUNO', id: aluno.id, name: aluno.nome, cpfCnpj: aluno.cpf!,
    } });

    expect(result).toMatchObject({ ok: false, error: 'TEMPORARY_ERROR' });
    if (!result.ok) expect(result.message).toContain('Resultado do POST incerto');
    expect(createCustomerMock).toHaveBeenCalledTimes(1);
    expect(listCustomersMock).toHaveBeenCalledTimes(4);
    const persisted = await prisma.aluno.findUnique({ where: { id: aluno.id } });
    expect(persisted?.asaasCustomerId).toBeNull();
  });

  it('mantém falha 4xx definitiva sem fazer lookup pós-criação', async () => {
    const aluno = await prisma.aluno.create({
      data: {
        contaId,
        nome: 'Aluno Erro Definitivo',
        dataNasc: new Date('2000-01-01'),
        cpf: '39053344705',
      },
    });
    createCustomerMock.mockRejectedValueOnce(new AsaasHttpError(
      'Invalid customer', 400, undefined, { errors: [{ description: 'CPF inválido.' }] },
    ));

    const result = await ensureAsaasCustomerForPayer({ contaId, payer: {
      type: 'ALUNO', id: aluno.id, name: aluno.nome, cpfCnpj: aluno.cpf!,
    } });

    expect(result).toMatchObject({ ok: false, error: 'PAYER_INVALID' });
    expect(createCustomerMock).toHaveBeenCalledTimes(1);
    expect(listCustomersMock).toHaveBeenCalledTimes(3);
  });

  it('mantém o ensure bem-sucedido quando a herança global falha', async () => {
    applyNotificationPreferencesMock.mockRejectedValueOnce(new Error('sync failed'));

    const aluno = await prisma.aluno.create({
      data: {
        contaId,
        nome: 'Aluno 2B',
        dataNasc: new Date('2000-01-01'),
        cpf: '39053344705',
        email: 'aluno2b@example.com',
        telefone: '11999999999',
        enderecoCep: '01001000',
        enderecoLogradouro: 'Rua B',
        enderecoNumero: '20',
        enderecoBairro: 'Centro',
        enderecoCidade: 'SP',
        enderecoUf: 'SP',
      },
    });

    const result = await ensureAsaasCustomerForPayer({
      contaId,
      payer: {
        type: 'ALUNO',
        id: aluno.id,
        name: aluno.nome,
        cpfCnpj: aluno.cpf!,
        email: aluno.email,
        phone: aluno.telefone,
      },
    });

    expect(result.ok).toBe(true);
    expect(applyNotificationPreferencesMock).toHaveBeenCalledWith(contaId, 'cust_new');

    const updated = await prisma.aluno.findUnique({ where: { id: aluno.id } });
    expect(updated?.asaasCustomerId).toBe('cust_new');
  });

  it('restaura customer removido (soft delete) antes de atualizar e persistir', async () => {
    listCustomersMock.mockImplementationOnce(async (params) => ({
      object: 'list',
      hasMore: false,
      totalCount: 1,
      limit: 100,
      offset: 0,
      data: [
        {
          id: 'cust_deleted',
          object: 'customer',
          dateCreated: '2026-01-01',
          name: 'Cliente',
          cpfCnpj: '15350946056',
          externalReference: params.externalReference,
          deleted: true,
          notificationDisabled: false,
        },
      ],
    } as never));
    listCustomersMock.mockImplementationOnce(async (params) => ({
      object: 'list', hasMore: false, totalCount: 1, limit: 100, offset: 0,
      data: [{ id: 'cust_deleted', object: 'customer', dateCreated: '2026-01-01', name: 'Cliente',
        cpfCnpj: '15350946056', externalReference: params.externalReference, deleted: true,
        notificationDisabled: false }],
    } as never));

    const aluno = await prisma.aluno.create({
      data: {
        contaId,
        nome: 'Aluno 3',
        dataNasc: new Date('2000-01-01'),
        cpf: '15350946056',
        email: 'aluno3@example.com',
        telefone: '11999999999',
        enderecoCep: '01001000',
        enderecoLogradouro: 'Rua C',
        enderecoNumero: '30',
        enderecoBairro: 'Centro',
        enderecoCidade: 'SP',
        enderecoUf: 'SP',
      },
    });

    const result = await ensureAsaasCustomerForPayer({
      contaId,
      payer: {
        type: 'ALUNO',
        id: aluno.id,
        name: aluno.nome,
        cpfCnpj: aluno.cpf!,
        email: aluno.email,
        phone: aluno.telefone,
      },
    });

    expect(result.ok).toBe(true);
    expect(restoreCustomerMock).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cust_deleted' }),
    );
    expect(updateCustomerMock).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cust_deleted' }),
    );
  });

  it('normaliza customer encontrado por cpfCnpj sem sobrescrever o bloqueio global', async () => {
    listCustomersMock
      .mockResolvedValueOnce({
        object: 'list',
        hasMore: false,
        totalCount: 0,
        limit: 100,
        offset: 0,
        data: [],
      })
      .mockResolvedValueOnce({
        object: 'list',
        hasMore: false,
        totalCount: 1,
        limit: 100,
        offset: 0,
        data: [
          {
            id: 'cust_existing',
            object: 'customer',
            dateCreated: '2026-01-01',
            name: 'Cliente',
            cpfCnpj: '11144477735',
            deleted: false,
            notificationDisabled: false,
          },
        ],
      });

    const aluno = await prisma.aluno.create({
      data: {
        contaId,
        nome: 'Aluno 1',
        dataNasc: new Date('2000-01-01'),
        cpf: '11144477735',
        email: 'aluno@example.com',
        telefone: '11999999999',
        enderecoCep: '01001000',
        enderecoLogradouro: 'Rua A',
        enderecoNumero: '10',
        enderecoBairro: 'Centro',
        enderecoCidade: 'SP',
        enderecoUf: 'SP',
      },
    });

    const result = await ensureAsaasCustomerForPayer({
      contaId,
      payer: {
        type: 'ALUNO',
        id: aluno.id,
        name: aluno.nome,
        cpfCnpj: aluno.cpf!,
        email: aluno.email,
        phone: aluno.telefone,
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.customerId).toBe('cust_existing');
      expect(result.reused).toBe(true);
    }

    const updated = await prisma.aluno.findUnique({ where: { id: aluno.id } });
    expect(updated?.asaasCustomerId).toBe('cust_existing');
    expect(updated?.asaasCustomerExternalReference).toBe(`alusa_${contaId}_aluno_${aluno.id}`);
    expect(updateCustomerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cust_existing',
        data: expect.objectContaining({
          externalReference: `alusa_${contaId}_aluno_${aluno.id}`,
        }),
      }),
    );
    const updateCall = updateCustomerMock.mock.calls.at(-1)?.[0];
    expect(updateCall.data).not.toHaveProperty('notificationDisabled');
  });

  it('atualiza apiKeyStatus para CONNECTED quando o ping é bem-sucedido', async () => {
    const profile = await prisma.financeProfile.findUnique({
      where: { contaId },
      select: { id: true },
    });

    const account = await prisma.asaasAccount.findUnique({
      where: { financeProfileId: profile!.id },
      select: { id: true },
    });
    expect(account?.id).toBeTruthy();

    await prisma.asaasAccount.update({
      where: { id: account!.id },
      data: { apiKeyStatus: 'MISSING' },
    });

    listCustomersMock
      .mockResolvedValueOnce({
        object: 'list',
        hasMore: false,
        totalCount: 0,
        limit: 100,
        offset: 0,
        data: [],
      })
      .mockResolvedValueOnce({
        object: 'list',
        hasMore: false,
        totalCount: 0,
        limit: 100,
        offset: 0,
        data: [],
      })
      .mockResolvedValueOnce({
        object: 'list',
        hasMore: false,
        totalCount: 0,
        limit: 100,
        offset: 0,
        data: [],
      });

    const aluno = await prisma.aluno.create({
      data: {
        contaId,
        nome: 'Aluno Ping',
        dataNasc: new Date('2000-01-01'),
        cpf: '39053344705',
        email: 'ping@example.com',
        telefone: '11999999999',
        enderecoCep: '01001000',
        enderecoLogradouro: 'Rua A',
        enderecoNumero: '10',
        enderecoBairro: 'Centro',
        enderecoCidade: 'SP',
        enderecoUf: 'SP',
      },
    });

    await ensureAsaasCustomerForPayer({
      contaId,
      payer: {
        type: 'ALUNO',
        id: aluno.id,
        name: aluno.nome,
        cpfCnpj: aluno.cpf!,
        email: aluno.email,
        phone: aluno.telefone,
      },
    });

    const refreshed = await prisma.asaasAccount.findUnique({ where: { id: account!.id } });
    expect(refreshed?.apiKeyStatus).toBe('CONNECTED');
  });

  it('persiste customer no responsável quando payer é RESPONSAVEL', async () => {
    const responsavel = await prisma.responsavel.create({
      data: {
        contaId,
        nome: 'Responsavel Teste',
        cpf: '15350946056',
        email: 'resp@example.com',
        telefone: '11999999999',
        financeiro: true,
      },
    });

    const result = await ensureAsaasCustomerForPayer({
      contaId,
      payer: {
        type: 'RESPONSAVEL',
        id: responsavel.id,
        name: responsavel.nome,
        cpfCnpj: responsavel.cpf,
        email: responsavel.email,
        phone: responsavel.telefone,
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.customerId).toBe('cust_new');
    }

    const updated = await prisma.responsavel.findUnique({ where: { id: responsavel.id } });
    expect(updated?.asaasCustomerId).toBe('cust_new');
    expect(updated?.asaasCustomerExternalReference).toBe(
      `alusa_${contaId}_responsavel_${responsavel.id}`,
    );
  });

  it('compartilha a identidade do responsável com aluno adulto sem transferir o histórico', async () => {
    const responsavel = await prisma.responsavel.create({ data: {
      contaId, nome: 'Pessoa Compartilhada', cpf: '11144477735',
      email: 'shared-resp@example.com', telefone: '11999999999', financeiro: true,
      asaasCustomerId: 'cust_shared',
    } });
    const canonical = await prisma.customer.create({ data: {
      contaId, payerType: 'RESPONSAVEL', payerId: responsavel.id,
      asaasCustomerId: 'cust_shared', externalReference: 'original-reference',
    } });
    const aluno = await prisma.aluno.create({ data: {
      contaId, nome: responsavel.nome, cpf: responsavel.cpf,
      dataNasc: new Date('2000-01-01'), email: 'shared-aluno@example.com',
      telefone: '11999999999', asaasCustomerId: 'cust_shared',
    } });
    getCustomerMock.mockResolvedValueOnce({ id: 'cust_shared', cpfCnpj: '11144477735', deleted: false });
    const result = await ensureAsaasCustomerForPayer({ contaId, payer: {
      type: 'ALUNO', id: aluno.id, name: aluno.nome, cpfCnpj: aluno.cpf!, asaasCustomerId: 'cust_shared',
    } });
    expect(result).toMatchObject({ ok: true, customerId: 'cust_shared', externalReference: 'original-reference' });
    const links = await prisma.customerPayer.findMany({ where: { contaId, customerId: canonical.id } });
    expect(links.map((link) => link.payerType).sort()).toEqual(['ALUNO', 'RESPONSAVEL']);
    const preserved = await prisma.customer.findUnique({ where: { id: canonical.id } });
    expect(preserved).toMatchObject({ payerType: 'RESPONSAVEL', payerId: responsavel.id, externalReference: 'original-reference' });
    expect(createCustomerMock).not.toHaveBeenCalled();
  });

  it('retorna MISSING_KEY quando não existe apiKey da subconta', async () => {
    const result = await ensureAsaasCustomerForPayer({
      contaId: 'conta-sem-chave',
      payer: {
        type: 'ALUNO',
        id: 'aluno-x',
        name: 'Aluno X',
        cpfCnpj: '11144477735',
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('MISSING_KEY');
    }
  });
});
