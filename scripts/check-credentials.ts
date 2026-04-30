import { PrismaClient } from '@prisma/client';
import { decryptSecret } from '../packages/lib/src/security/encryption';

const prisma = new PrismaClient();

async function main() {
  const contaId = 'ca37e235-4310-4499-9a55-9cc46d06d7d9';
  console.log(`Checking credentials for conta: ${contaId}`);
  
  const [profile, conta] = await Promise.all([
    prisma.financeProfile.findUnique({
      where: { contaId },
      select: {
        asaasCredential: { select: { apiKeyEncrypted: true } },
        asaasAccount: { select: { apiKeyEncrypted: true, apiKeyStatus: true } },
      },
    }),
    prisma.conta.findUnique({
      where: { id: contaId },
      select: { asaasApiKeyEncrypted: true },
    }),
  ]);
  
  console.log('Profile:', {
    hasAsaasAccount: !!profile?.asaasAccount,
    hasAsaasCredential: !!profile?.asaasCredential,
    apiKeyStatus: profile?.asaasAccount?.apiKeyStatus,
    hasEncryptedKey: !!profile?.asaasAccount?.apiKeyEncrypted,
  });
  
  console.log('Conta:', {
    hasLegacyKey: !!conta?.asaasApiKeyEncrypted,
  });
  
  const apiKeyEncrypted = profile?.asaasAccount?.apiKeyEncrypted;
  if (apiKeyEncrypted) {
    console.log('Encrypted key preview:', apiKeyEncrypted.substring(0, 40) + '...');
    
    try {
      const decrypted = decryptSecret(apiKeyEncrypted);
      console.log('Decrypted successfully:', decrypted ? decrypted.substring(0, 20) + '...' : 'null');
    } catch (e) {
      console.error('Decryption error:', e);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  });
