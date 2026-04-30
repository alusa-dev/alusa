import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import { prisma } from '@alusa/database';

import { financeProfileService } from '../../../foundation/finance-profile.service';
import { submitKycData } from '../../submit-kyc-data';
import { getKycSummary } from '../get-kyc-summary';

const VALID_CPF = '11144477735';

vi.mock('@alusa/asaas', async () => {
  const actual = await vi.importActual<typeof import('@alusa/asaas')>('@alusa/asaas');

  return {
    ...actual,
    createSubaccount: vi.fn(async () => ({
      object: 'account',
      id: `asaas-account-${randomUUID()}`,
      name: 'Conta Teste',
      email: 'owner@teste.com',
      cpfCnpj: VALID_CPF,
      apiKey: '$aact_sub_123',
      walletId: 'wallet-1',
    })),
    updateSubaccount: vi.fn(async (params: { accountId?: string }) => ({
      object: 'account',
      id: params.accountId ?? `asaas-account-${randomUUID()}`,
      name: 'Conta Teste',
      email: 'owner@teste.com',
      cpfCnpj: VALID_CPF,
      apiKey: '$aact_sub_123',
      walletId: 'wallet-1',
    })),
    getMyAccountDocuments: vi.fn(async () => ({
      data: [
        {
          id: 'grp_1',
          status: 'NOT_SENT',
          title: 'Documento',
          description: 'Envie um documento',
          documents: [],
        },
      ],
    })),
    getMyAccountStatus: vi.fn(async () => ({
      documentation: 'PENDING',
      general: 'PENDING',
    })),
    getMyAccount: vi.fn(async () => ({ id: `asaas-account-${randomUUID()}` })),
  };
});

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0'.repeat(64);
process.env.ASAAS_API_KEY = process.env.ASAAS_API_KEY || '$aact_master_test';
process.env.ASAAS_BASE_URL = process.env.ASAAS_BASE_URL ?? 'https://api-sandbox.asaas.com/v3';

