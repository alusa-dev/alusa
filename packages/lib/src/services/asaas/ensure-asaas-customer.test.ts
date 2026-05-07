import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

import { ensureAsaasCustomerForPayer } from './ensure-asaas-customer';
import { encryptSecret } from '../../security/encryption';

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

vi.mock('../../services/integracoes/asaas-notifications.service', () => ({
  applyAsaasNotificationPreferencesToCustomer: applyNotificationPreferencesMock,
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
      limit: 10,
      offset: 0,
      data: [],
    });
    getCustomerMock.mockResolvedValue({
      id: 'cust_local',
      object: 'customer',
      dateCreated: '2026-01-01',
      name: 'Teste',
      cpfCnpj: '12345678901',
      deleted: false,
      notificationDisabled: false,
    });
    createCustomerMock.mockResolvedValue({
      id: 'cust_new',
      object: 'customer',
      dateCreated: '2026-01-01',
      name: 'Teste',
      cpfCnpj: '12345678901',
      deleted: false,
      notificationDisabled: false,
    });
    updateCustomerMock.mockResolvedValue({
      id: 'cust_existing',
      object: 'customer',
      dateCreated: '2026-01-01',
      name: 'Teste',
      cpfCnpj: '12345678901',
      deleted: false,
      notificationDisabled: false,
    });

    restoreCustomerMock.mockResolvedValue({
      id: 'cust_existing',
      object: 'customer',
      dateCreated: '2026-01-01',
      name: 'Teste',
      cpfCnpj: '12345678901',
      deleted: false,
      notificationDisabled: false,
    });

    applyNotificationPreferencesMock.mockResolvedValue({ updated: true, total: 1 });

    await prisma.alunoResponsavel.deleteMany({ where: { aluno: { contaId } } });
    await prisma.aluno.deleteMany({ where: { contaId } });
    await prisma.responsavel.deleteMany({ where: { cpf: { in: ['11144477735', '52998224725', '15350946056'] } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('reaproveita customer existente por externalReference e persiste o ID', async () => {
    listCustomersMock.mockResolvedValueOnce({
      object: 'list',
      hasMore: false,
      totalCount: 1,
      limit: 1,
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
    expect(createCustomerMock).not.toHaveBeenCalled();
    expect(applyNotificationPreferencesMock).toHaveBeenCalledWith(contaId, 'cust_existing');
    expect(updateCustomerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cust_existing',
        data: expect.objectContaining({
          externalReference: `alusa_${contaId}_aluno_${aluno.id}`,
          notificationDisabled: true,
        }),
      }),
    );
  });

  it('reaproveita customer local por id com uma chamada direta ao Asaas', async () => {
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
    expect(updateCustomerMock).not.toHaveBeenCalled();
    expect(applyNotificationPreferencesMock).toHaveBeenCalledWith(contaId, 'cust_local');

    const updated = await prisma.aluno.findUnique({ where: { id: aluno.id } });
    expect(updated?.asaasCustomerExternalReference).toBe(`alusa_${contaId}_aluno_${aluno.id}`);
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
          notificationDisabled: true,
        }),
      }),
    );
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
    listCustomersMock.mockResolvedValueOnce({
      object: 'list',
      hasMore: false,
      totalCount: 1,
      limit: 1,
      offset: 0,
      data: [
        {
          id: 'cust_deleted',
          object: 'customer',
          dateCreated: '2026-01-01',
          name: 'Cliente',
          cpfCnpj: '15350946056',
          deleted: true,
          notificationDisabled: false,
        },
      ],
    });

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

  it('normaliza customer encontrado por cpfCnpj com externalReference e notificationDisabled', async () => {
    listCustomersMock
      .mockResolvedValueOnce({
        object: 'list',
        hasMore: false,
        totalCount: 0,
        limit: 1,
        offset: 0,
        data: [],
      })
      .mockResolvedValueOnce({
        object: 'list',
        hasMore: false,
        totalCount: 1,
        limit: 10,
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
          notificationDisabled: true,
        }),
      }),
    );
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
        limit: 1,
        offset: 0,
        data: [],
      })
      .mockResolvedValueOnce({
        object: 'list',
        hasMore: false,
        totalCount: 0,
        limit: 1,
        offset: 0,
        data: [],
      })
      .mockResolvedValueOnce({
        object: 'list',
        hasMore: false,
        totalCount: 0,
        limit: 10,
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

  it('retorna MISSING_KEY quando não existe apiKey da subconta', async () => {
    const result = await ensureAsaasCustomerForPayer({
      contaId: 'conta-sem-chave',
      payer: {
        type: 'ALUNO',
        id: 'aluno-x',
        name: 'Aluno X',
        cpfCnpj: '99999999999',
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('MISSING_KEY');
    }
  });
});
