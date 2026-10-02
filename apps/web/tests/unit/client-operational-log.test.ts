import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn() }));

import * as Sentry from '@sentry/nextjs';
import { logClientOperationalEvent } from '@/lib/observability/client-operational-log';

describe('client operational logs', () => {
  afterEach(() => vi.restoreAllMocks());

  it('captures a static event and allowlisted error type once per cooldown without error details', () => {
    const captureMessage = vi.mocked(Sentry.captureMessage);
    const error = new TypeError('private@example.test; token=secret; student=123');

    logClientOperationalEvent('enrollment.create.failed', error);
    logClientOperationalEvent('enrollment.create.failed', error);

    expect(captureMessage).toHaveBeenCalledTimes(1);
    const [message, options] = captureMessage.mock.calls[0] ?? [];
    expect(message).toBe('enrollment.create.failed');
    expect(options).toMatchObject({
      level: 'error',
      tags: { event_name: 'enrollment.create.failed', error_type: 'TypeError' },
    });
    expect(JSON.stringify(options)).not.toContain('private@example.test');
    expect(JSON.stringify(options)).not.toContain('secret');
  });
});
