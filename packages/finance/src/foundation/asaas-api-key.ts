import { getMyAccount } from '@alusa/asaas';
import type { AsaasApiKeyStatus } from '@prisma/client';

import { classifyAsaasOperationalError } from './asaas-operational-error';

export async function validateSubaccountApiKey(apiKey: string): Promise<AsaasApiKeyStatus> {
  try {
    await getMyAccount({ apiKey });
    return 'CONNECTED';
  } catch (error) {
    const failure = classifyAsaasOperationalError(error, 'subaccount');
    if (failure.category === 'invalid_subaccount_credentials') {
      return 'REVOKED';
    }
    return 'MISSING';
  }
}
