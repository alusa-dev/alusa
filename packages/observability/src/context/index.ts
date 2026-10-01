/** IDs are intentionally separate: requestId identifies one inbound request,
 * traceId identifies a distributed trace, and correlationId links a business operation across work/retries.
 */
export interface TechnicalContext {
  requestId?: string;
  traceId?: string;
  spanId?: string;
  correlationId?: string;
}

export interface TraceParent {
  version: string;
  traceId: string;
  parentId: string;
  traceFlags: number;
}

const TRACEPARENT_PATTERN = /^(?!ff)([\da-f]{2})-([\da-f]{32})-([\da-f]{16})-([\da-f]{2})(?:-([\da-f]{2}(?:-[\da-f]{2})*))?$/i;
const allZero = (value: string) => /^0+$/.test(value);

export function parseTraceParent(value: string | null | undefined): TraceParent | undefined {
  if (!value) return undefined;
  const match = TRACEPARENT_PATTERN.exec(value.trim());
  if (!match) return undefined;
  const [, version, traceId, parentId, flags, extension] = match;
  // This helper models version 00 only. Reject future versions until their
  // extension fields can be represented and round-tripped without loss.
  if (version.toLowerCase() !== '00' || extension || allZero(traceId) || allZero(parentId)) return undefined;
  return { version: version.toLowerCase(), traceId: traceId.toLowerCase(), parentId: parentId.toLowerCase(), traceFlags: Number.parseInt(flags, 16) };
}

export function formatTraceParent(context: TraceParent): string {
  const version = context.version.toLowerCase();
  const traceId = context.traceId.toLowerCase();
  const parentId = context.parentId.toLowerCase();
  if (version !== '00' || !/^[\da-f]{32}$/.test(traceId) || allZero(traceId) || !/^[\da-f]{16}$/.test(parentId) || allZero(parentId) || !Number.isInteger(context.traceFlags) || context.traceFlags < 0 || context.traceFlags > 255) {
    throw new TypeError('Invalid W3C trace context');
  }
  return `${version}-${traceId}-${parentId}-${context.traceFlags.toString(16).padStart(2, '0')}`;
}

export function contextFromTraceParent(value: string | null | undefined): Pick<TechnicalContext, 'traceId' | 'spanId'> | undefined {
  const parsed = parseTraceParent(value);
  return parsed ? { traceId: parsed.traceId, spanId: parsed.parentId } : undefined;
}
