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
});
