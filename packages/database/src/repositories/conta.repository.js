import { prisma } from '../client';
import { decryptSecret } from '../security/encryption';
/**
 * Carrega credenciais descriptografadas do Asaas
 */
export async function loadAsaasCredentials(contaId) {
    const [profile, conta] = await Promise.all([
        prisma.financeProfile.findUnique({
            where: { contaId },
            select: { asaasCredential: { select: { apiKeyEncrypted: true } } },
        }),
        prisma.conta.findUnique({
            where: { id: contaId },
            select: { asaasApiKeyEncrypted: true, asaasWebhookSecretEncrypted: true },
        }),
    ]);
    const apiKeyEncrypted = profile?.asaasCredential?.apiKeyEncrypted ?? conta?.asaasApiKeyEncrypted ?? null;
    const apiKey = decryptSecret(apiKeyEncrypted);
    if (!apiKey)
        return null;
    const webhookSecret = decryptSecret(conta?.asaasWebhookSecretEncrypted);
    return { apiKey, webhookSecret };
}
/**
 * Verifica se Asaas está habilitado para conta
 */
export async function isAsaasEnabled(contaId) {
    const profile = await prisma.financeProfile.findUnique({
        where: { contaId },
        select: { asaasCredential: { select: { id: true } } },
    });
    if (profile?.asaasCredential)
        return true;
    const conta = await prisma.conta.findUnique({ where: { id: contaId }, select: { asaasApiKeyEncrypted: true } });
    return !!conta?.asaasApiKeyEncrypted;
}
