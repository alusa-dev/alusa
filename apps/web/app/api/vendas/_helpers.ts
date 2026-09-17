import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { apiJsonError } from '@/lib/api/standard-response';

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

  return { contaId: auth.contaId, operatorId: auth.userId };
}
