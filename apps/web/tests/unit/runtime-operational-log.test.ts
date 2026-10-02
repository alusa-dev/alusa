import { afterEach, describe, expect, it, vi } from 'vitest';

import { logRuntimeOperationalEvent } from '@/lib/observability/runtime-operational-log';

describe('runtime operational logs', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits stable structured fields and suppresses repeated events without error details', () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = new TypeError('private email person@example.test and tenant tenant-secret');

    logRuntimeOperationalEvent({ eventName: 'dashboard.prefetch.failed', error });
    logRuntimeOperationalEvent({ eventName: 'dashboard.prefetch.failed', error });

    expect(errorLog).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(errorLog.mock.calls[0]?.[0])) as Record<string, unknown>;
    const serialized = JSON.stringify(payload);
    expect(payload['event.name']).toBe('dashboard.prefetch.failed');
    expect(payload['error.type']).toBe('TypeError');
    expect(payload['http.route']).toBe('/internal/operational-event');
    expect(serialized).not.toContain('person@example.test');
    expect(serialized).not.toContain('tenant-secret');
  });
});
