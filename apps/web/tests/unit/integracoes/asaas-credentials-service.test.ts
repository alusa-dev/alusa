import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@alusa/lib';
import {
  saveAsaasCredentials,
  getAsaasCredentials,
  loadDecryptedAsaasCredentials,
} from '@alusa/lib';

let contaId: string;

describe('AsaasCredentialsService', () => {
  beforeAll(async () => {
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Test Credenciais',
        cpfCnpj: '11122233344455',
        status: 'ATIVO',
      },
    });
    contaId = conta.id;
  });

  it('salva e recupera credenciais mascaradas', async () => {
    await saveAsaasCredentials(contaId, {
      apiKey: 'test-api-key-placeholder',
      webhookSecret: 'test-webhook-secret-placeholder',
    });
    const masked = await getAsaasCredentials(contaId);
    expect(masked.apiKeyMasked).toBeTruthy();
    expect(masked.webhookSecretMasked).toBeTruthy();
    expect(masked.apiKeyMasked).toContain('test');
  });

  it('retorna descriptografado para uso interno', async () => {
    const raw = await loadDecryptedAsaasCredentials(contaId);
    expect(raw).toBeTruthy();
    expect(raw?.apiKey).toBe('test-api-key-placeholder');
  });

  it('carrega api key da fonte canônica AsaasAccount quando Conta legacy está vazia', async () => {
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Test Credenciais Canonicas',
        cpfCnpj: '99988877766655',
        status: 'ATIVO',
      },
      select: { id: true },
    });

    await saveAsaasCredentials(conta.id, {
      apiKey: 'canonical-api-key-placeholder',
      webhookSecret: 'canonical-webhook-secret-placeholder',
    });

    const encrypted = await prisma.conta.findUnique({
      where: { id: conta.id },
      select: { asaasApiKeyEncrypted: true },
    });

    expect(encrypted?.asaasApiKeyEncrypted).toBeTruthy();

    await prisma.financeProfile.create({
      data: {
        contaId: conta.id,
        asaasAccount: {
          create: {
            status: 'APPROVED',
            apiKeyStatus: 'CONNECTED',
            apiKeyEncrypted: encrypted!.asaasApiKeyEncrypted,
          },
        },
      },
    });

    await prisma.conta.update({
      where: { id: conta.id },
      data: {
        asaasApiKeyEncrypted: null,
        asaasWebhookSecretEncrypted: null,
        asaasCredsUpdatedAt: null,
      },
    });

    const raw = await loadDecryptedAsaasCredentials(conta.id);

    expect(raw).toBeTruthy();
    expect(raw?.apiKey).toBe('canonical-api-key-placeholder');
  });
});
