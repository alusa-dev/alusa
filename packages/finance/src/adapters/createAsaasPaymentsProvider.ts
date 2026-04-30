/**
 * Factory para criar uma instância do AsaasPaymentsProviderAdapter
 * com as dependências corretas do projeto
 */

import { prisma } from '@alusa/database';
import { credentialVault } from '../foundation/credential-vault';
import { auditLogService } from '../foundation/audit-log.service';
import { AsaasPaymentsProviderAdapter } from './AsaasPaymentsProviderAdapter';

async function getApiKeyForConta(contaId: string): Promise<string> {
  const account = await prisma.asaasAccount.findFirst({
    where: {
      financeProfile: { contaId },
    },
    select: { apiKeyEncrypted: true },
  });

  if (!account?.apiKeyEncrypted) {
    throw new Error(`API key não encontrada para conta ${contaId}`);
  }

  return credentialVault.decrypt(account.apiKeyEncrypted);
}

async function logIntegration(params: {
  contaId: string;
  operation: string;
  entity: string;
  entityId: string;
  asaasId?: string;
  status: 'SUCCESS' | 'ERROR';
  httpStatus?: number;
  request?: unknown;
  response?: unknown;
  errorMessage?: string;
  correlationId?: string;
}): Promise<void> {
  try {
    await auditLogService.record({
      contaId: params.contaId,
      action: `ASAAS_${params.operation}`,
      entity: {
        type: params.entity,
        id: params.asaasId ?? params.entityId,
      },
      metadata: {
        operation: params.operation,
        entity: params.entity,
        entityId: params.entityId,
        asaasId: params.asaasId,
        status: params.status,
        httpStatus: params.httpStatus,
        request: params.request,
        response: params.response,
        errorMessage: params.errorMessage,
        correlationId: params.correlationId,
      },
    });
  } catch (error) {
    // Log de auditoria não deve quebrar o fluxo principal
    console.error('[AsaasAdapter] Erro ao registrar log:', error);
  }
}

/**
 * Cria uma instância do AsaasPaymentsProviderAdapter
 * com todas as dependências configuradas
 */
export function createAsaasPaymentsProvider(): AsaasPaymentsProviderAdapter {
  return new AsaasPaymentsProviderAdapter({
    getApiKeyForConta,
    logIntegration,
  });
}
