import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import { getMyAccountDocuments, uploadMyAccountDocument } from '@alusa/asaas';
import { loadAsaasCredentials, prisma } from '@alusa/database';

import { financeProfileService } from '../../../foundation/finance-profile.service';
import { credentialVault } from '../../../foundation/credential-vault';
import { submitKycData } from '../../submit-kyc-data';
import { getKycSummary } from '../get-kyc-summary';
import { uploadKycDocumentByGroup } from '../upload-kyc-document-by-group';

const VALID_CPF = '11144477735';

const subaccountId = `asaas-account-${randomUUID()}`;

vi.mock('@alusa/asaas', async () => {
  const actual = await vi.importActual<typeof import('@alusa/asaas')>('@alusa/asaas');

  return {
    ...actual,
    createSubaccount: vi.fn(async () => ({
      object: 'account',
      id: subaccountId,
      name: 'Conta Teste',
      email: 'owner@teste.com',
      cpfCnpj: VALID_CPF,
      apiKey: '$aact_sub_123',
      walletId: 'wallet-1',
    })),
    updateSubaccount: vi.fn(async () => ({
      object: 'account',
      id: subaccountId,
      name: 'Conta Teste',
      email: 'owner@teste.com',
      cpfCnpj: VALID_CPF,
      apiKey: '$aact_sub_123',
      walletId: 'wallet-1',
    })),
    listSubaccounts: vi.fn(async () => ({
      object: 'list',
      hasMore: false,
      totalCount: 0,
      limit: 10,
      offset: 0,
      data: [],
    })),
    listWebhooks: vi.fn(async () => ({
      object: 'list',
      hasMore: false,
      totalCount: 0,
      limit: 100,
      offset: 0,
      data: [],
    })),
    createWebhook: vi.fn(async () => ({ id: 'webhook-1' })),
    updateWebhook: vi.fn(async () => ({ id: 'webhook-1' })),
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
    uploadMyAccountDocument: vi.fn(async () => ({
      id: 'doc_1',
      status: 'PENDING',
    })),
    getMyAccountStatus: vi.fn(async () => ({
      documentation: 'PENDING',
      general: 'PENDING',
    })),
    getMyAccount: vi.fn(async () => ({ id: subaccountId })),
  };
});

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0'.repeat(64);
process.env.ASAAS_API_KEY = process.env.ASAAS_API_KEY || '$aact_master_test';
process.env.ASAAS_BASE_URL = process.env.ASAAS_BASE_URL ?? 'https://api-sandbox.asaas.com/v3';

async function cleanup(contaId: string) {
  const profile = await prisma.financeProfile.findUnique({ where: { contaId }, select: { id: true } });

  await prisma.auditLog.deleteMany({ where: { contaId } });
  await prisma.financeReconciliationIssue.deleteMany({ where: { contaId } });

  if (profile) {
    await prisma.asaasCredential.deleteMany({ where: { financeProfileId: profile.id } });
    await prisma.asaasAccount.deleteMany({ where: { financeProfileId: profile.id } });
  }

  await prisma.financeProfile.deleteMany({ where: { contaId } });
  await prisma.usuario.deleteMany({ where: { contaId } });
  await prisma.conta.deleteMany({ where: { id: contaId } });
}

