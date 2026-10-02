import { createStructuredLog, sharedTelemetry } from '@alusa/observability';

type CredentialSource = 'asaasAccount' | 'asaasCredential' | 'conta_legacy' | 'none';
type CredentialEventName =
  | 'asaas.credentials.fallback_used'
  | 'asaas.credentials.decryption_failed'
  | 'asaas.credentials.rotation_deferred';
type SafeErrorType = 'Error' | 'PrismaClientKnownRequestError' | 'PrismaClientValidationError';

const buckets = new Map<string, { count: number; lastEmittedAt: number }>();
function safeErrorType(error: unknown): SafeErrorType | undefined {
  if (!(error instanceof Error)) return undefined;
  switch (error.name) {
    case 'PrismaClientKnownRequestError':
    case 'PrismaClientValidationError':
      return error.name;
    case 'Error':
    default:
      return 'Error';
  }
}

export function logCredentialOperationalEvent(params: {
  eventName: CredentialEventName;
  severity: 'warn' | 'error';
  source?: CredentialSource;
  error?: unknown;
  sourceCount?: number;
  unreadableCount?: number;
}): void {
  const bucketKey = `${params.eventName}:${params.source ?? 'none'}`;
  const now = Date.now();
  const bucket = buckets.get(bucketKey) ?? { count: 0, lastEmittedAt: 0 };
  bucket.count += 1;
  buckets.set(bucketKey, bucket);
  if (bucket.lastEmittedAt > 0 && now - bucket.lastEmittedAt < 60_000) return;

  const log = createStructuredLog({
    severity: params.severity,
    'service.name': 'alusa-database',
    'deployment.environment': process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    'event.name': params.eventName,
    'error.type': safeErrorType(params.error),
    attributes: {
      source: params.source,
      count: bucket.count,
      ...(Number.isSafeInteger(params.sourceCount) && (params.sourceCount ?? -1) >= 0
        ? { sourceCount: params.sourceCount }
        : {}),
      ...(Number.isSafeInteger(params.unreadableCount) && (params.unreadableCount ?? -1) >= 0
        ? { unreadableCount: params.unreadableCount }
        : {}),
    },
    allowedAttributes: ['source', 'count', 'sourceCount', 'unreadableCount'],
  });
  bucket.count = 0;
  bucket.lastEmittedAt = now;
  if (params.severity === 'error') console.error(JSON.stringify(log));
  else console.warn(JSON.stringify(log));
  void sharedTelemetry.publishLog(log);
}
