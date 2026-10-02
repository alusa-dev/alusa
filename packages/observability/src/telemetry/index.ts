import type { StructuredLog } from '../logging/index.js';
import type { MetricDimensions } from '../metrics/index.js';

export interface TelemetryMetric {
  kind: 'counter' | 'distribution' | 'gauge';
  name: string;
  value: number;
  unit?: string;
  dimensions?: MetricDimensions;
}

export interface TelemetrySink {
  log?: (record: StructuredLog) => void | Promise<void>;
  metric?: (record: TelemetryMetric) => void | Promise<void>;
}

/** Explicit, provider-neutral port. The client retains only the active sink callback. */
export interface TelemetryClient {
  publishLog(record: StructuredLog): Promise<void>;
  recordMetric(record: TelemetryMetric): Promise<void>;
  replaceSink(sink?: TelemetrySink): () => void;
}

const NOOP_SINK: TelemetrySink = Object.freeze({});

/**
 * Creates an isolated telemetry client for an app or service to pass explicitly.
 * Sink failures are swallowed so observability can never fail a business operation.
 */
export function createTelemetryClient(initialSink: TelemetrySink = NOOP_SINK): TelemetryClient {
  let activeSink = initialSink;
  let activeRegistration = Symbol('telemetry-sink');

  const replaceSink = (sink: TelemetrySink = NOOP_SINK): (() => void) => {
    const registration = Symbol('telemetry-sink');
    activeRegistration = registration;
    activeSink = sink;
    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      // An old adapter must not clear a sink that has since replaced it.
      if (activeRegistration === registration) {
        activeRegistration = Symbol('telemetry-sink');
        activeSink = NOOP_SINK;
      }
    };
  };

  const safelyPublish = async (kind: 'log' | 'metric', record: StructuredLog | TelemetryMetric): Promise<void> => {
    const callback = activeSink[kind] as ((value: StructuredLog | TelemetryMetric) => void | Promise<void>) | undefined;
    if (!callback) return;
    try {
      await callback(record);
    } catch {
      // Telemetry is best-effort. Do not leak event contents or affect callers.
    }
  };

  return {
    publishLog: (record) => safelyPublish('log', record),
    recordMetric: (record) => safelyPublish('metric', record),
    replaceSink,
  };
}

/**
 * Process/module-scoped convenience client for consumers without a practical
 * per-call DI path. Registration retains only stateless callback references;
 * request, event, and tenant data are supplied per call and are never buffered
 * or retained by this package.
 */
export const sharedTelemetry = createTelemetryClient();

/** Installs an app bootstrap adapter on the shared client; unsubscribe is safe if replaced. */
export function registerTelemetrySink(sink: TelemetrySink): () => void {
  return sharedTelemetry.replaceSink(sink);
}
