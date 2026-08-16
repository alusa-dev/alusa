import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  financeProfileFindUnique: vi.fn(),
  contaFindUnique: vi.fn(),
  decryptSecretWithMetadata: vi.fn(),
  encryptSecret: vi.fn(() => 'rotated-cipher'),
  asaasAccountUpdateMany: vi.fn(),
  asaasCredentialUpdateMany: vi.fn(),
}));

vi.mock('../client', () => ({
  prisma: {
    financeProfile: { findUnique: mocks.financeProfileFindUnique },
    conta: { findUnique: mocks.contaFindUnique },
    asaasAccount: { updateMany: mocks.asaasAccountUpdateMany },
    asaasCredential: { updateMany: mocks.asaasCredentialUpdateMany },
  },
}));

vi.mock('../security/encryption', () => ({
  decryptSecretWithMetadata: mocks.decryptSecretWithMetadata,
  encryptSecret: mocks.encryptSecret,
}));

import { inspectAsaasCredentials, loadAsaasCredentials } from './conta.repository';

describe('conta.repository Asaas credentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.financeProfileFindUnique.mockResolvedValue({
      asaasAccount: { apiKeyEncrypted: 'canonical-cipher', apiKeyStatus: 'CONNECTED' },
      asaasCredential: { apiKeyEncrypted: 'legacy-cipher' },
    });
    mocks.contaFindUnique.mockResolvedValue({
      asaasApiKeyEncrypted: null,
      asaasWebhookSecretEncrypted: null,
    });
    mocks.decryptSecretWithMetadata.mockImplementation((value: string | null) =>
      value === 'legacy-cipher' ? { value: '$aact_sub_legacy', keyVersion: '1', needsRotation: false } : null,
    );
  });

  it('usa uma fonte de fallback quando a cifra canônica está ilegível', async () => {
    const credentials = await loadAsaasCredentials('conta-1');
    const inspection = await inspectAsaasCredentials('conta-1');

    expect(credentials).toMatchObject({
      apiKey: '$aact_sub_legacy',
      source: 'asaasCredential',
      apiKeyStatus: 'CONNECTED',
    });
    expect(inspection).toMatchObject({
      health: 'CONNECTED',
      source: 'asaasCredential',
      fallbackUsed: true,
      unreadableSources: ['asaasAccount'],
    });
  });

  it('diferencia cifra ilegível de credencial ausente', async () => {
    mocks.decryptSecretWithMetadata.mockReturnValue(null);

    await expect(loadAsaasCredentials('conta-1')).resolves.toBeNull();
    await expect(inspectAsaasCredentials('conta-1')).resolves.toMatchObject({
      health: 'DECRYPTION_FAILED',
      source: 'none',
      encryptedSources: ['asaasAccount', 'asaasCredential'],
      unreadableSources: ['asaasAccount', 'asaasCredential'],
    });
  });

  it('não reativa uma credencial antiga quando a fonte canônica está desconectada', async () => {
    mocks.financeProfileFindUnique.mockResolvedValue({
      asaasAccount: { apiKeyEncrypted: 'canonical-cipher', apiKeyStatus: 'INVALID' },
      asaasCredential: { apiKeyEncrypted: 'legacy-cipher' },
    });
    mocks.decryptSecretWithMetadata.mockImplementation((value: string | null) =>
      value === 'canonical-cipher'
        ? { value: '$aact_sub_invalid', keyVersion: '1', needsRotation: false }
        : { value: '$aact_sub_legacy', keyVersion: '1', needsRotation: false },
    );

    await expect(loadAsaasCredentials('conta-1')).resolves.toBeNull();
    await expect(inspectAsaasCredentials('conta-1')).resolves.toMatchObject({
      health: 'DISCONNECTED',
      source: 'none',
      apiKeyStatus: 'INVALID',
    });
  });

  it('recriptografa automaticamente uma credencial legada lida pela chave anterior', async () => {
    mocks.financeProfileFindUnique.mockResolvedValue({
      asaasAccount: { id: 'account-1', apiKeyEncrypted: 'legacy-cipher', apiKeyStatus: 'CONNECTED' },
      asaasCredential: null,
    });
    mocks.decryptSecretWithMetadata.mockImplementation((value: string | null) =>
      value === 'legacy-cipher' ? { value: '$aact_sub_legacy', keyVersion: '1', needsRotation: true } : null,
    );

    await expect(loadAsaasCredentials('conta-1')).resolves.toMatchObject({
      apiKey: '$aact_sub_legacy',
      source: 'asaasAccount',
    });

    expect(mocks.asaasAccountUpdateMany).toHaveBeenCalledWith({
      where: { id: 'account-1', apiKeyEncrypted: 'legacy-cipher' },
      data: { apiKeyEncrypted: 'rotated-cipher' },
    });
  });
});
