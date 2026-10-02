import * as Sentry from '@sentry/nextjs';
import { registerTelemetrySink, type StructuredLog, type TelemetryMetric } from '@alusa/observability';

function attributes(record: StructuredLog) {
  const values: Record<string, string | number | boolean> = {
    'service.name': record['service.name'],
    'event.name': record['event.name'],
  };
  for (const [key, value] of Object.entries({
    requestId: record.requestId,
    traceId: record.traceId,
    correlationId: record.correlationId,
    'http.route': record['http.route'],
    'http.request.method': record['http.request.method'],
    'http.response.status_code': record['http.response.status_code'],
    duration_ms: record.duration_ms,
    'error.type': record['error.type'],
  })) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') values[key] = value;
  }
  for (const [key, value] of Object.entries(record.attributes ?? {})) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') values[key] = value;
  }
  return values;
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

export function registerAdminSentryTelemetry() {
  return registerTelemetrySink({
    log(record) {
      if (!['warn', 'error', 'fatal'].includes(record.severity)) return;
      Sentry.logger[record.severity](record.message ?? record['event.name'], attributes(record));
    },
    metric: publishMetric,
  });
}
