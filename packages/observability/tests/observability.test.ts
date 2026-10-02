import { describe, expect, it } from 'vitest';
import { contextFromTraceParent, formatTraceParent, parseTraceParent } from '../src/context/index.js';
import { createStructuredLog } from '../src/logging/index.js';
import { normalizeHttpMethod, normalizeHttpRoute, normalizeMetricDimensions, statusClass } from '../src/metrics/index.js';
import { allowlistedAttributes, redactSensitiveData } from '../src/redaction/index.js';
import { createTelemetryClient, registerTelemetrySink, sharedTelemetry } from '../src/telemetry/index.js';

describe('trace context', () => {
  it('parses and formats valid W3C traceparent values', () => {
    const input = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    expect(parseTraceParent(input)).toEqual({ version: '00', traceId: '4bf92f3577b34da6a3ce929d0e0e4736', parentId: '00f067aa0ba902b7', traceFlags: 1 });
    expect(formatTraceParent(parseTraceParent(input)!)).toBe(input);
    expect(contextFromTraceParent(input)).toEqual({ traceId: '4bf92f3577b34da6a3ce929d0e0e4736', spanId: '00f067aa0ba902b7' });
  });

  it('rejects malformed and all-zero identifiers', () => {
    expect(parseTraceParent('00-00000000000000000000000000000000-00f067aa0ba902b7-01')).toBeUndefined();
    expect(parseTraceParent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-extra')).toBeUndefined();
    expect(parseTraceParent('01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-abcd')).toBeUndefined();
    expect(() => formatTraceParent({ version: 'ff', traceId: '4'.repeat(32), parentId: '5'.repeat(16), traceFlags: 0 })).toThrow();
    expect(() => formatTraceParent({ version: '01', traceId: '4'.repeat(32), parentId: '5'.repeat(16), traceFlags: 0 })).toThrow();
  });
});

describe('redaction and logs', () => {
  it('redacts sensitive nested keys and strings, cycles safely', () => {
    const value: Record<string, unknown> = { authorization: 'Bearer secret-value', safe: { email: 'x@example.com' } };
    value.tenantId = 'tenant-sensitive';
    value.studentName = 'Maria da Silva';
    value.self = value;
    expect(redactSensitiveData(value)).toEqual({ authorization: '[REDACTED]', safe: { email: '[REDACTED]' }, tenantId: '[REDACTED]', studentName: '[REDACTED]', self: '[CIRCULAR]' });
  });

  it('redacts Portuguese password keys and assignment text', () => {
    expect(redactSensitiveData({ senha: 'plain', confirmarSenha: 'again', novaSenha: 'new', senha_atual: 'old', safe: 'senha=plain confirmarSenha: "again" novaSenha=next senha_atual=older' })).toEqual({
      senha: '[REDACTED]', confirmarSenha: '[REDACTED]', novaSenha: '[REDACTED]', senha_atual: '[REDACTED]',
      safe: '[REDACTED] [REDACTED] [REDACTED] [REDACTED]',
    });
  });

  it('keeps only explicitly allowlisted non-sensitive attributes', () => {
    expect(allowlistedAttributes({ outcome: 'ok', email: 'a@b.com', detail: 'token=abc' }, ['outcome', 'detail'])).toEqual({ outcome: 'ok', detail: '[REDACTED]' });
    const log = createStructuredLog({ severity: 'info', 'service.name': 'web', 'event.name': 'http.completed', attributes: { outcome: 'ok', contaId: 'tenant-1', other: 'drop' }, allowedAttributes: ['outcome', 'other'], timestamp: '2026-01-01T00:00:00.000Z' });
    expect(log.attributes).toEqual({ outcome: 'ok', other: 'drop' });
  });

  it('redacts identifiers and secret assignments in free text', () => {
    expect(redactSensitiveData('cpf 123.456.789-01 cnpj 12.345.678/0001-90 phone +55 11 91234-5678 token=abc api_key: "xyz-123"'))
      .toBe('cpf [REDACTED] cnpj [REDACTED] phone [REDACTED] [REDACTED] [REDACTED]');
    expect(redactSensitiveData('document 12345678901 company 12345678000190 phone (11) 3234-5678'))
      .toBe('document [REDACTED] company [REDACTED] phone [REDACTED]');
  });
});

describe('metric normalization', () => {
  it('keeps known dimensions and drops tenant identifiers and high-cardinality values', () => {
    expect(normalizeMetricDimensions({ 'http.request.method': 'GET', 'http.response.status_class': '5xx', contaId: 'ct_1', result: 'invoice-123' })).toEqual({ 'http.request.method': 'get', 'http.response.status_class': '5xx' });
  });

  it('allows bounded cache states and still drops tenant identifiers', () => {
    expect(normalizeMetricDimensions({ 'cache.state': 'MISS', contaId: 'conta-123' })).toEqual({ 'cache.state': 'miss' });
  });

  it('normalizes route identifiers and status classes', () => {
    expect(normalizeHttpRoute('/api/alunos/123/profile?include=1')).toBe('/api/alunos/:id/profile');
    expect(statusClass(204)).toBe('2xx');
    expect(statusClass(700)).toBe('unknown');
    expect(normalizeHttpMethod('GET')).toBe('get');
    expect(normalizeHttpMethod('custom-attacker-method')).toBe('other');
  });

  it('normalizes Next.js dynamic and encoded dynamic route segments', () => {
    expect(normalizeHttpRoute('/api/alunos/[studentId]/[...segments]')).toBe('/api/alunos/:id/:id');
    expect(normalizeHttpRoute('/api/alunos/%5BstudentId%5D/%5B%5B...slug%5D%5D')).toBe('/api/alunos/:id/:id');
    expect(normalizeMetricDimensions({ 'http.route': normalizeHttpRoute('/api/alunos/[studentId]') })).toEqual({ 'http.route': '/api/alunos/:id' });
    expect(normalizeMetricDimensions({ 'http.route': '/api/alunos/ana%40example.com' })).toEqual({});
    expect(normalizeMetricDimensions({ 'http.route': `/api/alunos/${'x'.repeat(200)}` })).toEqual({ 'http.route': '/api/alunos/:id' });
  });

  it('preserves long static route segments while normalizing known identifiers', () => {
    expect(normalizeHttpRoute('/api/records/list-for-owner')).toBe('/api/records/list-for-owner');
    expect(normalizeHttpRoute('/api/jobs/retry-enrollment-billing')).toBe('/api/jobs/retry-enrollment-billing');
    expect(normalizeMetricDimensions({ 'http.route': normalizeHttpRoute('/api/jobs/retry-enrollment-billing') })).toEqual({ 'http.route': '/api/jobs/retry-enrollment-billing' });
    expect(normalizeHttpRoute(`/api/records/${'z'.repeat(24)}`)).toBe('/api/records/:id');
    expect(normalizeHttpRoute(`/api/records/${'c' + 'a'.repeat(24)}`)).toBe('/api/records/:id');
  });
});

describe('telemetry client', () => {
  const logRecord = { timestamp: '2026-01-01T00:00:00.000Z', severity: 'info' as const, 'service.name': 'test', 'event.name': 'test.event' };

  it('invokes the explicitly supplied sink with logs and metrics', async () => {
    const observed: unknown[] = [];
    const client = createTelemetryClient({
      log: (record) => { observed.push(record); },
      metric: (record) => { observed.push(record); },
    });

    await client.publishLog(logRecord);
    await client.recordMetric({ kind: 'counter', name: 'http.requests', value: 1, unit: 'count', dimensions: { result: 'ok' } });
    await client.recordMetric({ kind: 'distribution', name: 'http.duration', value: 23, unit: 'ms' });
    await client.recordMetric({ kind: 'gauge', name: 'queue.backlog', value: 4, unit: 'items' });
    expect(observed).toEqual([
      logRecord,
      { kind: 'counter', name: 'http.requests', value: 1, unit: 'count', dimensions: { result: 'ok' } },
      { kind: 'distribution', name: 'http.duration', value: 23, unit: 'ms' },
      { kind: 'gauge', name: 'queue.backlog', value: 4, unit: 'items' },
    ]);
  });

  it('supports replacement and unsubscribe without clearing a newer sink', async () => {
    const observed: string[] = [];
    const client = createTelemetryClient();
    const unsubscribeFirst = client.replaceSink({ log: () => { observed.push('first'); } });
    const unsubscribeSecond = client.replaceSink({ log: () => { observed.push('second'); } });
    unsubscribeFirst();
    await client.publishLog(logRecord);
    unsubscribeSecond();
    await client.publishLog(logRecord);
    expect(observed).toEqual(['second']);
  });

  it('swallows synchronous and asynchronous sink failures', async () => {
    const client = createTelemetryClient({
      log: () => { throw new Error('sink unavailable'); },
      metric: async () => { throw new Error('sink unavailable'); },
    });
    await expect(client.publishLog(logRecord)).resolves.toBeUndefined();
    await expect(client.recordMetric({ kind: 'counter', name: 'job.runs', value: 1 })).resolves.toBeUndefined();
  });

  it('registers and safely replaces the shared bootstrap sink', async () => {
    const observed: string[] = [];
    const unsubscribeFirst = registerTelemetrySink({ log: () => { observed.push('first'); } });
    const unsubscribeSecond = registerTelemetrySink({ log: () => { observed.push('second'); } });
    unsubscribeFirst();
    await sharedTelemetry.publishLog(logRecord);
    unsubscribeSecond();
    await sharedTelemetry.publishLog(logRecord);
    expect(observed).toEqual(['second']);
  });
});
