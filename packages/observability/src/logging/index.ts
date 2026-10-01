import { allowlistedAttributes, redactSensitiveData } from '../redaction/index.js';
import type { TechnicalContext } from '../context/index.js';

export type LogSeverity = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export interface LogBase {
  timestamp: string;
  severity: LogSeverity;
  'service.name': string;
  'deployment.environment'?: string;
  'service.version'?: string;
  'event.name': string;
}
export interface StructuredLog extends LogBase, TechnicalContext {
  attributes?: Record<string, unknown>;
  'http.request.method'?: string;
  'http.route'?: string;
  'http.response.status_code'?: number;
  duration_ms?: number;
  'error.type'?: string;
  message?: string;
}
export interface CreateLogInput extends Omit<StructuredLog, 'timestamp' | 'attributes'> {
  timestamp?: string;
  attributes?: Record<string, unknown>;
  allowedAttributes?: readonly string[];
}

export function createStructuredLog(input: CreateLogInput): StructuredLog {
  const { allowedAttributes = [], attributes = {}, timestamp, ...base } = input;
  const safeAttributes = allowlistedAttributes(attributes, allowedAttributes);
  return redactSensitiveData({ ...base, timestamp: timestamp ?? new Date().toISOString(), ...(Object.keys(safeAttributes).length ? { attributes: safeAttributes } : {}) }) as StructuredLog;
}
