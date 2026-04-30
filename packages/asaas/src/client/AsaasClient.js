/**
 * Factory para criação de instâncias AsaasHttp
 */
import { AsaasHttp } from './AsaasHttp';
export function createAsaasClient(config) {
    return new AsaasHttp(config);
}
