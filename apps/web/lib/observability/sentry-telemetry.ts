import * as Sentry from '@sentry/nextjs';
import {
  registerTelemetrySink,
  type StructuredLog,
  type TelemetryMetric,
} from '@alusa/observability';

const LOG_LEVELS = new Set(['warn', 'error', 'fatal']);

function logAttributes(record: StructuredLog): Record<string, string | number | boolean> {
  const attributes: Record<string, string | number | boolean> = {
    'service.name': record['service.name'],
    'event.name': record['event.name'],
  };

  for (const [key, value] of Object.entries({
    requestId: record.requestId,
    traceId: record.traceId,
    spanId: record.spanId,
    correlationId: record.correlationId,
    'deployment.environment': record['deployment.environment'],
    'service.version': record['service.version'],
    'http.request.method': record['http.request.method'],
    'http.route': record['http.route'],
    'http.response.status_code': record['http.response.status_code'],
    duration_ms: record.duration_ms,
    'error.type': record['error.type'],
  })) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      attributes[key] = value;
    }
  }

  for (const [key, value] of Object.entries(record.attributes ?? {})) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      attributes[key] = value;
    }
  }
  return attributes;
}

function publishMetric(metric: TelemetryMetric) {
  const options = {
    ...(metric.unit ? { unit: metric.unit } : {}),
    ...(metric.dimensions ? { attributes: metric.dimensions } : {}),
  };
  if (metric.kind === 'counter') Sentry.metrics.count(metric.name, metric.value, options);
  else if (metric.kind === 'distribution') Sentry.metrics.distribution(metric.name, metric.value, options);
  else Sentry.metrics.gauge(metric.name, metric.value, options);
}

/** Installs Sentry as the web runtime's provider for the vendor-neutral port. */
export function registerSentryTelemetry() {
  return registerTelemetrySink({
    log(record) {
      if (!LOG_LEVELS.has(record.severity)) return;
      Sentry.logger[record.severity](record.message ?? record['event.name'], logAttributes(record));
    },
    metric: publishMetric,
  });
}
