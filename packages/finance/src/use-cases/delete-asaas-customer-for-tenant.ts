import { deleteCustomer } from '@alusa/asaas';
import { loadAndValidateSubaccountKey } from '../use-cases/ensure-asaas-customer-for-payer';

/**
 * Soft delete de customer no Asaas usando credencial da subconta do tenant.
 */
export async function deleteAsaasCustomerForTenant(params: {
  contaId: string;
  customerId: string;
}): Promise<{ ok: true } | { ok: false; error: 'INVALID_API_KEY' | 'ASAAS_ERROR'; message: string }> {
  const keyResult = await loadAndValidateSubaccountKey(params.contaId);
  if (!keyResult.ok) {
    return { ok: false, error: 'INVALID_API_KEY', message: keyResult.message };
  }

  try {
    await deleteCustomer({
      apiKey: keyResult.apiKey,
      customerId: params.customerId,
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: 'ASAAS_ERROR',
      message: error instanceof Error ? error.message : 'Falha ao inativar customer no Asaas.',
    };
  }
}
