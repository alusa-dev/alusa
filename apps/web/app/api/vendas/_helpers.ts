import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { apiJsonError } from '@/lib/api/standard-response';
import { StoreSaleError } from '@alusa/finance';
import { platformBillingAccessResponseForConta } from '@/src/server/platform-billing/capacity';

export function jsonError(status: number, code: string, message: string, details?: unknown) {
  return apiJsonError(status, code, message, details);
}

export async function getStoreRequestContext() {
  const auth = await resolveTenantSession();
  if (!auth.ok) {
    throw Object.assign(new Error('Usuário não autenticado.'), {
      code: auth.reason === 'CONTA_MISMATCH' ? 'CONTA_INVALIDA' : 'NAO_AUTENTICADO',
      status: auth.reason === 'CONTA_MISMATCH' ? 403 : 401,
    });
  }

  return { contaId: auth.contaId, operatorId: auth.userId, role: auth.role };
}

export async function getStoreWriteRequestContext() {
  const context = await getStoreRequestContext();
  const blocked = await platformBillingAccessResponseForConta({ contaId: context.contaId, capability: 'STORE_WRITE' });
  if (blocked) {
    throw new StoreSaleError(
      'PLATFORM_BILLING_ACCESS_RESTRICTED',
      blocked.body.message,
      blocked.status,
    );
  }
  return context;
}

export async function storeWriteBillingBlock(contaId: string) {
  const blocked = await platformBillingAccessResponseForConta({ contaId, capability: 'STORE_WRITE' });
  return blocked
    ? apiJsonError(
      blocked.status,
      blocked.body.error,
      blocked.body.message,
      blocked.body.error === 'PLATFORM_BILLING_ACCESS_RESTRICTED' ? blocked.body.details : undefined,
    )
    : null;
}
