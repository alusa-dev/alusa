/**
 * Factory para criação de instâncias AsaasHttp
 */

import { AsaasHttp, type AsaasHttpConfig } from './AsaasHttp';

export function createAsaasClient(config: AsaasHttpConfig): AsaasHttp {
  return new AsaasHttp(config);
}
