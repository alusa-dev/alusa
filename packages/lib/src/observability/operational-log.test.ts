import { afterEach, describe, expect, it, vi } from 'vitest';
import { logLibOperationalEvent } from './operational-log';

describe('logLibOperationalEvent', () => {
  afterEach(() => vi.restoreAllMocks());

  it('emits only the stable event, error type, and allowlisted count', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = new Error('sensitive account and customer details');
    Object.assign(error, { accountId: 'tenant-secret', studentId: 'student-secret' });

    logLibOperationalEvent({
      eventName: 'notification.pending_inbox.enqueue.failed',
      error,
      count: 4,
    });

    expect(warn).toHaveBeenCalledTimes(1);
    const record = JSON.parse(String(warn.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(record['event.name']).toBe('notification.pending_inbox.enqueue.failed');
    expect(record['error.type']).toBe('Error');
    expect(record.attributes).toEqual({ count: 4 });
    expect(JSON.stringify(record)).not.toContain('sensitive account');
    expect(JSON.stringify(record)).not.toContain('tenant-secret');
    expect(JSON.stringify(record)).not.toContain('student-secret');
  });

  it('throttles repeated events into an aggregate count', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    logLibOperationalEvent({ eventName: 'event_map.reservation.expire.skipped', severity: 'info', count: 3 });
    logLibOperationalEvent({ eventName: 'event_map.reservation.expire.skipped', severity: 'info', count: 2 });
    expect(info).toHaveBeenCalledTimes(1);

    now += 60_000;
    logLibOperationalEvent({ eventName: 'event_map.reservation.expire.skipped', severity: 'info' });
    expect(info).toHaveBeenCalledTimes(2);
    const summary = JSON.parse(String(info.mock.calls[1]?.[0])) as { attributes?: { count?: number } };
    expect(summary.attributes?.count).toBe(3);
  });

  it('keeps inbox failure aggregates separated by bounded reason without request data', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    logLibOperationalEvent({ eventName: 'inbox.pending.failed', severity: 'error', failureReason: 'entity_missing' });
    logLibOperationalEvent({ eventName: 'inbox.pending.failed', severity: 'error', failureReason: 'payload_integrity' });
    now += 60_000;
    logLibOperationalEvent({ eventName: 'inbox.pending.failed', severity: 'error', failureReason: 'entity_missing' });
    logLibOperationalEvent({ eventName: 'inbox.pending.failed', severity: 'error', failureReason: 'payload_integrity' });

    const records = error.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
    expect(records).toHaveLength(4);
    expect(records.map((record) => (record.attributes as { failureReason: string }).failureReason)).toEqual([
      'entity_missing', 'payload_integrity', 'entity_missing', 'payload_integrity',
    ]);
    expect(records.every((record) => record['event.name'] === 'inbox.pending.failed')).toBe(true);
    expect(JSON.stringify(records)).not.toMatch(/dedupe|conta|customer|payment|message|student-secret/i);
  });
});
