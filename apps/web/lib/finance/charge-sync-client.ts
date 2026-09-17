'use client';

const inFlightByChargeId = new Map<string, Promise<boolean>>();
const lastAttemptByChargeId = new Map<string, number>();

export async function requestCobrancaAsaasSync(
  id: string,
  options: { throttleMs?: number; endpoint?: (_id: string) => string } = {},
): Promise<boolean> {
  const normalizedId = id.trim();
  if (!normalizedId) return false;

  const endpoint = options.endpoint ?? ((chargeId: string) => `/api/cobrancas/${encodeURIComponent(chargeId)}/sync-asaas`);
  const requestKey = `${endpoint(normalizedId)}\u0000${normalizedId}`;

  const inFlight = inFlightByChargeId.get(requestKey);
  if (inFlight) return inFlight;

  const throttleMs = Math.max(0, options.throttleMs ?? 30_000);
  const now = Date.now();
  const lastAttempt = lastAttemptByChargeId.get(requestKey) ?? 0;
  if (now - lastAttempt < throttleMs) return false;

  lastAttemptByChargeId.set(requestKey, now);
  const request = fetch(endpoint(normalizedId), {
    method: 'POST',
    headers: { Accept: 'application/json' },
  })
    .then((response) => response.ok)
    .catch(() => false)
    .finally(() => {
      inFlightByChargeId.delete(requestKey);
    });

  inFlightByChargeId.set(requestKey, request);
  return request;
}
