import { redactSensitiveData as redact } from '@alusa/observability';

/** Backwards-compatible web wrapper around the shared provider-neutral redactor. */
export function redactSensitiveData<T>(value: T, depth = 0): T {
  return redact(value, Math.max(1, 8 - depth)) as T;
}
