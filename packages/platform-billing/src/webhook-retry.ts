export type PlatformBillingWebhookFailureKind = 'TEMPORARY' | 'PERMANENT';

export interface PlatformBillingWebhookRetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
}

export const DEFAULT_PLATFORM_BILLING_WEBHOOK_RETRY_POLICY: PlatformBillingWebhookRetryPolicy = {
  maxAttempts: 10,
  baseDelayMs: 30_000,
  maxDelayMs: 30 * 60_000,
  jitterRatio: 0.2,
};

export function classifyPlatformBillingWebhookError(error: unknown): PlatformBillingWebhookFailureKind {
  const code = readErrorCode(error);
  if (!code) return 'TEMPORARY';

  if (
    code === 'PLATFORM_PRICE_UNKNOWN' ||
    code === 'PLATFORM_PRICE_INVALID' ||
    code === 'PLATFORM_BILLING_WEBHOOK_INVALID'
  ) {
    return 'PERMANENT';
  }

  return 'TEMPORARY';
}

export function computePlatformBillingWebhookNextAttemptAt(input: {
  attempts: number;
  now?: Date;
  policy?: Partial<PlatformBillingWebhookRetryPolicy>;
  random?: () => number;
}): Date {
  const policy = { ...DEFAULT_PLATFORM_BILLING_WEBHOOK_RETRY_POLICY, ...input.policy };
  const attempts = Math.max(1, input.attempts);
  const baseDelay = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.max(0, attempts - 1));
  const random = input.random ?? Math.random;
  const jitter = baseDelay * policy.jitterRatio * random();
  return new Date((input.now ?? new Date()).getTime() + Math.round(baseDelay + jitter));
}

export function hasExhaustedPlatformBillingWebhookAttempts(input: {
  attempts: number;
  policy?: Partial<PlatformBillingWebhookRetryPolicy>;
}): boolean {
  const policy = { ...DEFAULT_PLATFORM_BILLING_WEBHOOK_RETRY_POLICY, ...input.policy };
  return input.attempts >= policy.maxAttempts;
}

function readErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const maybe = error as { code?: unknown };
  return typeof maybe.code === 'string' ? maybe.code : null;
}
