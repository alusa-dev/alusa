export const ASAAS_READ_INTENTS = [
  'READ_MODEL',
  'COMMAND_PREFLIGHT_STATUS',
  'COMMAND_PREFLIGHT_FULL',
  'RECONCILIATION',
  'MANUAL_REPAIR',
  'AUTHORITATIVE_DOCUMENT',
] as const;

export type AsaasReadIntent = (typeof ASAAS_READ_INTENTS)[number];

export type AsaasReadIntentStats = Record<AsaasReadIntent, number>;

function createEmptyAsaasReadIntentStats(): AsaasReadIntentStats {
  return {
    READ_MODEL: 0,
    COMMAND_PREFLIGHT_STATUS: 0,
    COMMAND_PREFLIGHT_FULL: 0,
    RECONCILIATION: 0,
    MANUAL_REPAIR: 0,
    AUTHORITATIVE_DOCUMENT: 0,
  };
}

const stats = createEmptyAsaasReadIntentStats();

export function recordAsaasReadIntent(intent: AsaasReadIntent, increment = 1): void {
  stats[intent] += increment;
}

export function getAsaasReadIntentStats(): AsaasReadIntentStats {
  return { ...stats };
}

export function resetAsaasReadIntentStats(): void {
  for (const intent of ASAAS_READ_INTENTS) {
    stats[intent] = 0;
  }
}
