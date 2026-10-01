import { afterEach, describe, expect, it, vi } from 'vitest';
import { sharedTelemetry } from '@alusa/observability';

import { logApiError, logApiResponse } from '@/lib/observability/api-logger';

describe('API logger telemetry sink', () => {
  let restoreTelemetry: (() => void) | undefined;

  afterEach(() => {
    restoreTelemetry?.();
    restoreTelemetry = undefined;
    vi.restoreAllMocks();
  });

  it('publishes each warning/error once while preserving API output and console logs', () => {
    const log = vi.fn();
    restoreTelemetry = sharedTelemetry.replaceSink({ log });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    logApiError({
      route: '/api/students/[id]',
      method: 'GET',
      requestId: 'request-id-123',
      startedAt: Date.now(),
      error: new Error('private message must not be logged'),
    });
    logApiResponse({
      route: '/api/students/[id]',
      method: 'PATCH',
      requestId: 'request-id-456',
      status: 422,
      startedAt: Date.now(),
    });
    logApiResponse({
      route: '/api/students/[id]',
      method: 'GET',
      requestId: 'request-id-789',
      status: 503,
      startedAt: Date.now(),
    });

    expect(log).toHaveBeenCalledTimes(3);
    expect(log.mock.calls.map(([record]) => record)).toEqual([
      expect.objectContaining({ severity: 'error', 'event.name': 'api.request.failed' }),
      expect.objectContaining({ severity: 'warn', 'event.name': 'api.request.rejected' }),
      expect.objectContaining({ severity: 'error', 'event.name': 'api.request.rejected' }),
    ]);
    expect(JSON.stringify(log.mock.calls)).not.toContain('private message');
    expect(console.error).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('does not publish informational responses', () => {
    const log = vi.fn();
    restoreTelemetry = sharedTelemetry.replaceSink({ log });
    logApiResponse({
      route: '/api/health',
      method: 'GET',
      requestId: 'request-id-info',
      status: 200,
      startedAt: Date.now(),
    });
    expect(log).not.toHaveBeenCalled();
  });
});
