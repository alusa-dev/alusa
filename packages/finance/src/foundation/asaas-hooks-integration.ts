/**
 * Integração dos hooks do @alusa/asaas com os sistemas de
 * observabilidade do @alusa/finance (logger + alertas).
 *
 * Deve ser chamado uma vez na inicialização da aplicação.
 */

import { globalAsaasHooks } from '@alusa/asaas';
import { logAsaasApiCall } from './asaas-api-logger';
import { alertService } from './alert-channel';

let initialized = false;

export function registerAsaasHooksIntegration(): void {
  if (initialized) return;
  initialized = true;

  globalAsaasHooks.onApiCall((payload) => {
    logAsaasApiCall({
      method: payload.method,
      endpoint: payload.endpoint,
      contaId: payload.accountKey,
      httpStatus: payload.httpStatus,
      durationMs: payload.durationMs,
      success: payload.success,
      error: payload.error,
      circuitState: payload.circuitState,
      rateLimitRemaining: payload.rateLimitRemaining,
      quotaRemaining: payload.quotaRemaining,
    });
  });

  globalAsaasHooks.onCircuitOpen((payload) => {
    alertService
      .alertCircuitOpen(payload.accountKey, payload.failures)
      .catch(() => { /* fail-safe */ });
  });

  globalAsaasHooks.onQuotaWarning((payload) => {
    alertService
      .alertQuotaWarning(payload.used, payload.limit, payload.percentUsed)
      .catch(() => { /* fail-safe */ });
  });

  globalAsaasHooks.onRateLimitHit((payload) => {
    alertService
      .alertRateLimitExceeded(payload.accountKey, payload.endpoint)
      .catch(() => { /* fail-safe */ });
  });
}

/** Para testes — reseta o estado de inicialização. */
export function resetAsaasHooksIntegration(): void {
  initialized = false;
  globalAsaasHooks.removeAllListeners();
}