describe('uploadKycDocumentByGroup', () => {
  afterEach(async () => {
    // sem-op: cleanup por teste
  });

  it('deve enviar documento para o Asaas e avançar status para UNDER_REVIEW', async () => {
    const unique = randomUUID();
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste KYC Doc',
        cpfCnpj: VALID_CPF,
      },
    });

    const user = await prisma.usuario.create({
      data: {
        contaId: conta.id,
        nome: 'Owner',
        email: `owner+${unique}@teste.com`,
        birthDate: new Date('1990-01-01T00:00:00.000Z'),
        senhaHash: 'hash',
        role: 'ADMIN',
      },
    });

    try {
      // Garantir dados mínimos do onboarding (Etapa 2)
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

      // Cria a subconta + credencial (idempotente)
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
          complement: 'Apto 1',
        },
        actor: { type: 'USER', id: user.id },
      });

      // Sanity-check: credenciais precisam existir antes do upload
      const profileBefore = await prisma.financeProfile.findUnique({
        where: { contaId: conta.id },
        select: { id: true },
      });
      expect(profileBefore).not.toBeNull();

      const asaasAccountBefore = await prisma.asaasAccount.findUnique({
        where: { financeProfileId: profileBefore!.id },
        select: { id: true },
      });
      expect(asaasAccountBefore).not.toBeNull();

      // Evita a janela de 15s onde o Asaas pode ainda não listar documentos para contas recém-provisionadas.
      await prisma.asaasAccount.updateMany({
        where: { financeProfileId: profileBefore!.id },
        data: { provisionedAt: new Date(Date.now() - 20_000) },
      });

      const credentialBefore = await prisma.asaasCredential.findUnique({
        where: { financeProfileId: profileBefore!.id },
        select: { apiKeyEncrypted: true },
      });
      expect(credentialBefore).not.toBeNull();
      expect(credentialVault.decrypt(credentialBefore!.apiKeyEncrypted)).toBe('$aact_sub_123');

      const credsBefore = await loadAsaasCredentials(conta.id);
      expect(credsBefore?.apiKey).toBe('$aact_sub_123');

      const result = await uploadKycDocumentByGroup({
        contaId: conta.id,
        groupId: 'grp_1',
        type: 'IDENTIFICATION',
        file: {
          bytes: new Uint8Array([1, 2, 3]),
          filename: 'doc.pdf',
          mimeType: 'application/pdf',
        },
        actor: { type: 'USER', id: user.id },
      });

      expect(result.updatedOnboardingStatus).toBe('UNDER_REVIEW');

      const profile = await prisma.financeProfile.findUnique({ where: { contaId: conta.id }, select: { id: true } });
      expect(profile).not.toBeNull();

      const credential = await prisma.asaasCredential.findUnique({ where: { financeProfileId: profile!.id } });
      expect(credential).not.toBeNull();
      expect(credentialVault.decrypt(credential!.apiKeyEncrypted)).toBe('$aact_sub_123');

      const asaasAccount = await prisma.asaasAccount.findUnique({ where: { financeProfileId: profile!.id } });
      expect(asaasAccount?.status).toBe('UNDER_REVIEW');

      const auditCount = await prisma.auditLog.count({ where: { contaId: conta.id } });
      expect(auditCount).toBeGreaterThan(0);

      const summary = await getKycSummary(conta.id);
      expect(summary.documents?.data?.[0]?.id).toBe('grp_1');
    } finally {
      await cleanup(conta.id);
    }
  });

  it('mantém upload via API quando o grupo não tem onboardingUrl mesmo com description padrão do Asaas', async () => {
    const unique = randomUUID();
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste KYC Description',
        cpfCnpj: VALID_CPF,
      },
    });

    const user = await prisma.usuario.create({
      data: {
        contaId: conta.id,
        nome: 'Owner',
        email: `owner+${unique}@teste.com`,
        birthDate: new Date('1990-01-01T00:00:00.000Z'),
        senhaHash: 'hash',
        role: 'ADMIN',
      },
    });

    vi.mocked(getMyAccountDocuments).mockResolvedValueOnce({
      data: [
        {
          id: 'grp_desc',
          status: 'NOT_SENT',
          type: 'IDENTIFICATION',
          title: 'Documentos de identificação',
          description: 'Para enviar esse documento acesse nosso aplicativo ou utilize o link de onboarding.',
          documents: [],
        },
      ],
    } as never);

    try {
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
        actor: { type: 'USER', id: user.id },
      });

      const profile = await prisma.financeProfile.findUnique({
        where: { contaId: conta.id },
        select: { id: true },
      });

      await prisma.asaasAccount.updateMany({
        where: { financeProfileId: profile!.id },
        data: { provisionedAt: new Date(Date.now() - 20_000) },
      });

      await uploadKycDocumentByGroup({
        contaId: conta.id,
        groupId: 'grp_desc',
        type: 'IDENTIFICATION',
        file: {
          bytes: new Uint8Array([1, 2, 3]),
          filename: 'doc.pdf',
          mimeType: 'application/pdf',
        },
        actor: { type: 'USER', id: user.id },
      });

      expect(uploadMyAccountDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          groupId: 'grp_desc',
          type: 'IDENTIFICATION',
        }),
      );
    } finally {
      await cleanup(conta.id);
    }
  });
});