describe('getKycSummary (cache TTL)', () => {
  it('cache válido -> não chama provedor e retorna cache', async () => {
    const unique = randomUUID();
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste Cache TTL',
        cpfCnpj: VALID_CPF,
      },
    });

    await prisma.usuario.create({
      data: {
        contaId: conta.id,
        nome: 'Owner',
        email: `owner+${unique}@teste.com`,
        birthDate: new Date('1990-01-01T00:00:00.000Z'),
        senhaHash: 'hash',
        role: 'ADMIN',
      },
    });

    await financeProfileService.setOnboardingData(conta.id, {
      personType: 'PF',
      ownerName: 'Conta Financeira Teste',
      cpfCnpj: VALID_CPF,
      birthDate: '1990-01-01',
      mobilePhone: '11999999999',
      incomeValue: 1000,
      address: 'Rua Teste',
      addressNumber: '123',
      province: 'Centro',
      postalCode: '01001-000',
    });

    await submitKycData({
      contaId: conta.id,
      payload: {
        personType: 'PF',
        ownerName: 'Conta Financeira Teste',
        cpfCnpj: VALID_CPF,
        birthDate: '1990-01-01',
        mobilePhone: '11999999999',
        incomeValue: 1000,
        address: 'Rua Teste',
        addressNumber: '123',
        province: 'Centro',
        postalCode: '01001-000',
      },
      actor: { type: 'USER', id: 'u1' },
    });

    const { getMyAccountDocuments, getMyAccountStatus } = await import('@alusa/asaas');
    vi.mocked(getMyAccountDocuments).mockClear();
    vi.mocked(getMyAccountStatus).mockClear();

    const profile = await prisma.financeProfile.findUnique({ where: { contaId: conta.id }, select: { id: true } });
    expect(profile?.id).toBeTruthy();

    const cachedDocs = {
      data: [{ id: 'grp_cache', status: 'PENDING', title: 'Cached', description: 'Cached', documents: [] }],
    };

    await prisma.asaasAccount.updateMany({
      where: { financeProfileId: profile!.id },
      data: {
        provisionedAt: new Date(Date.now() - 60_000),
        documentsCache: { version: 1, documents: cachedDocs, myAccountStatus: { general: 'PENDING' } },
        documentsCacheUpdatedAt: new Date(),
      },
    });

    const summary = await getKycSummary(conta.id);

    expect(summary.documents).toMatchObject(cachedDocs);
    expect(summary.myAccountStatus).toMatchObject({ general: 'PENDING' });

    expect(getMyAccountDocuments).not.toHaveBeenCalled();
    expect(getMyAccountStatus).not.toHaveBeenCalled();
  });

  it('cache expirado -> chama provedor e atualiza cache', async () => {
    const unique = randomUUID();
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste Cache Expirado',
        cpfCnpj: VALID_CPF,
      },
    });

    await prisma.usuario.create({
      data: {
        contaId: conta.id,
        nome: 'Owner',
        email: `owner+${unique}@teste.com`,
        birthDate: new Date('1990-01-01T00:00:00.000Z'),
        senhaHash: 'hash',
        role: 'ADMIN',
      },
    });

    await financeProfileService.setOnboardingData(conta.id, {
      personType: 'PF',
      ownerName: 'Conta Financeira Teste',
      cpfCnpj: VALID_CPF,
      birthDate: '1990-01-01',
      mobilePhone: '11999999999',
      incomeValue: 1000,
      address: 'Rua Teste',
      addressNumber: '123',
      province: 'Centro',
      postalCode: '01001-000',
    });

    await submitKycData({
      contaId: conta.id,
      payload: {
        personType: 'PF',
        ownerName: 'Conta Financeira Teste',
        cpfCnpj: VALID_CPF,
        birthDate: '1990-01-01',
        mobilePhone: '11999999999',
        incomeValue: 1000,
        address: 'Rua Teste',
        addressNumber: '123',
        province: 'Centro',
        postalCode: '01001-000',
      },
      actor: { type: 'USER', id: 'u1' },
    });

    const profile = await prisma.financeProfile.findUnique({ where: { contaId: conta.id }, select: { id: true } });

    await prisma.asaasAccount.updateMany({
      where: { financeProfileId: profile!.id },
      data: {
        provisionedAt: new Date(Date.now() - 60_000),
        documentsCache: { version: 1, documents: { data: [] } },
        documentsCacheUpdatedAt: new Date(Date.now() - 60_000),
      },
    });

    const { getMyAccountDocuments, getMyAccountStatus } = await import('@alusa/asaas');
    vi.mocked(getMyAccountDocuments).mockClear();
    vi.mocked(getMyAccountStatus).mockClear();

    const summary = await getKycSummary(conta.id);

    expect(getMyAccountDocuments).toHaveBeenCalledTimes(1);
    expect(getMyAccountStatus).toHaveBeenCalledTimes(1);

    const updated = await prisma.asaasAccount.findFirst({
      where: { financeProfileId: profile!.id },
      select: { documentsCacheUpdatedAt: true, documentsCache: true },
    });

    expect(updated?.documentsCacheUpdatedAt).toBeTruthy();
    expect(updated?.documentsCache).toBeTruthy();
    expect(summary.documents?.data?.length).toBeGreaterThan(0);
  });

  it('reconcilia commercialInfo expirado a partir do GET oficial do Asaas', async () => {
    const unique = randomUUID();
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste Commercial Info',
        cpfCnpj: VALID_CPF,
      },
    });

    await prisma.usuario.create({
      data: {
        contaId: conta.id,
        nome: 'Owner',
        email: `owner+${unique}@teste.com`,
        birthDate: new Date('1990-01-01T00:00:00.000Z'),
        senhaHash: 'hash',
        role: 'ADMIN',
      },
    });

    await financeProfileService.setOnboardingData(conta.id, {
      personType: 'PF',
      ownerName: 'Conta Financeira Teste',
      cpfCnpj: VALID_CPF,
      birthDate: '1990-01-01',
      mobilePhone: '11999999999',
      incomeValue: 1000,
      address: 'Rua Teste',
      addressNumber: '123',
      province: 'Centro',
      postalCode: '01001-000',
    });

    await submitKycData({
      contaId: conta.id,
      payload: {
        personType: 'PF',
        ownerName: 'Conta Financeira Teste',
        cpfCnpj: VALID_CPF,
        birthDate: '1990-01-01',
        mobilePhone: '11999999999',
        incomeValue: 1000,
        address: 'Rua Teste',
        addressNumber: '123',
        province: 'Centro',
        postalCode: '01001-000',
      },
      actor: { type: 'USER', id: 'u1' },
    });

    const { getMyAccountDocuments, getMyAccountStatus } = await import('@alusa/asaas');
    vi.mocked(getMyAccountDocuments).mockResolvedValueOnce({ data: [], rejectReasons: [] });
    vi.mocked(getMyAccountStatus).mockResolvedValueOnce({
      documentation: 'APPROVED',
      general: 'APPROVED',
      bankAccountInfo: 'APPROVED',
      commercialInfo: 'APPROVED',
      commercialInfoExpiration: { isExpired: true, scheduledDate: '2026-05-10' },
    });

    const summary = await getKycSummary(conta.id);

    expect(summary.myAccountStatus?.commercialInfoExpiration).toEqual({
      isExpired: true,
      scheduledDate: '2026-05-10',
    });

    const profile = await prisma.financeProfile.findUnique({ where: { contaId: conta.id }, select: { id: true } });
    const asaasAccount = await prisma.asaasAccount.findFirst({
      where: { financeProfileId: profile!.id },
      select: { commercialInfoStatus: true, commercialInfoScheduledDate: true },
    });

    expect(asaasAccount).toMatchObject({
      commercialInfoStatus: 'EXPIRED',
      commercialInfoScheduledDate: '2026-05-10',
    });
  });
});
