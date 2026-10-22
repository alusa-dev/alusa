// Client
export { prisma } from './client.js';
export {
  getTenantRuntimeHealth,
  isRlsRuntimeEnabled,
  runWithTenant,
} from './tenant.js';
export type { TenantTransactionClient } from './tenant.js';

// Repositories
export {
  inspectAsaasCredentials,
  loadAsaasCredentials,
  isAsaasEnabled,
} from './repositories/conta.repository.js';
export type {
  AsaasCredentialHealth,
  AsaasCredentialInspection,
  AsaasCredentialSource,
} from './repositories/conta.repository.js';

// Security
export {
  decryptSecret,
  decryptSecretWithMetadata,
  encryptSecret,
  validateEncryptionConfiguration,
} from './security/encryption.js';
export type { DecryptedSecret } from './security/encryption.js';
